// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Horn simulation (spec: "Horn simulation"): flare profiles, a chain of conical-segment transfer matrices ended by a
// baffled-piston mouth, coupled to the driver. One-dimensional (plane-wave, Webster) and lossless: it shows cutoff,
// mouth-reflection ripple, the throat chamber's roll-off and the loading of the driver; it says nothing about
// directivity, and it is only trustworthy while the mouth is not large against the wavelength.
// Iteration counts are fixed (no convergence tests) so the numbers match the reference implementation closely.
import { type Cx, add, cx, div, mul, scale } from './complex';
import { C, RHO } from './constants';
import { type DriverSpec, deriveDriver } from './drivers';

const BESSEL_SWITCH = 20;
const SERIES_TERMS = 60;

/** R1 = 1 - 2 J1(x)/x by power series, summed from the second term on so it has no cancellation at small x. */
function r1Series(x: number): number {
  const h = x / 2;
  let term = h;
  let tail = 0;
  for (let m = 0; m < SERIES_TERMS; ++m) {
    term *= (-h * h) / ((m + 1) * (m + 2));
    tail += term;
  }
  return (-2 * tail) / x;
}

/** Struve H1(x) by power series. */
function h1Series(x: number): number {
  const h = x / 2;
  let term = (h * h * 8) / (3 * Math.PI);
  let total = term;
  for (let m = 0; m < SERIES_TERMS; ++m) {
    term *= (-h * h) / ((m + 1.5) * (m + 2.5));
    total += term;
  }
  return total;
}

/** Bessel J1 and Y1 by Hankel's asymptotic expansion, for x above the switch. */
function hankel1(x: number): { j1: number; y1: number } {
  const p = 1 + 0.1171875 / x ** 2 - 0.144195556640625 / x ** 4;
  const q = 0.375 / x - 0.1025390625 / x ** 3 + 0.2775764465332031 / x ** 5;
  const chi = x - 0.75 * Math.PI;
  const amp = Math.sqrt(2 / (Math.PI * x));
  return { j1: amp * (p * Math.cos(chi) - q * Math.sin(chi)), y1: amp * (p * Math.sin(chi) + q * Math.cos(chi)) };
}

/** Radiation factors of a rigid circular piston in an infinite baffle, x = 2 k a: Z = (rho c / S)(r1 + j x1). */
export function pistonRadiation(x: number): { r1: number; x1: number } {
  if (x <= BESSEL_SWITCH) return { r1: r1Series(x), x1: (2 * h1Series(x)) / x };
  const { j1, y1 } = hankel1(x);
  const h1 = y1 + (2 / Math.PI) * (1 + 1 / x ** 2 - 3 / x ** 4 + 45 / x ** 6);
  return { r1: 1 - (2 * j1) / x, x1: (2 * h1) / x };
}

/** Acoustic radiation impedance (Pa s/m^3) of a baffled piston of the given area at wavenumber k. */
export function pistonImpedance(k: number, areaM2: number): Cx {
  const { r1, x1 } = pistonRadiation(2 * k * Math.sqrt(areaM2 / Math.PI));
  return scale(cx(r1, x1), (RHO * C) / areaM2);
}

export type FlareKind = 'exponential' | 'hyperbolic' | 'tractrix' | 'conical';

export interface Flare {
  kind: FlareKind;
  throatM2: number;
  mouthM2: number;
  /** Flare cutoff, Hz. Not used by a conical flare. */
  cutoffHz: number;
  /** Hyperbolic family parameter: 1 is exponential, 0 catenoidal. Used by 'hyperbolic' only. */
  t: number;
  /** Axial length, m. Used by 'conical' only; the other flares derive their length. */
  lengthM: number;
}

const tractrixXm = (a: number, r: number): number => {
  const q = Math.sqrt(a * a - r * r);
  return a * Math.log((a + q) / r) - q;
};

/** Area of a full tractrix mouth: radius c / (2 pi fc). A tractrix cannot have a larger mouth. */
export const tractrixFullMouth = (cutoffHz: number): number => Math.PI * (C / (2 * Math.PI * cutoffHz)) ** 2;

const radius = (area: number): number => Math.sqrt(area / Math.PI);

