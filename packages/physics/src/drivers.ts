// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Drivers (spec: "Drivers"). SI units throughout a DriverSpec.
import { C, RHO, clamp } from './constants';

export interface DriverSpec {
  name: string;
  /** Free-air resonance, Hz. */
  fs: number;
  qes: number;
  qms: number;
  /** Equivalent compliance volume, m^3. */
  vasM3: number;
  /** Cone area, m^2. */
  sd: number;
  /** Voice-coil DC resistance, ohm. */
  re: number;
  /** One-way linear excursion, m. */
  xmax: number;
  /** Thermal power, W. */
  pe: number;
}

/** Generic classes: invented values, not any real product. The order matches the plugin's frozen class list. */
export const DRIVER_CLASSES: readonly DriverSpec[] = [
  { name: '10 in', fs: 45, qes: 0.55, qms: 5, vasM3: 0.025, sd: 0.033, re: 3.4, xmax: 0.006, pe: 200 },
  { name: '12 in', fs: 38, qes: 0.5, qms: 5, vasM3: 0.06, sd: 0.048, re: 3.4, xmax: 0.008, pe: 400 },
  { name: '15 in', fs: 32, qes: 0.45, qms: 6, vasM3: 0.14, sd: 0.0855, re: 3.4, xmax: 0.01, pe: 600 },
  { name: '18 in', fs: 28, qes: 0.4, qms: 6, vasM3: 0.28, sd: 0.123, re: 3.4, xmax: 0.012, pe: 900 },
  { name: '21 in', fs: 24, qes: 0.38, qms: 6, vasM3: 0.45, sd: 0.17, re: 3.4, xmax: 0.014, pe: 1200 },
  { name: '8 in', fs: 65, qes: 0.5, qms: 4, vasM3: 0.018, sd: 0.0215, re: 6.0, xmax: 0.004, pe: 150 },
  { name: '6.5 in', fs: 85, qes: 0.55, qms: 4, vasM3: 0.008, sd: 0.014, re: 6.0, xmax: 0.003, pe: 100 },
  { name: '1 in HF', fs: 700, qes: 0.3, qms: 3, vasM3: 0.000002, sd: 0.0008, re: 6.0, xmax: 0.0005, pe: 40 },
];

/**
 * Classes the app adds for home speakers (spec v0.11 and later), appended in a frozen order after the plugin's eight. App only:
 * the plugin and the parity cases know only DRIVER_CLASSES. Invented values, not any real product; a dome sits in a small
 * sealed chamber of its own, the planar tweeter is meant for open-baffle use (Qts 0.7).
 */
export const EXTRA_DRIVER_CLASSES: readonly DriverSpec[] = [
  { name: '3 in', fs: 140, qes: 0.7, qms: 3.5, vasM3: 0.0007, sd: 0.0033, re: 4.0, xmax: 0.002, pe: 20 },
  { name: '4 in', fs: 115, qes: 0.6, qms: 3.5, vasM3: 0.0018, sd: 0.0055, re: 4.0, xmax: 0.0025, pe: 40 },
  { name: '5.25 in', fs: 100, qes: 0.55, qms: 3.5, vasM3: 0.0035, sd: 0.0088, re: 4.0, xmax: 0.003, pe: 60 },
  { name: '3 in mid', fs: 180, qes: 0.7, qms: 3, vasM3: 0.0006, sd: 0.0033, re: 6.0, xmax: 0.0015, pe: 40 },
  { name: '4 in mid', fs: 150, qes: 0.65, qms: 3, vasM3: 0.0015, sd: 0.0055, re: 6.0, xmax: 0.002, pe: 50 },
  { name: '0.75 in dome', fs: 1400, qes: 1.0, qms: 3, vasM3: 0.0000075, sd: 0.00022, re: 4.0, xmax: 0.0004, pe: 20 },
  { name: '1 in dome', fs: 900, qes: 1.0, qms: 2.5, vasM3: 0.000025, sd: 0.0005, re: 4.0, xmax: 0.0005, pe: 40 },
  { name: '1.25 in dome', fs: 700, qes: 0.9, qms: 2.5, vasM3: 0.00005, sd: 0.0008, re: 6.0, xmax: 0.0006, pe: 50 },
  { name: 'Planar tweeter', fs: 1500, qes: 1.0, qms: 2.3, vasM3: 0.000006, sd: 0.0006, re: 4.0, xmax: 0.0005, pe: 30 },
  // car subwoofers (spec v0.12): Re is per voice coil; Qes, Pe and Xmax are the whole driver's. Generic invented values.
  { name: '8 in car sub', fs: 45, qes: 0.6, qms: 5, vasM3: 0.015, sd: 0.022, re: 3.6, xmax: 0.009, pe: 300 },
  { name: '10 in car sub', fs: 38, qes: 0.55, qms: 5, vasM3: 0.035, sd: 0.0335, re: 3.6, xmax: 0.012, pe: 500 },
  { name: '12 in car sub', fs: 32, qes: 0.5, qms: 5, vasM3: 0.05, sd: 0.049, re: 3.6, xmax: 0.014, pe: 800 },
  { name: '15 in car sub', fs: 28, qes: 0.45, qms: 5, vasM3: 0.12, sd: 0.085, re: 3.6, xmax: 0.016, pe: 1200 },
  { name: '10 in shallow sub', fs: 42, qes: 0.65, qms: 4, vasM3: 0.02, sd: 0.0335, re: 3.6, xmax: 0.013, pe: 400 },
  { name: '12 in shallow sub', fs: 36, qes: 0.6, qms: 4, vasM3: 0.035, sd: 0.049, re: 3.6, xmax: 0.015, pe: 600 },
  // car door, kick and dash speakers (spec v0.12): component woofers and coaxials; a coaxial's tweeter is built in, so its class is
  // the woofer's with the passband running to the top. Generic invented values.
  { name: '5.25 in door', fs: 70, qes: 0.8, qms: 3.5, vasM3: 0.006, sd: 0.0088, re: 3.6, xmax: 0.005, pe: 80 },
  { name: '6.5 in door', fs: 60, qes: 0.75, qms: 3.5, vasM3: 0.012, sd: 0.014, re: 3.6, xmax: 0.006, pe: 100 },
  { name: '6x9 door', fs: 55, qes: 0.7, qms: 3.5, vasM3: 0.02, sd: 0.021, re: 3.6, xmax: 0.007, pe: 120 },
  { name: '5.25 in coax', fs: 75, qes: 0.85, qms: 3.5, vasM3: 0.006, sd: 0.0088, re: 3.6, xmax: 0.005, pe: 70 },
  { name: '6.5 in coax', fs: 65, qes: 0.8, qms: 3.5, vasM3: 0.012, sd: 0.014, re: 3.6, xmax: 0.006, pe: 90 },
  { name: '6x9 coax', fs: 60, qes: 0.75, qms: 3.5, vasM3: 0.02, sd: 0.021, re: 3.6, xmax: 0.007, pe: 110 },
];

