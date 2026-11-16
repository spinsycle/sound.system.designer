// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Alignments and design helpers from Dickason, "The Loudspeaker Design Cookbook" 7th ed. (ch. 1, 2): sealed Qtc design,
// vented alignments fitted to a prototype response, box-loss and fill rules, reference efficiency, displacement-limited
// output, vent sizing checks, and the sealed-rear band-pass design equations.
import { C } from './constants';
import { type Cx, abs, dB } from './complex';
import type { DriverSpec } from './drivers';
import { bandpassG } from './bandpass';
import { sealedParams } from './sealed';
import { passiveG } from './passive';
import { ventedG } from './ported';

// ---------------------------------------------------------------- sealed

/** Net box volume (same unit as vas) that gives the wanted total Qtc: Vb = Vas / ((Qtc/Qts)^2 - 1). Cookbook p. 36. */
export const sealedVolumeForQtc = (qts: number, vas: number, qtc: number): number => vas / ((qtc / qts) ** 2 - 1);

/** Small and Margolis, 100 % fill (Cookbook p. 41): the air looks 1.2 times larger and adds 0.2 to 1/Qtc. */
export const FILL_VOLUME_GAIN = 1.2;
export const FILL_LOSS = 0.2;

/**
 * Effective volume gain and the loss added to 1/Qtc at a fill fraction in [0, 1].
 * ponytail: the book gives only the 100 % case; linear in between is an assumption, measured fill curves are the upgrade.
 */
export function fillEffect(fill: number): { volumeGain: number; addedInvQ: number } {
  const f = Math.min(Math.max(fill, 0), 1);
  return { volumeGain: 1 + (FILL_VOLUME_GAIN - 1) * f, addedInvQ: FILL_LOSS * f };
}

/** Sealed box with fibrous fill: Qtc and fc from the effective volume, with the added loss on 1/Qtc. */
export function sealedFilled(fs: number, qts: number, vas: number, vb: number, fill: number): { alpha: number; fc: number; qtc: number } {
  const e = fillEffect(fill);
  const p = sealedParams(fs, qts, vas, vb * e.volumeGain);
  return { alpha: p.alpha, fc: p.fc, qtc: 1 / (1 / p.qtc + e.addedInvQ) };
}

// ---------------------------------------------------------------- reference efficiency and output

/** Reference efficiency eta0 (fraction): 9.64e-10 fs^3 Vas / Qes^3 with Vas in litres (Cookbook pp. 37, 75). */
export const referenceEfficiency = (d: DriverSpec): number => (9.64e-7 * d.fs ** 3 * d.vasM3) / d.qes ** 3;

/** SPL at 1 W, 1 m (half-space convention of the book): 112 + 10 log10(eta0). */
export const referenceSpl = (eta0: number): number => 112 + 10 * Math.log10(eta0);

/** Displacement volume Vd = Sd Xmax, m^3. */
export const displacementVolume = (d: DriverSpec): number => d.sd * d.xmax;

/** Cookbook Table 1.14: Kp against Qtc for the closed box. */
const KP: readonly (readonly [number, number])[] = [
  [0.5, 0.06],
  [0.577, 0.15],
  [0.707, 0.39],
  [0.8, 0.57],
  [0.9, 0.75],
  [1.0, 0.84],
  [1.1, 0.85],
  [1.2, 0.84],
  [1.5, 0.71],
];

export function closedKp(qtc: number): number {
  if (qtc <= KP[0]![0]) return KP[0]![1];
  for (let i = 1; i < KP.length; ++i) {
    const a = KP[i - 1]!;
    const b = KP[i]!;
    if (qtc <= b[0]) return a[1] + ((b[1] - a[1]) * (qtc - a[0])) / (b[0] - a[0]);
  }
  return KP[KP.length - 1]![1];
}

/** Kp of a vented box (Cookbook p. 76). */
export const VENTED_KP = 3.0;

/** Displacement-limited acoustic power, W: Kp f3^4 Vd^2. */
export const maxAcousticPower = (f3: number, vdM3: number, kp: number): number => kp * f3 ** 4 * vdM3 * vdM3;

/** SPL at 1 m from an acoustic power, dB: 112 + 10 log10(Par). */
export const powerSpl = (parW: number): number => 112 + 10 * Math.log10(parW);

/** Electrical input that reaches Par: Per = Par / eta0, W. Compare with the driver's thermal rating. */
export const electricalPowerFor = (parW: number, eta0: number): number => parW / eta0;

// ---------------------------------------------------------------- vents

/** Smallest vent diameter, m (Cookbook p. 69): dv >= sqrt(411.25 Vd / sqrt(fB)), Vd in m^3 (the book writes it in inches with 39.37). */
export const minVentDiameterM = (vdM3: number, fb: number): number => Math.sqrt((411.25 * vdM3) / Math.sqrt(fb));

