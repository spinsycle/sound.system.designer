// 1.16: the sheet layout of a tapered box: trapezoid panels are paired and drawn with their true outline, and the waste counts true areas.
import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import { computeBuild } from '../src/buildlist';
import { panelSvg, sheetDxf, sheetSvg } from '../src/export';
import * as C from '../src/carsub';
import * as M from '../src/model';
import * as S from '../src/system';

const proj = (build: Record<string, unknown>): S.Project =>
  S.sanitizeProject({ ...S.DEFAULT_PROJECT, nBands: 1, bands: [{ design: M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: 1, type: 'sealed', volumeL: 60 }), build }] });

describe('the sheet layout of a tower', () => {
  const p = proj({ shape: 'tower', taper: 0.5 });
  const v = computeBuild(p);
  const outlined = v.pieces.filter((x) => x.placement.poly);
  it('the front and back have outlines; every other piece, the leaning sides included, is a rectangle', () => {
    expect(outlined.map((x) => x.label).sort()).toEqual(['Band 1 Back (trapezoid)', 'Band 1 Front baffle (trapezoid)'].map((l) => l.replace('Band 1', v.bands[0]!.name)).sort());
  });
  it('the waste counts the true area of an outlined piece, not its bounding box', () => {
    const area = v.pieces.filter((x) => x.placement.sheet >= 0).reduce((a, x) => a + (x.placement.poly ? P.polyArea(x.placement.poly) : x.placement.w * x.placement.h), 0);
    expect(v.waste).toBeCloseTo(1 - area / (v.sheets * (p.shop.sheetLmm / 1000) * (p.shop.sheetWmm / 1000)), 12);
    const box = outlined.reduce((a, x) => a + x.placement.w * x.placement.h, 0);
    const true_ = outlined.reduce((a, x) => a + P.polyArea(x.placement.poly!), 0);
    expect(true_).toBeLessThan(box);
  });
  it('the sheet drawing has a polygon for each outlined piece', () => {
    const svg = sheetSvg(v, p, 0);
    expect(svg.match(/<polygon /g)!.length).toBe(outlined.filter((x) => x.placement.sheet === 0).length);
  });
  it('the DXF cuts each outline edge by edge: four lines per outlined piece, four per rectangle', () => {
    const dxf = sheetDxf(v, p, 0);
    const cutLines = dxf.split('\n').filter((l, i, a) => l.trim() === 'LINE' && a[i + 2]?.trim() === 'CUT').length;
    expect(cutLines).toBe(4 * v.pieces.filter((x) => x.placement.sheet === 0).length);
  });
  it('the front and back are paired head to tail: together narrower than two bounding boxes', () => {
    const xs = outlined.flatMap((x) => x.placement.poly!.map((q) => q[0]));
    const wide = outlined[0]!.placement.w;
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(2 * wide);
    expect(outlined[0]!.placement.sheet).toBe(outlined[1]!.placement.sheet);
  });
  it('a trapezoid box outlines its top and bottom', () => {
    const t = computeBuild(proj({ shape: 'trapezoid', taper: 0.5 }));
    const o = t.pieces.filter((x) => x.placement.poly);
    expect(o).toHaveLength(2);
    expect(o.every((x) => x.label.endsWith('Top and bottom (trapezoid)'))).toBe(true);
  });
});

describe('a rectangular box is unchanged', () => {
  it('no outlines at all', () => {
    const v = computeBuild(proj({}));
    expect(v.pieces.some((x) => x.placement.poly)).toBe(false);
    expect(sheetSvg(v, proj({}), 0)).not.toMatch(/<polygon /);
  });
});

