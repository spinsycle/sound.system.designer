// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Crossover filter alignments (spec "Crossover filters (app only, v0.20)"): Butterworth, Linkwitz-Riley, Bessel and
// Chebyshev low-pass / high-pass pairs of order 1 to 8 as analog transfer functions, the polarity that sums them flat,
// N-way banks, all-pass sections and pure delay. Frequency domain only; the ideal analog curve, no sample rate.
import { type Cx, abs, add, cx, div, mul } from './complex';
import { C } from './constants';

export const ALIGNMENTS = ['butterworth', 'linkwitz-riley', 'bessel', 'chebyshev'] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

export const MAX_ORDER = 8;
export const RIPPLE_MIN_DB = 0.01;
export const RIPPLE_MAX_DB = 3;
export const DEFAULT_RIPPLE_DB = 0.5;

export interface FilterSpec {
  alignment: Alignment;
  order: number;
  /** Chebyshev passband ripple, dB; ignored by the other alignments. */
  rippleDb?: number;
}

/** Orders 1 to 8; Linkwitz-Riley only the even ones (two Butterworth sections of half the order). */
export function isValidOrder(alignment: Alignment, order: number): boolean {
  return Number.isInteger(order) && order >= 1 && order <= MAX_ORDER && (alignment !== 'linkwitz-riley' || order % 2 === 0);
}

/** All roots of a polynomial given by ascending coefficients: Durand-Kerner from fixed start points. */
function polyRoots(ascending: readonly number[]): Cx[] {
  const n = ascending.length - 1;
  const lead = ascending[n]!;
  const a = ascending.map((c) => c / lead);
  const pv = (z: Cx): Cx => {
    let acc = cx(0);
    for (let k = n; k >= 0; --k) acc = add(mul(acc, z), cx(a[k]!));
    return acc;
  };
  const roots: Cx[] = [];
  let z = cx(1);
  for (let k = 0; k < n; ++k) {
    roots.push(z);
    z = mul(z, cx(0.4, 0.9));
  }
  for (let it = 0; it < 2000; ++it) {
    let step = 0;
    for (let i = 0; i < n; ++i) {
      let d = cx(1);
      for (let j = 0; j < n; ++j) if (j !== i) d = mul(d, cx(roots[i]!.re - roots[j]!.re, roots[i]!.im - roots[j]!.im));
      const dz = div(pv(roots[i]!), d);
      roots[i] = cx(roots[i]!.re - dz.re, roots[i]!.im - dz.im);
      step = Math.max(step, abs(dz));
    }
    if (step < 1e-16) break;
  }
  return roots;
}

const factorial = (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1));

/** Poles of the delay-normalised Bessel low-pass: roots of the reverse Bessel polynomial (group delay 1 s at DC). */
export function besselPolesDelay(n: number): Cx[] {
  const coefs: number[] = [];
  for (let k = 0; k <= n; ++k) coefs.push(factorial(2 * n - k) / (2 ** (n - k) * factorial(k) * factorial(n - k)));
  return polyRoots(coefs);
}

function lpMagAt(poles: readonly Cx[], w: number): number {
  let m = 1;
  for (const p of poles) m *= abs(p) / abs(cx(-p.re, w - p.im));
  return m;
}

