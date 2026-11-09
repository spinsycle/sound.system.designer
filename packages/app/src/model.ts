// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The design a user edits and everything derived from it. Pure functions, no UI: the page only draws what
// compute() returns, and the tests assert the same path against the shared physics vectors.
import * as P from '@soundsystemdesigner/physics';

export type BoxKind = 'sealed' | 'ported' | 'bandpass';
export const BOX_KINDS: readonly { id: BoxKind; label: string }[] = [
  { id: 'sealed', label: 'Sealed' },
  { id: 'ported', label: 'Ported' },
  { id: 'bandpass', label: 'Band-pass' },
];

/** Index of the Custom driver in the class picker (after the generic classes). */
export const CUSTOM_CLASS = P.DRIVER_CLASSES.length;

export interface Design {
  driverClass: number;
  custom: P.CustomDriverFields;
  type: BoxKind;
  /** Box volume; the sealed rear chamber of a band-pass box. */
  volumeL: number;
  /** Port tuning (ported) or front chamber + port resonance (band-pass). */
  tuneHz: number;
  frontVolumeL: number;
  portDiameterCm: number;
  /** Amplifier power for the excursion plot. */
  powerW: number;
}

export interface Range {
  label: string;
  unit: string;
  min: number;
  max: number;
}

/** User-entered driver ranges are the shared spec's Custom ranges. */
export const CUSTOM_RANGES: Record<keyof P.CustomDriverFields, Range> = {
  fsHz: { label: 'Fs', unit: 'Hz', min: 10, max: 300 },
  qts: { label: 'Qts', unit: '', min: 0.15, max: 1.5 },
  qms: { label: 'Qms', unit: '', min: 1, max: 20 },
  vasL: { label: 'Vas', unit: 'L', min: 1, max: 2000 },
  sdCm2: { label: 'Sd', unit: 'cm²', min: 5, max: 2500 },
  reOhm: { label: 'Re', unit: 'Ω', min: 1, max: 32 },
  xmaxMm: { label: 'Xmax', unit: 'mm', min: 0.2, max: 40 },
  powerW: { label: 'Power', unit: 'W', min: 5, max: 5000 },
};

export type BoxField = 'volumeL' | 'tuneHz' | 'frontVolumeL' | 'portDiameterCm' | 'powerW';
export const BOX_RANGES: Record<BoxField, Range> = {
  volumeL: { label: 'Volume', unit: 'L', min: 1, max: 1000 },
  tuneHz: { label: 'Tuning', unit: 'Hz', min: 10, max: 200 },
  frontVolumeL: { label: 'Front volume', unit: 'L', min: 1, max: 1000 },
  portDiameterCm: { label: 'Port diameter', unit: 'cm', min: 2, max: 40 },
  powerW: { label: 'Amp power', unit: 'W', min: 1, max: 5000 },
};

export const DEFAULT_DESIGN: Design = {
  driverClass: 3,
  custom: { ...P.CUSTOM_DRIVER_DEFAULTS },
  type: 'ported',
  volumeL: 150,
  tuneHz: 40,
  frontVolumeL: 100,
  portDiameterCm: 10,
  powerW: 100,
};

const num = (v: unknown, r: Range, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? P.clamp(v, r.min, r.max) : fallback;

/** Any stored or typed value to a valid Design: unknown fields dropped, numbers clamped to their ranges. */
export function sanitize(input: unknown): Design {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const c = (i.custom && typeof i.custom === 'object' ? i.custom : {}) as Record<string, unknown>;
  const d = DEFAULT_DESIGN;
  const custom = { ...d.custom };
  for (const k of Object.keys(CUSTOM_RANGES) as (keyof P.CustomDriverFields)[]) custom[k] = num(c[k], CUSTOM_RANGES[k], d.custom[k]);
  const out: Design = {
    driverClass: typeof i.driverClass === 'number' && Number.isInteger(i.driverClass) ? P.clamp(i.driverClass, 0, CUSTOM_CLASS) : d.driverClass,
    custom,
    type: BOX_KINDS.some((k) => k.id === i.type) ? (i.type as BoxKind) : d.type,
    volumeL: d.volumeL,
    tuneHz: d.tuneHz,
    frontVolumeL: d.frontVolumeL,
    portDiameterCm: d.portDiameterCm,
    powerW: d.powerW,
  };
  for (const k of Object.keys(BOX_RANGES) as BoxField[]) out[k] = num(i[k], BOX_RANGES[k], d[k]);
  return out;
}

export const driverOf = (d: Design): P.DriverSpec =>
  d.driverClass < CUSTOM_CLASS ? P.DRIVER_CLASSES[d.driverClass]! : P.customDriver(d.custom);

export const boxOf = (d: Design): P.BoxParams => ({
  driver: driverOf(d),
  type: d.type,
  volumeL: d.volumeL,
  tuneHz: d.tuneHz,
  frontVolumeL: d.frontVolumeL,
  hornThroatCm2: 600,
  hornMouthCm2: 4000,
  hornLengthM: 1,
});

export interface Point {
  responseDb: number;
  /** Peak cone excursion at the design's amp power. */
  excursionMm: number;
  impedanceOhm: number;
  phaseDeg: number;
  groupDelayMs: number;
}

export function evaluateAt(d: Design, f: number): Point {
  const box = boxOf(d);
  const z = P.boxImpedance(box, f);
  return {
    responseDb: P.dB(P.abs(P.boxResponse(box, f))),
    excursionMm: P.abs(P.boxDisplacement(box, f)) * P.peakVoltsForPower(d.powerW, box.driver.re) * 1000,
    impedanceOhm: P.abs(z),
    phaseDeg: P.phaseDeg(z),
    groupDelayMs: P.groupDelayS((x) => P.boxResponse(box, x), f) * 1000,
  };
}

export const F_MIN = 10;
export const F_MAX = 2000;
const N_POINTS = 280;
export const FREQS: readonly number[] = Array.from({ length: N_POINTS }, (_, k) => F_MIN * (F_MAX / F_MIN) ** (k / (N_POINTS - 1)));

export interface Readout {
  label: string;
  value: string;
}

export interface Computed {
  driver: P.DriverSpec;
  derived: P.DriverDerived;
  freqs: readonly number[];
  curves: Record<keyof Point, number[]>;
  readouts: Readout[];
  warnings: string[];
  /** Frequencies worth a marker on the plots (box resonance, tuning). */
  markers: { f: number; label: string }[];
}

const fmt = (v: number, digits = 1): string => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(digits));