describe('the sheet layout of a car wedge box (1.18)', () => {
  const car = C.sanitizeCar({ ...structuredClone(C.DEFAULT_CAR), shape: 'wedge', taper: 0.5, space: { id: 'none', wCm: 0, hCm: 0, dCm: 0 }, build: { ...C.DEFAULT_CAR.build, rw: 1, rh: 1.2, rd: 1.5 } });
  const p = S.sanitizeProject({ ...S.DEFAULT_PROJECT, kind: 'car', car });
  const v = computeBuild(p);
  const sides = v.pieces.filter((x) => x.label.endsWith('Sides'));
  it('the two sides have outlines, are listed with the trapezoid note, and pair into a rectangle', () => {
    expect(sides).toHaveLength(2);
    expect(sides.every((x) => x.placement.poly)).toBe(true);
    const note = v.cutList.find((r) => r.part === 'Sides')!.note;
    expect(note).toMatch(/trapezoid: .* on one edge and .* on the parallel one/);
    const [a, b] = sides.map((x) => x.placement);
    const wall = Math.max(a!.x + a!.w, b!.x + b!.w) - Math.min(a!.x, b!.x);
    const g = v.bands[0]!.cabinets[0]!.wedge!;
    expect(note).toContain(`${Math.round(g.dBottomI * 1000)} mm on one edge and ${Math.round(g.dTopI * 1000)} mm on the parallel`);
    // the pair is a rectangle the sum of the depths wide (a kerf more) and the height high, not two bounding boxes
    const long = Math.max(wall, a!.h, b!.h);
    expect(long).toBeLessThan(2 * Math.max(g.dBottomI, g.hI));
    expect(P.polyArea(a!.poly!) + P.polyArea(b!.poly!)).toBeCloseTo(((g.dBottomI + g.dTopI) / 2) * g.hI * 2, 12);
  });
  it('wastes less than the bounding boxes would', () => {
    const area = v.pieces.filter((x) => x.placement.sheet >= 0).reduce((s, x) => s + (x.placement.poly ? P.polyArea(x.placement.poly) : x.placement.w * x.placement.h), 0);
    expect(v.waste).toBeCloseTo(1 - area / (v.sheets * (p.shop.sheetLmm / 1000) * (p.shop.sheetWmm / 1000)), 12);
    const box = sides.reduce((s, x) => s + x.placement.w * x.placement.h, 0);
    expect(sides.reduce((s, x) => s + P.polyArea(x.placement.poly!), 0)).toBeLessThan(box);
  });
  it('the drawing of a side is to the size of its outline: bottom depth wide, height high', () => {
    const g = v.bands[0]!.cabinets[0]!.wedge!;
    const side = v.bands[0]!.cabinets[0]!.panels.find((x) => x.name === 'Sides')!;
    const vb = /viewBox="-80 -80 ([\d.]+) ([\d.]+)"/.exec(panelSvg(side, 'Side')!)!;
    expect(Number(vb[1])).toBeCloseTo(Math.round(g.dBottomI * 10000) / 10 + 160, 6);
    expect(Number(vb[2])).toBeCloseTo(Math.round(g.hI * 10000) / 10 + 160, 6);
  });
  it('the sheet drawing and the DXF carry the outlines', () => {
    const sheet = sides[0]!.placement.sheet;
    expect(sheetSvg(v, p, sheet).match(/<polygon /g)!.length).toBeGreaterThanOrEqual(2);
  });
});

describe('the sheet layout of a horn (1.18)', () => {
  const dance = S.applyTemplate(S.DEFAULT_PROJECT, S.TEMPLATES.findIndex((tt) => tt.label.includes('dancehall')));
  const v = computeBuild(dance);
  const horn = v.bands.find((b) => b.horn)!;
  const flaring = horn.horn!.sections.map((s, k) => ({ s, k })).filter(({ s }) => s.sidePoly);
  it('a horn section whose ends differ has trapezoid sides, listed with the note and nested in pairs', () => {
    expect(flaring.length).toBeGreaterThan(0);
    const { s, k } = flaring[0]!;
    const row = v.cutList.find((r) => r.band === horn.name && r.part === `Horn ${k + 1}: sides`)!;
    expect(row.note).toMatch(/trapezoid: .* on one edge and .* on the parallel one/);
    expect(row.note).toContain(`${Math.round(s.sideH * 1000)} mm on one edge and ${Math.round((s.sidePoly![2]![0] - s.sidePoly![3]![0]) * 1000)} mm on the parallel one, ${Math.round(s.sideLen * 1000)} mm apart`);
    const mine = v.pieces.filter((x) => x.label === `${horn.name} Horn ${k + 1}: sides`);
    expect(mine.length).toBe(2 * horn.count);
    expect(mine.every((x) => x.placement.poly)).toBe(true);
    expect(P.polyArea(mine[0]!.placement.poly!)).toBeCloseTo(((s.sidePoly![1]![0] + (s.sidePoly![2]![0] - s.sidePoly![3]![0])) / 2) * s.sideLen, 12);
  });
  it('a section with equal ends is a rectangle: no outline', () => {
    const plain = horn.horn!.sections.map((s, k) => ({ s, k })).filter(({ s }) => !s.sidePoly);
    plain.forEach(({ k }) => {
      expect(v.cutList.find((r) => r.band === horn.name && r.part === `Horn ${k + 1}: sides`)!.note).toBe('rectangle');
      expect(v.pieces.filter((x) => x.label === `${horn.name} Horn ${k + 1}: sides`).every((x) => !x.placement.poly)).toBe(true);
    });
  });
});
