// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Electrical input impedance (spec: "Electrical impedance" and "Driver load model"). A driver with no `le` has no voice-coil
// inductance, so the curve returns to Re at high frequency; with `le` the coil's s Le is simply in series, so it climbs as
// Re + s Le. That is exact: the motional part Bl^2/Zm does not depend on the electrical side. The acoustic response is still
// the lossless-Le one (the inductance does not feed back into the displacement the box functions return).
import { type BoxParams, boxDisplacement } from './box';
import { type Cx, cx, div, jw, mul, scale } from './complex';
import { deriveDriver } from './drivers';

/**
 * Impedance from a box's cone displacement per volt x: the coil current is i = (E - Bl v)/Re with v = s x,
 * so Z = Re / (1 - Bl s x). A voice-coil inductance le (H) is in series: Z = Re / (1 - Bl s x) + s Le.
 * One formula for every box type.
 */
export function impedanceFromDisplacement(f: number, x: Cx, bl: number, re: number, le = 0): Cx {
  const blSx = scale(mul(jw(f), x), bl);
  const z = div(cx(re), cx(1 - blSx.re, -blSx.im));
  return cx(z.re, z.im + 2 * Math.PI * f * le);
}

/** Input impedance of the driver in its box, ohms (complex). */
export function boxImpedance(p: BoxParams, f: number): Cx {
  return impedanceFromDisplacement(f, boxDisplacement(p, f), deriveDriver(p.driver).bl, p.driver.re, p.driver.le);
}

/** Phase of a complex value, degrees. */
export const phaseDeg = (z: Cx): number => (Math.atan2(z.im, z.re) * 180) / Math.PI;
