// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Crossover optimiser (spec "Crossover optimiser (app only, v0.24)"): moves the reactive parts of passive networks so the
// drivers' summed acoustic response is as flat as possible (or follows a target) while the amplifier's impedance stays above a
// floor, then snaps the parts to a standard series. Deterministic: a bounded Nelder-Mead search with a fixed iteration budget
// and no randomness, so the same problem always gives the same answer.
import { type Cx, abs, add, cx, mul } from './complex';
import { type Series, seriesStep, snapToSeries } from './activecircuits';
import { type LoadFn, type Network, networkGain, networkInputZ, parallelZ } from './passive_xo';

/** One driver and the network in front of it. */
export interface Way {
  network: Network;
  /** Impedance of the driver (and anything across it) at the network's output. */
  load: LoadFn;
  /** The driver's acoustic response per volt at its terminals (complex, includes its level), at f. */
  response: (f: number) => Cx;
  /** +1, or -1 when the driver is wired reversed. */
  polarity?: 1 | -1;
  /** Extra delay of this driver's sound, seconds (acoustic centre set back). */
  delayS?: number;
}

/** The summed acoustic response at f. */
export function sumResponse(ways: readonly Way[], f: number): Cx {
  let tot = cx(0);
  for (const w of ways) {
    const a = -2 * Math.PI * f * (w.delayS ?? 0);
    const term = mul(mul(networkGain(w.network, f, w.load), w.response(f)), cx(Math.cos(a), Math.sin(a)));
    tot = add(tot, cx((w.polarity ?? 1) * term.re, (w.polarity ?? 1) * term.im));
  }
  return tot;
}

export interface Evaluation {
  /** Mean of the error (summed level in dB minus the target) over the frequencies. */
  meanDb: number;
  /** Rms of the error. */
  rmsDb: number;
  /** Rms of the error with its mean removed: the shape error, which a level trim cannot fix. */
  rmsFlatDb: number;
  /** Smallest impedance the amplifier sees (all the ways in parallel) over the frequencies, ohm. */
  zMinOhm: number;
}

export function evaluate(ways: readonly Way[], freqs: readonly number[], targetDb: (f: number) => number = () => 0): Evaluation {
  const err = freqs.map((f) => 20 * Math.log10(abs(sumResponse(ways, f))) - targetDb(f));
  const mean = err.reduce((a, b) => a + b, 0) / err.length;
  let zMin = Infinity;
  for (const f of freqs) zMin = Math.min(zMin, abs(parallelZ(ways.map((w) => networkInputZ(w.network, f, w.load)))));
  return {
    meanDb: mean,
    rmsDb: Math.sqrt(err.reduce((a, b) => a + b * b, 0) / err.length),
    rmsFlatDb: Math.sqrt(err.reduce((a, b) => a + (b - mean) * (b - mean), 0) / err.length),
    zMinOhm: zMin,
  };
}

/** n log-spaced frequencies from lo to hi inclusive. */
export const logGrid = (lo: number, hi: number, n: number): number[] => Array.from({ length: n }, (_, k) => lo * (hi / lo) ** (k / (n - 1)));

export interface OptimiseOptions {
  /** Frequencies the error is measured at; default 61 points from 100 Hz to 20 kHz. */
  freqs?: readonly number[];
  /** Target level in dB at f; default 0 (flat). */
  targetDb?: (f: number) => number;
  /** 'free' (default) scores the shape only, ignoring the overall level (a trim or L-pad sets it); 'fixed' scores the level too. */
  level?: 'free' | 'fixed';
  /** Amplifier-side impedance floor, ohm; 0 (default) means none. Below it the cost grows by `zWeight` dB per ohm. */
  zMinOhm?: number;
  zWeight?: number;
  /** Each part may move by this factor either way from its start value; default 4. */
  bound?: number;
  /** Search iterations per start of the simplex; default 300. */
  maxIter?: number;
  /** Extra restarts of the simplex from the best point found; default 2. */
  restarts?: number;
  /** Which parts move; default both inductors and capacitors (resistors never do). */
  kinds?: readonly ('L' | 'C')[];
}

