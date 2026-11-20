// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// 6th-order band-pass box (spec: "6th-order band-pass", app only, v0.16): the driver between a vented rear chamber and a vented
// front chamber, both ports radiating into the room. Rear chamber ar = Vas/Vrear tuned to fr, front chamber af = Vas/Vfront tuned
// to ff, each with its own leakage loss (QL). Output is the sum of the two ports' volume velocities (the front port in phase with
// the cone, the rear one opposite); 0 dB is the direct-radiator reference, as for every box here. With the rear port closed
// (fr -> 0) it is the 4th-order band-pass of bandpass.ts, which the vectors check.
import { type Cx, add, div, jw, mul, poly, scale } from './complex';
import type { DriverDerived, DriverSpec } from './drivers';

const omega = (f: number): number => 2 * Math.PI * f;

/** D(s) = s^2 + s w / QL + w^2 for one vented chamber (lossless when ql is undefined). */
function chamberDen(s: Cx, f: number, ql?: number): Cx {
  const w = omega(f);
  return poly([1, ql === undefined ? 0 : w / ql, w * w], s);
}

/** The whole system's denominator Df Dr (s^2 + s ws / Qts + ws^2) + ws^2 s^2 (af Dr + ar Df). */
function systemDen(s: Cx, fs: number, qts: number, ar: number, af: number, df: Cx, dr: Cx): Cx {
  const ws = omega(fs);
  const drive = poly([1, ws / qts, ws * ws], s);
  const coupling = scale(mul(mul(s, s), add(scale(dr, af), scale(df, ar))), ws * ws);
  return add(mul(mul(df, dr), drive), coupling);
}

/** Response: both ports over the direct radiator's passband, s^2 (wf^2 Dr - wr^2 Df) / D. qlr and qlf are the rear and front chamber losses. */
export function bandpass6G(f: number, fs: number, qts: number, ar: number, af: number, fr: number, ff: number, qlr?: number, qlf?: number): Cx {
  const s = jw(f);
  const df = chamberDen(s, ff, qlf);
  const dr = chamberDen(s, fr, qlr);
  const wf = omega(ff);
  const wr = omega(fr);
  const num = mul(mul(s, s), add(scale(dr, wf * wf), scale(df, -(wr * wr))));
  return div(num, systemDen(s, fs, qts, ar, af, df, dr));
}

/** Cone displacement per volt, m/V: zero at both tunings when lossless, and the free-air Bl Cms / Re at DC (both ports are open there). */
export function bandpass6X(f: number, d: DriverSpec, r: DriverDerived, ar: number, af: number, fr: number, ff: number, qlr?: number, qlf?: number): Cx {
  const s = jw(f);
  const df = chamberDen(s, ff, qlf);
  const dr = chamberDen(s, fr, qlr);
  const ws = omega(d.fs);
  return scale(div(mul(df, dr), systemDen(s, d.fs, r.qts, ar, af, df, dr)), (r.bl * r.cms * ws * ws) / d.re);
}
