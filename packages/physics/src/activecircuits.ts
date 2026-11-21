// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Active crossover circuits (spec "Active crossover circuits (app only, v0.21)"): component values for an op-amp realisation of
// any alignment from filters.ts, the response of the circuit from those values, and snapping to the E24 and E96 series.
// A filter is cut into sections: one RC plus buffer per real pole and one biquad per complex pair (low Q first).
import { type Cx, abs, cx, div, mul } from './complex';
import { type FilterSpec, xoFilter } from './filters';

export const TOPOLOGIES = ['sk-equal', 'sk-unity', 'mfb', 'state-variable'] as const;
export type Topology = (typeof TOPOLOGIES)[number];
export type Band = 'lp' | 'hp';
export type Series = 'E24' | 'E96';

export interface Section {
  order: 1 | 2;
  topology: Topology;
  band: Band;
  /** Corner (first order) or natural frequency (second order) of this section, Hz. */
  f0: number;
  q: number;
  /** Farads, by name (`c`, or `c1` `c2` `c3`). */
  caps: Record<string, number>;
  /** Ohms, by name. */
  res: Record<string, number>;
}

export interface ActiveDesign {
  spec: FilterSpec;
  fc: number;
  band: Band;
  topology: Topology;
  sections: Section[];
  /** Linear gain that follows the cascade so its passband gain equals the filter's (attenuator, or gain when above 1). */
  trim: number;
  /** True when an odd number of sections invert: the network as a whole inverts the signal. */
  inverts: boolean;
}

const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];
const E96 = Array.from({ length: 96 }, (_, k) => Math.round(10 ** (k / 96) * 100) / 100);

/** Nearest standard value of the series by log distance (the decade's 10 counts as a value). */
export function snapToSeries(v: number, series: Series): number {
  const tab = [...(series === 'E24' ? E24 : E96), 10];
  const e = Math.floor(Math.log10(v));
  const m = v / 10 ** e;
  let best = tab[0]!;
  for (const c of tab) if (Math.abs(Math.log(m / c)) < Math.abs(Math.log(m / best))) best = c;
  return best * 10 ** e;
}

/** The next standard value strictly above (direction 1) or below (-1) v; a value within 1e-9 of a standard one counts as it. */
export function seriesStep(v: number, series: Series, direction: 1 | -1): number {
  const tab = series === 'E24' ? E24 : E96;
  const e = Math.floor(Math.log10(v));
  const vals = [e - 1, e, e + 1].flatMap((k) => tab.map((c) => c * 10 ** k)).sort((x, y) => x - y);
  return direction > 0 ? vals.find((x) => x > v * (1 + 1e-9))! : [...vals].reverse().find((x) => x < v * (1 - 1e-9))!;
}

export const DEFAULT_CAP_F = 10e-9;
export const DEFAULT_R0_OHM = 10e3;

const invertsSection = (s: Section): boolean => s.order === 2 && (s.topology === 'mfb' || s.topology === 'state-variable');

function capsFor(t: Topology, band: Band, order: 1 | 2, q: number, c: number): Record<string, number> {
  if (order === 1) return { c };
  if (t === 'sk-equal') return { c1: c, c2: c };
  if (t === 'sk-unity') return band === 'lp' ? { c1: 4 * q * q * c, c2: c } : { c1: c, c2: c };
  if (t === 'mfb') return band === 'lp' ? { c1: c, c2: c / (16 * q * q) } : { c1: c, c2: c, c3: c };
  return { c };
}

