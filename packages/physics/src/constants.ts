// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Shared physics spec conventions: SI units, 20 C.

/** Speed of sound, m/s. */
export const C = 343.0;
/** Air density, kg/m^3. */
export const RHO = 1.18;
/** Copper temperature coefficient, 1/K. */
export const ALPHA_CU = 0.00393;

export const clamp = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi);