/** Small's more conservative bound, m: dv >= sqrt(fB Vd). */
export const minVentDiameterConservativeM = (vdM3: number, fb: number): number => Math.sqrt(fb * vdM3);

/** Cone to vent area ratio: the book wants at most 9 (hard limit), 4 or less for good linearity; stage use near 1. */
export const ventAreaRatio = (sdM2: number, ventM2: number): number => sdM2 / ventM2;

/** Two round vents of diameters d1 and d2 act as one of this diameter (Cookbook p. 72). */
export const combinedVentDiameter = (d1: number, d2: number): number => Math.sqrt(d1 * d1 + d2 * d2);

/**
 * Mean air speed in a port when the cone moves xPeak at f, m/s. The book gives no limit; 5 % of c is a common rule (not from the book).
 */
export const portAirSpeed = (f: number, sdM2: number, xPeakM: number, portAreaM2: number): number => (2 * Math.PI * f * sdM2 * xPeakM) / portAreaM2;
export const PORT_MACH_LIMIT = 0.05 * C;

// ---------------------------------------------------------------- vented alignments

export type VentedAlignment = 'B4' | 'BE4' | 'QB3' | 'C4';

/** Chebyshev (0.5 dB ripple) frequency scale so |H|^2 = 1/2 at the -3 dB edge, solved once by bisection. */
const CHEB_EPS2 = 10 ** 0.05 - 1;
const cheb4 = (u: number): number => 8 * u ** 4 - 8 * u ** 2 + 1;
const CHEB_SCALE = (() => {
  let lo = 1;
  let hi = 2;
  for (let i = 0; i < 80; ++i) {
    const mid = (lo + hi) / 2;
    if (1 / (1 + CHEB_EPS2 * cheb4(mid) ** 2) > 0.5) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
})();

/** Bessel 4th-order prototype frequency at which |H|^2 = 1/2. */
const bessel2 = (w: number): number => 105 ** 2 / ((w ** 4 - 45 * w ** 2 + 105) ** 2 + (-10 * w ** 3 + 105 * w) ** 2);
const BESSEL_SCALE = (() => {
  let lo = 0.1;
  let hi = 10;
  for (let i = 0; i < 100; ++i) {
    const mid = (lo + hi) / 2;
    if (bessel2(mid) > 0.5) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
})();

/** Squared magnitude of the high-pass prototype at x = f / f3: what each named alignment aims at. */
function target(kind: VentedAlignment, x: number): number {
  switch (kind) {
    case 'B4':
      return 1 / (1 + x ** -8);
    case 'QB3':
      return 1 / (1 + x ** -6);
    case 'C4':
      return 1 / (1 + CHEB_EPS2 * cheb4(CHEB_SCALE / x) ** 2);
    case 'BE4':
      return bessel2(BESSEL_SCALE / x);
  }
}

export interface VentedSolution {
  alpha: number;
  /** fb / fs. */
  h: number;
  /** -3 dB point over fs. */
  f3OverFs: number;
  /** RMS dB error to the prototype over 0.4 f3 .. 3 f3: how well the alignment is reached. */
  errDb: number;
}

/** -3 dB frequency of a high-pass response given as a function of f (fs = 1): scan up, then bisect. -1 if none below 12. */
function f3Of(g: (f: number) => Cx): number {
  const above = (f: number): boolean => dB(abs(g(f))) >= -3;
  let prev = 0.05;
  for (let f = prev; f < 12; f *= 1.002) {
    if (above(f)) {
      let lo = prev;
      let hi = f;
      for (let i = 0; i < 60; ++i) {
        const mid = 0.5 * (lo + hi);
        if (above(mid)) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    prev = f;
  }
  return -1;
}

/**
 * Fit (alpha, H) so a response g(f, alpha, h) with fs = 1 follows the named prototype, f3 free.
 * Shared by the vented and passive-radiator boxes.
 */
export function fitAlignment(g: (f: number, alpha: number, h: number) => Cx, kind: VentedAlignment): VentedSolution {
  const xs: number[] = [];
  for (let i = 0; i <= 40; ++i) xs.push(0.4 * (3 / 0.4) ** (i / 40));
  const cost = (alpha: number, h: number): { err: number; f3: number } => {
    if (alpha <= 0.02 || h <= 0.3 || h > 3) return { err: 1e3, f3: 1 };
    const f3 = f3Of((f) => g(f, alpha, h));
    if (f3 <= 0) return { err: 1e3, f3: 1 };
    let e = 0;
    for (const x of xs) e += (dB(abs(g(x * f3, alpha, h))) - 10 * Math.log10(target(kind, x))) ** 2;
    return { err: Math.sqrt(e / xs.length), f3 };
  };
  let best = { a: 1, h: 1, err: 1e9, f3: 1 };
  for (let a = 0.1; a <= 12; a *= 1.12) {
    for (let h = 0.5; h <= 2.5; h *= 1.05) {
      const c = cost(a, h);
      if (c.err < best.err) best = { a, h, err: c.err, f3: c.f3 };
    }
  }
  let sa = best.a * 0.06;
  let sh = best.h * 0.03;
  for (let it = 0; it < 300 && (sa > 1e-8 || sh > 1e-8); ++it) {
    let moved = false;
    for (const [da, dh] of [[sa, 0], [-sa, 0], [0, sh], [0, -sh]] as const) {
      const c = cost(best.a + da, best.h + dh);
      if (c.err < best.err) {
        best = { a: best.a + da, h: best.h + dh, err: c.err, f3: c.f3 };
        moved = true;
      }
    }
    if (!moved) {
      sa *= 0.5;
      sh *= 0.5;
    }
  }
  return { alpha: best.a, h: best.h, f3OverFs: best.f3, errDb: best.err };
}

/**
 * Vented alignment at the driver's Qts and the box's QL. The book's tables (2.1-2.10) are this fit; B4 reproduces them
 * (Qts = 0.4048, QL = 7: alpha 1.0613, H = 1).
 */
export const solveVented = (qts: number, kind: VentedAlignment, ql: number | undefined): VentedSolution =>
  fitAlignment((f, a, h) => ventedG(f, 1, qts, a, h, ql), kind);

// ---------------------------------------------------------------- sealed-rear band-pass (Cookbook section 1.300)

export interface BandpassDesign {
  /** Front (ported) chamber, m^3. */
  vfM3: number;
  /** Rear (sealed) chamber, m^3. */
  vrM3: number;
  /** Front chamber plus port resonance, Hz. */
  fbHz: number;
}

/** Ripple factor S: 0.7 flat (0 dB), 0.6 (0.35 dB), 0.5 (1.25 dB). Qbp is the band-pass Q (must exceed Qts). */
export function bandpassDesign(d: DriverSpec, qts: number, s: number, qbp: number): BandpassDesign {
  return {
    vfM3: (2 * s * qts) ** 2 * d.vasM3,
    vrM3: d.vasM3 / ((qbp / qts) ** 2 - 1),
    fbHz: (qbp * d.fs) / qts,
  };
}

/** -3 dB edges of the band-pass about its peak, Hz, scanned in 1/48 octaves. */
export function bandpassEdges(fs: number, qts: number, ar: number, af: number, fb: number, ql?: number): { fl: number; fh: number; peakDb: number } {
  let peak = -1e9;
  const pts: { f: number; db: number }[] = [];
  for (let f = fs * 0.1; f < fs * 12; f *= 2 ** (1 / 48)) {
    const db = dB(abs(bandpassG(f, fs, qts, ar, af, fb, ql)));
    pts.push({ f, db });
    peak = Math.max(peak, db);
  }
  const inBand = pts.filter((p) => p.db >= peak - 3);
  return { fl: inBand[0]!.f, fh: inBand[inBand.length - 1]!.f, peakDb: peak };
}

/**
 * Passive-radiator tuning for a chosen box (alpha = Vas/Vb, delta = alpha): the H = fB/fs with the lowest f3 whose
 * passband stays within +0.5 dB. The Cookbook's Table 3.1 rows (Qts 0.26: alpha 4.33, H 1.73, f3/fs 1.98) are reproduced
 * by this rule to a few percent; the table's own selection rule is not printed.
 */
export function solvePassiveTuning(qts: number, alpha: number, ql: number | undefined): { h: number; f3OverFs: number; peakDb: number } | null {
  let best: { h: number; f3OverFs: number; peakDb: number } | null = null;
  for (let h = 0.6; h <= 3; h *= 1.005) {
    const g = (f: number): Cx => passiveG(f, 1, qts, alpha, alpha, h / Math.sqrt(1 + alpha), ql);
    const f3 = f3Of(g);
    if (f3 <= 0) continue;
    let peak = -1e9;
    for (let f = f3; f < 8; f *= 1.03) peak = Math.max(peak, dB(abs(g(f))));
    if (peak <= 0.5 && (best === null || f3 < best.f3OverFs)) best = { h, f3OverFs: f3, peakDb: peak };
  }
  return best;
}

/** Starting box for a passive-radiator woofer: alpha about 1.13 / Qts (the Cookbook's worked rows, Qts 0.25-0.26 give 4.3-4.6). */
export const recommendedPassiveAlpha = (qts: number): number => Math.min(Math.max(1.13 / qts, 1.5), 10);
