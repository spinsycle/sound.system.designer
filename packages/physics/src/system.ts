// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The whole system (spec: "Crossover network and band mixer"): up to four bands, each a speaker in a box behind its
// crossover leg, with mute, solo, trim and delay, summed as complex numbers so the bands interfere as in a room.
import { type BoxParams, boxResponse } from './box';
import { type Cx, add, cx, mul, scale } from './complex';
import { clamp } from './constants';
import { crossoverBands, effectiveCrossovers } from './crossover';

export const MAX_BANDS = 4;
/** The plugin's longest band delay, samples (its delay buffer minus one). */
const MAX_DELAY_SAMPLES = 4095;

export interface BandSettings {
  box: BoxParams;
  solo: boolean;
  mute: boolean;
  trimDb: number;
  delayMs: number;
}

export interface SystemParams {
  /** Active bands, 1 to 4; band[0] is the lowest. */
  bands: number;
  /** Requested crossover points, Hz; the first bands - 1 are used. */
  xover: readonly number[];
  /** Manual delay on; off means no delay on any band. */
  align: boolean;
  band: readonly BandSettings[];
}

/** A band is audible when it is active and not muted, and either no active band is soloed or it is. */
export function bandAudible(p: SystemParams, b: number): boolean {
  if (b >= p.bands || p.band[b]!.mute) return false;
  const anySolo = p.band.slice(0, p.bands).some((s) => s.solo);
  return !anySolo || p.band[b]!.solo;
}

/**
 * Small-signal response of the whole system at f. Omit `sampleRate` for the ideal network; pass it to match the
 * plugin (warped crossover axis, the 0.45 fs crossover cap, delays rounded to whole samples).
 */
export function systemResponse(p: SystemParams, f: number, sampleRate?: number): Cx {
  const n = clamp(p.bands, 1, MAX_BANDS);
  const legs = crossoverBands(f, effectiveCrossovers(p.xover, n, sampleRate), sampleRate);
  let sum = cx(0);
  for (let b = 0; b < n; ++b) {
    if (!bandAudible(p, b)) continue;
    const s = p.band[b]!;
    let delayS = 0;
    if (p.align)
      delayS = sampleRate
        ? clamp(Math.round(s.delayMs * 1e-3 * sampleRate), 0, MAX_DELAY_SAMPLES) / sampleRate
        : Math.max(s.delayMs, 0) * 1e-3;
    const phase = -2 * Math.PI * f * delayS;
    const leg = mul(legs[b]!, cx(Math.cos(phase), Math.sin(phase)));
    sum = add(sum, scale(mul(leg, boxResponse(s.box, f)), 10 ** (s.trimDb / 20)));
  }
  return sum;
}