/** Every class the app offers: the plugin's eight, then the app's own. Indices are stored in projects, so only ever append. */
export const ALL_DRIVER_CLASSES: readonly DriverSpec[] = [...DRIVER_CLASSES, ...EXTRA_DRIVER_CLASSES];

export interface DriverDerived {
  qts: number;
  /** Suspension compliance, m/N. */
  cms: number;
  /** Moving mass, kg. */
  mms: number;
  /** Force factor, T m. */
  bl: number;
  /** Mechanical resistance, N s/m. */
  rms: number;
}

export function deriveDriver(d: DriverSpec): DriverDerived {
  const qts = 1 / (1 / d.qes + 1 / d.qms);
  const cms = d.vasM3 / (RHO * C * C * d.sd * d.sd);
  const ws = 2 * Math.PI * d.fs;
  const mms = 1 / (ws * ws * cms);
  return { qts, cms, mms, bl: Math.sqrt((ws * mms * d.re) / d.qes), rms: (ws * mms) / d.qms };
}

/** A user-entered driver in datasheet units (the plugin's eight Custom fields). */
export interface CustomDriverFields {
  fsHz: number;
  qts: number;
  qms: number;
  vasL: number;
  sdCm2: number;
  reOhm: number;
  xmaxMm: number;
  powerW: number;
}

/** Defaults equal the "12 in" class. */
export const CUSTOM_DRIVER_DEFAULTS: CustomDriverFields = {
  fsHz: 38,
  qts: 0.4545454545454546,
  qms: 5,
  vasL: 60,
  sdCm2: 480,
  reOhm: 3.4,
  xmaxMm: 8,
  powerW: 400,
};

/**
 * User-entered fields to a DriverSpec, with the plugin's engine clamps. Qes follows from Qts and Qms
 * (1/Qts = 1/Qes + 1/Qms); Qms is kept at least 1.05 Qts so Qes stays positive.
 */
export function customDriver(c: CustomDriverFields): DriverSpec {
  const qts = clamp(c.qts, 0.05, 3.0);
  const qms = Math.max(clamp(c.qms, 0.5, 50.0), qts * 1.05);
  return {
    name: 'Custom',
    fs: clamp(c.fsHz, 5.0, 500.0),
    qes: (qts * qms) / (qms - qts),
    qms,
    vasM3: clamp(c.vasL, 0.1, 5000.0) * 1e-3,
    sd: clamp(c.sdCm2, 1.0, 5000.0) * 1e-4,
    re: clamp(c.reOhm, 0.5, 64.0),
    xmax: clamp(c.xmaxMm, 0.1, 60.0) * 1e-3,
    pe: clamp(c.powerW, 1.0, 10000.0),
  };
}
