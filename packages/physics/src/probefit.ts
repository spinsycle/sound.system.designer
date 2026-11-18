// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Driver Probe fitter: complex free-air impedance points in, Thiele-Small numbers with 95 % bands out.
// Model (the inverse of impedance.ts for a free-air driver, plus a voice-coil inductance Le the probe sees but the
// Designer's driver fields do not carry):  Z(f) = Re + j 2 pi f Le + (Re Qms / Qes) / (1 + j Qms (f/fs - fs/f)).
import { type Cx, add, cx, div, jw, scale } from './complex';
import { C, RHO } from './constants';

export interface ImpedancePoint {
  f: number;
  /** ohm */
  re: number;
  im: number;
}

/** Relative 95 % half-widths (0.02 = +-2 %); Le's is absolute, in mH. */
export interface FitBands {
  re: number;
  fs: number;
  qms: number;
  qes: number;
  qts: number;
  leMH: number;
}

export interface FreeAirFit {
  re: number;
  fs: number;
  qms: number;
  qes: number;
  qts: number;
  /** mH */
  leMH: number;
  bands: FitBands;
  /** RMS relative residual of the fit; the noise floor if the model is right. */
  rmsResidual: number;
  iterations: number;
}

/** Free-air impedance of the model. p = [Re, fs, Qms, Qes, Le in mH]. */
export function freeAirImpedance(p: readonly number[], f: number): Cx {
  const [re, fs, qms, qes, leMH] = p as [number, number, number, number, number];
  const motional = div(cx((re * qms) / qes), cx(1, qms * (f / fs - fs / f)));
  return add(add(cx(re), scale(jw(f), leMH * 1e-3)), motional);
}

type Theta = [number, number, number, number, number];
const toP = (t: Theta): Theta => [Math.exp(t[0]), Math.exp(t[1]), Math.exp(t[2]), Math.exp(t[3]), Math.max(0, t[4])];

function residuals(pts: readonly ImpedancePoint[], t: Theta): number[] {
  const p = toP(t);
  const r: number[] = [];
  for (const q of pts) {
    const m = freeAirImpedance(p, q.f);
    const d = Math.hypot(q.re, q.im);
    r.push((m.re - q.re) / d, (m.im - q.im) / d);
  }
  return r;
}

/** Solves A x = b (Gauss, partial pivot); returns null if singular. A is n x n, row-major copies. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    if (Math.abs(M[piv]![c]!) < 1e-300) return null;
    [M[c], M[piv]] = [M[piv]!, M[c]!];
    for (let r = c + 1; r < n; r++) {
      const k = M[r]![c]! / M[c]![c]!;
      for (let j = c; j <= n; j++) M[r]![j]! -= k * M[c]![j]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r]![n]!;
    for (let j = r + 1; j < n; j++) s -= M[r]![j]! * x[j]!;
    x[r] = s / M[r]![r]!;
  }
  return x;
}

function jacobian(pts: readonly ImpedancePoint[], t: Theta): number[][] {
  const cols: number[][] = [];
  for (let k = 0; k < 5; k++) {
    const h = k === 4 ? 1e-4 : 1e-6;
    const a = [...t] as Theta;
    const b = [...t] as Theta;
    a[k] += h;
    b[k] -= h;
    const ra = residuals(pts, a);
    const rb = residuals(pts, b);
    cols.push(ra.map((v, i) => (v - rb[i]!) / (2 * h)));
  }
  return cols; // cols[k][i]
}

function normalEq(J: number[][]): number[][] {
  const A: number[][] = [];
  for (let i = 0; i < 5; i++) {
    A.push([]);
    for (let j = 0; j < 5; j++) {
      let s = 0;
      for (let n = 0; n < J[i]!.length; n++) s += J[i]![n]! * J[j]![n]!;
      A[i]!.push(s);
    }
  }
  return A;
}

/** Starting point from the curve's shape: min |Z| ~ Re, peak at fs, half-power width for Q. */
function initialGuess(pts: readonly ImpedancePoint[]): Theta {
  const mag = pts.map((q) => Math.hypot(q.re, q.im));
  const re0 = Math.min(...mag);
  let ip = 0;
  for (let i = 1; i < pts.length; i++) if (mag[i]! > mag[ip]!) ip = i;
  const fs0 = pts[ip]!.f;
  const r0 = Math.max(1.05, mag[ip]! / re0);
  const lvl = re0 * Math.sqrt(r0);
  let f1 = pts[0]!.f;
  let f2 = pts[pts.length - 1]!.f;
  for (let i = ip; i >= 0; i--) if (mag[i]! <= lvl) { f1 = pts[i]!.f; break; }
  for (let i = ip; i < pts.length; i++) if (mag[i]! <= lvl) { f2 = pts[i]!.f; break; }
  const qms0 = Math.min(50, Math.max(0.5, (fs0 / Math.max(f2 - f1, fs0 * 0.01)) * Math.sqrt(r0)));
  const qes0 = Math.max(0.1, qms0 / (r0 - 1));
  return [Math.log(re0), Math.log(fs0), Math.log(qms0), Math.log(qes0), 0];
}

