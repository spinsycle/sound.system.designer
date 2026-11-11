// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Sealed box (spec: "Sealed box", Small 1972).
import { C, RHO } from './constants';
import { type Cx, cx, div, jw, poly } from './complex';
import type { DriverDerived, DriverSpec } from './drivers';

/** alpha, fc and Qtc from Fs, Qts, Vas and Vb (the two volumes in the same unit). */
export function sealedParams(fs: number, qts: number, vas: number, vb: number): { alpha: number; fc: number; qtc: number } {
  const alpha = vas / vb;
  return { alpha, fc: fs * Math.sqrt(1 + alpha), qtc: qts * Math.sqrt(1 + alpha) };
}

/** Second-order high-pass with corner fc and total Q qtc. */
export function sealedHP(f: number, fc: number, qtc: number): Cx {
  const wc = 2 * Math.PI * fc;
  const s = jw(f);
  return div(poly([1, 0, 0], s), poly([1, wc / qtc, wc * wc], s));
}

export function sealedG(f: number, fs: number, qts: number, vasM3: number, vbM3: number): Cx {
  const p = sealedParams(fs, qts, vasM3, vbM3);
  return sealedHP(f, p.fc, p.qtc);
}

/** -3 dB frequency of the sealed response. */
export function sealedF3(fc: number, qtc: number): number {
  const k = 1 / (qtc * qtc) - 2;
  return fc * Math.sqrt((k + Math.sqrt(k * k + 4)) / 2);
}

/** Mechanical compliance of an air volume behind a cone of area sd, m/N. */
export const boxCompliance = (vbM3: number, sd: number): number => vbM3 / (RHO * C * C * sd * sd);

/** Cone displacement per volt, m/V. */
export function sealedX(f: number, d: DriverSpec, r: DriverDerived, vbM3: number): Cx {
  const cmb = boxCompliance(vbM3, d.sd);
  const cmt = (r.cms * cmb) / (r.cms + cmb);
  return div(cx(r.bl / d.re), poly([r.mms, r.rms + (r.bl * r.bl) / d.re, 1 / cmt], jw(f)));
}