/** Peak of a sampled curve and the band around it that stays within 3 dB of the peak (log-interpolated edges). */
export function passband(freqs: readonly number[], db: readonly number[]): { peakDb: number; peakHz: number; loHz: number; hiHz: number } {
  let k = 0;
  for (let i = 1; i < db.length; ++i) if (db[i]! > db[k]!) k = i;
  const edge = (step: -1 | 1): number => {
    const target = db[k]! - 3;
    for (let i = k; i + step >= 0 && i + step < db.length; i += step) {
      const a = db[i]!;
      const b = db[i + step]!;
      if (b < target) return freqs[i]! * (freqs[i + step]! / freqs[i]!) ** ((a - target) / (a - b));
    }
    return step < 0 ? freqs[0]! : freqs[freqs.length - 1]!;
  };
  return { peakDb: db[k]!, peakHz: freqs[k]!, loHz: edge(-1), hiHz: edge(1) };
}

export function compute(d: Design): Computed {
  const driver = driverOf(d);
  const derived = P.deriveDriver(driver);
  const points = FREQS.map((f) => evaluateAt(d, f));
  const curve = (k: keyof Point): number[] => points.map((p) => p[k]);
  const curves = { responseDb: curve('responseDb'), excursionMm: curve('excursionMm'), impedanceOhm: curve('impedanceOhm'), phaseDeg: curve('phaseDeg'), groupDelayMs: curve('groupDelayMs') };

  const readouts: Readout[] = [];
  const warnings: string[] = [];
  const markers: Computed['markers'] = [];
  const vb = d.volumeL / 1000;

  const port = (chamberL: number): void => {
    const lengthCm = P.portLengthM(chamberL / 1000, d.tuneHz, d.portDiameterCm / 100) * 100;
    readouts.push({ label: `Port length (${fmt(d.portDiameterCm)} cm round)`, value: lengthCm > 0 ? `${fmt(lengthCm)} cm` : 'does not fit' });
    if (lengthCm <= 0)
      warnings.push(`A ${fmt(d.portDiameterCm)} cm port cannot tune ${fmt(chamberL)} L to ${fmt(d.tuneHz)} Hz: the length comes out negative. Use a narrower port, a smaller chamber or a lower tuning.`);
    markers.push({ f: d.tuneHz, label: 'fb' });
  };

  if (d.type === 'sealed') {
    const s = P.sealedParams(driver.fs, derived.qts, driver.vasM3, vb);
    readouts.push({ label: 'Box resonance fc', value: `${fmt(s.fc)} Hz` }, { label: 'Qtc', value: s.qtc.toFixed(3) }, { label: 'F3', value: `${fmt(P.sealedF3(s.fc, s.qtc))} Hz` });
    markers.push({ f: s.fc, label: 'fc' });
  } else if (d.type === 'ported') {
    const f3 = P.ventedF3(driver.fs, derived.qts, driver.vasM3 / vb, d.tuneHz);
    readouts.push({ label: 'F3', value: f3 > 0 ? `${fmt(f3)} Hz` : 'none below 4 Fs' });
    port(d.volumeL);
  } else {
    const pb = passband(FREQS, curves.responseDb);
    readouts.push({ label: 'Peak', value: `${pb.peakDb >= 0 ? '+' : ''}${fmt(pb.peakDb)} dB at ${fmt(pb.peakHz)} Hz` }, { label: 'Passband (-3 dB from peak)', value: `${fmt(pb.loHz)} to ${fmt(pb.hiHz)} Hz` });
    port(d.frontVolumeL);
  }

  const xmaxMm = driver.xmax * 1000;
  let over = -1;
  curves.excursionMm.forEach((x, k) => {
    if (x > xmaxMm) over = k;
  });
  if (over >= 0) warnings.push(`At ${fmt(d.powerW)} W the cone exceeds Xmax (${fmt(xmaxMm)} mm) at some frequencies below ${fmt(FREQS[Math.min(over + 1, FREQS.length - 1)]!)} Hz.`);
  if (d.powerW > driver.pe) warnings.push(`${fmt(d.powerW)} W is above the driver's rated power (${fmt(driver.pe)} W).`);
  if (d.driverClass === CUSTOM_CLASS && d.custom.qms < d.custom.qts * 1.05)
    warnings.push(`Qms must be above Qts: it is treated as ${(d.custom.qts * 1.05).toFixed(2)} so Qes stays positive.`);

  return { driver, derived, freqs: FREQS, curves, readouts, warnings, markers };
}
