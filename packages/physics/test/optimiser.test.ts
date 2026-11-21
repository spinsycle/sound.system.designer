// What an optimiser can promise: it recovers a known answer, never ends worse than it started, is repeatable, stays inside its
// bounds, and lands on standard values. Plus the pieces it is built from.
import { describe, expect, it } from 'vitest';
import * as P from '../src/index';

const scaled = (net: P.Network, fac: readonly number[]): P.Network => net.map((b, i) => ({ ...b, groups: b.groups.map((g) => g.map((p) => ({ ...p, value: p.value * fac[i]! }))) }));
const unit = (): P.Cx => P.cx(1);

function lr4Pair(fac: readonly number[], r = 8): P.Way[] {
  const spec: P.FilterSpec = { alignment: 'linkwitz-riley', order: 4 };
  return [
    { network: scaled(P.designPassive(spec, 'lp', 2000, r), fac.slice(0, 4)), load: P.resistiveLoad(r), response: unit },
    { network: scaled(P.designPassive(spec, 'hp', 2000, r), fac.slice(4, 8)), load: P.resistiveLoad(r), response: unit },
  ];
}

describe('evaluate and sumResponse', () => {
  it('no network and a unit driver: zero error, impedance is the load', () => {
    const w: P.Way = { network: [], load: P.resistiveLoad(6), response: unit };
    const e = P.evaluate([w], P.logGrid(100, 10000, 11));
    expect(e.meanDb).toBeCloseTo(0, 12);
    expect(e.rmsDb).toBeCloseTo(0, 12);
    expect(e.rmsFlatDb).toBeCloseTo(0, 12);
    expect(e.zMinOhm).toBeCloseTo(6, 12);
  });

  it('polarity negates, delay rotates the phase, ways add', () => {
    const w: P.Way = { network: [], load: P.resistiveLoad(8), response: () => P.cx(2, 1) };
    const base = P.sumResponse([w], 500);
    const inv = P.sumResponse([{ ...w, polarity: -1 }], 500);
    expect(inv.re).toBeCloseTo(-base.re, 12);
    expect(inv.im).toBeCloseTo(-base.im, 12);
    const late = P.sumResponse([{ ...w, delayS: 0.0004 }], 500);
    expect(P.abs(late)).toBeCloseTo(P.abs(base), 12);
    const turn = Math.atan2(late.im, late.re) - Math.atan2(base.im, base.re);
    expect(turn).toBeCloseTo(-2 * Math.PI * 500 * 0.0004, 12);
    const two = P.sumResponse([w, w], 500);
    expect(two.re).toBeCloseTo(2 * base.re, 12);
  });

  it('a constant level offset moves the mean and not the shape error; the target shifts the mean', () => {
    const lo: P.Way = { network: [], load: P.resistiveLoad(8), response: () => P.cx(1) };
    const hi: P.Way = { ...lo, response: () => P.cx(2) };
    const g = P.logGrid(100, 10000, 9);
    const a = P.evaluate([lo], g);
    const b = P.evaluate([hi], g);
    expect(b.meanDb - a.meanDb).toBeCloseTo(20 * Math.log10(2), 12);
    expect(b.rmsFlatDb).toBeCloseTo(a.rmsFlatDb, 12);
    expect(P.evaluate([lo], g, () => 3).meanDb).toBeCloseTo(-3, 12);
    expect(P.evaluate([lo], g, () => 3).rmsDb).toBeCloseTo(3, 12);
    expect(P.evaluate([lo], g, (f) => (f > 1000 ? 3 : 0)).rmsFlatDb).toBeGreaterThan(1);
  });

  it('logGrid: endpoints, count, constant ratio', () => {
    const g = P.logGrid(20, 20000, 61);
    expect(g).toHaveLength(61);
    expect(g[0]).toBeCloseTo(20, 12);
    expect(g[60]).toBeCloseTo(20000, 8);
    expect(g[31]! / g[30]!).toBeCloseTo(g[1]! / g[0]!, 12);
  });
});

