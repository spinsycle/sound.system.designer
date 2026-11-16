// Folded horn (spec v0.14): properties of the layout beyond the shared vectors.
import { describe, expect, it } from 'vitest';
import * as P from '../src';

const exp: P.Flare = { kind: 'exponential', throatM2: 0.06, mouthM2: 0.4, cutoffHz: 40, t: 1, lengthM: 0 };
const T = 0.018;

describe('foldHorn', () => {
  it('the path is the flare, whatever the leg count', () => {
    for (const n of [2, 3, 4, 6, 8]) {
      const f = P.foldHorn(exp, 0.8, n, 2, T);
      if (f.feasible) expect(f.ends[n - 1]).toBeCloseTo(f.length, 12);
      else expect(f.ends[n - 1]!).toBeGreaterThan(f.length); // the turns alone are longer than the horn
      expect(f.starts[0]).toBe(0);
      expect(f.joints).toHaveLength(2 * n);
    }
  });
  it('each leg is the flare height at its middle and the flare opens leg by leg', () => {
    const f = P.foldHorn(exp, 0.8, 4, 2, T);
    f.heights.forEach((h, k) => expect(h).toBeCloseTo(P.flareArea(exp, (f.starts[k]! + f.ends[k]!) / 2) / 0.8, 12));
    for (let k = 1; k < 4; ++k) expect(f.heights[k]!).toBeGreaterThan(f.heights[k - 1]!);
  });
  it('the turns are at least as wide as the legs, so the area never pinches', () => {
    const f = P.foldHorn(exp, 0.8, 6, 2, T);
    f.gaps.forEach((g, k) => expect(g).toBeGreaterThanOrEqual(Math.max(f.heights[k]!, f.heights[k + 1]!)));
  });
  it('the box holds the legs and the septa; the depth is at least what the folds need', () => {
    const f = P.foldHorn(exp, 0.8, 4, 0.5, T); // far too shallow
    expect(f.hI).toBeCloseTo(f.heights.reduce((a, b) => a + b, 0) + 3 * T, 12);
    expect(f.dI).toBeCloseTo(f.minDepthI, 12);
    expect(f.dO).toBeCloseTo(f.dI + 2 * T, 12);
    const deep = P.foldHorn(exp, 0.8, 4, 3, T);
    expect(deep.dI).toBeCloseTo(3 - 2 * T, 12);
    expect(deep.minDepthI).toBeCloseTo(f.minDepthI, 12);
  });
  it('septa alternate between the front and back walls and stop short by the gap', () => {
    const f = P.foldHorn(exp, 0.8, 4, 2, T);
    expect(f.septaAnchor).toEqual(['front', 'back', 'front']);
    f.septaLength.forEach((l, k) => expect(l).toBeCloseTo(f.dI - f.gaps[k]!, 12));
    f.septaTop.forEach((y, k) => expect(y).toBeCloseTo(f.heights.slice(0, k + 1).reduce((a, b) => a + b, 0) + k * T, 12));
  });
  it('an even leg count puts the mouth on the front, an odd one at the back', () => {
    expect(P.foldHorn(exp, 0.8, 4, 2, T).mouthAtFront).toBe(true);
    expect(P.foldHorn(exp, 0.8, 3, 2, T).mouthAtFront).toBe(false);
  });
  it('more folds make a shallower box but a taller one', () => {
    const two = P.foldHorn(exp, 0.8, 2, 3, T);
    const six = P.foldHorn(exp, 0.8, 6, 3, T);
    expect(six.minDepthI).toBeLessThan(two.minDepthI);
  });
  it('the folded horn simulates to finite values and keeps the horn volume close to the flare', () => {
    const f = P.foldHorn(exp, 0.8, 4, 2, T);
    const ideal = P.hornJoints(exp, 100);
    const ratio = P.hornVolume(f.joints) / P.hornVolume(ideal);
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThan(1.4);
  });
});

describe('foldHorn when the folds cannot fit', () => {
  const big: P.Flare = { kind: 'exponential', throatM2: 0.0506, mouthM2: 6, cutoffHz: 40.9, t: 1, lengthM: 0 };
  it('a 6 m2 mouth on a 0.6 m wide horn gives finite numbers and says it is infeasible', () => {
    for (const legs of [2, 3, 4, 6, 8]) {
      const f = P.foldHorn(big, 0.6, legs, 3, 0.018);
      const all = [f.leg, f.hI, f.hO, f.dI, f.minDepthI, ...f.heights, ...f.gaps, ...f.septaLength, ...f.septaTop, ...f.joints.flatMap((j) => [j.x, j.area])];
      expect(all.every(Number.isFinite)).toBe(true);
    }
    expect(P.foldHorn(big, 0.6, 4, 3, 0.018).feasible).toBe(false);
    expect(P.foldHorn(big, 6, 4, 3, 0.018).feasible).toBe(true);
  });
  it('the legs are held to the minimum length when it is infeasible, and are the exact split when it is not', () => {
    const f = P.foldHorn(big, 0.6, 4, 3, 0.018);
    expect(f.leg).toBeCloseTo((P.MIN_LEG_SHARE * f.length) / 4, 12);
    const ok = P.foldHorn({ kind: 'exponential', throatM2: 0.06, mouthM2: 0.4, cutoffHz: 40, t: 1, lengthM: 0 }, 0.8, 4, 2, 0.018);
    expect(ok.feasible).toBe(true);
    expect(ok.leg).toBeGreaterThan((P.MIN_LEG_SHARE * ok.length) / 4);
  });
  it('every flare kind and extreme width stays finite', () => {
    for (const kind of ['exponential', 'hyperbolic', 'conical'] as const) {
      for (const w of [0.05, 0.3, 3]) {
        const fl: P.Flare = { kind, throatM2: 0.01, mouthM2: 6, cutoffHz: 30, t: 0.5, lengthM: 2 };
        const f = P.foldHorn(fl, w, 8, 0.2, 0.025);
        expect([f.leg, f.hO, f.dO, ...f.heights, ...f.septaLength].every(Number.isFinite)).toBe(true);
      }
    }
  });
});

