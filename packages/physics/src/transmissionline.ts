// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Transmission-line box (Cookbook ch. 4). The book gives rules and tables, not a model: the line is simulated here as a
// chain of short uniform tubes (a staircase of the taper), stuffed over part of its length with fibre modelled by the
// Delany-Bazley wavenumber and characteristic impedance, driven from the cone's rear and ended by a baffled-piston
// mouth. Output is the cone front minus the exit flow, as for the rear-loaded horn. 0 dB is the direct-radiator
// passband. Sizing comes from the book's Tables 4.1 to 4.3 (stuffing density, fs/fp, Vas/Vp) and fp = c / 4L.
import { C, RHO } from './constants';
import { type Cx, add, cx, div, mul, scale } from './complex';
import { type DriverSpec, deriveDriver } from './drivers';
import { pistonImpedance, pistonRadiation } from './hornsim';

const LB_PER_FT3 = 16.0185; // kg/m^3 per lb/ft^3

export type TlKind = 'taper' | 'chamber' | 'offset';
export type TlTable = 'standard' | 'extended';
export type Stuffing = 'acousta' | 'polyester' | 'fiberglass' | 'microfibre';

/** Stuffing density (lb/ft^3) for +-1 dB ripple, Table 4.1, by line length in inches (24, 36, 48, 72, 96). Fibreglass has no 72/96 in entries. */
const LENGTHS_IN = [24, 36, 48, 72, 96];
const DENSITY: Record<Stuffing, readonly (number | null)[]> = {
  acousta: [1.7, 1.3, 1.0, 0.75, 0.5],
  polyester: [1.8, 1.4, 1.1, 0.85, 0.65],
  fiberglass: [0.9, 0.7, 0.6, null, null],
  microfibre: [0.65, 0.55, 0.45, 0.35, 0.27],
};

/** Table 4.1 interpolated in line length, lb/ft^3; fibreglass past 48 in holds its 48 in value. */
export function stuffingDensityLb(material: Stuffing, lengthM: number): number {
  const li = lengthM / 0.0254;
  const row = DENSITY[material];
  const ok = LENGTHS_IN.map((l, i) => ({ l, v: row[i] })).filter((p): p is { l: number; v: number } => p.v !== null && p.v !== undefined);
  if (li <= ok[0]!.l) return ok[0]!.v;
  for (let i = 1; i < ok.length; ++i) {
    const a = ok[i - 1]!;
    const b = ok[i]!;
    if (li <= b.l) return a.v + ((b.v - a.v) * (li - a.l)) / (b.l - a.l);
  }
  return ok[ok.length - 1]!.v;
}

/** Table 4.2 (standard) and 4.3 (extended): rows at three Qts values; f3/fs, fs/fp, Vas/Vp per line type. */
interface Row {
  qts: number;
  f3OverFs: number;
  fsOverFp: number;
  vasOverVp: number;
}
const TABLES: Record<TlTable, Record<TlKind, readonly Row[]>> = {
  standard: {
    taper: [
      { qts: 0.36, f3OverFs: 2.0, fsOverFp: 0.4, vasOverVp: 3.1 },
      { qts: 0.46, f3OverFs: 1.6, fsOverFp: 0.5, vasOverVp: 2.0 },
      { qts: 0.58, f3OverFs: 1.3, fsOverFp: 0.63, vasOverVp: 1.2 },
    ],
    chamber: [
      { qts: 0.31, f3OverFs: 2.0, fsOverFp: 0.4, vasOverVp: 2.14 },
      { qts: 0.39, f3OverFs: 1.6, fsOverFp: 0.5, vasOverVp: 1.35 },
      { qts: 0.5, f3OverFs: 1.3, fsOverFp: 0.63, vasOverVp: 0.84 },
    ],
    offset: [
      { qts: 0.36, f3OverFs: 2.0, fsOverFp: 0.6, vasOverVp: 3.1 },
      { qts: 0.46, f3OverFs: 1.6, fsOverFp: 0.74, vasOverVp: 2.0 },
      { qts: 0.58, f3OverFs: 1.3, fsOverFp: 0.94, vasOverVp: 1.2 },
    ],
  },
  extended: {
    taper: [
      { qts: 0.25, f3OverFs: 2.0, fsOverFp: 0.4, vasOverVp: 1.5 },
      { qts: 0.33, f3OverFs: 1.6, fsOverFp: 0.5, vasOverVp: 1.0 },
      { qts: 0.41, f3OverFs: 1.3, fsOverFp: 0.63, vasOverVp: 0.6 },
    ],
    chamber: [
      { qts: 0.31, f3OverFs: 1.75, fsOverFp: 0.4, vasOverVp: 1.1 },
      { qts: 0.39, f3OverFs: 1.4, fsOverFp: 0.5, vasOverVp: 0.68 },
      { qts: 0.5, f3OverFs: 1.1, fsOverFp: 0.63, vasOverVp: 0.42 },
    ],
    offset: [
      { qts: 0.25, f3OverFs: 2.0, fsOverFp: 0.6, vasOverVp: 1.5 },
      { qts: 0.33, f3OverFs: 1.6, fsOverFp: 0.74, vasOverVp: 1.0 },
      { qts: 0.41, f3OverFs: 1.3, fsOverFp: 0.94, vasOverVp: 0.6 },
    ],
  },
};

