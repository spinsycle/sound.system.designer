// Outline nesting: identical isosceles trapezoids lie head to tail as one unit; everything else packs as packSheets does.
import { describe, expect, it } from 'vitest';
import * as P from '../src';

const trap = (a: number, b: number, h: number): [number, number][] => [[0, 0], [a, 0], [(a + b) / 2, h], [(a - b) / 2, h]];
const piece = (a: number, b: number, h: number): P.NestPiece => ({ l: a, w: h, poly: trap(a, b, h) });
const SL = 2.44;
const SW = 1.22;
const K = 0.003;

/** Two convex polygons overlap (more than touching) when no edge normal of either separates them. */
function overlap(p: [number, number][], q: [number, number][]): boolean {
  for (const poly of [p, q]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      const nx = b[1] - a[1];
      const ny = a[0] - b[0];
      const proj = (s: [number, number][]) => s.map((v) => v[0] * nx + v[1] * ny);
      const pa = proj(p);
      const pb = proj(q);
      if (Math.max(...pa) <= Math.min(...pb) + 1e-9 || Math.max(...pb) <= Math.min(...pa) + 1e-9) return false;
    }
  }
  return true;
}
/** Smallest distance from a vertex of one polygon to the other's edges is at least d (a cheap gap check for parallel edges). */
const gap = (p: [number, number][], q: [number, number][]): number => {
  let best = Infinity;
  for (const [x, y] of p)
    for (let i = 0; i < q.length; i++) {
      const a = q[i]!;
      const b = q[(i + 1) % q.length]!;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2)));
      best = Math.min(best, Math.hypot(x - (a[0] + t * (b[0] - a[0])), y - (a[1] + t * (b[1] - a[1]))));
    }
  return best;
};

describe('polyArea', () => {
  it('the area of a trapezoid and of a rectangle, whichever way round', () => {
    expect(P.polyArea(trap(0.5, 0.3, 0.4))).toBeCloseTo(0.16, 12);
    expect(P.polyArea([[0, 0], [2, 0], [2, 3], [0, 3]])).toBe(6);
    expect(P.polyArea([[0, 3], [2, 3], [2, 0], [0, 0]])).toBe(6);
  });
});