function resFor(t: Topology, band: Band, order: 1 | 2, w0: number, q: number, caps: Record<string, number>, r0: number): Record<string, number> {
  if (order === 1) return { r: 1 / (w0 * caps.c!) };
  if (t === 'sk-equal') {
    if (!(q > 0.5)) throw new RangeError(`Sallen-Key equal-component needs Q above 0.5 (this section has ${q.toFixed(3)})`);
    const r = 1 / (w0 * Math.sqrt(caps.c1! * caps.c2!));
    return { r1: r, r2: r, rg: r, rf: (2 - 1 / q) * r };
  }
  if (t === 'sk-unity') {
    const c = Math.sqrt(caps.c1! * caps.c2!);
    if (band === 'lp') return { r1: 1 / (w0 * c), r2: 1 / (w0 * c) };
    return { r1: 1 / (2 * q * w0 * c), r2: (2 * q) / (w0 * c) };
  }
  if (t === 'mfb') {
    if (band === 'lp') {
      const a1 = 1 / (w0 * q);
      const a2 = 1 / (w0 * w0);
      const { c1, c2 } = caps as { c1: number; c2: number };
      const disc = Math.max(0, (a1 / c2) ** 2 - (8 * a2) / (c1 * c2));
      const r2 = (a1 / c2 - Math.sqrt(disc)) / 2;
      return { r1: r2, r2, r3: a2 / (r2 * c1 * c2) };
    }
    const { c1, c2, c3 } = caps as { c1: number; c2: number; c3: number };
    const r2 = (q * (c1 + c2 + c3)) / (w0 * c2 * c3);
    return { r1: 1 / (w0 * w0 * r2 * c2 * c3), r2 };
  }
  if (!(q >= 1 / 3)) throw new RangeError(`the state-variable circuit needs Q of at least 1/3 (this section has ${q.toFixed(3)})`);
  return { r: 1 / (w0 * caps.c!), rs: r0, rf: r0, rb: r0, ra: (3 * q - 1) * r0 };
}

/** Response of one section from its component values (ideal op-amp). Inverting sections have a negative passband gain. */
export function sectionResponse(sec: Section, f: number): Cx {
  const s = cx(0, 2 * Math.PI * f);
  const s2 = mul(s, s);
  const { caps: c, res: r } = sec;
  const lp = sec.band === 'lp';
  if (sec.order === 1) {
    const x = mul(s, cx(r.r! * c.c!));
    const den = cx(1 + x.re, x.im);
    return lp ? div(cx(1), den) : div(x, den);
  }
  if (sec.topology === 'sk-equal' || sec.topology === 'sk-unity') {
    const k = r.rf !== undefined ? 1 + r.rf / r.rg! : 1;
    const p = r.r1! * r.r2! * c.c1! * c.c2!;
    if (lp) {
      const b = r.r1! * c.c2! + r.r2! * c.c2! + r.r1! * c.c1! * (1 - k);
      return div(cx(k), cx(1 - p * (2 * Math.PI * f) ** 2, b * s.im));
    }
    const b = r.r1! * (c.c1! + c.c2!) + r.r2! * c.c2! * (1 - k);
    return div(mul(s2, cx(k * p)), cx(1 - p * (2 * Math.PI * f) ** 2, b * s.im));
  }
  if (sec.topology === 'mfb') {
    if (lp) {
      const a1 = c.c2! * (r.r2! + r.r3! + (r.r2! * r.r3!) / r.r1!);
      const a2 = c.c1! * c.c2! * r.r2! * r.r3!;
      return div(cx(-r.r2! / r.r1!), cx(1 - a2 * (2 * Math.PI * f) ** 2, a1 * s.im));
    }
    const a1 = (c.c1! + c.c2! + c.c3!) / (r.r2! * c.c2! * c.c3!);
    const a0 = 1 / (r.r1! * r.r2! * c.c2! * c.c3!);
    return div(mul(s2, cx(-c.c1! / c.c2!)), cx(a0 - (2 * Math.PI * f) ** 2, a1 * s.im));
  }
  // state-variable: both integrators r and c, summing amp gain g = rf/rs, damping divider beta = rb / (ra + rb)
  const x = 2 * Math.PI * f * r.r! * c.c!;
  const g = r.rf! / r.rs!;
  const beta = r.rb! / (r.ra! + r.rb!);
  const den = cx(g - x * x, (1 + 2 * g) * beta * x);
  return lp ? div(cx(-g), den) : div(cx(g * x * x), den);
}

