// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Passive crossover networks (spec "Passive crossover networks (app only, v0.23)"): ladder values for any alignment of order 1 to 4
// by singly-terminated synthesis, a complex ladder solver against any load (a driver's impedance, not just a resistor), and the
// extras: Zobel, L-pad, notch trap, baffle-step shelf, inductor resistance, element voltage and current.
import { type Cx, abs, add, cx, div, mul, scale } from './complex';
import { type FilterSpec, isValidOrder, xoFilter } from './filters';

export const MAX_PASSIVE_ORDER = 4;

export type PartType = 'R' | 'L' | 'C';
export interface Part {
  type: PartType;
  /** Ohm, henry or farad. */
  value: number;
}

/**
 * One element of a ladder. A series element sits in the line, a shunt element goes from the line to ground. Its impedance is
 * the sum over `groups` of each group's parallel combination, so `[[L], [R]]` is an inductor with its resistance in series and
 * `[[L, R]]` an inductor with a resistor across it.
 */
export interface Branch {
  kind: 'series' | 'shunt';
  groups: Part[][];
  name: string;
}

export type Network = Branch[];
export type LoadFn = (f: number) => Cx;

const partZ = (p: Part, f: number): Cx => {
  if (p.type === 'R') return cx(p.value);
  const w = 2 * Math.PI * f;
  return p.type === 'L' ? cx(0, w * p.value) : cx(0, -1 / (w * p.value));
};

/** Impedance of a branch at f. */
export function branchZ(b: Branch, f: number): Cx {
  let z = cx(0);
  for (const g of b.groups) {
    let y = cx(0);
    for (const p of g) y = add(y, div(cx(1), partZ(p, f)));
    z = add(z, div(cx(1), y));
  }
  return z;
}

/** Generic air-core inductor resistance, ohm: 0.1 ohm at 1 mH, rising as L^0.6. An estimate to start from; enter the real one. */
export const estimateDcrOhm = (lH: number): number => 0.1 * (lH / 1e-3) ** 0.6;

// -- ladder synthesis ------------------------------------------------------------------------------------------------------

/** Ascending coefficients of prod(1 - s/p) over the poles (real: they come in conjugate pairs). */
function denominator(poles: readonly Cx[]): number[] {
  let c: Cx[] = [cx(1)];
  for (const p of poles) {
    const next: Cx[] = Array.from({ length: c.length + 1 }, () => cx(0));
    const inv = div(cx(1), p);
    c.forEach((a, i) => {
      next[i] = add(next[i]!, a);
      const t = mul(a, inv);
      next[i + 1] = cx(next[i + 1]!.re - t.re, next[i + 1]!.im - t.im);
    });
    c = next;
  }
  return c.map((x) => x.re);
}

/**
 * Normalised element values of the singly-terminated ladder for the all-pole low-pass 1/D(s), source side first: series L, shunt C,
 * series L, ... in units of R/wc (L) and 1/(R wc) (C). D = A + B with A the even and B the odd part; the elements are the
 * quotients of the continued fraction of B/A (odd order) or A/B (even order), which starts at the load.
 */
export function ladderG(poles: readonly Cx[]): number[] {
  const d = denominator(poles);
  const n = d.length - 1;
  const big = Math.max(...d.map(Math.abs), 1);
  const a = d.map((x, i) => (i % 2 === 0 ? x : 0));
  const b = d.map((x, i) => (i % 2 === 1 ? x : 0));
  let num = n % 2 === 1 ? b : a;
  let den = n % 2 === 1 ? a : b;
  const deg = (p: readonly number[]): number => {
    for (let i = p.length - 1; i >= 0; --i) if (Math.abs(p[i]!) > 1e-12 * big) return i;
    return -1;
  };
  const out: number[] = [];
  for (let step = 0; step <= n; ++step) {
    const dd = deg(den);
    if (dd < 0) break;
    const dn = deg(num);
    const k = num[dn]! / den[dd]!;
    out.push(k);
    const rem = num.map((x, i) => x - (i >= 1 ? k * den[i - 1]! : 0));
    num = den;
    den = rem;
  }
  return out.reverse();
}

export interface PassiveOptions {
  /** Put each inductor's estimated resistance in series with it. */
  dcr?: boolean;
}

/**
 * Ladder for a low-pass or high-pass section of the given filter into a resistive load r, crossover frequency fc. Orders 1 to 4.
 * A lossless singly-terminated ladder has unity gain at DC, so an even-order Chebyshev (which starts ripple dB down) cannot be
 * built this way and is refused.
 */
