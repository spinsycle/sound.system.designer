// 1.14: the tapered box (plan trapezoid and tower): the air is held exactly, the dimensions follow the proportions and the taper, the
// side walls have the right slant and lean, and the panels are the ones the geometry asks for. App-only physics: no shared vectors.
import { describe, expect, it } from 'vitest';
import * as P from '../src/index';

const T = 0.018;
const solve = (taper: number, axis: P.TaperAxis, over: { v?: number; disp?: number; rw?: number; rh?: number; rd?: number } = {}) =>
  P.solveTaper(over.v ?? 0.05, over.disp ?? 0.002, over.rw ?? 1.6, over.rh ?? 2.6, over.rd ?? 1, taper, axis, T);

describe('solveTaper', () => {
  it('holds the air: (wide + narrow) / 2 x height x depth less the displacement is the net volume', () => {
    for (const axis of ['plan', 'height'] as const) {
      for (const taper of [0.3, 0.55, 0.8, 1]) {
        const g = solve(taper, axis);
        expect(((g.wideI + g.narrowI) / 2) * g.hI * g.dI - 0.002).toBeCloseTo(0.05, 12);
        expect(g.netM3).toBeCloseTo(0.05, 12);
      }
    }
  });
  it('the proportions are wide : height : depth and the narrow end is the taper times the wide end', () => {
    const g = solve(0.6, 'plan', { rw: 2, rh: 3, rd: 1 });
    expect(g.hI / g.wideI).toBeCloseTo(1.5, 12);
    expect(g.dI / g.wideI).toBeCloseTo(0.5, 12);
    expect(g.narrowI / g.wideI).toBeCloseTo(0.6, 12);
    expect(g.taper).toBe(0.6);
  });
  it('outside sizes add two walls', () => {
    const g = solve(0.7, 'height');
    expect([g.wideO - g.wideI, g.narrowO - g.narrowI, g.hO - g.hI, g.dO - g.dI].map((x) => Number(x.toFixed(12)))).toEqual([2 * T, 2 * T, 2 * T, 2 * T]);
  });
  it('a taper of 1 is a plain box with the same proportions and no lean', () => {
    const g = solve(1, 'plan');
    const b = P.solveBox(0.05, 0.002, 1.6, 2.6, 1, T, 'none', false);
    expect(g.wideI).toBeCloseTo(b.wI, 12);
    expect(g.hI).toBeCloseTo(b.hI, 12);
    expect(g.dI).toBeCloseTo(b.dI, 12);
    expect(g.insetI).toBe(0);
    expect(g.angleDeg).toBe(0);
    expect(g.slantI).toBeCloseTo(g.dI, 12);
  });
  it('plan: the side walls lean over the depth; tower: over the height', () => {
    const p = solve(0.5, 'plan');
    expect(p.insetI).toBeCloseTo((p.wideI - p.narrowI) / 2, 12);
    expect(p.slantI).toBeCloseTo(Math.hypot(p.dI, p.insetI), 12);
    expect(p.angleDeg).toBeCloseTo((Math.atan(p.insetI / p.dI) * 180) / Math.PI, 9);
    const h = solve(0.5, 'height');
    expect(h.slantI).toBeCloseTo(Math.hypot(h.hI, h.insetI), 12);
    expect(h.angleDeg).toBeCloseTo((Math.atan(h.insetI / h.hI) * 180) / Math.PI, 9);
    expect(h.angleDeg).not.toBeCloseTo(p.angleDeg, 3);
    expect(p.axis).toBe('plan');
    expect(h.axis).toBe('height');
  });
  it('a known case: a 0.5 taper, 2:2:1, 20 L, no displacement, 18 mm walls', () => {
    // 20 L = s^3 x 2 x 2 x 1 x 0.75  =>  s = (0.02 / 3)^(1/3)
    const s = (0.02 / 3) ** (1 / 3);
    const g = P.solveTaper(0.02, 0, 2, 2, 1, 0.5, 'plan', 0.018);
    expect(g.wideI).toBeCloseTo(2 * s, 12);
    expect(g.narrowI).toBeCloseTo(s, 12);
    expect(g.insetI).toBeCloseTo(s / 2, 12);
    expect(g.dI).toBeCloseTo(s, 12);
    expect(g.angleDeg).toBeCloseTo((Math.atan(0.5) * 180) / Math.PI, 9);
  });
  it('more displacement makes a bigger box and a smaller net is not smaller than the air asked for', () => {
    expect(solve(0.7, 'plan', { disp: 0.004 }).wideI).toBeGreaterThan(solve(0.7, 'plan', { disp: 0.001 }).wideI);
    expect(solve(0.7, 'plan', { disp: 0.004 }).netM3).toBeCloseTo(0.05, 12);
  });
});

