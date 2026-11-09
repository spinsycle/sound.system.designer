// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Excursion limiting and thermal compression (spec: "Excursion limiter (plugin) and the power model").
import { ALPHA_CU } from './constants';

/** Soft-limit gain for a displacement x against Xmax: tanh(u)/u, 1 as x -> 0, never above 1. */
export function limiterGain(x: number, xmax: number): number {
  const u = Math.abs(x) / xmax;
  return u < 1e-4 ? 1 - (u * u) / 3 : Math.tanh(u) / u;
}

/** Peak volts of the sine that puts powerW into the coil resistance re (the plugin's 0 dB drive at rated power). */
export const peakVoltsForPower = (powerW: number, re: number): number => Math.sqrt(2 * powerW * re);

/** Voltage-driven level change for a voice-coil temperature rise of dT kelvin, dB (+100 K = -2.879 dB). */
export const thermalGainDb = (deltaTK: number): number => -20 * Math.log10(1 + ALPHA_CU * deltaTK);