/** Row of Tables 4.2 / 4.3 at a Qts, interpolated linearly and held at the ends (the book's rows span Qts only about +-0.1). */
export function tlRow(table: TlTable, kind: TlKind, qts: number): Row {
  const rows = TABLES[table][kind];
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  if (qts <= first.qts) return { ...first, qts };
  if (qts >= last.qts) return { ...last, qts };
  for (let i = 1; i < rows.length; ++i) {
    const a = rows[i - 1]!;
    const b = rows[i]!;
    if (qts <= b.qts) {
      const t = (qts - a.qts) / (b.qts - a.qts);
      const mix = (x: number, y: number): number => x + (y - x) * t;
      return { qts, f3OverFs: mix(a.f3OverFs, b.f3OverFs), fsOverFp: mix(a.fsOverFp, b.fsOverFp), vasOverVp: mix(a.vasOverVp, b.vasOverVp) };
    }
  }
  return last;
}

export interface TlDesign {
  kind: TlKind;
  /** Quarter-wave resonance, Hz. */
  fpHz: number;
  /** Line length, m. */
  lengthM: number;
  /** Total line volume Vp (chamber included), m^3. */
  volumeM3: number;
  /** Cross-section at the driver end and at the exit, m^2. */
  startM2: number;
  exitM2: number;
  /** Coupling chamber volume (kind 'chamber'), m^3; the rest of Vp is the line. */
  chamberM3: number;
  /** Driver distance from the closed end as a share of the line (kind 'offset'). */
  offset: number;
  /** Expected f3 from the table, Hz. */
  f3Hz: number;
}

/** Line taper used for the sized line: start area over exit area (the book's 1:4 standard, p. 100). */
export const TL_TAPER = 4;
export const TL_OFFSET = 0.2;
export const TL_CHAMBER_SHARE = 1 / 3;

/** Size a line from the tables: fp = fs / (fs/fp), L = c / 4 fp, Vp = Vas / (Vas/Vp). Taper 1:4 fills Vp with start area S0 = Vp / (0.625 L). */
export function tlDesign(d: DriverSpec, kind: TlKind, table: TlTable): TlDesign {
  const qts = deriveDriver(d).qts;
  const row = tlRow(table, kind, qts);
  const fp = d.fs / row.fsOverFp;
  const length = C / (4 * fp);
  const vp = d.vasM3 / row.vasOverVp;
  const chamber = kind === 'chamber' ? vp * TL_CHAMBER_SHARE : 0;
  const lineVol = vp - chamber;
  // the 'chamber' type has a straight line; the others taper 1:4
  const start = kind === 'chamber' ? lineVol / length : lineVol / (((1 + 1 / TL_TAPER) / 2) * length);
  const exit = kind === 'chamber' ? start : start / TL_TAPER;
  return { kind, fpHz: fp, lengthM: length, volumeM3: vp, startM2: start, exitM2: exit, chamberM3: chamber, offset: kind === 'offset' ? TL_OFFSET : 0, f3Hz: row.f3OverFs * d.fs };
}