describe('cost', () => {
  it('free level scores the shape, fixed level the whole error, the floor adds its penalty', () => {
    const ways = lr4Pair([1, 1, 1, 1, 1, 1, 1, 1]);
    ways[1]!.response = () => P.cx(10 ** (4 / 20)); // tweeter 4 dB hot: a flat 4 dB error in the sum above the crossover only
    const e = P.evaluate(ways, P.logGrid(100, 20000, 61));
    expect(P.cost(ways)).toBeCloseTo(e.rmsFlatDb, 12);
    expect(P.cost(ways, { level: 'fixed' })).toBeCloseTo(e.rmsDb, 12);
    expect(e.rmsDb).toBeGreaterThan(e.rmsFlatDb);
    const withFloor = P.cost(ways, { zMinOhm: e.zMinOhm + 3, zWeight: 5 });
    expect(withFloor).toBeCloseTo(e.rmsFlatDb + 15, 9);
    expect(P.cost(ways, { zMinOhm: e.zMinOhm - 1 })).toBeCloseTo(e.rmsFlatDb, 12);
    expect(P.cost(ways, { zMinOhm: e.zMinOhm + 1 })).toBeCloseTo(e.rmsFlatDb + 2, 9); // default weight 2 dB per ohm
  });
});

describe('optimise', () => {
  const start = lr4Pair([1.3, 0.75, 1.25, 0.8, 0.8, 1.3, 0.75, 1.25]);

  it('recovers a known answer: perturbed Linkwitz-Riley 4 ladders go back to a flat sum', () => {
    const r = P.optimise(start);
    expect(r.startCost).toBeGreaterThan(0.5);
    expect(r.endCost).toBeLessThan(0.05);
    expect(P.cost(r.ways)).toBeCloseTo(r.endCost, 9);
    expect(r.values).toHaveLength(8);
    expect(r.names).toEqual(['L1', 'C2', 'L3', 'C4', 'C1', 'L2', 'C3', 'L4']);
    expect(r.evaluations).toBeGreaterThan(50);
  });

  it('restarts from the best point keep improving a search that ran out of iterations', () => {
    const short = P.optimise(start, { maxIter: 15, restarts: 0 });
    const withRestarts = P.optimise(start, { maxIter: 15 });
    expect(withRestarts.endCost).toBeLessThan(short.endCost - 1e-6);
  });

  it('resistors never move: an L-pad in front of a ladder keeps its values and is left out of the names', () => {
    const w: P.Way = { ...start[0]!, network: [...P.lPad(3, 8), ...start[0]!.network] };
    const r = P.optimise([w, start[1]!]);
    expect(r.names.every((n) => n[0] === 'L' || n[0] === 'C')).toBe(true);
    expect(r.names).not.toContain('Rs');
    expect(r.ways[0]!.network[0]!.groups[0]![0]!.value).toBe(P.lPad(3, 8)[0]!.groups[0]![0]!.value);
    expect(r.ways[0]!.network[1]!.groups[0]![0]!.value).toBe(P.lPad(3, 8)[1]!.groups[0]![0]!.value);
  });

  it('is repeatable bit for bit', () => {
    expect(P.optimise(start)).toEqual(P.optimise(start));
  });

  it('never ends worse than it started and does not touch the start networks', () => {
    const before = JSON.stringify(start.map((w) => w.network));
    const r = P.optimise(start, { maxIter: 5, restarts: 0 });
    expect(r.endCost).toBeLessThanOrEqual(r.startCost);
    expect(JSON.stringify(start.map((w) => w.network))).toBe(before);
  });

  it('stays inside the bounds', () => {
    const v0 = P.networkValues(start[0]!.network).map((x) => x.value).concat(P.networkValues(start[1]!.network).map((x) => x.value));
    for (const bound of [1.1, 1.5]) {
      const r = P.optimise(start, { bound });
      r.values.forEach((v, k) => {
        expect(v).toBeLessThanOrEqual(v0[k]! * bound * (1 + 1e-9));
        expect(v).toBeGreaterThanOrEqual((v0[k]! / bound) * (1 - 1e-9));
      });
    }
    const pinned = P.optimise(start, { bound: 1 });
    expect(pinned.endCost).toBeCloseTo(pinned.startCost, 12);
  });

  it('the default bound is a factor of 4: an answer further away stops at the edge', () => {
    const far = lr4Pair([20, 1, 20, 1, 1, 20, 1, 20]);
    const v0 = far.flatMap((w) => P.networkValues(w.network).map((x) => x.value));
    const r = P.optimise(far);
    r.values.forEach((v, k) => {
      expect(v / v0[k]!).toBeGreaterThanOrEqual(0.25 * (1 - 1e-9));
      expect(v / v0[k]!).toBeLessThanOrEqual(4 * (1 + 1e-9));
    });
    expect(Math.max(...r.values.map((v, k) => Math.abs(Math.log(v / v0[k]!))))).toBeCloseTo(Math.log(4), 6); // at least one part sits on the edge
  });

  it('kinds limits what moves: capacitors only leaves every inductor alone', () => {
    const r = P.optimise(start, { kinds: ['C'] });
    expect(r.names).toEqual(['C2', 'C4', 'C1', 'C3']);
    const l0 = P.networkValues(start[0]!.network).filter((x) => x.type === 'L').map((x) => x.value);
    const l1 = P.networkValues(r.ways[0]!.network).filter((x) => x.type === 'L').map((x) => x.value);
    expect(l1).toEqual(l0);
    expect(P.optimise(start, { kinds: [] }).values).toEqual([]);
    expect(P.optimise(start, { kinds: [] }).endCost).toBeCloseTo(P.cost(start), 12);
  });

  it('improves a real pair: drivers with inductance and a rolled-off woofer', () => {
    const spec: P.FilterSpec = { alignment: 'butterworth', order: 2 };
    const woofer: P.Way = {
      network: P.designPassive(spec, 'lp', 2500, 6),
      load: P.seriesLoad(5.5, 0.0009),
      response: (f) => P.div(P.cx(1), P.cx(1, f / 3500)), // first-order roll-off above 3.5 kHz
    };
    const tweeter: P.Way = {
      network: P.designPassive(spec, 'hp', 2500, 6),
      load: P.seriesLoad(5.2, 0.00006),
      response: () => P.cx(10 ** (3 / 20)),
      polarity: -1,
    };
    const r = P.optimise([woofer, tweeter], { zMinOhm: 3 });
    expect(r.endCost).toBeLessThan(0.7 * r.startCost);
    expect(P.evaluate(r.ways, P.logGrid(100, 20000, 61)).rmsFlatDb).toBeLessThan(P.evaluate([woofer, tweeter], P.logGrid(100, 20000, 61)).rmsFlatDb);
  });

  it('the impedance floor holds the amplifier load up when the shape alone would let it sag', () => {
    const ways = lr4Pair([1, 1, 1, 1, 1, 1, 1, 1], 4);
    const free = P.optimise(ways, { bound: 8 });
    const floor = P.optimise(ways, { bound: 8, zMinOhm: P.evaluate(ways, P.logGrid(100, 20000, 61)).zMinOhm * 0.98 });
    const zf = P.evaluate(free.ways, P.logGrid(100, 20000, 61)).zMinOhm;
    const zc = P.evaluate(floor.ways, P.logGrid(100, 20000, 61)).zMinOhm;
    expect(zc).toBeGreaterThanOrEqual(zf - 1e-9);
  });

  it('a band-pass network optimises too (the interaction the ladder design ignores)', () => {
    const band: P.Way = {
      network: P.designPassiveBand({ alignment: 'butterworth', order: 2 }, 500, 3000, 8),
      load: P.resistiveLoad(8),
      response: unit,
    };
    const r = P.optimise([band], { freqs: P.logGrid(700, 2200, 41) });
    expect(r.endCost).toBeLessThan(r.startCost);
  });
});

