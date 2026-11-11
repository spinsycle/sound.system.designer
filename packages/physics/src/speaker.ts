// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Loudspeaker cabinets (spec: "Loudspeaker cabinets", v0.11, app only): baffle step, open-baffle tweeters, woofer groups.
import type { Cx } from './complex';
import { firstOrderShelf } from './room';
import { sealedHP } from './sealed';

/** Hz m: the step's -3 dB point is K / baffle width (Olson, Linkwitz). */
export const BAFFLE_STEP_K = 115.0;
/** 4 pi below the step, 2 pi above it: -6 dB. */
export const BAFFLE_STEP_GAIN = 0.5;

/** -3 dB frequency of the baffle step, Hz, for a baffle widthM wide. */
export const baffleStepCornerHz = (widthM: number): number => BAFFLE_STEP_K / Math.max(widthM, 0.01);

/** Free-standing box: half-space pressure above the baffle's size, full space (-6 dB) below it. Every box response in this library is half space. */
export const baffleStepShelf = (f: number, widthM: number, sampleRate?: number): Cx =>
  firstOrderShelf(f, BAFFLE_STEP_GAIN, baffleStepCornerHz(widthM), sampleRate);

/** A driver with no box behind it (planar, ribbon): second-order high-pass at its own Fs, with Q = Qts. */
export const openBaffleG = (f: number, fs: number, qts: number): Cx => sealedHP(f, fs, qts);

/** n identical drivers in one cabinet of net air volume totalM3 see totalM3 / n each, whether they share the chamber or have n equal ones. */
export const groupVolumeM3 = (totalM3: number, n: number): number => totalM3 / Math.max(n, 1);