interface Slot {
  way: number;
  branch: number;
  group: number;
  part: number;
}

const DEFAULTS = { bound: 4, maxIter: 300, restarts: 2, zWeight: 2 };

const cloneWays = (ways: readonly Way[]): Way[] =>
  ways.map((w) => ({ ...w, network: w.network.map((b) => ({ ...b, groups: b.groups.map((g) => g.map((p) => ({ ...p }))) })) }));

function slotsOf(ways: readonly Way[], kinds: readonly string[]): Slot[] {
  const out: Slot[] = [];
  ways.forEach((w, wi) =>
    w.network.forEach((b, bi) =>
      b.groups.forEach((g, gi) =>
        g.forEach((p, pi) => {
          if (kinds.includes(p.type)) out.push({ way: wi, branch: bi, group: gi, part: pi });
        }),
      ),
    ),
  );
  return out;
}

const valueOf = (ways: readonly Way[], s: Slot): number => ways[s.way]!.network[s.branch]!.groups[s.group]![s.part]!.value;

function withValues(ways: readonly Way[], slots: readonly Slot[], values: readonly number[]): Way[] {
  const out = cloneWays(ways);
  slots.forEach((s, k) => {
    out[s.way]!.network[s.branch]!.groups[s.group]![s.part]!.value = values[k]!;
  });
  return out;
}

/** The inductor and capacitor values of each way, in network order: what a page stores to keep an optimised design. */
export function reactiveValues(ways: readonly Way[]): number[][] {
  return ways.map((w, wi) => slotsOf([w], ['L', 'C']).map((sl) => valueOf(ways, { ...sl, way: wi })));
}

/** The ways with those inductor and capacitor values put back (the shapes must match; extra or missing values are ignored). */
export function withReactiveValues(ways: readonly Way[], values: readonly (readonly number[])[]): Way[] {
  const slots = slotsOf(ways, ['L', 'C']);
  const flat = ways.flatMap((_, wi) => slots.filter((sl) => sl.way === wi).map((_, k) => values[wi]?.[k]));
  const out = cloneWays(ways);
  slots.forEach((sl, k) => {
    const v = flat[k];
    if (v !== undefined && Number.isFinite(v) && v > 0) out[sl.way]!.network[sl.branch]!.groups[sl.group]![sl.part]!.value = v;
  });
  return out;
}

export interface OptimiseResult {
  ways: Way[];
  /** The moved parts' values, in network order, and their names. */
  values: number[];
  names: string[];
  startCost: number;
  endCost: number;
  evaluations: number;
}

/** The cost the search minimises: the shape (or level and shape) error in dB plus the impedance-floor penalty. */
export function cost(ways: readonly Way[], o: OptimiseOptions = {}): number {
  const e = evaluate(ways, o.freqs ?? logGrid(100, 20000, 61), o.targetDb);
  const base = o.level === 'fixed' ? e.rmsDb : e.rmsFlatDb;
  return base + (o.zMinOhm ? (o.zWeight ?? DEFAULTS.zWeight) * Math.max(0, o.zMinOhm - e.zMinOhm) : 0);
}