describe('snapOptimised', () => {
  const start = lr4Pair([1.3, 0.75, 1.25, 0.8, 0.8, 1.3, 0.75, 1.25]);
  const opt = P.optimise(start);

  for (const series of ['E24', 'E96'] as const)
    it(`every moved part lands on an ${series} value and the cost is no worse than plain snapping`, () => {
      const r = P.snapOptimised(opt.ways, series);
      for (const v of r.values) expect(P.snapToSeries(v, series)).toBeCloseTo(v, 12 - Math.floor(Math.log10(Math.abs(v))) - 3);
      const slots = P.networkValues(opt.ways[0]!.network).concat(P.networkValues(opt.ways[1]!.network));
      const naive = opt.ways.map((w) => ({ ...w, network: w.network.map((b) => ({ ...b, groups: b.groups.map((g) => g.map((p) => ({ ...p, value: P.snapToSeries(p.value, series) }))) })) }));
      expect(r.endCost).toBeLessThanOrEqual(P.cost(naive) + 1e-12);
      expect(P.cost(r.ways)).toBeCloseTo(r.endCost, 9);
      expect(r.values).toHaveLength(slots.length);
      expect(r.evaluations).toBeGreaterThan(1);
    });

  it('E96 ends no further from the continuous optimum than E24 in cost', () => {
    expect(P.snapOptimised(opt.ways, 'E96').endCost).toBeLessThanOrEqual(P.snapOptimised(opt.ways, 'E24').endCost + 0.05);
    expect(P.snapOptimised(opt.ways, 'E24').endCost).toBeLessThan(0.5);
  });

  it('tries the next value on both sides: the log-nearest standard value is not always the cheapest', () => {
    const one = (lMh: number): P.Way => ({ network: [{ kind: 'series', name: 'L1', groups: [[{ type: 'L', value: lMh * 1e-3 }]] }], load: P.resistiveLoad(8), response: () => P.cx(1) });
    const level = (lMh: number): number => 20 * Math.log10(P.abs(P.networkGain(one(lMh).network, 1000, P.resistiveLoad(8))));
    const run = (startMh: number, wantMh: number) => P.snapOptimised([one(startMh)], 'E24', { freqs: [1000], level: 'fixed', targetDb: () => level(wantMh) });
    // 1.2495 mH is nearest to 1.3 by ratio, but the target level is that of 1.2 mH: the downward neighbour wins
    expect(run(1.2495, 1.2).values[0]!).toBeCloseTo(1.2e-3, 12);
    // and the other way: nearest to 1.2 by ratio, target is 1.3 mH
    expect(run(1.2001, 1.3).values[0]!).toBeCloseTo(1.3e-3, 12);
    expect(run(1.2001, 1.3).endCost).toBeLessThan(1e-9);
  });

  it('a part that changes nothing is left on its snapped value (no wandering on ties)', () => {
    const live = start[0]!;
    const dead: P.Way = { ...start[1]!, response: () => P.cx(0) }; // contributes nothing to the sum: its parts cost nothing
    const r = P.snapOptimised([live, dead], 'E24');
    dead.network.forEach((b, i) => expect(r.ways[1]!.network[i]!.groups[0]![0]!.value).toBeCloseTo(P.snapToSeries(b.groups[0]![0]!.value, 'E24'), 12));
  });

  it('is repeatable, and leaves resistors alone', () => {
    expect(P.snapOptimised(opt.ways, 'E24')).toEqual(P.snapOptimised(opt.ways, 'E24'));
    const withPad: P.Way = { ...opt.ways[0]!, network: [...P.lPad(3, 8), ...opt.ways[0]!.network] };
    const r = P.snapOptimised([withPad], 'E24');
    expect(r.ways[0]!.network[0]!.groups[0]![0]!.value).toBe(P.lPad(3, 8)[0]!.groups[0]![0]!.value);
  });
});

