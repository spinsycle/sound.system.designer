// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Linkwitz-Riley 4th-order crossover network (spec: "Crossover network and band mixer").
// `sampleRate` is optional everywhere: omit it for the ideal analog network (what a design tool wants and what the
// shared vectors use); pass it to follow the plugin's digital network on the bilinear-warped axis.
import { type Cx, add, cx, div, mul, poly } from './complex';

const normFreq = (f: number, fc: number, sampleRate?: number): number =>
  sampleRate ? Math.tan((Math.PI * f) / sampleRate) / Math.tan((Math.PI * fc) / sampleRate) : f / fc;

const bw2Den = (s: Cx): Cx => poly([1, Math.SQRT2, 1], s);

export function lr4Lp(f: number, fc: number, sampleRate?: number): Cx {
  const h = div(cx(1), bw2Den(cx(0, normFreq(f, fc, sampleRate))));
  return mul(h, h);
}

export function lr4Hp(f: number, fc: number, sampleRate?: number): Cx {
  const s = cx(0, normFreq(f, fc, sampleRate));
  const h = div(mul(s, s), bw2Den(s));
  return mul(h, h);
}

/**
 * Band responses (lowest band first) of the cascaded network with crossover points xs (ascending; bands = xs.length + 1).
 * Every band below a later split also passes through that split's all-pass, so the bands sum to an all-pass.
 */
export function crossoverBands(f: number, xs: readonly number[], sampleRate?: number): Cx[] {
  const n = xs.length + 1;
  const out: Cx[] = [];
  let rest = cx(1);
  for (let s = 0; s < n - 1; ++s) {
    out.push(mul(rest, lr4Lp(f, xs[s]!, sampleRate)));
    rest = mul(rest, lr4Hp(f, xs[s]!, sampleRate));
  }
  out.push(rest);
  for (let k = 0; k < n - 2; ++k)
    for (let s = k + 1; s < n - 1; ++s)
      out[k] = mul(out[k]!, add(lr4Lp(f, xs[s]!, sampleRate), lr4Hp(f, xs[s]!, sampleRate)));
  return out;
}

/**
 * The crossover points actually used for `bands` bands: the first bands - 1 requested points, forced ascending, each
 * at least 1.2x the previous, none below 20 Hz, and (with a sample rate) none above 0.45 of it.
 */
export function effectiveCrossovers(requested: readonly number[], bands: number, sampleRate?: number): number[] {
  const out: number[] = [];
  let prev = 0;
  for (let i = 0; i < Math.min(Math.max(bands - 1, 0), requested.length); ++i) {
    const lo = prev > 0 ? prev * 1.2 : 20;
    prev = Math.min(Math.max(requested[i]!, lo), sampleRate ? 0.45 * sampleRate : Infinity);
    out.push(prev);
  }
  return out;
}