/** Section values for a filter at crossover frequency fc, built on capacitor `capF` (the base capacitance of every section). */
export function designActive(spec: FilterSpec, fc: number, band: Band, topology: Topology, capF = DEFAULT_CAP_F, r0 = DEFAULT_R0_OHM): ActiveDesign {
  const filter = xoFilter(spec);
  const found: { order: 1 | 2; w0p: number; q: number }[] = [];
  for (const p of filter.poles) {
    const m = abs(p);
    if (Math.abs(p.im) < 1e-9 * m) found.push({ order: 1, w0p: m, q: 0 });
    else if (p.im > 0) found.push({ order: 2, w0p: m, q: m / (-2 * p.re) });
  }
  found.sort((a, b) => a.order - b.order || a.q - b.q);
  const sections: Section[] = found.map(({ order, w0p, q }) => {
    const f0 = band === 'lp' ? fc * w0p : fc / w0p;
    const caps = capsFor(topology, band, order, q, capF);
    return { order, topology, band, f0, q, caps, res: resFor(topology, band, order, 2 * Math.PI * f0, q, caps, r0) };
  });
  const gain = sections.reduce((g, sec) => g * abs(sectionResponse(sec, band === 'lp' ? 1e-3 : 1e9)), 1);
  return { spec, fc, band, topology, sections, trim: filter.peak / gain, inverts: sections.filter(invertsSection).length % 2 === 1 };
}

/** Response of the whole cascade from its component values, trim included; negative passband gain when it inverts. */
export function activeResponse(d: ActiveDesign, f: number): Cx {
  let h = cx(d.trim);
  for (const sec of d.sections) h = mul(h, sectionResponse(sec, f));
  return h;
}

/** Capacitors snapped to the series first, the resistors recomputed from those capacitors, then the resistors snapped. The trim is kept. */
export function snapDesign(d: ActiveDesign, series: Series): ActiveDesign {
  const sections = d.sections.map((sec) => {
    const caps = Object.fromEntries(Object.entries(sec.caps).map(([k, v]) => [k, snapToSeries(v, series)]));
    const r0 = sec.res.rs ?? DEFAULT_R0_OHM;
    const res = resFor(sec.topology, sec.band, sec.order, 2 * Math.PI * sec.f0, sec.q, caps, r0);
    return { ...sec, caps, res: Object.fromEntries(Object.entries(res).map(([k, v]) => [k, snapToSeries(v, series)])) };
  });
  return { ...d, sections };
}

export interface DesignError {
  /** Largest magnitude error against the ideal filter over 20 Hz to 20 kHz (61 log points), dB. */
  maxDb: number;
  /** Level offset in the passband (fc/10 for a low-pass, 10 fc for a high-pass), dB: removable with the trim. */
  offsetDb: number;
  /** Largest error once that offset is removed, dB. */
  maxDbTrimmed: number;
}

export function designError(d: ActiveDesign): DesignError {
  const filter = xoFilter(d.spec);
  const ideal = (f: number): number => abs(d.band === 'lp' ? filter.lp(f, d.fc) : filter.hp(f, d.fc));
  const dev = (f: number): number => 20 * Math.log10(abs(activeResponse(d, f)) / ideal(f));
  const offsetDb = dev(d.band === 'lp' ? d.fc / 10 : d.fc * 10);
  let maxDb = 0;
  let maxDbTrimmed = 0;
  for (let k = 0; k <= 60; ++k) {
    const x = dev(20 * 10 ** (k / 20));
    maxDb = Math.max(maxDb, Math.abs(x));
    maxDbTrimmed = Math.max(maxDbTrimmed, Math.abs(x - offsetDb));
  }
  return { maxDb, offsetDb, maxDbTrimmed };
}
