// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Horns. Geometry (spec: "Horns (geometry only)") and the lumped horn bin (spec: "Horn-loaded box"): driver, sealed
// rear chamber, and a resistive throat load behind a 2nd-order Butterworth high-pass at the flare cutoff. The bin is
// NOT a horn simulation: no mouth reflections or ripple. Deeper horn models belong to the horn designer (A2).
import { C, RHO } from './constants';
import { type Cx, add, div, jw, mul, poly, scale } from './complex';
import type { DriverDerived, DriverSpec } from './drivers';
import { boxCompliance } from './sealed';

/** Exponential flare constant m (1/m) and cutoff fc (Hz) from throat area, mouth area and length. */
export function hornFlare(stM2: number, smM2: number, lengthM: number): { m: number; fc: number } {
  const m = Math.log(smM2 / stM2) / lengthM;
  return { m, fc: (m * C) / (4 * Math.PI) };
}

/** Smallest mouth area whose circumference equals the wavelength at fc, m^2. A smaller mouth reflects badly. */
export const hornMinMouthArea = (fc: number): number => Math.PI * (C / (2 * Math.PI * fc)) ** 2;

export interface HornModel {
  m: number;
  fc: number;
  wc: number;
  /** Throat load seen by the cone, mechanical ohms. */
  rLoad: number;
  r0: number;
  rTot: number;
  cmt: number;
  /** Damping-controlled upper corner, Hz. */
  fh: number;
  /** Output scale; passband gain is kg / rTot. */
  kg: number;
  mms: number;
  bl: number;
  re: number;
}

export function hornModel(d: DriverSpec, r: DriverDerived, vrM3: number, stM2: number, smM2: number, lengthM: number): HornModel {
  const { m, fc } = hornFlare(stM2, smM2, lengthM);
  const rLoad = (RHO * C * d.sd * d.sd) / stM2;
  const r0 = r.rms + (r.bl * r.bl) / d.re;
  const cmb = boxCompliance(vrM3, d.sd);
  const rTot = r0 + rLoad;
  return {
    m,
    fc,
    wc: 2 * Math.PI * fc,
    rLoad,
    r0,
    rTot,
    cmt: (r.cms * cmb) / (r.cms + cmb),
    fh: rTot / (2 * Math.PI * r.mms),
    kg: r.mms * Math.sqrt((2 * Math.PI * C * rLoad) / (RHO * d.sd * d.sd)),
    mms: r.mms,
    bl: r.bl,
    re: d.re,
  };
}

const d2 = (s: Cx, h: HornModel): Cx => poly([1, Math.SQRT2 * h.wc, h.wc * h.wc], s);

/** N4(s) = (Mms s^2 + R0 s + 1/Cmt) D2(s) + R_load s^3. */
function n4(s: Cx, h: HornModel): Cx {
  return add(mul(poly([h.mms, h.r0, 1 / h.cmt], s), d2(s, h)), poly([h.rLoad, 0, 0, 0], s));
}

/** Response normalised to the direct-radiator reference by radiated power. */
export function hornG(f: number, h: HornModel): Cx {
  const s = jw(f);
  return div(poly([h.kg, 0, 0, 0], s), n4(s, h));
}

/** Cone displacement per volt, m/V. */
export function hornX(f: number, h: HornModel): Cx {
  const s = jw(f);
  return div(scale(d2(s, h), h.bl / h.re), n4(s, h));
}
