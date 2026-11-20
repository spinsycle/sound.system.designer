// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// A starting alignment for the 8th-order band-pass (app only, v0.18): the same search as the 6th-order helper (flattest, loudest
// passband between two frequencies) with a stricter skirt mask: the level outside the band must fall 12 dB per octave from the band's mean at five distances
// from each edge, so no peak can sit just off the band over three chamber volumes and three tunings.
// There are no design equations in the Cookbook for it: a starting point to refine on the plots.
import { abs, dB } from './complex';
import { bandpass6Design, BP6_LIMITS } from './bandpass6design';
import { type Bp8Layout, bandpass8G } from './bandpass8';
import { type DriverSpec, deriveDriver } from './drivers';

export interface Bp8Alignment {
  /** Rear chamber, inner front chamber (next to the driver) and outer front chamber (to the room), litres. */
  rearL: number;
  innerL: number;
  outerL: number;
  /** Their tunings: rear port, port 1 (inner into outer chamber) and port 2 (outer chamber to the room), Hz. */
  rearHz: number;
  innerHz: number;
  outerHz: number;
  /** Mean level over the passband relative to the direct radiator's, dB, and the spread (max - min) over it. */
  meanDb: number;
  rippleDb: number;
}

const SAMPLES = 25;
/** Distances from a passband edge (as a ratio of the frequency) where the skirt is checked, and how fast it must fall: 12 dB per octave under the passband mean. */
const MASK_RATIOS = [1.3, 1.6, 2, 3, 4] as const;
const clampVol = (v: number): number => Math.min(BP6_LIMITS.volMax, Math.max(BP6_LIMITS.volMin, v));
const clampTune = (f: number): number => Math.min(BP6_LIMITS.tuneMax, Math.max(BP6_LIMITS.tuneMin, f));
type Six = [number, number, number, number, number, number];

function evaluate(driver: DriverSpec, qts: number, ql: number | undefined, p: Readonly<Six>, lo: number, hi: number, layout: Bp8Layout): { score: number; meanDb: number; rippleDb: number } {
  const [vr, v1, v2, fr, f1, f2] = p;
  const bad = { score: -Infinity, meanDb: Number.NaN, rippleDb: Number.NaN };
  for (const v of [vr, v1, v2]) if (v < BP6_LIMITS.volMin || v > BP6_LIMITS.volMax) return bad;
  for (const f of [fr, f1, f2]) if (f < BP6_LIMITS.tuneMin || f > BP6_LIMITS.tuneMax) return bad;
  const vas = driver.vasM3 * 1000;
  const at = (f: number): number => dB(abs(bandpass8G(f, driver.fs, qts, vas / vr, vas / v1, vas / v2, fr, f1, f2, ql, ql, ql, layout)));
  const db = Array.from({ length: SAMPLES }, (_, i) => at(lo * (hi / lo) ** (i / (SAMPLES - 1))));
  const meanDb = db.reduce((a, b) => a + b, 0) / SAMPLES;
  const rippleDb = Math.max(...db) - Math.min(...db);
  // nowhere outside the passband may the level stand above the mask: a peak a little way off the band would otherwise pass an octave-only check
  const under = MASK_RATIOS.reduce((acc, ratio) => {
    const allowed = meanDb - 12 * Math.log2(ratio);
    return acc + Math.max(0, at(lo / ratio) - allowed) + Math.max(0, at(hi * ratio) - allowed);
  }, 0);
  if (!Number.isFinite(meanDb) || !Number.isFinite(rippleDb) || !Number.isFinite(under)) return bad;
  return { score: meanDb - 2.5 * rippleDb - 1 * under, meanDb, rippleDb };
}

/**
 * Chamber volumes and tunings for a passband from loHz to hiHz (loHz < hiHz, at least 1.2 apart), leakage QL on all three chambers (0
 * for lossless), for a rear-chamber layout ('vented' by default; a 'sealed' rear ignores the rear tuning). Deterministic: seeded from the
 * 6th-order alignment with an inner chamber added and the rear chamber scaled, on a coarse grid, then a coordinate search in log space with a
 * shrinking step.
 */
export function bandpass8Design(driver: DriverSpec, loHz: number, hiHz: number, ql = 7, layout: Bp8Layout = 'vented'): Bp8Alignment {
  const qts = deriveDriver(driver).qts;
  const q = ql > 0 ? ql : undefined;
  const vas = driver.vasM3 * 1000;
  const geo = Math.sqrt(loHz * hiHz);
  const score = (p: Readonly<Six>) => evaluate(driver, qts, q, p, loHz, hiHz, layout);
  const six = bandpass6Design(driver, loHz, hiHz, ql);
  const seeds: { p: Six; s: number }[] = [];
  for (const a1 of [0.3, 1, 3]) {
    for (const f1 of [loHz, geo, hiHz]) {
      for (const rearScale of [0.4, 1, 2.5]) {
        for (const fr of [six.rearHz, geo]) {
          const p: Six = [clampVol(six.rearL * rearScale), clampVol(vas / a1), clampVol(six.frontL), clampTune(fr), clampTune(f1), clampTune(six.frontHz)];
          seeds.push({ p, s: score(p).score });
        }
      }
    }
  }
  // the best seed is not always the best start: search from the best few and keep the best result
  seeds.sort((x, y) => y.s - x.s);
  let p = seeds[0]!.p;
  let s = -Infinity;
  for (const seed of seeds.slice(0, 3)) {
    let cur = seed.p;
    let curScore = seed.s;
    let step = 0.25;
    for (let iter = 0; iter < 400 && step > 1e-4; ++iter) {
      let improved = false;
      for (let i = 0; i < 6; ++i) {
        for (const sgn of [1, -1]) {
          const c = [...cur] as Six;
          c[i] = c[i]! * (1 + sgn * step);
          const sc = score(c).score;
          if (sc > curScore) {
            curScore = sc;
            cur = c;
            improved = true;
          }
        }
      }
      if (!improved) step *= 0.6;
    }
    if (curScore > s) {
      s = curScore;
      p = cur;
    }
  }
  const r = score(p);
  return { rearL: p[0], innerL: p[1], outerL: p[2], rearHz: p[3], innerHz: p[4], outerHz: p[5], meanDb: r.meanDb, rippleDb: r.rippleDb };
}
