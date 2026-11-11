// Edge cases of the cabinet library that the shared vectors do not reach: brace thresholds, narrow braces, packing order,
// kerf and oversize pieces.
import { describe, expect, it } from 'vitest';
import * as P from '../src/index';

describe('braces', () => {
  it('a single brace needs 0.2 m of depth; window braces count from 0.4 m', () => {
    expect(P.braceCount('single', 0.19)).toBe(0);
    expect(P.braceCount('single', 0.2)).toBe(1);
    expect(P.braceCount('none', 5)).toBe(0);
    expect(P.braceCount('window', 0.4)).toBe(0);
    expect(P.braceCount('window', 0.41)).toBe(1);
    expect(P.braceCount('window', 0.8)).toBe(1);
    expect(P.braceCount('window', 0.81)).toBe(2);
  });

  it('a frame narrower than its two bars in either direction is solid', () => {
    const t = 0.018;
    expect(P.braceVolume(0.08, 0.5, t)).toBeCloseTo(0.08 * 0.5 * t, 12);
    expect(P.braceVolume(0.5, 0.08, t)).toBeCloseTo(0.5 * 0.08 * t, 12);
    expect(P.braceVolume(0.5, 0.5, t)).toBeCloseTo((0.25 - 0.4 * 0.4) * t, 12);
  });
});

describe('horn sections', () => {
  it('keep the inside heights at their throat and mouth ends', () => {
    const s = P.hornPanels([{ x: 0, h: 0.1 }, { x: 0.5, h: 0.18 }], 0.3, 0.018)[0]!;
    expect([s.h1, s.h2]).toEqual([0.1, 0.18]);
  });
});

describe('sheet packing', () => {
  const pk = (pieces: [number, number][], kerf = 0.003) => P.packSheets(pieces.map(([l, w]) => ({ l, w })), 2.44, 1.22, kerf);

  it('equal shelf heights: the longer piece goes first', () => {
    const r = pk([[0.5, 0.3], [0.9, 0.3]]);
    expect(r.placements[1]!.x).toBe(0);
    expect(r.placements[0]!.x).toBeCloseTo(0.9 + 0.003, 12);
  });

  it('every piece on a shelf is followed by a kerf', () => {
    const r = pk([[0.5, 0.3], [0.5, 0.3], [0.5, 0.3]]);
    expect(r.placements.map((p) => p.x)).toEqual([0, 0.503, 1.006].map((x) => expect.closeTo(x, 12)));
    expect(r.sheets).toBe(1);
  });

  it('a shelf above is a kerf higher', () => {
    const r = pk([[2.4, 0.5], [2.4, 0.4]]);
    expect(r.placements[1]!.y).toBeCloseTo(0.5 + 0.003, 12);
  });

  it('a second shelf on the same sheet also leaves a kerf after its first piece', () => {
    const r = pk([[2.4, 0.5], [0.5, 0.4], [0.5, 0.4]]);
    expect(r.placements[1]!.x).toBe(0);
    expect(r.placements[2]!.x).toBeCloseTo(0.503, 12);
    expect(r.placements[2]!.y).toBeCloseTo(0.503, 12);
  });

  it('a piece wider than the sheet is oversize even when its length fits', () => {
    const r = pk([[1.3, 1.3], [1.0, 1.0]]);
    expect(r.placements[0]!.sheet).toBe(-1);
    expect(r.placements[1]!.sheet).toBe(0);
    expect(r.sheets).toBe(1);
  });
});