export function designPassive(spec: FilterSpec, band: 'lp' | 'hp', fc: number, r: number, opts: PassiveOptions = {}): Network {
  if (!isValidOrder(spec.alignment, spec.order) || spec.order > MAX_PASSIVE_ORDER)
    throw new RangeError(`passive networks go up to order ${MAX_PASSIVE_ORDER} (order ${spec.order} of ${spec.alignment} is not available)`);
  if (spec.alignment === 'chebyshev' && spec.order % 2 === 0) throw new RangeError('an even-order Chebyshev needs a source resistance; use an odd order');
  const g = ladderG(xoFilter(spec).poles);
  const wc = 2 * Math.PI * fc;
  return g.map((v, i): Branch => {
    const series = i % 2 === 0;
    const name = `${series === (band === 'lp') ? 'L' : 'C'}${i + 1}`;
    if (band === 'lp') {
      if (series) return { kind: 'series', name, groups: inductor((v * r) / wc, opts) };
      return { kind: 'shunt', name, groups: [[{ type: 'C', value: v / (wc * r) }]] };
    }
    if (series) return { kind: 'series', name, groups: [[{ type: 'C', value: 1 / (v * wc * r) }]] };
    return { kind: 'shunt', name, groups: inductor(r / (v * wc), opts) };
  });
}

const inductor = (l: number, opts: PassiveOptions): Part[][] => (opts.dcr ? [[{ type: 'L', value: l }], [{ type: 'R', value: estimateDcrOhm(l) }]] : [[{ type: 'L', value: l }]]);

/** Band-pass: a high-pass ladder at fLow then a low-pass ladder at fHigh, each designed for r by itself (their interaction shows in the response). */
export function designPassiveBand(spec: FilterSpec, fLow: number, fHigh: number, r: number, opts: PassiveOptions = {}): Network {
  const hp = designPassive(spec, 'hp', fLow, r, opts).map((b) => ({ ...b, name: `${b.name} (hp)` }));
  const lp = designPassive(spec, 'lp', fHigh, r, opts).map((b) => ({ ...b, name: `${b.name} (lp)` }));
  return [...hp, ...lp];
}

/** The reactive elements' values as a flat list, source first: name, type and value of the L or C of each branch. */
export function networkValues(net: Network): { name: string; type: PartType; value: number }[] {
  return net.flatMap((b) => b.groups.flat().filter((p) => p.type !== 'R').map((p) => ({ name: b.name, type: p.type, value: p.value })));
}

// -- solver ----------------------------------------------------------------------------------------------------------------

type Abcd = [Cx, Cx, Cx, Cx];

/** Chain matrix of the whole network at f. */
export function networkAbcd(net: Network, f: number): Abcd {
  let m: Abcd = [cx(1), cx(0), cx(0), cx(1)];
  for (const b of net) {
    const z = branchZ(b, f);
    const [a, bb, c, d] = m;
    if (b.kind === 'series') m = [a, add(mul(a, z), bb), c, add(mul(c, z), d)];
    else {
      const y = div(cx(1), z);
      m = [add(a, mul(bb, y)), bb, add(c, mul(d, y)), d];
    }
  }
  return m;
}

/** Voltage at the load terminals over the source voltage. */
export function networkGain(net: Network, f: number, load: LoadFn): Cx {
  const [a, b] = networkAbcd(net, f);
  return div(cx(1), add(a, div(b, load(f))));
}

/** Impedance the amplifier sees. */
export function networkInputZ(net: Network, f: number, load: LoadFn): Cx {
  const [a, b, c, d] = networkAbcd(net, f);
  const zl = load(f);
  return div(add(mul(a, zl), b), add(mul(c, zl), d));
}

/** Several branches fed by the same amplifier in parallel: the impedance the amplifier sees. */
export function parallelZ(zs: readonly Cx[]): Cx {
  let y = cx(0);
  for (const z of zs) y = add(y, div(cx(1), z));
  return div(cx(1), y);
}

/** A resistor as a load. */
export const resistiveLoad = (r: number): LoadFn => () => cx(r);

/** A driver's free-air-style load: Re + s Le in series with a motional impedance function. */
export function seriesLoad(re: number, le: number, motional?: LoadFn): LoadFn {
  return (f) => {
    const z = cx(re, 2 * Math.PI * f * le);
    return motional ? add(z, motional(f)) : z;
  };
}

// -- the extras ------------------------------------------------------------------------------------------------------------