export function flareLength(fl: Flare): number {
  if (fl.kind === 'conical') return fl.lengthM;
  const x0 = C / (2 * Math.PI * fl.cutoffHz);
  if (fl.kind === 'tractrix') return tractrixXm(x0, radius(fl.throatM2)) - tractrixXm(x0, radius(fl.mouthM2));
  const t = fl.kind === 'exponential' ? 1 : fl.t;
  const ratio = Math.sqrt(fl.mouthM2 / fl.throatM2);
  return x0 * Math.log((ratio + Math.sqrt(ratio * ratio - (1 - t * t))) / (1 + t));
}

/** Cross-section area at distance x from the throat, m^2. */
export function flareArea(fl: Flare, x: number): number {
  if (fl.kind === 'conical') return (Math.sqrt(fl.throatM2) + ((Math.sqrt(fl.mouthM2) - Math.sqrt(fl.throatM2)) * x) / fl.lengthM) ** 2;
  const x0 = C / (2 * Math.PI * fl.cutoffHz);
  if (fl.kind === 'tractrix') {
    const fromThroat = tractrixXm(x0, radius(fl.throatM2));
    let lo = radius(fl.throatM2);
    let hi = radius(fl.mouthM2);
    for (let i = 0; i < 60; ++i) {
      const mid = (lo + hi) / 2;
      if (fromThroat - tractrixXm(x0, mid) < x) lo = mid;
      else hi = mid;
    }
    return Math.PI * ((lo + hi) / 2) ** 2;
  }
  const t = fl.kind === 'exponential' ? 1 : fl.t;
  return fl.throatM2 * (Math.cosh(x / x0) + t * Math.sinh(x / x0)) ** 2;
}

export interface Joint {
  /** Distance from the throat along the axis, m. */
  x: number;
  area: number;
}

/** The flare cut at the given distances from the throat (ascending, first 0, last the length). */
export const hornJointsAt = (fl: Flare, xs: readonly number[]): Joint[] => xs.map((x) => ({ x, area: flareArea(fl, x) }));

/** The flare cut into n equal-length conical segments: n + 1 joints, throat first. */
export function hornJoints(fl: Flare, n: number): Joint[] {
  const length = flareLength(fl);
  return hornJointsAt(fl, Array.from({ length: n + 1 }, (_, i) => (length * i) / n));
}

/** Air volume of the horn as built from conical segments (frusta), m^3. */
export function hornVolume(joints: readonly Joint[]): number {
  let v = 0;
  for (let i = 1; i < joints.length; ++i) {
    const a = joints[i - 1]!;
    const b = joints[i]!;
    v += ((b.x - a.x) / 3) * (a.area + b.area + Math.sqrt(a.area * b.area));
  }
  return v;
}

/**
 * Lossless transfer matrix, throat side from mouth side: p1 = a p2 + j bi U2, U1 = j ci p2 + d U2.
 * a and d are real, the off-diagonal terms purely imaginary, and that form survives multiplication.
 */
export interface HornMatrix {
  a: number;
  bi: number;
  ci: number;
  d: number;
}

/** One conical segment: exact for Webster's equation with area proportional to the squared distance from the apex. */
export function coneMatrix(k: number, s1: number, s2: number, length: number): HornMatrix {
  const th = k * length;
  const cs = Math.cos(th);
  const sn = Math.sin(th);
  const r1 = Math.sqrt(s1);
  const r2 = Math.sqrt(s2);
  if (Math.abs(r2 - r1) <= 1e-9 * r1) return { a: cs, bi: ((RHO * C) / s1) * sn, ci: (s1 / (RHO * C)) * sn, d: cs };
  const x1 = (length * r1) / (r2 - r1); // distance of the throat end from the apex; negative when the segment narrows
  const x2 = x1 + length;
  return {
    a: (x2 / x1) * cs - sn / (k * x1),
    bi: ((RHO * C) / s2) * (x2 / x1) * sn,
    ci: (s1 / (RHO * C)) * ((x2 / x1 + 1 / (k * x1) ** 2) * sn - ((length / x1) * cs) / (k * x1)),
    d: (x1 / x2) * cs + sn / (k * x2),
  };
}