/**
 * Levenberg-Marquardt fit of the free-air model to complex impedance points (at least 12, spanning fs).
 * Throws on too few points or a degenerate curve.
 */
export function fitFreeAir(points: readonly ImpedancePoint[]): FreeAirFit {
  if (points.length < 12) throw new Error('need at least 12 impedance points');
  const pts = [...points].sort((a, b) => a.f - b.f);
  let t = initialGuess(pts);
  let r = residuals(pts, t);
  let ssr = r.reduce((s, v) => s + v * v, 0);
  let lambda = 1e-3;
  let it = 0;
  for (; it < 200; it++) {
    const J = jacobian(pts, t);
    const A = normalEq(J);
    const g = J.map((col) => col.reduce((s, v, i) => s + v * r[i]!, 0));
    let improved = false;
    for (let tries = 0; tries < 12; tries++) {
      const Ad = A.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) + 1e-12 : v)));
      const dx = solve(Ad, g.map((v) => -v));
      if (dx) {
        const tn = t.map((v, i) => v + dx[i]!) as Theta;
        const rn = residuals(pts, tn);
        const sn = rn.reduce((s, v) => s + v * v, 0);
        if (Number.isFinite(sn) && sn < ssr) {
          const rel = (ssr - sn) / ssr;
          t = tn;
          r = rn;
          ssr = sn;
          lambda = Math.max(lambda / 5, 1e-9);
          improved = true;
          if (rel < 1e-10) it = 1e9;
          break;
        }
      }
      lambda *= 5;
    }
    if (!improved || it >= 1e9) break;
  }
  const p = toP(t);
  const J = jacobian(pts, t);
  const A = normalEq(J);
  const dof = Math.max(1, r.length - 5);
  const s2 = ssr / dof;
  // covariance = s2 A^-1, one column at a time
  const cov: number[][] = [];
  for (let k = 0; k < 5; k++) {
    const e = [0, 0, 0, 0, 0];
    e[k] = 1;
    const col = solve(A.map((row, i) => row.map((v, j) => (i === j ? v + 1e-12 : v))), e);
    if (!col) throw new Error('degenerate impedance curve');
    cov.push(col.map((v) => v * s2));
  }
  const sd = (k: number) => Math.sqrt(Math.max(0, cov[k]![k]!));
  const qts = 1 / (1 / p[2]! + 1 / p[3]!);
  const gq = [0, 0, qts / p[2]!, qts / p[3]!, 0];
  let vq = 0;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) vq += gq[i]! * cov[i]![j]! * gq[j]!;
  const K = 1.96;
  return {
    re: p[0]!, fs: p[1]!, qms: p[2]!, qes: p[3]!, qts, leMH: p[4]!,
    bands: { re: K * sd(0), fs: K * sd(1), qms: K * sd(2), qes: K * sd(3), qts: K * Math.sqrt(vq), leMH: K * sd(4) },
    rmsResidual: Math.sqrt(ssr / r.length),
    iterations: it >= 1e9 ? 200 : it,
  };
}

export interface MassResult {
  /** kg */
  mms: number;
  /** m/N */
  cms: number;
  /** T m */
  bl: number;
  bands: { mms: number; cms: number; bl: number };
}

/**
 * Added-mass method: the same driver fitted free-air (base) and with a known mass dMassKg glued to the cone (loaded).
 * fs0^2 / fs1^2 = (Mms + dm) / Mms. dMassBand is the relative 95 % uncertainty of the added mass (scale + glue).
 * Needs no Sd. Vas = rho c^2 Sd^2 Cms does, see vasFromCms.
 */
export function addedMass(base: FreeAirFit, loaded: FreeAirFit, dMassKg: number, dMassBand = 0.01): MassResult {
  const r = (base.fs / loaded.fs) ** 2;
  if (!(r > 1.0001) || !(dMassKg > 0)) throw new Error('the added mass must lower fs');
  const mms = dMassKg / (r - 1);
  const bFs = Math.hypot(base.bands.fs, loaded.bands.fs);
  const bMms = Math.hypot(((2 * r) / (r - 1)) * bFs, dMassBand);
  const ws = 2 * Math.PI * base.fs;
  const cms = 1 / (ws * ws * mms);
  const bCms = Math.hypot(2 * base.bands.fs, bMms);
  const bl = Math.sqrt((ws * mms * base.re) / base.qes);
  const bBl = 0.5 * Math.sqrt(base.bands.fs ** 2 + bMms ** 2 + base.bands.re ** 2 + base.bands.qes ** 2);
  return { mms, cms, bl, bands: { mms: bMms, cms: bCms, bl: bBl } };
}

/** Vas, m^3, from Cms and the user-entered cone area (m^2); relative band from Cms and the Sd entry. */
export function vasFromCms(cms: number, sdM2: number, cmsBand: number, sdBand = 0.03): { vasM3: number; band: number } {
  return { vasM3: RHO * C * C * sdM2 * sdM2 * cms, band: Math.hypot(cmsBand, 2 * sdBand) };
}

