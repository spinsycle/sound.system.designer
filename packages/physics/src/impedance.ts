// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Electrical input impedance (spec: "Electrical impedance"). Voice-coil inductance is ignored: the driver fields
// carry no Le, so the curve returns to Re at high frequency.
import { type BoxParams, boxDisplacement } from './box';
import { type Cx, cx, div, jw, mul, scale } from './complex';
import { deriveDriver } from './drivers';

/**
 * Impedance from a box's cone displacement per volt x: the coil current is i = (E - Bl v)/Re with v = s x,
 * so Z = Re / (1 - Bl s x). One formula for every box type.
 */
export function impedanceFromDisplacement(f: number, x: Cx, bl: number, re: number): Cx {
  const blSx = scale(mul(jw(f), x), bl);
  return div(cx(re), cx(1 - blSx.re, -blSx.im));
}

/** Input impedance of the driver in its box, ohms (complex). */
export function boxImpedance(p: BoxParams, f: number): Cx {
  return impedanceFromDisplacement(f, boxDisplacement(p, f), deriveDriver(p.driver).bl, p.driver.re);
}

/** Phase of a complex value, degrees. */
export const phaseDeg = (z: Cx): number => (Math.atan2(z.im, z.re) * 180) / Math.PI;
