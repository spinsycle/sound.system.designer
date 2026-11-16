// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Passive-radiator box (Cookbook ch. 3, after Small 1974): a sealed box whose vent is replaced by a passive cone of area Sdp,
// suspension compliance equivalent to the air volume Vap and moving mass Mmp. Box compliance leaks through QL like the vented
// box. The Cookbook prints no transfer function ("same as vented"); this is the circuit worked out in full, checked against the
// book's Table 3.2 example. alpha = Vas/Vb, delta = Cap/Cab = Vap/Vb, W = 1 + s^2 Tp^2 with Tp = 1/(2 pi fp).
import { type Cx, add, cx, div, jw, mul, poly, scale } from './complex';
import { C, RHO } from './constants';
import type { DriverDerived, DriverSpec } from './drivers';

const tau = (f: number): number => 1 / (2 * Math.PI * f);

export interface PassiveRadiator {
  /** Radiating area, m^2. */
  sdp: number;
  /** Air volume with the same compliance as the suspension, m^3. */
  vapM3: number;
  /** Total moving mass including added mass, kg. */
  massKg: number;
}

/** Suspension compliance, m/N. */
export const prCompliance = (pr: PassiveRadiator): number => pr.vapM3 / (RHO * C * C * pr.sdp * pr.sdp);

/** Free-air resonance of the passive radiator, Hz. */
export const prResonance = (pr: PassiveRadiator): number => 1 / (2 * Math.PI * Math.sqrt(pr.massKg * prCompliance(pr)));

/** Mass that puts the radiator's free-air resonance at fp, kg. */
export const prMassForResonance = (pr: Pick<PassiveRadiator, 'sdp' | 'vapM3'>, fp: number): number =>
  1 / ((2 * Math.PI * fp) ** 2 * prCompliance({ ...pr, massKg: 1 }));

/** Box tuning fB the radiator makes with a box of compliance ratio delta: fp sqrt(1 + delta). */
export const prBoxTuning = (fp: number, delta: number): number => fp * Math.sqrt(1 + delta);

interface Terms {
  w: Cx;
  wd: Cx;
  d0: Cx;
  leak: Cx;
  s: Cx;
}

function terms(f: number, fs: number, qts: number, alpha: number, delta: number, fp: number, ql: number | undefined): Terms {
  const s = jw(f);
  const ts = tau(fs);
  const tp = tau(fp);
  const t = poly([ts * ts, ts / qts, 1], s);
  const w = poly([tp * tp, 0, 1], s);
  const wd = poly([tp * tp, 0, 1 + delta], s);
  const d0 = add(mul(t, wd), scale(w, alpha));
  const wB = 2 * Math.PI * fp * Math.sqrt(1 + delta);
  const leak = scale(mul(t, w), ql === undefined ? 0 : wB / ql);
  return { w, wd, d0, leak, s };
}

/** Pressure response relative to the direct-radiator passband. */
export function passiveG(f: number, fs: number, qts: number, alpha: number, delta: number, fp: number, ql?: number): Cx {
  const k = terms(f, fs, qts, alpha, delta, fp, ql);
  const ts = tau(fs);
  const den = add(mul(k.s, k.d0), k.leak);
  return div(scale(mul(poly([1, 0, 0, 0], k.s), k.w), ts * ts), den);
}

/** Cone displacement per volt, m/V. */
export function passiveX(f: number, d: DriverSpec, r: DriverDerived, alpha: number, delta: number, fp: number, ql?: number): Cx {
  const k = terms(f, d.fs, r.qts, alpha, delta, fp, ql);
  const ts = tau(d.fs);
  const wB = 2 * Math.PI * fp * Math.sqrt(1 + delta);
  const lq = ql === undefined ? 0 : wB / ql;
  const num = add(mul(k.s, k.wd), scale(k.w, lq));
  const den = add(mul(k.s, k.d0), k.leak);
  return scale(div(num, den), (r.bl / (d.re * r.mms)) * ts * ts);
}

/** Passive-radiator excursion per volt, m/V: the cone's displacement scaled by the flow share the radiator takes. */
export function passiveXp(f: number, d: DriverSpec, r: DriverDerived, pr: PassiveRadiator, alpha: number, ql?: number): Cx {
  const delta = pr.vapM3 / (d.vasM3 / alpha);
  const fp = prResonance(pr);
  const k = terms(f, d.fs, r.qts, alpha, delta, fp, ql);
  const wB = 2 * Math.PI * fp * Math.sqrt(1 + delta);
  const lq = ql === undefined ? 0 : wB / ql;
  const share = div(cx(delta), add(k.wd, scale(mul(k.w, div(cx(1), k.s)), lq)));
  return scale(mul(passiveX(f, d, r, alpha, delta, fp, ql), share), d.sd / pr.sdp);
}
