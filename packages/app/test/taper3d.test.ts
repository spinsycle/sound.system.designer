// 1.14: a tapered box in the 3D preview: the walls where the geometry puts them, the side walls t thick, holes and drivers on the front.
import { describe, expect, it } from 'vitest';
import { computeBuild } from '../src/buildlist';
import * as C from '../src/carsub';
import { layout3d } from '../src/layout3d';
import * as M from '../src/model';
import * as S from '../src/system';

const T = 0.018; // the default wall, m
const proj = (design: Partial<M.Design>, build: Record<string, unknown>): S.Project =>
  S.sanitizeProject({ ...S.DEFAULT_PROJECT, nBands: 1, bands: [{ design: M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: 1, type: 'sealed', volumeL: 60, ...design }), build }] });
const lay = (p: S.Project) => layout3d(computeBuild(p), p);
const taper = (p: S.Project) => computeBuild(p).bands[0]!.cabinets[0]!.taper!;
/** Distance from a point to the line through two points, in two coordinates. */
const dist = (p: number[], a: number[], b: number[]): number => Math.abs((b[0]! - a[0]!) * (a[1]! - p[1]!) - (a[0]! - p[0]!) * (b[1]! - a[1]!)) / Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);

describe('a plan trapezoid in 3D', () => {
  const p = proj({}, { shape: 'trapezoid', taper: 0.6 });
  const g = taper(p);
  const l = lay(p);
  it('a holed front plate at the wide end, a back plate at the narrow end, two prisms for top and bottom, two for the sides', () => {
    expect(l.boxes).toHaveLength(2);
    expect(l.prisms).toHaveLength(4);
    const [front, back] = l.boxes;
    expect(front!.size).toEqual([g.wideO, g.hO, T]);
    expect(front!.center[2]).toBeCloseTo(-T / 2, 12);
    expect(front!.holes).toHaveLength(1);
    expect(back!.size).toEqual([g.narrowO, g.hO, T]);
    expect(back!.center[2]).toBeCloseTo(-g.dO + T / 2, 12);
  });
  it('the extent is the outside of the box and the box stands on the floor', () => {
    expect(l.extent[0]).toBeCloseTo(g.wideO, 12);
    expect(l.extent[1]).toBeCloseTo(g.hO, 12);
    expect(l.extent[2]).toBeCloseTo(g.dO, 12);
    const ys = l.prisms.flatMap((q) => q.points.map((pt) => pt[1]));
    expect(Math.min(...ys)).toBeCloseTo(0, 12);
    expect(Math.max(...ys)).toBeCloseTo(g.hO, 12);
  });
  it('a side wall runs from the front corner to the back corner and is t thick, inwards', () => {
    const sides = l.prisms.slice(2);
    for (const s of sides) {
      const q = s.points; // outer front, outer back, inner back, inner front at y = 0, then the same at the top
      const xz = (i: number): number[] => [q[i]![0], q[i]![2]];
      expect(Math.abs(q[0]![0] - l.boxes[0]!.center[0])).toBeCloseTo(g.wideO / 2, 12);
      expect(Math.abs(q[1]![0] - l.boxes[0]!.center[0])).toBeCloseTo(g.narrowO / 2, 12);
      expect(q[0]![2]).toBe(0);
      expect(q[1]![2]).toBeCloseTo(-g.dO, 12);
      expect(dist(xz(3), xz(0), xz(1))).toBeCloseTo(T, 9);
      expect(dist(xz(2), xz(0), xz(1))).toBeCloseTo(T, 9);
      expect(q[4]![1]).toBeCloseTo(g.hO, 12);
    }
    // the two sides mirror each other
    expect(sides[0]!.points[0]![0] - 0).toBeCloseTo(-(sides[1]!.points[0]![0] - 2 * l.boxes[0]!.center[0]), 12);
  });
  it('the driver sits on the front, facing out, with a disc over its hole', () => {
    expect(l.drivers).toHaveLength(1);
    expect(l.drivers[0]!.flange[2]).toBe(0);
    expect(l.drivers[0]!.dir).toEqual([0, 0, -1]);
    expect(l.discs.some((d) => d.kind === 'driver')).toBe(true);
  });
  it('the top and the bottom are trapezoids between the front and the back plates', () => {
    const bottom = l.prisms[0]!.points;
    expect(bottom[0]![1]).toBe(0);
    expect(bottom[4]![1]).toBeCloseTo(T, 12);
    expect(bottom[1]![0] - bottom[0]![0]).toBeGreaterThan(bottom[2]![0] - bottom[3]![0]);
    expect(bottom[0]![2]).toBeCloseTo(-T, 12);
    expect(bottom[2]![2]).toBeCloseTo(-(g.dO - T), 12);
  });
});