export interface TlGeometry {
  lengthM: number;
  startM2: number;
  exitM2: number;
  /** Volume between the cone and the line start, m^3. */
  chamberM3: number;
  /** Driver distance from the closed end, share of the line length (0 for a driver at the end). */
  offset: number;
  stuffing: Stuffing;
  /** Stuffing density, lb/ft^3 (the book's unit). */
  densityLb: number;
  /** Share of the line length stuffed, from the closed end; the rest stays open (the book leaves about the last 20 % clear). */
  stuffedShare: number;
}

/** Flow resistivity of the fibre, Pa s/m^2, from its density: sigma = SIGMA_REF (m * rho)^1.5 with m the material's effectiveness against Acousta-Stuf. */
export const SIGMA_REF = 730;
export const MATERIAL_FACTOR: Record<Stuffing, number> = { acousta: 1, polyester: 0.95, fiberglass: 1.8, microfibre: 2.6 };

export const flowResistivity = (material: Stuffing, densityLb: number): number => SIGMA_REF * (MATERIAL_FACTOR[material] * densityLb) ** 1.5;

/** Delany-Bazley wavenumber and characteristic impedance (units of rho c) of a fibre of flow resistivity sigma at f; e^(j omega t) convention. */
export function delanyBazley(f: number, sigma: number): { k: Cx; z: Cx } {
  const x = (RHO * f) / sigma;
  const k0 = (2 * Math.PI * f) / C;
  return {
    k: cx(k0 * (1 + 0.0978 * x ** -0.7), -k0 * 0.189 * x ** -0.595),
    z: cx(1 + 0.0571 * x ** -0.754, -0.087 * x ** -0.732),
  };
}

// complex helpers beyond complex.ts
const csub = (a: Cx, b: Cx): Cx => cx(a.re - b.re, a.im - b.im);
const ccos = (z: Cx): Cx => cx(Math.cos(z.re) * Math.cosh(z.im), -Math.sin(z.re) * Math.sinh(z.im));
const csin = (z: Cx): Cx => cx(Math.sin(z.re) * Math.cosh(z.im), Math.cos(z.re) * Math.sinh(z.im));

interface M2 {
  a: Cx;
  b: Cx;
  c: Cx;
  d: Cx;
}

const I2: M2 = { a: cx(1), b: cx(0), c: cx(0), d: cx(1) };
const mm = (x: M2, y: M2): M2 => ({
  a: add(mul(x.a, y.a), mul(x.b, y.c)),
  b: add(mul(x.a, y.b), mul(x.b, y.d)),
  c: add(mul(x.c, y.a), mul(x.d, y.c)),
  d: add(mul(x.c, y.b), mul(x.d, y.d)),
});

/** Uniform tube section of area s, length l, complex wavenumber k and relative characteristic impedance zr: p1 = a p2 + b U2, U1 = c p2 + d U2. */
function tube(k: Cx, zr: Cx, s: number, l: number): M2 {
  const kl = cx(k.re * l, k.im * l);
  const cs = ccos(kl);
  const sn = csin(kl);
  const z0 = scale(zr, (RHO * C) / s);
  // b = j z0 sin(kl), c = j sin(kl) / z0
  const jsn = cx(-sn.im, sn.re);
  return { a: cs, b: mul(z0, jsn), c: div(jsn, z0), d: cs };
}

/** Line sections used for the staircase: enough for the taper at the highest frequency the plot shows. */
const SEGMENTS = 48;

export interface TlResult {
  g: Cx;
  x: Cx;
  z: Cx;
}