describe('taperPanels', () => {
  const area = (poly: [number, number][]): number => Math.abs(poly.reduce((a, [x, y], i) => a + (x * poly[(i + 1) % poly.length]![1] - poly[(i + 1) % poly.length]![0] * y), 0)) / 2;
  it('plan: a wide front, a narrow back, trapezoid top and bottom, angled sides', () => {
    const g = solve(0.6, 'plan');
    const p = P.taperPanels(g);
    expect(p.map((x) => [x.name, x.qty])).toEqual([['Front baffle (wide end)', 1], ['Back (narrow end)', 1], ['Top and bottom (trapezoid)', 2], ['Sides (angled)', 2]]);
    expect([p[0]!.l, p[0]!.w]).toEqual([g.wideO, g.hO]);
    expect([p[1]!.l, p[1]!.w]).toEqual([g.narrowO, g.hO]);
    expect([p[2]!.l, p[2]!.w]).toEqual([g.wideO, g.dI]);
    expect([p[3]!.l, p[3]!.w]).toEqual([g.slantI, g.hI]);
    expect(p[3]!.bevelDeg).toBe(g.angleDeg);
    expect(p[3]!.bevelEdges).toMatch(/front and the back/);
    expect(p[0]!.poly).toBeUndefined();
    expect(p[1]!.bevelDeg).toBeUndefined();
  });
  it('plan: the top outline is the trapezoid, with its parallel edges the front and the back widths', () => {
    const g = solve(0.6, 'plan');
    const poly = P.taperPanels(g)[2]!.poly!;
    expect(poly).toHaveLength(4);
    expect(poly[0]).toEqual([0, 0]);
    expect(poly[1]![0]).toBeCloseTo(g.wideO, 12);
    expect(poly[2]![0] - poly[3]![0]).toBeCloseTo(g.narrowO, 12);
    expect(poly[2]![1]).toBeCloseTo(g.dI, 12);
    expect(area(poly)).toBeCloseTo(((g.wideO + g.narrowO) / 2) * g.dI, 12);
    // symmetric about the middle
    expect(poly[3]![0]).toBeCloseTo(g.wideO - poly[2]![0], 12);
  });
  it('tower: trapezoid front and back, a wide bottom, a narrow top, leaning sides', () => {
    const g = solve(0.6, 'height');
    const p = P.taperPanels(g);
    expect(p.map((x) => [x.name, x.qty])).toEqual([['Front baffle (trapezoid)', 1], ['Back (trapezoid)', 1], ['Bottom (wide end)', 1], ['Top (narrow end)', 1], ['Sides (leaning)', 2]]);
    expect([p[2]!.l, p[2]!.w]).toEqual([g.wideO, g.dI]);
    expect([p[3]!.l, p[3]!.w]).toEqual([g.narrowO, g.dI]);
    expect([p[4]!.l, p[4]!.w]).toEqual([g.slantI, g.dI]);
    expect(p[4]!.bevelDeg).toBe(g.angleDeg);
    expect(p[4]!.bevelEdges).toMatch(/top and the bottom/);
    for (const k of [0, 1]) {
      const poly = p[k]!.poly!;
      expect(area(poly)).toBeCloseTo(((g.wideO + g.narrowO) / 2) * g.hO, 12);
      expect(poly[2]![0] - poly[3]![0]).toBeCloseTo(g.narrowO, 12);
      expect(poly[2]![1]).toBeCloseTo(g.hO, 12);
      expect([p[k]!.l, p[k]!.w]).toEqual([g.wideO, g.hO]);
    }
  });
  it('the wood of the walls is about the shell around the interior (plan, rough check: outside prism less inside prism)', () => {
    const g = solve(0.6, 'plan');
    const wood = P.taperPanels(g).reduce((a, p) => a + p.qty * p.l * p.w * T * (p.poly ? area(p.poly) / (p.l * p.w) : 1), 0);
    const outside = ((g.wideO + g.narrowO) / 2) * g.hO * g.dO;
    const inside = ((g.wideI + g.narrowI) / 2) * g.hI * g.dI;
    // butt joints and slanted sides make this a few per cent off, never wildly
    expect(wood / (outside - inside)).toBeGreaterThan(0.85);
    expect(wood / (outside - inside)).toBeLessThan(1.15);
  });
});