/** Frequency (rad/s, delay-normalised) where the Bessel low-pass is 1/sqrt(2) down, by bisection. */
export function besselW3(n: number): number {
  const poles = besselPolesDelay(n);
  let lo = 0.01;
  let hi = 50;
  for (let i = 0; i < 200; ++i) {
    const mid = 0.5 * (lo + hi);
    if (lpMagAt(poles, mid) > Math.SQRT1_2) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

interface Prototype {
  /** Low-pass poles with the -3 dB point at 1 rad/s (Linkwitz-Riley: the half-order Butterworth poles twice). */
  poles: Cx[];
  /** Peak passband gain: 1, or 1/sqrt(1 + eps^2) for an even-order Chebyshev. */
  peak: number;
}

function butterworthPoles(n: number): Cx[] {
  const out: Cx[] = [];
  for (let k = 0; k < n; ++k) {
    const a = (Math.PI * (2 * k + n + 1)) / (2 * n);
    out.push(cx(Math.cos(a), Math.sin(a)));
  }
  return out;
}

function prototype(spec: FilterSpec): Prototype {
  const { alignment, order: n } = spec;
  if (!isValidOrder(alignment, n)) throw new RangeError(`order ${n} is not valid for ${alignment}`);
  if (alignment === 'butterworth') return { poles: butterworthPoles(n), peak: 1 };
  if (alignment === 'linkwitz-riley') {
    const half = butterworthPoles(n / 2);
    return { poles: [...half, ...half], peak: 1 };
  }
  if (alignment === 'bessel') {
    const w3 = besselW3(n);
    return { poles: besselPolesDelay(n).map((p) => cx(p.re / w3, p.im / w3)), peak: 1 };
  }
  const ripple = spec.rippleDb ?? DEFAULT_RIPPLE_DB;
  if (!(ripple >= RIPPLE_MIN_DB && ripple <= RIPPLE_MAX_DB)) throw new RangeError(`ripple ${ripple} dB is outside ${RIPPLE_MIN_DB} to ${RIPPLE_MAX_DB}`);
  const eps = Math.sqrt(10 ** (ripple / 10) - 1);
  const a = Math.asinh(1 / eps) / n;
  const w3 = Math.cosh(Math.acosh(1 / eps) / n);
  const poles: Cx[] = [];
  for (let k = 1; k <= n; ++k) {
    const th = ((2 * k - 1) * Math.PI) / (2 * n);
    poles.push(cx((-Math.sinh(a) * Math.sin(th)) / w3, (Math.cosh(a) * Math.cos(th)) / w3));
  }
  return { poles, peak: n % 2 === 0 ? 1 / Math.sqrt(1 + eps * eps) : 1 };
}

export interface XoFilter {
  spec: FilterSpec;
  /** Low-pass poles for fc = 1 rad/s. */
  poles: readonly Cx[];
  /** Peak passband gain: 1, or 1/sqrt(1 + eps^2) for an even-order Chebyshev. */
  peak: number;
  /** Low-pass response at f for crossover frequency fc. */
  lp(f: number, fc: number): Cx;
  /** High-pass response at f for crossover frequency fc, before the polarity. */
  hp(f: number, fc: number): Cx;
  /** +1, or -1 when the high-pass is inverted for a flat sum (decided at fc: invert when |LP - HP| beats |LP + HP| by more than 1e-9). */
  polarity: 1 | -1;
  /** True when LP + polarity * HP is an all-pass: every Linkwitz-Riley, and Butterworth of odd order. */
  allPassSum: boolean;
}

export function xoFilter(spec: FilterSpec): XoFilter {
  const { poles, peak } = prototype(spec);
  let numLp = cx(peak);
  for (const p of poles) numLp = mul(numLp, cx(-p.re, -p.im));
  const invPoles = poles.map((p) => div(cx(1), p));
  const lp = (f: number, fc: number): Cx => {
    const s = cx(0, f / fc);
    let den = cx(1);
    for (const p of poles) den = mul(den, cx(s.re - p.re, s.im - p.im));
    return div(numLp, den);
  };
  const hp = (f: number, fc: number): Cx => {
    const s = cx(0, f / fc);
    let num = cx(peak);
    let den = cx(1);
    for (const p of invPoles) {
      num = mul(num, s);
      den = mul(den, cx(s.re - p.re, s.im - p.im));
    }
    return div(num, den);
  };
  const a = lp(1, 1);
  const b = hp(1, 1);
  const polarity = abs(cx(a.re - b.re, a.im - b.im)) > abs(add(a, b)) + 1e-9 ? -1 : 1;
  const allPassSum = spec.alignment === 'linkwitz-riley' || (spec.alignment === 'butterworth' && spec.order % 2 === 1);
  return { spec, poles, peak, lp, hp, polarity, allPassSum };
}

/**
 * Band responses, lowest band first, of an N-way bank with crossover points xs (ascending, bands = xs.length + 1): band k is
 * the product of the high-passes below it and its own low-pass (the high-pass carries the polarity). When LP + HP is an
 * all-pass, each lower band also passes through every higher split's LP + HP so the bands sum to an all-pass; otherwise there is
 * no compensation and the sum is whatever the alignment gives.
 */
export function xoBands(f: number, xs: readonly number[], filter: XoFilter): Cx[] {
  const lp = xs.map((x) => filter.lp(f, x));
  const hp = xs.map((x) => {
    const h = filter.hp(f, x);
    return filter.polarity < 0 ? cx(-h.re, -h.im) : h;
  });
  const out: Cx[] = [];
  let rest = cx(1);
  for (let s = 0; s < xs.length; ++s) {
    out.push(mul(rest, lp[s]!));
    rest = mul(rest, hp[s]!);
  }
  out.push(rest);
  if (filter.allPassSum)
    for (let k = 0; k < xs.length - 1; ++k) for (let s = k + 1; s < xs.length; ++s) out[k] = mul(out[k]!, add(lp[s]!, hp[s]!));
  return out;
}

/** First-order all-pass (1 - s/w0)/(1 + s/w0) at f. */
export function allPass1(f: number, f0: number): Cx {
  const s = cx(0, f / f0);
  return div(cx(1 - s.re, -s.im), cx(1 + s.re, s.im));
}

/** Second-order all-pass (s^2 - s/Q + 1)/(s^2 + s/Q + 1) with s = j f / f0. */
export function allPass2(f: number, f0: number, q: number): Cx {
  const w = f / f0;
  return div(cx(1 - w * w, -w / q), cx(1 - w * w, w / q));
}

/** A pure delay of tauS seconds at f. */
export function delayResponse(f: number, tauS: number): Cx {
  const a = -2 * Math.PI * f * tauS;
  return cx(Math.cos(a), Math.sin(a));
}

/** Delay that lines up a driver whose acoustic centre sits offsetM metres behind the reference one. */
export const delayForOffsetS = (offsetM: number): number => offsetM / C;