describe('reactiveValues and withReactiveValues', () => {
  const ways = lr4Pair([1.3, 0.75, 1.25, 0.8, 0.8, 1.3, 0.75, 1.25]);

  it('read the inductors and capacitors of each way in order, and put them back', () => {
    const v = P.reactiveValues(ways);
    expect(v).toHaveLength(2);
    expect(v[0]).toEqual(P.networkValues(ways[0]!.network).map((x) => x.value));
    expect(v[1]).toEqual(P.networkValues(ways[1]!.network).map((x) => x.value));
    const doubled = P.withReactiveValues(ways, v.map((w) => w.map((x) => 2 * x)));
    expect(P.reactiveValues(doubled)).toEqual(v.map((w) => w.map((x) => 2 * x)));
    expect(P.reactiveValues(ways)).toEqual(v); // the input is not touched
    expect(P.reactiveValues(P.withReactiveValues(ways, v))).toEqual(v);
  });

  it('resistors are skipped when reading and left alone when writing', () => {
    const padded: P.Way = { ...ways[0]!, network: [...ways[0]!.network, ...P.lPad(3, 8)] };
    expect(P.reactiveValues([padded])[0]).toHaveLength(4);
    const out = P.withReactiveValues([padded], [[1e-3, 1e-5, 2e-3, 2e-5]]);
    expect(out[0]!.network[4]!.groups[0]![0]!.value).toBe(padded.network[4]!.groups[0]![0]!.value);
    expect(P.reactiveValues(out)[0]).toEqual([1e-3, 1e-5, 2e-3, 2e-5]);
  });

  it('bad or missing values are ignored, and the values of the second way go to the second way', () => {
    const v = P.reactiveValues(ways);
    const out = P.withReactiveValues(ways, [[NaN, -1, 0, Infinity], [1e-4]]);
    expect(P.reactiveValues(out)[0]).toEqual(v[0]); // nothing usable in the first way
    expect(P.reactiveValues(out)[1]![0]).toBe(1e-4);
    expect(P.reactiveValues(out)[1]!.slice(1)).toEqual(v[1]!.slice(1));
    expect(P.reactiveValues(P.withReactiveValues(ways, []))).toEqual(v);
  });
});