describe('suggestFold', () => {
  const T = 0.018;
  const ok: P.Flare = { kind: 'exponential', throatM2: 0.06, mouthM2: 0.4, cutoffHz: 40, t: 1, lengthM: 0 };
  const big: P.Flare = { kind: 'exponential', throatM2: 0.0506, mouthM2: 6, cutoffHz: 40.9, t: 1, lengthM: 0 };
  it('the suggestion folds: feasible, mouth on the front, no slack and no shortfall', () => {
    for (const fl of [ok, big, { ...ok, mouthM2: 1 }]) {
      const s = P.suggestFold(fl, 0.6, T);
      expect(s).not.toBeNull();
      const f = P.foldHorn(fl, s!.widthM, s!.legs, s!.depthOutM, T);
      expect(f.feasible).toBe(true);
      expect(f.mouthAtFront).toBe(true);
      expect(s!.legs % 2).toBe(0);
      expect(f.dO).toBeGreaterThanOrEqual(f.minDepthI + 2 * T - 1e-12);
      expect(f.dO).toBeLessThan(f.minDepthI + 2 * T + 0.0100001); // rounded up to the centimetre
      expect(s!.widthM).toBeGreaterThanOrEqual(0.6 - 1e-12);
      expect(s!.depthOutM).toBeLessThanOrEqual(P.FOLD_MAX_DEPTH_M);
    }
    // a practical depth is preferred: widening comes before a deep box
    {
      const s = P.suggestFold({ ...ok, mouthM2: 1.5 }, 0.3, T)!;
      expect(s.depthOutM).toBeLessThanOrEqual(P.FOLD_PRACTICAL_DEPTH_M);
      expect(s.widthM).toBeGreaterThan(0.3); // it widened rather than build a deeper box
      // a mouth too large for a practical box falls back to a deep one, up to the limit
      expect(P.suggestFold(big, 0.6, T)!.depthOutM).toBeGreaterThan(P.FOLD_PRACTICAL_DEPTH_M);
    }
  });
  it('widens in 25 % steps from the width given: the narrowest that works', () => {
    const fl: P.Flare = { ...ok, mouthM2: 1.5 };
    const s = P.suggestFold(fl, 0.3, T)!;
    const steps = Math.log(s.widthM / 0.3) / Math.log(1.25);
    expect(steps).toBeGreaterThan(0.5); // this flare needs a wider horn, so the steps are exercised
    expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-9);
    // the width one step narrower has no box up to the same depth limit
    if (steps > 0.5) {
      const w = 0.3 * 1.25 ** (Math.round(steps) - 1);
      for (const legs of [2, 4, 6, 8]) {
        const f = P.foldHorn(fl, w, legs, 0, T);
        expect(!f.feasible || !f.mouthAtFront || f.dO > P.FOLD_PRACTICAL_DEPTH_M).toBe(true);
      }
    }
  });
  it('keeps the width when it already works, widens only when it must', () => {
    expect(P.suggestFold(ok, 0.8, T)!.widthM).toBeCloseTo(0.8, 12);
    expect(P.suggestFold(big, 0.6, T)!.widthM).toBeGreaterThan(0.6);
  });
  it('picks the smallest box among the leg counts that work', () => {
    const s = P.suggestFold(ok, 0.8, T)!;
    const vol = (legs: number): number => {
      const f = P.foldHorn(ok, 0.8, legs, 0, T);
      return f.wO * f.hO * f.dO;
    };
    for (const legs of [2, 4, 6, 8]) {
      const f = P.foldHorn(ok, 0.8, legs, 0, T);
      if (f.feasible && f.mouthAtFront) expect(vol(s.legs)).toBeLessThanOrEqual(vol(legs) + 1e-12);
    }
  });
  it('returns null when no box up to the limits works, and maxFoldableMouthM2 then finds a mouth that does', () => {
    const huge: P.Flare = { kind: 'exponential', throatM2: 0.06, mouthM2: 400, cutoffHz: 15, t: 1, lengthM: 0 };
    expect(P.suggestFold(huge, 0.3, T)).toBeNull();
    const m = P.maxFoldableMouthM2(huge, 0.3, T);
    expect(m).not.toBeNull();
    expect(m!).toBeLessThan(400);
    expect(P.suggestFold({ ...huge, mouthM2: m! }, 0.3, T)).not.toBeNull();
    expect(P.suggestFold({ ...huge, mouthM2: m! * 1.2 }, 0.3, T)).toBeNull();
  });
  it('maxFoldableMouthM2 is the flare own mouth when it already folds', () => {
    expect(P.maxFoldableMouthM2(ok, 0.8, T)).toBe(ok.mouthM2);
  });
});
