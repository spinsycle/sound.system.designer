// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Car audio (spec: "Car audio", v0.12, app only): cabin gain, dual-voice-coil wiring, bridging, and the 12 V electrical side.
import { ALPHA_CU } from './constants';
import { type Cx, cx, div, mul, scale } from './complex';
import { wiring } from './level';

export type CabinId = 'open' | 'coupe' | 'sedan' | 'suv' | 'truck' | 'van';
export interface CabinType {
  id: CabinId;
  label: string;
  /** Gain at the lowest frequencies, dB, and the corner it starts below, Hz. Rules of thumb, not measurements. */
  gainDb: number;
  cornerHz: number;
}

export const CABIN_TYPES: readonly CabinType[] = [
  { id: 'open', label: 'Open (no cabin gain)', gainDb: 0, cornerHz: 60 },
  { id: 'coupe', label: 'Coupe or hatchback', gainDb: 12, cornerHz: 70 },
  { id: 'sedan', label: 'Sedan, sub in the trunk', gainDb: 10, cornerHz: 60 },
  { id: 'suv', label: 'SUV or wagon', gainDb: 8, cornerHz: 50 },
  { id: 'truck', label: 'Truck cab', gainDb: 9, cornerHz: 65 },
  { id: 'van', label: 'Van', gainDb: 6, cornerHz: 40 },
];

export const cabinOf = (id: CabinId): CabinType => CABIN_TYPES.find((c) => c.id === id) ?? CABIN_TYPES[0]!;

/** Q of the cabin shelf: 1/sqrt(2). */
export const CABIN_Q = 1 / Math.SQRT2;

/**
 * Second-order low shelf (RBJ form, w0 = 2 pi fc): gainDb at DC, 0 dB at high frequency, exactly gainDb / 2 at fc.
 * H(s) = A (s^2 + (sqrt(A)/Q) s + A) / (A s^2 + (sqrt(A)/Q) s + 1), s normalised to w0, A = 10^(gainDb / 40).
 */
export function cabinShelf(f: number, gainDb: number, fcHz: number, q = CABIN_Q): Cx {
  const a = 10 ** (gainDb / 40);
  const s = cx(0, f / fcHz);
  const s2 = mul(s, s); // purely real: -(f/fc)^2
  const k = Math.sqrt(a) / q;
  return div(scale(cx(s2.re + a, k * s.im), a), cx(a * s2.re + 1, k * s.im));
}

export const cabinGain = (f: number, id: CabinId): Cx => {
  const c = cabinOf(id);
  return cabinShelf(f, c.gainDb, c.cornerHz);
};

export interface DvcDriver {
  /** Load as a multiple of one coil's Re. */
  loadFactor: number;
  /** Pressure at a given driver voltage as a multiple of a one-coil driver's. */
  levelFactor: number;
}

/** A driver with `coils` voice coils on one cone, `coilSeries` of them in each series string (strings in parallel). */
export function dvcDriver(coils: number, coilSeries: number): DvcDriver {
  return { loadFactor: (coilSeries * coilSeries) / coils, levelFactor: coils / coilSeries };
}

/** n identical drivers of `coils` coils each, wired as `wiring(n, series)`, each driver wired as `dvcDriver`. */
export function carWiring(n: number, series: number, coils: number, coilSeries: number): { loadFactor: number; levelGainDb: number } {
  const d = dvcDriver(coils, coilSeries);
  const w = wiring(n, series);
  return { loadFactor: d.loadFactor * w.loadFactor, levelGainDb: 20 * Math.log10((d.levelFactor * n) / series) };
}

/** Swing of two channels bridged, each rated powerW into loadOhm: twice the channel's. */
export const bridgedVolts = (powerW: number, loadOhm: number): number => 2 * Math.sqrt(powerW * loadOhm);
/** A bridged amp's lowest load is twice the channel's. */
export const bridgedMinLoad = (channelMinLoadOhm: number): number => 2 * channelMinLoadOhm;

/** Supply current for an amp putting powerW into its load at the given efficiency from a supply of `volts`. */
export const ampCurrent = (powerW: number, efficiency: number, volts: number): number => powerW / (efficiency * volts);

/** Average supply current on music: the rated power scaled by the average-to-rated power ratio `duty`. */
export const musicCurrent = (powerW: number, efficiency: number, volts: number, duty: number): number => ampCurrent(powerW * duty, efficiency, volts);

/** Copper cross-section of an American wire gauge number, mm2 (0 is 1/0). */
export function awgAreaMm2(awg: number): number {
  const d = 0.127 * 92 ** ((36 - awg) / 39);
  return (Math.PI * d * d) / 4;
}

/** Copper resistivity at 20 C, ohm m. */
export const CU_RHO = 1.68e-8;

export const wireResistance = (awg: number, lengthM: number, tempC = 20): number => (CU_RHO * (1 + ALPHA_CU * (tempC - 20)) * lengthM) / (awgAreaMm2(awg) * 1e-6);

/** Volts lost in the power cable and the ground return (the same gauge and length each way). */
export const wireDropVolts = (amps: number, awg: number, lengthM: number, tempC = 20): number => amps * 2 * wireResistance(awg, lengthM, tempC);

export const FUSES: readonly number[] = [5, 7.5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 100, 125, 150, 175, 200, 250, 300, 400];

/** Smallest standard fuse that carries 1.25 x the current; beyond 400 A the next 100 A. */
export function fuseAmps(amps: number): number {
  const need = 1.25 * amps;
  const f = FUSES.find((x) => x >= need);
  return f ?? Math.ceil(need / 100) * 100;
}

/** Thinnest gauge (largest number, from 20 down to 0) whose cable and ground return lose no more than maxDropFrac of `volts`; -1 if none does. */
export function minAwg(amps: number, lengthM: number, volts: number, maxDropFrac: number): number {
  for (let awg = 20; awg >= 0; awg--) if (wireDropVolts(amps, awg, lengthM) <= maxDropFrac * volts) return awg;
  return -1;
}