/** L-pad that attenuates by attDb into a resistive load r and keeps r as the input impedance: series then shunt resistor. */
export function lPad(attDb: number, r: number): Network {
  const k = 10 ** (-attDb / 20);
  return [
    { kind: 'series', name: 'Rs', groups: [[{ type: 'R', value: r * (1 - k) }]] },
    { kind: 'shunt', name: 'Rp', groups: [[{ type: 'R', value: (r * k) / (1 - k) }]] },
  ];
}

/** Zobel across a driver of Re and Le: Rz = Re, Cz = Le/Re^2 makes the pair exactly Re (for that simple model). */
export function zobel(re: number, le: number): Branch {
  return { kind: 'shunt', name: 'Zobel', groups: [[{ type: 'R', value: re }], [{ type: 'C', value: le / (re * re) }]] };
}

/** Series R-L-C trap across a driver, resonant at f0 with quality factor q and the given resistance: L = q R/w0, C = 1/(w0 q R). */
export function notchTrap(f0: number, q: number, r: number): Branch {
  const w0 = 2 * Math.PI * f0;
  return { kind: 'shunt', name: 'Notch', groups: [[{ type: 'R', value: r }], [{ type: 'L', value: (q * r) / w0 }], [{ type: 'C', value: 1 / (w0 * q * r) }]] };
}

/**
 * Baffle-step shelf: an inductor with a resistor across it in series with a driver of nominal impedance rd. It is flat at low
 * frequency and rd/(rd + Rp) = -depthDb at high frequency, with the step centred (half the depth) on fStep.
 */
export function baffleStep(depthDb: number, fStep: number, rd: number): Branch {
  const rp = rd * (10 ** (depthDb / 20) - 1);
  const fz = fStep * 10 ** (depthDb / 40);
  return { kind: 'series', name: 'BSC', groups: [[{ type: 'L', value: rp / (2 * Math.PI * fz) }, { type: 'R', value: rp }]] };
}

// -- ratings ---------------------------------------------------------------------------------------------------------------

export interface ElementStress {
  name: string;
  /** rms volts across the branch. */
  vRms: number;
  /** rms amps through the branch. */
  iRms: number;
  /** Watts dissipated in the branch: about 0 for a pure inductor or capacitor, the heat in a resistor or an inductor's resistance. */
  powerW: number;
}

/** Voltage across and current through every branch for vInRms at f, working from the source along the line. */
export function networkStress(net: Network, f: number, load: LoadFn, vInRms: number): ElementStress[] {
  let v = cx(vInRms);
  let i = scale(div(cx(1), networkInputZ(net, f, load)), vInRms);
  return net.map((b) => {
    const z = branchZ(b, f);
    if (b.kind === 'series') {
      const across = mul(i, z);
      v = cx(v.re - across.re, v.im - across.im);
      return { name: b.name, vRms: abs(across), iRms: abs(i), powerW: across.re * i.re + across.im * i.im };
    }
    const through = div(v, z);
    i = cx(i.re - through.re, i.im - through.im);
    return { name: b.name, vRms: abs(v), iRms: abs(through), powerW: v.re * through.re + v.im * through.im };
  });
}

/** The largest voltage and current each branch sees over a set of frequencies. */
export function worstStress(net: Network, freqs: readonly number[], load: LoadFn, vInRms: number): ElementStress[] {
  const worst = net.map((b) => ({ name: b.name, vRms: 0, iRms: 0, powerW: 0 }));
  for (const f of freqs)
    networkStress(net, f, load, vInRms).forEach((s, k) => {
      worst[k]!.vRms = Math.max(worst[k]!.vRms, s.vRms);
      worst[k]!.iRms = Math.max(worst[k]!.iRms, s.iRms);
      worst[k]!.powerW = Math.max(worst[k]!.powerW, s.powerW);
    });
  return worst;
}

export const CAPACITOR_VOLTAGE_RATINGS = [16, 25, 35, 50, 63, 100, 160, 250, 400, 630] as const;

/** Smallest standard capacitor voltage rating with 50 % margin over the peak of an rms voltage; Infinity above the table. */
export function capacitorVoltageRating(vRms: number): number {
  const need = 1.5 * Math.SQRT2 * vRms;
  return CAPACITOR_VOLTAGE_RATINGS.find((v) => v >= need) ?? Infinity;
}

/** The amplifier's rms output voltage for a power into a load: sqrt(P R). */
export const ampVoltsRms = (powerW: number, loadOhm: number): number => Math.sqrt(powerW * loadOhm);

/** Log-spaced test frequencies, 20 Hz to 20 kHz. */
export const STRESS_FREQS: readonly number[] = Array.from({ length: 61 }, (_, k) => 20 * 10 ** (k / 20));