describe('seriesStep', () => {
  it('walks up and down the series across decades', () => {
    let v = 0.91;
    const up: number[] = [];
    for (let k = 0; k < 5; ++k) {
      v = P.seriesStep(v, 'E24', 1);
      up.push(v);
    }
    expect(up.map((x) => +x.toPrecision(3))).toEqual([1, 1.1, 1.2, 1.3, 1.5]);
    let w = 1.5;
    const down: number[] = [];
    for (let k = 0; k < 4; ++k) {
      w = P.seriesStep(w, 'E24', -1);
      down.push(w);
    }
    expect(down.map((x) => +x.toPrecision(3))).toEqual([1.3, 1.2, 1.1, 1]);
    expect(+P.seriesStep(1, 'E24', -1).toPrecision(3)).toBe(0.91);
    expect(+P.seriesStep(10, 'E24', 1).toPrecision(3)).toBe(11);
    expect(+P.seriesStep(0.0000047, 'E24', 1).toPrecision(3)).toBe(0.0000051);
  });

  it('a value that is not standard steps to its neighbours; a standard one to the adjacent', () => {
    expect(P.seriesStep(4.8, 'E24', -1)).toBeCloseTo(4.7, 12);
    expect(P.seriesStep(4.8, 'E24', 1)).toBeCloseTo(5.1, 12);
    expect(P.seriesStep(4.7, 'E24', 1)).toBeCloseTo(5.1, 12);
    expect(P.seriesStep(4.7 * (1 + 1e-10), 'E24', 1)).toBeCloseTo(5.1, 12);
  });
});