describe('a tower in 3D', () => {
  const p = proj({}, { shape: 'tower', taper: 0.6 });
  const g = taper(p);
  const l = lay(p);
  it('trapezoid front and back as prisms, a wide bottom and a narrow top as boxes, two leaning sides', () => {
    expect(l.boxes.map((b) => b.size)).toEqual([[g.wideO, T, g.dO - 2 * T], [g.narrowO, T, g.dO - 2 * T]]);
    expect(l.boxes[0]!.center[1]).toBeCloseTo(T / 2, 12);
    expect(l.boxes[1]!.center[1]).toBeCloseTo(g.hO - T / 2, 12);
    expect(l.prisms).toHaveLength(4);
    const front = l.prisms[0]!.points;
    expect(front[1]![0] - front[0]![0]).toBeCloseTo(g.wideO, 12);
    expect(front[2]![0] - front[3]![0]).toBeCloseTo(g.narrowO, 12);
    expect(front[0]![2]).toBe(0);
    expect(front[4]![2]).toBeCloseTo(-T, 12);
  });
  it('a leaning side wall is t thick, inwards, and spans the depth between the front and back plates', () => {
    for (const s of l.prisms.slice(2)) {
      const q = s.points;
      const xy = (i: number): number[] => [q[i]![0], q[i]![1]];
      expect(dist(xy(3), xy(0), xy(1))).toBeCloseTo(T, 9);
      expect(dist(xy(2), xy(0), xy(1))).toBeCloseTo(T, 9);
      expect(q[0]![2]).toBeCloseTo(-T, 12);
      expect(q[4]![2]).toBeCloseTo(-(g.dO - T), 12);
    }
  });
  it('the extent is the outside of the box; the driver and its hole are on the front', () => {
    expect(l.extent[0]).toBeCloseTo(g.wideO, 12);
    expect(l.extent[1]).toBeCloseTo(g.hO, 12);
    expect(l.extent[2]).toBeCloseTo(g.dO, 12);
    expect(l.drivers).toHaveLength(1);
    expect(l.discs.filter((d) => d.kind === 'driver')).toHaveLength(1);
  });
});

describe('the exploded view moves every wall', () => {
  it('each prism of a tapered box carries the centre of its cabinet, as the boxes do', () => {
    for (const shape of ['trapezoid', 'tower']) {
      const p = proj({}, { shape, taper: 0.6 });
      const g = taper(p);
      const l = lay(p);
      const origin = [g.wideO / 2, g.hO / 2, -g.dO / 2];
      expect(l.prisms.length).toBeGreaterThan(0);
      for (const q of l.prisms) expect(q.origin).toEqual(origin);
      for (const b of l.boxes) expect(b.origin).toEqual(origin);
    }
  });
  it('the sides of a wedge and the sections of a TQWT column move too; a horn section stays', () => {
    const car = S.sanitizeProject({ ...S.DEFAULT_PROJECT, kind: 'car', car: C.sanitizeCar({ ...C.DEFAULT_CAR, shape: 'wedge', taper: 0.5 }) });
    const w = lay(car);
    expect(w.prisms.length).toBeGreaterThan(0);
    expect(w.prisms.every((q) => q.origin !== undefined)).toBe(true);
    const tq = lay(proj({ type: 'tqwt', tl: M.tqwtSettingsFor(M.driverOf(M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: 1 }))) }, {}));
    expect(tq.prisms.length).toBeGreaterThan(0);
    expect(tq.prisms.every((q) => q.origin !== undefined)).toBe(true);
    const horn = lay(proj({ type: 'horn', volumeL: 40 }, {}));
    expect(horn.prisms.some((q) => q.origin === undefined)).toBe(true);
  });
});

