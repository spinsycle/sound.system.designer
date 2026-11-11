// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Minimal complex arithmetic for evaluating transfer functions at s = j 2 pi f.

export interface Cx {
  re: number;
  im: number;
}

export const cx = (re: number, im = 0): Cx => ({ re, im });
export const add = (a: Cx, b: Cx): Cx => ({ re: a.re + b.re, im: a.im + b.im });
export const mul = (a: Cx, b: Cx): Cx => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
export const scale = (a: Cx, k: number): Cx => ({ re: a.re * k, im: a.im * k });
export const abs = (a: Cx): number => Math.hypot(a.re, a.im);

export function div(a: Cx, b: Cx): Cx {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

/** Polynomial with real coefficients, highest power first, evaluated at s (Horner). */
export function poly(coefs: readonly number[], s: Cx): Cx {
  let acc = cx(0);
  for (const c of coefs) acc = add(mul(acc, s), cx(c));
  return acc;
}

/** s = j 2 pi f. */
export const jw = (f: number): Cx => cx(0, 2 * Math.PI * f);

/**
 * Group delay of a response h at f, seconds: -d(phase)/d(omega), by a central difference. The phase step is taken
 * as arg(h(f+) conj(h(f-))), so it never sees a wrap.
 */
export function groupDelayS(h: (f: number) => Cx, f: number): number {
  const df = f * 1e-4;
  const a = h(f - df);
  const b = h(f + df);
  const dPhase = Math.atan2(b.im * a.re - b.re * a.im, b.re * a.re + b.im * a.im);
  return -dPhase / (2 * Math.PI * 2 * df);
}

export const dB =(mag: number): number => 20 * Math.log10(mag);