describe('packNested', () => {
  const r = P.packNested([piece(0.5, 0.3, 0.4), piece(0.5, 0.3, 0.4)], SL, SW, K);
  const [p1, p2] = r.placements.map((x) => x.poly!);
  it('a pair of trapezoids interlocks: both have outlines of their own area, on one sheet, not overlapping, a kerf apart', () => {
    expect(r.sheets).toBe(1);
    expect(P.polyArea(p1!)).toBeCloseTo(0.16, 12);
    expect(P.polyArea(p2!)).toBeCloseTo(0.16, 12);
    expect(overlap(p1!, p2!)).toBe(false);
    expect(gap(p1!, p2!)).toBeCloseTo(K, 6);
  });
  it('the pair is shorter than two rectangles side by side by (wide - narrow) / 2 plus the kerf slant', () => {
    const xs = [...p1!, ...p2!].map((q) => q[0]);
    const width = Math.max(...xs) - Math.min(...xs);
    const slant = (K * Math.hypot(0.1, 0.4)) / 0.4;
    expect(width).toBeCloseTo((3 * 0.5 + 0.3) / 2 + slant, 9);
    expect(width).toBeLessThan(2 * 0.5);
  });
  it('the placement is the outline\'s bounding box', () => {
    for (const x of r.placements) {
      const xs = x.poly!.map((q) => q[0]);
      const ys = x.poly!.map((q) => q[1]);
      expect([x.x, x.y, x.w, x.h]).toEqual([Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]);
    }
  });
  it('an odd trapezoid stands alone, as its bounding rectangle, with its outline', () => {
    const o = P.packNested([piece(0.5, 0.3, 0.4), piece(0.5, 0.3, 0.4), piece(0.5, 0.3, 0.4)], SL, SW, K);
    expect(o.placements.every((x) => x.poly && x.sheet === 0)).toBe(true);
    const polys = o.placements.map((x) => x.poly!);
    expect(overlap(polys[0]!, polys[2]!) || overlap(polys[1]!, polys[2]!)).toBe(false);
  });
  it('different trapezoids do not pair; a rectangle outline is not nested', () => {
    const o = P.packNested([piece(0.5, 0.3, 0.4), piece(0.5, 0.2, 0.4)], SL, SW, K);
    expect(overlap(o.placements[0]!.poly!, o.placements[1]!.poly!)).toBe(false);
    expect(gap(o.placements[0]!.poly!, o.placements[1]!.poly!)).toBeGreaterThanOrEqual(K - 1e-9);
    expect(o.placements[0]!.x === o.placements[1]!.x && o.placements[0]!.y === o.placements[1]!.y).toBe(false);
    const sq = P.packNested([{ l: 0.5, w: 0.4, poly: [[0, 0], [0.5, 0], [0.5, 0.4], [0, 0.4]] }, { l: 0.5, w: 0.4, poly: [[0, 0], [0.5, 0], [0.5, 0.4], [0, 0.4]] }], SL, SW, K);
    sq.placements.forEach((x) => expect(x.w).toBeCloseTo(0.5, 12));
  });
  it('tall trapezoids are laid on their side and still do not overlap', () => {
    const o = P.packNested([piece(0.3, 0.2, 0.9), piece(0.3, 0.2, 0.9)], SL, SW, K);
    const [a, b] = o.placements.map((x) => x.poly!);
    expect(overlap(a!, b!)).toBe(false);
    expect(o.placements[0]!.w).toBeGreaterThan(o.placements[0]!.h);
    expect(P.polyArea(a!)).toBeCloseTo(((0.3 + 0.2) / 2) * 0.9, 12);
  });
  it('a pair needs only its interlocked length of sheet', () => {
    const slant = (K * Math.hypot(0.1, 0.4)) / 0.4;
    const w = (3 * 0.5 + 0.3) / 2 + slant;
    const fit = P.packNested([piece(0.5, 0.3, 0.4), piece(0.5, 0.3, 0.4)], w + 1e-6, SW, K).placements;
    expect(fit.map((x) => x.sheet)).toEqual([0, 0]);
    const xs = fit.flatMap((x) => x.poly!.map((q) => q[0]));
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(w, 9);
    expect(P.packNested([piece(0.5, 0.3, 0.4), piece(0.5, 0.3, 0.4)], w - 1e-3, SW, K).placements.map((x) => x.sheet)).toEqual([0, 0]);
  });
  it('an outline that is not an isosceles trapezoid on the line y = 0 is never paired', () => {
    const skew: [number, number][] = [[0, 0.1], [0.5, 0], [0.4, 0.4], [0.1, 0.4]];
    const o = P.packNested([{ l: 0.5, w: 0.4, poly: skew }, { l: 0.5, w: 0.4, poly: skew }], SL, SW, K);
    const xs = o.placements.flatMap((x) => x.poly!.map((q) => q[0]));
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(2 * 0.5);
  });
  it('rectangles pack exactly as packSheets does', () => {
    const pcs = [{ l: 1, w: 0.5 }, { l: 0.6, w: 0.6 }, { l: 2, w: 0.3 }, { l: 0.4, w: 0.4 }];
    const a = P.packSheets(pcs, SL, SW, K);
    const b = P.packNested(pcs, SL, SW, K);
    expect(b.sheets).toBe(a.sheets);
    expect(b.placements).toEqual(a.placements);
  });
  it('a piece that does not fit a sheet is left off, with no outline', () => {
    const o = P.packNested([piece(3, 2.8, 0.4)], SL, SW, K);
    expect(o.placements[0]!.sheet).toBe(-1);
    expect(o.placements[0]!.poly).toBeUndefined();
  });
  it('pairing needs less sheet than rectangles: eight trapezoids that fill a sheet of bounding boxes need fewer shelves', () => {
    const many = Array.from({ length: 12 }, () => piece(0.6, 0.2, 0.5));
    const nested = P.packNested(many, SL, SW, K);
    const plain = P.packSheets(many.map((m) => ({ l: m.l, w: m.w })), SL, SW, K);
    const used = (pl: P.Placement[]) => Math.max(...pl.filter((x) => x.sheet === 0).map((x) => x.x + x.w));
    expect(nested.sheets).toBeLessThanOrEqual(plain.sheets);
    expect(used(nested.placements)).toBeLessThan(used(plain.placements));
  });
});

