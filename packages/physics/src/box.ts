// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// One speaker in its box: the small-signal response and cone displacement for any box type, with the same input
// clamps the plugin applies (its analyticG), so a design here and a patch there agree.
import type { Cx } from './complex';
import { bandpassG, bandpassX } from './bandpass';
import { type DriverSpec, deriveDriver } from './drivers';
import { hornG, hornModel, hornX } from './horn';
import { ventedG, ventedX } from './ported';
import { sealedG, sealedX } from './sealed';

export type BoxType = 'sealed' | 'ported' | 'bandpass' | 'horn';

export interface BoxParams {
  driver: DriverSpec;
  type: BoxType;
  /** Box volume, litres; the sealed rear chamber for band-pass and horn. */
  volumeL: number;
  /** Port tuning (ported) or front chamber + port resonance (band-pass), Hz. */
  tuneHz: number;
  /** Band-pass front chamber, litres. */
  frontVolumeL: number;
  hornThroatCm2: number;
  hornMouthCm2: number;
  hornLengthM: number;
}

function evaluate(p: BoxParams, f: number): { g: Cx; x: Cx } {
  const d = p.driver;
  const r = deriveDriver(d);
  const vb = Math.max(p.volumeL, 0.01) / 1000;
  const fb = Math.max(p.tuneHz, 1);
  switch (p.type) {
    case 'sealed':
      return { g: sealedG(f, d.fs, r.qts, d.vasM3, vb), x: sealedX(f, d, r, vb) };
    case 'ported':
      return { g: ventedG(f, d.fs, r.qts, d.vasM3 / vb, fb), x: ventedX(f, d, r, d.vasM3 / vb, fb) };
    case 'bandpass': {
      const ar = d.vasM3 / vb;
      const af = d.vasM3 / (Math.max(p.frontVolumeL, 0.01) / 1000);
      return { g: bandpassG(f, d.fs, r.qts, ar, af, fb), x: bandpassX(f, d, r, ar, af, fb) };
    }
    case 'horn': {
      const st = Math.max(p.hornThroatCm2, 0.5) * 1e-4;
      const sm = Math.max(p.hornMouthCm2, p.hornThroatCm2 * 1.01) * 1e-4;
      const h = hornModel(d, r, vb, st, sm, Math.max(p.hornLengthM, 0.05));
      return { g: hornG(f, h), x: hornX(f, h) };
    }
  }
}

/** Pressure response relative to the direct-radiator passband (0 dB far above the box corner). */
export const boxResponse = (p: BoxParams, f: number): Cx => evaluate(p, f).g;

/** Cone displacement per volt, m/V. */
export const boxDisplacement = (p: BoxParams, f: number): Cx => evaluate(p, f).x;