describe('motor out and long ports', () => {
  it('with the motor out the flange is behind the baffle and the driver points forward', () => {
    const p = proj({ layout: { ...M.DEFAULT_LAYOUT, mount: 'out' } }, { shape: 'trapezoid', taper: 0.7 });
    const l = lay(p);
    expect(l.drivers[0]!.flange[2]).toBeCloseTo(-T, 12);
    expect(l.drivers[0]!.dir).toEqual([0, 0, 1]);
  });
  it('a port longer than the box is drawn as long as the box is deep', () => {
    const p = proj({ type: 'ported', volumeL: 25, tuneHz: 28, portDiameterCm: 6 }, { shape: 'trapezoid', taper: 0.7 });
    const b = computeBuild(p).bands[0]!;
    expect(b.ports[0]!.lengthM).toBeGreaterThan(b.cabinets[0]!.taper!.dI);
    expect(lay(p).tubes[0]!.length).toBeCloseTo(b.cabinets[0]!.taper!.dI, 12);
  });
});

describe('ports and neighbours', () => {
  it('a ported tapered box has its port tube through the baffle', () => {
    const p = proj({ type: 'ported', volumeL: 80, tuneHz: 42 }, { shape: 'trapezoid', taper: 0.7 });
    const l = lay(p);
    expect(l.tubes).toHaveLength(1);
    expect(l.tubes[0]!.center[2]).toBe(0);
    expect(l.tubes[0]!.length).toBeLessThanOrEqual(taper(p).dI + 1e-12);
  });
  it('a tapered box next to others takes its wide width on the row', () => {
    const p = S.sanitizeProject({
      ...S.DEFAULT_PROJECT,
      nBands: 2,
      bands: [{ design: M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: 1, type: 'sealed', volumeL: 60 }), build: { shape: 'trapezoid', taper: 0.6 } }, { design: M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: 1, type: 'sealed', volumeL: 60 }) }],
    });
    const l = lay(p);
    const g = taper(p);
    // the second box starts after the first one's wide end plus the gap
    expect(l.extent[0]).toBeGreaterThan(g.wideO);
    expect(l.boxes.length).toBeGreaterThan(2);
  });
});

describe('braces and the tower front in 3D', () => {
  const deep = { taper: 0.6, brace: 'window', rd: 2.5 };
  it('a plan trapezoid has a windowed brace box per brace, as wide as the interior where it sits', () => {
    const p = proj({ volumeL: 200 }, { ...deep, shape: 'trapezoid' });
    const g = taper(p);
    const braces = lay(p).boxes.filter((b) => b.kind === 'brace');
    expect(g.braces).toBeGreaterThan(0);
    expect(braces.map((b) => b.size[0])).toEqual(g.braceWidths);
    expect(braces.every((b) => b.holes?.length === 1 && b.size[2] === T)).toBe(true);
    braces.forEach((b, k) => expect(b.center[2]).toBeCloseTo(-T - g.braceAt[k]!, 12));
  });
  it('a tower has trapezoid brace prisms with a window, and its front prism carries the driver hole', () => {
    const p = proj({ volumeL: 200 }, { ...deep, shape: 'tower' });
    const g = taper(p);
    const l = lay(p);
    const braces = l.prisms.filter((q) => q.kind === 'brace');
    expect(braces).toHaveLength(g.braces);
    expect(braces.every((q) => q.holes?.length === 1)).toBe(true);
    const front = l.prisms.find((q) => q.kind === undefined && q.holes && q.holes.length > 0);
    expect(front).toBeDefined();
    expect(front!.holes).toHaveLength(1);
  });
  it('no bracing, no brace parts', () => {
    const p = proj({ volumeL: 200 }, { ...deep, shape: 'tower', brace: 'none' });
    expect(lay(p).prisms.some((q) => q.kind === 'brace')).toBe(false);
  });
});