/** Bounded Nelder-Mead in the log of each part's value (reflect 1, expand 2, contract 0.5, shrink 0.5), the same every time. */
export function optimise(ways: readonly Way[], o: OptimiseOptions = {}): OptimiseResult {
  const slots = slotsOf(ways, o.kinds ?? ['L', 'C']);
  const v0 = slots.map((s) => valueOf(ways, s));
  const bound = Math.log(o.bound ?? DEFAULTS.bound);
  const n = slots.length;
  let evaluations = 0;
  const lo = (x: readonly number[]): number[] => x.map((t) => Math.min(Math.max(t, -bound), bound));
  const f = (x: readonly number[]): number => {
    ++evaluations;
    return cost(withValues(ways, slots, v0.map((v, k) => v * Math.exp(x[k]!))), o);
  };
  const startCost = n === 0 ? cost(ways, o) : f(new Array(n).fill(0));
  let best = new Array<number>(n).fill(0);
  let bestCost = startCost;
  for (let round = 0; round <= (o.restarts ?? DEFAULTS.restarts) && n > 0; ++round) {
    const step = round === 0 ? 0.2 : 0.1;
    let simplex = [best, ...best.map((_, i) => lo(best.map((t, k) => (k === i ? t + (t + step > bound ? -step : step) : t))))].map((x) => ({ x, c: f(x) }));
    for (let it = 0; it < (o.maxIter ?? DEFAULTS.maxIter); ++it) {
      simplex.sort((a, b) => a.c - b.c);
      if (simplex[n]!.c - simplex[0]!.c < 1e-10) break;
      const cen = new Array<number>(n).fill(0);
      for (let i = 0; i < n; ++i) for (let k = 0; k < n; ++k) cen[k] += simplex[i]!.x[k]! / n;
      const worst = simplex[n]!;
      const at = (t: number): { x: number[]; c: number } => {
        const x = lo(cen.map((c, k) => c + t * (c - worst.x[k]!)));
        return { x, c: f(x) };
      };
      const refl = at(1);
      if (refl.c < simplex[0]!.c) {
        const exp = at(2);
        simplex[n] = exp.c < refl.c ? exp : refl;
      } else if (refl.c < simplex[n - 1]!.c) simplex[n] = refl;
      else {
        const con = at(refl.c < worst.c ? 0.5 : -0.5);
        if (con.c < Math.min(refl.c, worst.c)) simplex[n] = con;
        else
          simplex = simplex.map((p, i) => {
            if (i === 0) return p;
            const x = lo(p.x.map((t, k) => simplex[0]!.x[k]! + 0.5 * (t - simplex[0]!.x[k]!)));
            return { x, c: f(x) };
          });
      }
    }
    simplex.sort((a, b) => a.c - b.c);
    if (simplex[0]!.c < bestCost - 1e-9) {
      best = simplex[0]!.x;
      bestCost = simplex[0]!.c;
    } else break;
  }
  const values = v0.map((v, k) => v * Math.exp(best[k]!));
  const out = withValues(ways, slots, values);
  return { ways: out, values, names: slots.map((s) => ways[s.way]!.network[s.branch]!.name), startCost, endCost: bestCost, evaluations };
}

/**
 * Standard-value parts: every moved part is snapped to the series, then up to three passes try the next value above and below
 * on each part in turn and keep any step that lowers the cost. Never worse than plain snapping.
 */
export function snapOptimised(ways: readonly Way[], series: Series, o: OptimiseOptions = {}): OptimiseResult {
  const slots = slotsOf(ways, o.kinds ?? ['L', 'C']);
  let values = slots.map((s) => snapToSeries(valueOf(ways, s), series));
  let evaluations = 0;
  const c = (v: readonly number[]): number => {
    ++evaluations;
    return cost(withValues(ways, slots, v), o);
  };
  const startCost = cost(ways, o);
  let best = c(values);
  for (let pass = 0; pass < 3; ++pass) {
    let moved = false;
    for (let k = 0; k < slots.length; ++k)
      for (const dir of [1, -1] as const) {
        const trial = values.slice();
        trial[k] = seriesStep(values[k]!, series, dir);
        const t = c(trial);
        if (t < best - 1e-12) {
          best = t;
          values = trial;
          moved = true;
        }
      }
    if (!moved) break;
  }
  return { ways: withValues(ways, slots, values), values, names: slots.map((s) => ways[s.way]!.network[s.branch]!.name), startCost, endCost: best, evaluations };
}
