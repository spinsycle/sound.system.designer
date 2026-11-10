// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Absolute level, driver groups and limits (spec: "Absolute level, driver groups and limits").
import { type Cx, add, cx, mul } from './complex';
import { C, RHO } from './constants';
import { type DriverSpec, deriveDriver } from './drivers';

/** 0 dB SPL, Pa. */
export const P_REF = 20e-6;

/**
 * RMS pressure (Pa) at r metres in half space of the driver as a direct radiator in its passband, for `volts` RMS.
 * Every response G in this library is relative to this, so the pressure of a box is referencePressure x G.
 */
export function referencePressure(d: DriverSpec, volts: number, r = 1): number {
  const m = deriveDriver(d);
  return (RHO * d.sd * m.bl * volts) / (2 * Math.PI * r * d.re * m.mms);
}

export const splDb = (pressurePa: number): number => 20 * Math.log10(Math.abs(pressurePa) / P_REF);

/** Reference efficiency in half space (acoustic watts per electrical watt into Re). */
export function efficiency(d: DriverSpec): number {
  const m = deriveDriver(d);
  return (RHO * m.bl * m.bl * d.sd * d.sd) / (2 * Math.PI * C * m.mms * m.mms * d.re);
}

export interface Wiring {
  /** Load impedance = one driver's impedance x this. */
  loadFactor: number;
  /** Each driver's share of the amplifier voltage. */
  voltsFactor: number;
  /** Level against one driver at the full amplifier voltage: n coherent sources, each at 1/series of the voltage. */
  levelGainDb: number;
}

/** n identical drivers, `series` in each series string, the strings in parallel (series must divide n). */
export function wiring(n: number, series: number): Wiring {
  const parallel = n / series;
  return { loadFactor: series / parallel, voltsFactor: 1 / series, levelGainDb: 20 * Math.log10(n / series) };
}

/** Amplifier RMS voltage at which each driver dissipates its rated power in Re. */
export const thermalLimitVolts = (pe: number, re: number, series: number): number => series * Math.sqrt(pe * re);

/** Amplifier RMS voltage at which a sine reaches Xmax; xPerVolt is the largest |x/E| the band's signal can meet. */
export const excursionLimitVolts = (xmax: number, xPerVolt: number, series: number): number => (series * xmax) / (Math.SQRT2 * xPerVolt);

/** RMS voltage of an amplifier rated powerW into loadOhm. */
export const ampVolts = (powerW: number, loadOhm: number): number => Math.sqrt(powerW * loadOhm);

export interface BandPressure {
  /** Complex pressure of the band, Pa: everything but its delay. */
  pressure: Cx;
  delayS: number;
}

/** Complex sum of the bands' pressures, each turned by its delay. */
export function systemPressure(f: number, bands: readonly BandPressure[]): Cx {
  let sum = cx(0);
  for (const b of bands) {
    const phase = -2 * Math.PI * f * b.delayS;
    sum = add(sum, mul(b.pressure, cx(Math.cos(phase), Math.sin(phase))));
  }
  return sum;
}