export function hornMatrix(k: number, joints: readonly Joint[]): HornMatrix {
  let m: HornMatrix = { a: 1, bi: 0, ci: 0, d: 1 };
  for (let i = 1; i < joints.length; ++i) {
    const s = coneMatrix(k, joints[i - 1]!.area, joints[i]!.area, joints[i]!.x - joints[i - 1]!.x);
    m = { a: m.a * s.a - m.bi * s.ci, bi: m.a * s.bi + m.bi * s.d, ci: m.ci * s.a + m.d * s.ci, d: m.d * s.d - m.ci * s.bi };
  }
  return m;
}

const throatFrom = (m: HornMatrix, zl: Cx): Cx => div(add(scale(zl, m.a), cx(0, m.bi)), add(mul(cx(0, m.ci), zl), cx(m.d)));

/** Acoustic impedance at the throat (Pa s/m^3). The mouth is a baffled piston unless a load is given. */
export function hornThroatImpedance(k: number, joints: readonly Joint[], zLoad?: Cx): Cx {
  return throatFrom(hornMatrix(k, joints), zLoad ?? pistonImpedance(k, joints[joints.length - 1]!.area));
}

export interface HornSystem {
  driver: DriverSpec;
  joints: readonly Joint[];
  /** Chamber between the cone and the throat, m^3 (0 for none). Its compliance shunts the throat. */
  throatChamberM3: number;
  /** Front-loaded only: the sealed chamber behind the cone, m^3. */
  rearVolumeM3: number;
  /**
   * Rear-loaded (scoop): the cone's front radiates directly and its rear drives the horn through the throat
   * chamber; there is no sealed rear chamber. The two outputs are summed as co-located sources.
   */
  rearLoaded?: boolean;
}

export interface HornResult {
  /**
   * Radiated-power response in half space, relative to the direct-radiator passband: the level a source without
   * directivity radiating the same power would give. The same normalisation as the lumped horn bin.
   */
  g: Cx;
  /** Cone displacement per volt, m/V. */
  x: Cx;
  /** Electrical input impedance, ohm. */
  z: Cx;
  /** Throat acoustic impedance, Pa s/m^3. */
  zt: Cx;
}

export function hornSystem(sys: HornSystem, f: number): HornResult {
  const d = sys.driver;
  const r = deriveDriver(d);
  const w = 2 * Math.PI * f;
  const s = cx(0, w);
  const k = w / C;
  const m = hornMatrix(k, sys.joints);
  const mouthArea = sys.joints[sys.joints.length - 1]!.area;
  const zl = pistonImpedance(k, mouthArea);
  const zt = throatFrom(m, zl);
  const compliance = (v: number): Cx => scale(s, v / (RHO * C * C)); // admittance of an air volume
  const zf = sys.throatChamberM3 > 0 ? div(cx(1), add(compliance(sys.throatChamberM3), div(cx(1), zt))) : zt;
  const sd2 = d.sd * d.sd;
  // mechanical impedance the motor sees: mass, suspension, the horn side and the other side of the cone
  let zm = add(cx(r.rms, w * r.mms - 1 / (w * r.cms)), scale(zf, sd2));
  zm = add(zm, scale(sys.rearLoaded ? pistonImpedance(k, d.sd) : div(cx(1), compliance(sys.rearVolumeM3)), sd2));
  const blRe = r.bl / d.re;
  const v = div(cx(blRe), add(zm, cx(r.bl * blRe))); // cone velocity per volt
  const uc = scale(v, d.sd);
  const mouthFlow = div(div(mul(zf, uc), zt), add(mul(cx(0, m.ci), zl), cx(m.d))); // volume velocity out of the mouth
  // Radiated-power weighting of the mouth, sqrt(R1(x) / (x^2 / 8)): 1 while the mouth is small, falling as 1/(ka)
  // above. Without it the figure would be the on-axis pressure of a plane piston, which beams and hides the roll-off.
  const xm = 2 * k * Math.sqrt(mouthArea / Math.PI);
  const um = scale(mouthFlow, Math.sqrt(8 * pistonRadiation(xm).r1) / xm);
  const out = sys.rearLoaded ? add(uc, scale(um, -1)) : um; // the rear of the cone moves air the opposite way
  return {
    g: scale(mul(s, out), (d.re * r.mms) / (d.sd * r.bl)),
    x: div(v, s),
    z: add(cx(d.re), div(cx(r.bl * r.bl), zm)),
    zt,
  };
}
