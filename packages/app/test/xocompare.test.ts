// 1.13: crossover variants (order, alignment, active or passive), the plain figures of each, and the preset comparisons.
import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import { type Computed, DEFAULT_XO, computeCrossover, sanitizeXo } from '../src/crossover';
import * as X from '../src/xocompare';

const base = (over: Partial<typeof DEFAULT_XO> = {}) => sanitizeXo({ ...DEFAULT_XO, ...over });
const spec = (mode: X.XoMode, alignment: P.Alignment, order: number): X.VariantSpec => ({ mode, alignment, order });

describe('labels and problems', () => {
  it('names a variant with its slope', () => {
    expect(X.slopeDbPerOct(4)).toBe(24);
    expect(X.variantLabel(spec('active', 'linkwitz-riley', 4))).toBe('Active Linkwitz-Riley 4 (24 dB/oct)');
    expect(X.variantLabel(spec('passive', 'butterworth', 3))).toBe('Passive Butterworth 3 (18 dB/oct)');
    expect(X.specKey(spec('passive', 'bessel', 2))).toBe('passive|bessel|2');
  });
  it('knows what cannot be built, and why', () => {
    expect(X.variantProblem(spec('active', 'linkwitz-riley', 4))).toBeNull();
    expect(X.variantProblem(spec('active', 'linkwitz-riley', 3))).toMatch(/even orders only/);
    expect(X.variantProblem(spec('active', 'butterworth', 3))).toBeNull();
    expect(X.variantProblem(spec('active', 'butterworth', 8))).toBeNull();
    expect(X.variantProblem(spec('active', 'butterworth', 9))).toMatch(/1 to 8/);
    expect(X.variantProblem(spec('active', 'butterworth', 0))).toMatch(/1 to 8/);
    expect(X.variantProblem(spec('active', 'butterworth', 2.5))).toMatch(/whole number/);
    expect(X.variantProblem(spec('passive', 'butterworth', 5))).toMatch(/up to order 4/);
    expect(X.variantProblem(spec('passive', 'butterworth', 4))).toBeNull();
    expect(X.variantProblem(spec('passive', 'chebyshev', 2))).toMatch(/even-order Chebyshev/);
    expect(X.variantProblem(spec('passive', 'chebyshev', 3))).toBeNull();
    expect(X.variantProblem(spec('active', 'chebyshev', 2))).toBeNull();
  });
  it('lists the orders that can be built', () => {
    expect(X.validOrders('active', 'butterworth')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(X.validOrders('active', 'linkwitz-riley')).toEqual([2, 4, 6, 8]);
    expect(X.validOrders('passive', 'butterworth')).toEqual([1, 2, 3, 4]);
    expect(X.validOrders('passive', 'linkwitz-riley')).toEqual([2, 4]);
    expect(X.validOrders('passive', 'chebyshev')).toEqual([1, 3]);
  });
});

describe('variantState', () => {
  it('changes mode, alignment and order and nothing else about the drivers or points', () => {
    const b = base({ ways: 3, xover: [400, 3000, 3500] });
    const v = X.variantState(b, spec('passive', 'butterworth', 3));
    expect([v.mode, v.alignment, v.order]).toEqual(['passive', 'butterworth', 3]);
    expect(v.ways).toBe(3);
    expect(v.xover.slice(0, 2)).toEqual([400, 3000]);
    expect(v.drivers).toEqual(b.drivers);
    expect(v.ampPowerW).toBe(b.ampPowerW);
  });
  it('keeps optimised passive values only for the variant that is the current one', () => {
    const tuned = { sig: 'x', values: [[1]] };
    const b = base({ mode: 'passive', tuned });
    expect(X.variantState(b, X.specOf(b)).tuned).toEqual(tuned);
    expect(X.variantState(b, spec('passive', 'linkwitz-riley', 2)).tuned).toBeNull();
    expect(X.variantState(b, spec('active', 'linkwitz-riley', 4)).tuned).toBeNull();
  });
});

describe('computeVariant and metricsOf', () => {
  const b = base();
  it('Linkwitz-Riley 4 active sums flat with no reversal, and its figures follow the state', () => {
    const v = X.computeVariant(b, spec('active', 'linkwitz-riley', 4));
    expect(v.m.filterDevDb).toBeLessThan(0.05);
    expect(v.m.reversed).toBe(false);
    expect(v.m.rmsFlatDb).toBe(computeCrossover(v.state).rmsFlatDb);
    expect(v.m.parts).toBeNull();
    expect(v.m.ampMinOhm).toBeNull();
    expect(v.m.hottestPartW).toBeNull();
    expect(v.m.passbandLossDb).toBe(0);
    expect(v.m.error).toBeNull();
    expect(v.m.warnings).toBe(v.c.warnings.length);
    expect(v.label).toBe('Active Linkwitz-Riley 4 (24 dB/oct)');
    expect(v.key).toBe('active|linkwitz-riley|4');
  });
  it('Butterworth 2 wants the upper driver reversed; Linkwitz-Riley 4 does not', () => {
    expect(X.computeVariant(b, spec('active', 'butterworth', 2)).m.reversed).toBe(true);
    expect(X.computeVariant(b, spec('active', 'linkwitz-riley', 4)).m.reversed).toBe(false);
  });
  it('a steeper filter has more stages, and the stages are counted from the circuits', () => {
    const a2 = X.computeVariant(b, spec('active', 'butterworth', 2));
    const a4 = X.computeVariant(b, spec('active', 'butterworth', 4));
    const a6 = X.computeVariant(b, spec('active', 'butterworth', 6));
    expect(a4.m.stages!).toBeGreaterThan(a2.m.stages!);
    expect(a6.m.stages!).toBeGreaterThan(a4.m.stages!);
    const n = (v: X.Variant) => v.c.active!.reduce((s, a) => s + a.lp.sections.length + a.hp.sections.length, 0);
    expect(a4.m.stages).toBe(n(a4));
  });
  it('a passive variant reports parts, the amplifier load, heat and a passband loss; more order, more parts', () => {
    const p2 = X.computeVariant(b, spec('passive', 'linkwitz-riley', 2));
    const p4 = X.computeVariant(b, spec('passive', 'linkwitz-riley', 4));
    for (const v of [p2, p4]) {
      expect(v.m.error).toBeNull();
      expect(v.m.parts).toBeGreaterThan(0);
      expect(v.m.stages).toBeNull();
      expect(v.m.ampMinOhm).toBeGreaterThan(0);
      expect(v.m.hottestPartW).toBeGreaterThanOrEqual(0);
      expect(v.m.passbandLossDb).toBeGreaterThanOrEqual(0);
    }
    expect(p4.m.parts!).toBeGreaterThan(p2.m.parts!);
    expect(p4.m.ampMinOhm).toBe(Math.min(...p4.c.zAmp!));
    expect(p4.m.parts).toBe(p4.c.passive!.reduce((n, w) => n + w.parts.length, 0));
  });
  it('a passive network that cannot be built says so and has no parts', () => {
    const v = X.computeVariant(b, spec('passive', 'butterworth', 6));
    expect(v.m.error).not.toBeNull();
    expect(v.m.parts).toBeNull();
    expect(v.m.hottestPartW).toBeNull();
    expect(v.m.passbandLossDb).toBe(0);
  });
  it('the filter-sum deviation is measured within an octave of a crossover only', () => {
    const v = X.computeVariant(b, spec('active', 'butterworth', 3));
    const xs = [P.effectiveCrossovers(v.state.xover, v.state.ways)[0]!];
    let manual = 0;
    v.c.freqs.forEach((f, i) => {
      if (f >= xs[0]! / 2 && f <= xs[0]! * 2) manual = Math.max(manual, Math.abs(v.c.filterSumDb[i]!));
    });
    expect(v.m.filterDevDb).toBeCloseTo(manual, 12);
  });
  it('a three-way watches both crossover points', () => {
    const v = X.computeVariant(base({ ways: 3, xover: [400, 3000, 3500] }), spec('active', 'butterworth', 3));
    const xs = P.effectiveCrossovers(v.state.xover, v.state.ways);
    expect(xs).toHaveLength(2);
    let manual = 0;
    v.c.freqs.forEach((f, i) => {
      if (xs.some((x) => f >= x / 2 && f <= x * 2)) manual = Math.max(manual, Math.abs(v.c.filterSumDb[i]!));
    });
    expect(v.m.filterDevDb).toBeCloseTo(manual, 12);
  });
  it('group delay peak is the positive peak of the summed delay', () => {
    const v = X.computeVariant(b, spec('active', 'linkwitz-riley', 4));
    expect(v.m.groupDelayPeakMs).toBe(Math.max(0, ...v.c.sumDelayMs.filter(Number.isFinite)));
    expect(v.m.groupDelayPeakMs).toBeGreaterThan(0);
  });
  it('Linkwitz-Riley 4 beats Butterworth 4 on the filter sum', () => {
    const lr = X.computeVariant(b, spec('active', 'linkwitz-riley', 4));
    const bw = X.computeVariant(b, spec('active', 'butterworth', 4));
    expect(lr.m.filterDevDb).toBeLessThan(bw.m.filterDevDb);
  });
});

/** A Computed with only what metricsOf reads, so each branch can be pinned with numbers that real data does not reach. */
const fake = (over: Partial<Computed> = {}): Computed =>
  ({
    freqs: [100, 200, 400, 800, 1600, 3200],
    ways: [],
    sumDb: [],
    filterSumDb: [0, 0, 0, 0, 0, 0],
    sumPhaseDeg: [],
    sumDelayMs: [1, 2, 3, 2, 1, 0],
    zAmp: null,
    rmsFlatDb: 0.5,
    advice: [],
    polarity: [],
    delayMs: [],
    active: null,
    passive: null,
    passiveError: null,
    warnings: [],
    notes: [],
    ...over,
  }) as unknown as Computed;

describe('metricsOf on constructed results', () => {
  it('the filter sum is watched within an octave either side of a point, and only there', () => {
    // 0.5 dB at 200 Hz (half an octave under 400... inside), 9 dB at 100 Hz and at 1600 Hz (two octaves away or more: outside)
    const c = fake({ filterSumDb: [-9, 0.5, 0, 0, 9, 0] });
    expect(X.metricsOf(c, [400]).filterDevDb).toBe(0.5);
    // 200 is exactly half of 400 and 800 exactly twice: both ends are inside
    expect(X.metricsOf(fake({ filterSumDb: [0, 1, 0, 2, 0, 0] }), [400]).filterDevDb).toBe(2);
    // the sign does not matter
    expect(X.metricsOf(fake({ filterSumDb: [0, -3, 0, 0, 0, 0] }), [400]).filterDevDb).toBe(3);
    // another point brings its own window in
    expect(X.metricsOf(fake({ filterSumDb: [0, 0, 0, 0, 0, 4] }), [400, 3200]).filterDevDb).toBe(4);
    expect(X.metricsOf(fake({ filterSumDb: [0, 0, 0, 0, 0, 4] }), [400]).filterDevDb).toBe(0);
  });
  it('the upper driver is reversed if any split needs it', () => {
    const adv = (inv: boolean) => ({ split: 0, lower: '', upper: '', invertUpper: inv });
    expect(X.metricsOf(fake({ advice: [adv(false), adv(true)] }), [400]).reversed).toBe(true);
    expect(X.metricsOf(fake({ advice: [adv(true), adv(false)] }), [400]).reversed).toBe(true);
    expect(X.metricsOf(fake({ advice: [adv(false), adv(false)] }), [400]).reversed).toBe(false);
    expect(X.metricsOf(fake({ advice: [] }), [400]).reversed).toBe(false);
  });
  it('the group delay peak is never negative, ignores NaN, and is 0 for none', () => {
    expect(X.metricsOf(fake({ sumDelayMs: [-1, -2, -0.5] }), [400]).groupDelayPeakMs).toBe(0);
    expect(X.metricsOf(fake({ sumDelayMs: [] }), [400]).groupDelayPeakMs).toBe(0);
    expect(X.metricsOf(fake({ sumDelayMs: [NaN, 2, -1] }), [400]).groupDelayPeakMs).toBe(2);
  });
  it('a passive result: parts, hottest part, the loss below 0 dB in the passband, the lowest amplifier load', () => {
    const way = (db: number[], watts: number[], parts: number) => ({
      filterDb: db,
      name: '',
      levelDb: [],
      __parts: parts,
      __watts: watts,
    });
    const ways = [way([-0.5, -3, -40], [1, 5], 3), way([-0.2, -20], [2], 2)];
    const passive = ways.map((w) => ({ name: '', kind: '', network: null, parts: Array.from({ length: w.__parts }, () => ({ name: '', type: 'inductor', value: 1 })), stress: w.__watts.map((powerW) => ({ name: '', vRms: 1, iRms: 1, powerW })) }));
    const m = X.metricsOf(fake({ ways: ways as never, passive: passive as never, zAmp: [6, 3.2, 8] }), [400]);
    expect(m.passbandLossDb).toBe(0.5);
    expect(m.parts).toBe(5);
    expect(m.hottestPartW).toBe(5);
    expect(m.ampMinOhm).toBe(3.2);
    expect(m.stages).toBeNull();
    expect(m.error).toBeNull();
  });
  it('a passive network with an error has no parts, heat or loss, whatever else is there', () => {
    const ways = [{ filterDb: [-1, -2], name: '', levelDb: [] }];
    const m = X.metricsOf(fake({ ways: ways as never, passive: [] as never, passiveError: 'cannot', zAmp: [4, 5] }), [400]);
    expect(m.error).toBe('cannot');
    expect(m.parts).toBeNull();
    expect(m.hottestPartW).toBeNull();
    expect(m.passbandLossDb).toBe(0);
  });
  it('an active result has stages and no passive figures', () => {
    const sec = (n: number) => ({ sections: Array.from({ length: n }, () => ({})) });
    const m = X.metricsOf(fake({ active: [{ lp: sec(2), hp: sec(1) }] as never }), [400]);
    expect(m.stages).toBe(3);
    expect(m.parts).toBeNull();
    expect(m.passbandLossDb).toBe(0);
    expect(m.hottestPartW).toBeNull();
  });
});

describe('presetSpecs', () => {
  const key = (l: X.VariantSpec[]) => l.map(X.specKey);
  it('orders: the others up to 4 in this mode and alignment', () => {
    expect(key(X.presetSpecs(base({ alignment: 'butterworth', order: 3 }), 'orders'))).toEqual(['active|butterworth|1', 'active|butterworth|2', 'active|butterworth|4']);
    expect(key(X.presetSpecs(base({ alignment: 'linkwitz-riley', order: 4 }), 'orders'))).toEqual(['active|linkwitz-riley|2']);
    expect(key(X.presetSpecs(base({ mode: 'passive', alignment: 'chebyshev', order: 3 }), 'orders'))).toEqual(['passive|chebyshev|1']);
  });
  it('alignments: every other alignment that has this order here', () => {
    expect(key(X.presetSpecs(base({ alignment: 'linkwitz-riley', order: 4 }), 'alignments'))).toEqual(['active|butterworth|4', 'active|bessel|4', 'active|chebyshev|4']);
    expect(key(X.presetSpecs(base({ alignment: 'butterworth', order: 3 }), 'alignments'))).toEqual(['active|bessel|3', 'active|chebyshev|3']);
    expect(key(X.presetSpecs(base({ mode: 'passive', alignment: 'butterworth', order: 4 }), 'alignments'))).toEqual(['passive|linkwitz-riley|4', 'passive|bessel|4']);
  });
  it('modes: the other kind of network, if it can be built', () => {
    expect(key(X.presetSpecs(base({ alignment: 'linkwitz-riley', order: 4 }), 'modes'))).toEqual(['passive|linkwitz-riley|4']);
    expect(key(X.presetSpecs(base({ mode: 'passive', alignment: 'linkwitz-riley', order: 4 }), 'modes'))).toEqual(['active|linkwitz-riley|4']);
    expect(X.presetSpecs(base({ alignment: 'butterworth', order: 6 }), 'modes')).toEqual([]);
  });
});