// 1.18: a right trapezoid (a wedge box's side) paired with a half turn of itself is a rectangle
const right = (a: number, b: number, h: number): [number, number][] => [[0, 0], [a, 0], [b, h], [0, h]];
const rpiece = (a: number, b: number, h: number): P.NestPiece => ({ l: h, w: a, poly: right(a, b, h) });

describe('right trapezoids', () => {
  const a = 0.5;
  const b = 0.2;
  const h = 0.4;
  const r = P.packNested([rpiece(a, b, h), rpiece(a, b, h)], SL, SW, K);
  const [p, q] = [r.placements[0]!.poly!, r.placements[1]!.poly!];
  it('two identical ones are laid as one rectangle, half a turn apart, the slanted edges a kerf apart', () => {
    expect(p).toBeDefined();
    expect(q).toBeDefined();
    expect(overlap(p, q)).toBe(false);
    expect(gap(p, q)).toBeCloseTo(K, 6);
    const w = Math.max(...[...p, ...q].map((v) => v[0])) - Math.min(...[...p, ...q].map((v) => v[0]));
    expect(w).toBeCloseTo(a + b + (K * Math.hypot(a - b, h)) / h, 12);
    // the pair is as high as one piece, so two bounding rectangles (2 a wide) are not needed
    expect(w).toBeLessThan(2 * a);
  });
  it('the second is the first turned half a turn', () => {
    const area = (poly: [number, number][]) => P.polyArea(poly);
    expect(area(q)).toBeCloseTo(area(p), 12);
    expect(area(p)).toBeCloseTo(((a + b) / 2) * h, 12);
  });
  it('a lone right trapezoid keeps its outline and its bounding box', () => {
    const one = P.packNested([rpiece(a, b, h)], SL, SW, K).placements[0]!;
    expect(one.poly).toBeDefined();
    expect(one.w).toBeCloseTo(a, 12);
    expect(one.h).toBeCloseTo(h, 12);
  });
  it('different ones, or a right and an isosceles one, are not paired', () => {
    const mixed = P.packNested([rpiece(a, b, h), rpiece(a, b + 0.01, h), piece(a, b, h)], SL, SW, K);
    mixed.placements.forEach((pl) => expect(pl.w).toBeLessThan(a + 1e-9));
    // a right and an isosceles trapezoid with the same numbers are different shapes: the isosceles one is not turned to meet the other
    // (numbers exact in binary, so the two outlines give the very same a, b and h)
    const pair = P.packNested([rpiece(0.5, 0.25, 0.5), piece(0.5, 0.25, 0.5)], SL, SW, K);
    const iso = pair.placements[1]!.poly!;
    expect(iso[0]![1]).toBeCloseTo(Math.min(...iso.map((v) => v[1])), 12);
    expect(iso[1]![1]).toBeCloseTo(iso[0]![1], 12);
  });
  it('a pair wider than the sheet falls back to two singles', () => {
    const big = P.packNested([rpiece(0.7, 0.6, 0.3), rpiece(0.7, 0.6, 0.3)], 1.0, 0.4, K);
    expect(big.placements.every((pl) => pl.sheet >= 0)).toBe(true);
  });
});
