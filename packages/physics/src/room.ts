// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Room and distance (spec: "Room and distance"): distance law, ISO 9613-1 air absorption, boundary gain and shelf,
// critical distance. `sampleRate` is optional: omit it for the ideal curves, pass it to match the plugin's filters.
import { C, clamp } from './constants';
import { type Cx, cx, div, scale } from './complex';

export const REF_DISTANCE_M = 1.0;
export const MAX_DISTANCE_M = 200.0;
const AIR_STAGES = 12;
const AIR_MATCH_HZ = 9000.0;
const MAX_TAIL_GAIN = 16.0;

/** ISO 9613-1 pure-tone attenuation, dB/m. */
export function airAbsorptionDbPerM(f: number, tempC = 20.0, rh = 50.0, pKpa = 101.325): number {
  const t = tempC + 273.15;
  const t0 = 293.15;
  const t01 = 273.16;
  const pr = 101.325;
  const psat = pr * 10 ** (-6.8346 * (t01 / t) ** 1.261 + 4.6151);
  const h = rh * (psat / pKpa);
  const frO = (pKpa / pr) * (24.0 + (4.04e4 * h * (0.02 + h)) / (0.391 + h));
  const frN = (pKpa / pr) * (t / t0) ** -0.5 * (9.0 + 280.0 * h * Math.exp(-4.17 * ((t / t0) ** (-1 / 3) - 1.0)));
  return (
    8.686 *
    f *
    f *
    ((1.84e-11 / (pKpa / pr)) * Math.sqrt(t / t0) +
      (t / t0) ** -2.5 *
        ((0.01275 * Math.exp(-2239.1 / t)) / (frO + (f * f) / frO) + (0.1068 * Math.exp(-3352.0 / t)) / (frN + (f * f) / frN)))
  );
}

/** Inverse-distance law relative to 1 m, dB. */
export const distanceGainDb = (r: number): number => -20 * Math.log10(Math.max(r, 1e-9) / REF_DISTANCE_M);
/** Time of flight over r metres, s. The plugin's optional delay is this minus the 1 m reference: (r - 1) / c. */
/** Delay relative to the reference distance (the plugin and the shared spec use 1 m). */
export const timeOfFlightS = (r: number, rRef = 1): number => (r - rRef) / C;
/** Low-frequency pressure gain for n boundaries (1 wall, 2 edge, 3 corner), dB. */
export const boundaryGainDb = (n: number): number => 20 * Math.log10(2 ** n);
/** Distance at which the diffuse field equals the direct sound (omnidirectional source), m. */
export const criticalDistanceM = (volumeM3: number, t60: number): number => 0.057 * Math.sqrt(volumeM3 / t60);
/** Corner of the boundary shelf (half its dB gain) for a source distM from the boundary, Hz. */
export const boundaryCornerHz = (distM: number): number => C / (4 * Math.max(distM, 0.01));

/** The shelf (s + G w0)/(s + w0): gain 2^n at DC, 1 at high frequency, sqrt(2^n) at the corner. */
export function boundaryShelf(f: number, n: number, distM: number, sampleRate?: number): Cx {
  if (n <= 0) return cx(1);
  return firstOrderShelf(f, 2 ** n, boundaryCornerHz(distM), sampleRate);
}

/** The shelf (s + g w0)/(s + w0), w0 = wc/sqrt(g): gain g at DC, 1 at high frequency, sqrt(g) at fc. g below 1 is a loss. */
export function firstOrderShelf(f: number, g: number, fc: number, sampleRate?: number): Cx {
  const warp = (x: number): number => (sampleRate ? 2 * sampleRate * Math.tan((Math.PI * x) / sampleRate) : 2 * Math.PI * x);
  const w0 = warp(fc) / Math.sqrt(g);
  const w = warp(f);
  return div(cx(g * w0, w), cx(w0, w));
}

/** Loss (positive dB) at f of the plugin's 12 one-pole air filter for a path of r metres. */
export function airFilterLossDb(f: number, r: number, sampleRate: number): number {
  const ref = Math.min(AIR_MATCH_HZ, 0.4 * sampleRate);
  const totalDb = airAbsorptionDbPerM(ref) * Math.max(r - REF_DISTANCE_M, 0);
  if (totalDb < 1e-9) return 0;
  const t = 10 ** (-totalDb / (10 * AIR_STAGES));
  const c = Math.cos((2 * Math.PI * ref) / sampleRate);
  const qa = t - 1;
  const qb = 2 - 2 * t * c;
  const a = clamp(1 - (-qb + Math.sqrt(Math.max(qb * qb - 4 * qa * qa, 0))) / (2 * qa), 1e-6, 1);
  if (a >= 1) return 0;
  const b = 1 - a;
  return -AIR_STAGES * 10 * Math.log10((a * a) / (1 - 2 * b * Math.cos((2 * Math.PI * f) / sampleRate) + b * b));
}

export interface RoomParams {
  distanceM: number;
  /** Held: the direct sound keeps its 1 m level whatever the distance. */
  held: boolean;
  /** 0 free field, 1 wall, 2 edge, 3 corner. */
  boundary: number;
  boundaryDistM: number;
  indoor: boolean;
  rt60: number;
  volumeM3: number;
}

const clampDistance = (r: number): number => clamp(r, REF_DISTANCE_M, MAX_DISTANCE_M);

export const directGain = (p: RoomParams): number => (p.held ? 1 : REF_DISTANCE_M / clampDistance(p.distanceM));

/** Level of the diffuse tail relative to the 1 m direct sound; 0 outdoors. */
export function tailGain(p: RoomParams): number {
  if (!p.indoor) return 0;
  const rc = criticalDistanceM(Math.max(p.volumeM3, 1), Math.max(p.rt60, 0.05));
  return Math.min((p.held ? clampDistance(p.distanceM) : 1) / rc, MAX_TAIL_GAIN);
}

/** Direct path: boundary shelf x air absorption x distance law. Without a sample rate the air loss is exact ISO. */
export function roomDirectResponse(p: RoomParams, f: number, sampleRate?: number): Cx {
  const r = clampDistance(p.distanceM);
  const lossDb = sampleRate ? airFilterLossDb(f, r, sampleRate) : airAbsorptionDbPerM(f) * (r - REF_DISTANCE_M);
  return scale(boundaryShelf(f, p.boundary, p.boundaryDistM, sampleRate), 10 ** (-lossDb / 20) * directGain(p));
}
