// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Band-pass box (spec: "Band-pass box"): sealed rear chamber (ar = Vas/Vrear), ported front chamber (af = Vas/Vfront),
// fb = front chamber + port resonance. Lossless. Output is the port; 0 dB is the direct-radiator reference.
import { type Cx, div, jw, poly, scale } from './complex';
import type { DriverDerived, DriverSpec } from './drivers';

const tau = (f: number): number => 1 / (2 * Math.PI * f);

/** D_bp(s), coefficients highest power first. With ar = 0 it equals the ported box's D(s). */
export function bandpassDenCoefs(fs: number, qts: number, ar: number, af: number, fb: number): number[] {
  const ts = tau(fs);
  const tb = tau(fb);
  return [tb * tb * ts * ts, (tb * tb * ts) / qts, ts * ts + tb * tb * (1 + ar + af), ts / qts, 1 + ar];
}

export function bandpassG(f: number, fs: number, qts: number, ar: number, af: number, fb: number): Cx {
  const s = jw(f);
  const ts = tau(fs);
  return div(poly([ts * ts, 0, 0], s), poly(bandpassDenCoefs(fs, qts, ar, af, fb), s));
}

/** Cone displacement per volt, m/V. Zero at fb. */
export function bandpassX(f: number, d: DriverSpec, r: DriverDerived, ar: number, af: number, fb: number): Cx {
  const s = jw(f);
  const tb = tau(fb);
  const num = scale(poly([tb * tb, 0, 1], s), (r.bl * r.cms) / d.re);
  return div(num, poly(bandpassDenCoefs(d.fs, r.qts, ar, af, fb), s));
}
