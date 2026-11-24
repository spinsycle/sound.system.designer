// 1.16: the sheet layout of a tapered box: trapezoid panels are paired and drawn with their true outline, and the waste counts true areas.
import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import { computeBuild } from '../src/buildlist';
import { sheetDxf, sheetSvg } from '../src/export';
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