/** Response, cone displacement per volt and input impedance of the driver in the line at f. */
export function tlSystem(d: DriverSpec, geo: TlGeometry, f: number): TlResult {
  const r = deriveDriver(d);
  const w = 2 * Math.PI * f;
  const s = cx(0, w);
  const k0 = w / C;
  const sigma = flowResistivity(geo.stuffing, geo.densityLb);
  const fib = delanyBazley(f, sigma);
  const air = { k: cx(k0), z: cx(1) };
  const dx = geo.lengthM / SEGMENTS;
  const stuffedLen = geo.lengthM * geo.stuffedShare;
  // segment i runs from the closed end (x = 0) toward the exit; area tapers from `start` at the closed end... the line
  // starts at the driver end, so area runs start -> exit along the path from the driver to the exit
  const pathStart = geo.offset * geo.lengthM;
  const nAfter = Math.max(1, Math.round(((geo.lengthM - pathStart) / geo.lengthM) * SEGMENTS));
  const lenAfter = geo.lengthM - pathStart;
  const segLen = lenAfter / nAfter;
  void dx;
  const areaAt = (t: number): number => geo.startM2 * (geo.exitM2 / geo.startM2) ** t; // exponential taper start -> exit
  let m = I2;
  for (let i = 0; i < nAfter; ++i) {
    const xMid = pathStart + (i + 0.5) * segLen;
    const t = (i + 0.5) / nAfter;
    const stuffed = xMid <= stuffedLen;
    m = mm(m, tube(stuffed ? fib.k : air.k, stuffed ? fib.z : air.z, areaAt(t), segLen));
  }
  const zl = pistonImpedance(k0, geo.exitM2);
  // impedance looking into the line from the driver: (a zl + b) / (c zl + d)
  const num = add(mul(m.a, zl), m.b);
  const den = add(mul(m.c, zl), m.d);
  const zline = div(num, den);
  // closed-end stub behind the driver (offset line): impedance -j z0 cot(kl), shunted across the driver node
  let yNode = div(cx(1), zline);
  if (geo.offset > 0) {
    const stubLen = pathStart;
    const mid = stubLen / 2;
    const stuffed = mid <= stuffedLen;
    const kk = stuffed ? fib.k : air.k;
    const zr = stuffed ? fib.z : air.z;
    const z0 = scale(zr, (RHO * C) / geo.startM2);
    const kl = cx(kk.re * stubLen, kk.im * stubLen);
    const cot = div(ccos(kl), csin(kl));
    const zstub = mul(cx(0, -1), mul(z0, cot));
    yNode = add(yNode, div(cx(1), zstub));
  }
  if (geo.chamberM3 > 0) yNode = add(yNode, scale(s, geo.chamberM3 / (RHO * C * C)));
  const zf = div(cx(1), yNode);
  const sd2 = d.sd * d.sd;
  let zm = add(cx(r.rms, w * r.mms - 1 / (w * r.cms)), scale(zf, sd2));
  zm = add(zm, scale(pistonImpedance(k0, d.sd), sd2));
  const blRe = r.bl / d.re;
  const v = div(cx(blRe), add(zm, cx(r.bl * blRe)));
  const uc = scale(v, d.sd);
  // flow into the line, then through it to the exit (the stub and chamber take their share at the node)
  const pNode = mul(zf, uc);
  const uLine = div(pNode, zline);
  const mouthFlow = div(uLine, den);
  const xm = 2 * k0 * Math.sqrt(geo.exitM2 / Math.PI);
  const um = scale(mouthFlow, Math.sqrt(8 * pistonRadiation(xm).r1) / xm);
  const out = csub(uc, um);
  return {
    g: scale(mul(s, out), (d.re * r.mms) / (d.sd * r.bl)),
    x: div(v, s),
    z: add(cx(d.re), div(cx(r.bl * r.bl), zm)),
  };
}

/** The geometry a sized design implies, with the book's stuffing for the chosen material. */
export function tlGeometryFromDesign(des: TlDesign, material: Stuffing): TlGeometry {
  return {
    lengthM: des.lengthM,
    startM2: des.startM2,
    exitM2: des.exitM2,
    chamberM3: des.chamberM3,
    offset: des.offset,
    stuffing: material,
    densityLb: stuffingDensityLb(material, des.lengthM),
    stuffedShare: 0.8,
  };
}

/** Convert the density to kg/m^3 for the bill of materials. */
export const densityKgM3 = (lb: number): number => lb * LB_PER_FT3;
