// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// A starting alignment for the 6th-order band-pass (app only, v0.16). The Cookbook has no design equations for it, so this is a
// deterministic search over the two chamber volumes and the two tunings for the flattest, loudest passband between two
// frequencies, with the skirts an octave outside held down. A starting point to refine on the plots, not an optimum from a book.
import { abs, dB } from './complex';
import { bandpass6G } from './bandpass6';
import { type DriverSpec, deriveDriver } from './drivers';

export interface Bp6Alignment {
  /** Rear and front chamber volumes, litres. */
  rearL: number;
  frontL: number;
  /** Rear and front port tunings, Hz. */
  rearHz: number;
  frontHz: number;
  /** Mean level over the passband relative to the direct radiator's, dB, and the spread (max - min) over it. */
  meanDb: number;
  rippleDb: number;
}

/** What the search may choose: volumes (L) and tunings (Hz). The app's box ranges. */
export const BP6_LIMITS = { volMin: 1, volMax: 1000, tuneMin: 10, tuneMax: 200 } as const;

const SAMPLES = 25;
const clampVol = (v: number): number => Math.min(BP6_LIMITS.volMax, Math.max(BP6_LIMITS.volMin, v));
const clampTune = (f: number): number => Math.min(BP6_LIMITS.tuneMax, Math.max(BP6_LIMITS.tuneMin, f));

function evaluate(driver: DriverSpec, qts: number, ql: number, p: readonly [number, number, number, number], lo: number, hi: number): { score: number; meanDb: number; rippleDb: number } {
  const [vr, vf, fr, ff] = p;
  const bad = { score: -Infinity, meanDb: Number.NaN, rippleDb: Number.NaN };
  if (vr < BP6_LIMITS.volMin || vr > BP6_LIMITS.volMax || vf < BP6_LIMITS.volMin || vf > BP6_LIMITS.volMax) return bad;
  if (fr < BP6_LIMITS.tuneMin || fr > BP6_LIMITS.tuneMax || ff < BP6_LIMITS.tuneMin || ff > BP6_LIMITS.tuneMax) return bad;
  const ar = (driver.vasM3 * 1000) / vr;
  const af = (driver.vasM3 * 1000) / vf;
  const at = (f: number): number => dB(abs(bandpass6G(f, driver.fs, qts, ar, af, fr, ff, ql, ql)));
  const db = Array.from({ length: SAMPLES }, (_, i) => at(lo * (hi / lo) ** (i / (SAMPLES - 1))));
  const meanDb = db.reduce((a, b) => a + b, 0) / SAMPLES;
  const rippleDb = Math.max(...db) - Math.min(...db);
  // an octave outside the passband the level should be 12 dB under its mean
  const under = Math.max(0, at(lo / 2) - (meanDb - 12)) + Math.max(0, at(hi * 2) - (meanDb - 12));
  // equal tunings and losses cancel the two ports exactly (no output): not a design
  if (!Number.isFinite(meanDb) || !Number.isFinite(rippleDb) || !Number.isFinite(under)) return bad;
  return { score: meanDb - 2.5 * rippleDb - 1 * under, meanDb, rippleDb };
}

/**
 * Chamber volumes and tunings for a passband from loHz to hiHz (loHz < hiHz, at least 1.2 apart), leakage QL on both chambers
 * (0 for lossless). Deterministic: seeds on a coarse grid, then a coordinate search in log space with a shrinking step.
 */
export function bandpass6Design(driver: DriverSpec, loHz: number, hiHz: number, ql = 7): Bp6Alignment {
  const qts = deriveDriver(driver).qts;
  const q = ql > 0 ? ql : undefined;
  const vas = driver.vasM3 * 1000;
  const score = (p: readonly [number, number, number, number]) => evaluate(driver, qts, q as number, p, loHz, hiHz);
  const geo = Math.sqrt(loHz * hiHz);
  let best: { p: [number, number, number, number]; s: number } | null = null;
  for (const ar of [0.3, 1, 3]) {
    for (const af of [0.3, 1, 3]) {
      for (const fr of [loHz, geo, hiHz]) {
        for (const ff of [loHz, geo, hiHz]) {
          // a driver with a tiny Vas (a tweeter) cannot reach the smallest box at these ratios: keep the seeds inside the ranges
          const p: [number, number, number, number] = [clampVol(vas / ar), clampVol(vas / af), clampTune(fr), clampTune(ff)];
          const s = score(p).score;
          if (best === null || s > best.s) best = { p, s };
        }
      }
    }
  }
  let { p, s } = best!;
  // step is a multiplicative factor on each coordinate
  let step = 0.25;
  for (let iter = 0; iter < 400 && step > 1e-4; ++iter) {
    let improved = false;
    for (let i = 0; i < 4; ++i) {
      for (const sgn of [1, -1]) {
        const c: [number, number, number, number] = [...p];
        c[i] = c[i]! * (1 + sgn * step);
        const sc = score(c).score;
        if (sc > s) {
          s = sc;
          p = c;
          improved = true;
        }
      }
    }
    if (!improved) step *= 0.6;
  }
  const r = score(p);
  return { rearL: p[0], frontL: p[1], rearHz: p[2], frontHz: p[3], meanDb: r.meanDb, rippleDb: r.rippleDb };
}
