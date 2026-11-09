// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Ported box (spec: "Ported box", Small 1973), lossless. alpha = Vas/Vb, fb = port tuning.
import { C } from './constants';
import { type Cx, abs, dB, div, jw, poly, scale } from './complex';
import type { DriverDerived, DriverSpec } from './drivers';

const tau = (f: number): number => 1 / (2 * Math.PI * f);

/** D(s), coefficients highest power first. */
export function ventedDenCoefs(fs: number, qts: number, alpha: number, fb: number): number[] {
  const ts = tau(fs);
  const tb = tau(fb);
  return [tb * tb * ts * ts, (tb * tb * ts) / qts, (alpha + 1) * tb * tb + ts * ts, ts / qts, 1];
}

export function ventedG(f: number, fs: number, qts: number, alpha: number, fb: number): Cx {
  const s = jw(f);
  const ts = tau(fs);
  const tb = tau(fb);
  return div(poly([tb * tb * ts * ts, 0, 0, 0, 0], s), poly(ventedDenCoefs(fs, qts, alpha, fb), s));
}

/** Cone displacement per volt, m/V. Zero at fb. */
export function ventedX(f: number, d: DriverSpec, r: DriverDerived, alpha: number, fb: number): Cx {
  const s = jw(f);
  const ts = tau(d.fs);
  const tb = tau(fb);
  const num = scale(poly([tb * tb, 0, 1], s), (r.bl / (d.re * r.mms)) * ts * ts);
  return div(num, poly(ventedDenCoefs(d.fs, r.qts, alpha, fb), s));
}

/** Lower -3 dB frequency of the ported response: scan up from 0.05 Fs, then bisect. Returns -1 if none below 4 Fs. */
export function ventedF3(fs: number, qts: number, alpha: number, fb: number): number {
  const above = (f: number): boolean => dB(abs(ventedG(f, fs, qts, alpha, fb))) >= -3;
  let prev = 0.05 * fs;
  for (let f = prev; f < 4 * fs; f *= 1.0005) {
    if (above(f)) {
      let lo = prev;
      let hi = f;
      for (let i = 0; i < 80; ++i) {
        const mid = 0.5 * (lo + hi);
        if (above(mid)) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    prev = f;
  }
  return -1;
}

/** Port length for a round port of diameter d (one flanged end correction), m. Can be negative: the port does not fit. */
export function portLengthM(vbM3: number, fb: number, dPortM: number): number {
  const sp = Math.PI * (dPortM / 2) * (dPortM / 2);
  return (C * C * sp) / (4 * Math.PI * Math.PI * fb * fb * vbM3) - 0.732 * dPortM;
}
