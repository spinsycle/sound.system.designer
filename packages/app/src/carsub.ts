// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// A car subwoofer install: one or more identical subs (single or dual voice coil) in one enclosure, an amplifier (optionally
// bridged), a vehicle cabin, and the space the enclosure has to fit. Pure functions; the page draws what computeCarSub returns.
// Spec: "Car audio" (v0.12) and "Loudspeaker cabinets" (group volume).
import * as P from '@soundsystemdesigner/physics';
import { type BuildOpts, DEFAULT_BUILD, sanitizeBuild } from './build';
import { type CarFront, DEFAULT_FRONT, checkFront, frontPressures, sanitizeFront } from './carfront';
import { BOX_RANGES, DEFAULT_DESIGN, type Design, type Range, REF_VOLTS, driverOf, rawEvaluator, sanitize } from './model';

export type CarBoxShape = 'box' | 'wedge';
export type AmpClass = 'd' | 'ab';

export interface VehicleSpace {
  id: string;
  label: string;
  /** Largest outside width, height and depth (bottom depth for a wedge) the enclosure may have, cm. 0: no limit. */
  wCm: number;
  hCm: number;
  dCm: number;
}

/** Generic vehicle spaces, in rough sizes: a starting point to edit, not a claim about any model of car. */
export const SPACES: readonly VehicleSpace[] = [
  { id: 'none', label: 'No limit', wCm: 0, hCm: 0, dCm: 0 },
  { id: 'trunk-compact', label: 'Trunk, compact car', wCm: 90, hCm: 45, dCm: 45 },
  { id: 'trunk-full', label: 'Trunk, full-size car', wCm: 110, hCm: 55, dCm: 55 },
  { id: 'hatch', label: 'Hatchback or SUV cargo floor', wCm: 100, hCm: 45, dCm: 60 },
  { id: 'under-seat', label: 'Under a seat', wCm: 60, hCm: 14, dCm: 30 },
  { id: 'under-seat-flat', label: 'Under a seat, firing up or down', wCm: 60, hCm: 30, dCm: 14 },
  { id: 'behind-seat', label: 'Behind the seat of a truck cab', wCm: 120, hCm: 35, dCm: 25 },
  { id: 'custom', label: 'Custom size', wCm: 80, hCm: 40, dCm: 40 },
];

export const spaceOf = (id: string): VehicleSpace => SPACES.find((s) => s.id === id) ?? SPACES[0]!;

/** Mounting depth of each car sub class (the depth the driver needs behind the baffle), cm. Generic estimates. */
export const MOUNT_DEPTH_CM: Record<string, number> = {
  '8 in car sub': 10,
  '10 in car sub': 12,
  '12 in car sub': 14,
  '15 in car sub': 17,
  '10 in shallow sub': 8,
  '12 in shallow sub': 9,
};
/** What a driver needs when its class is not listed (a PA class or a custom driver): none is assumed. */
export const mountDepthCm = (name: string): number => MOUNT_DEPTH_CM[name] ?? 0;

export const CAR_AMP_LOADS: readonly number[] = [0.5, 1, 2, 4, 8];
export const CAR_AMP_MIN_LOADS: readonly number[] = [0.5, 1, 2, 4];

export interface CarSub {
  cabin: P.CabinId;
  /** One driver type in one box: `volumeL` is the air of the whole enclosure, shared by `count` drivers. */
  design: Design;
  count: number;
  /** Drivers in each series string (divides count). */
  series: number;
  /** Voice coils per driver (1 or 2) and coils per series string inside each driver. */
  coils: number;
  coilSeries: number;
  ampPowerW: number;
  ampLoadOhm: number;
  ampMinLoadOhm: number;
  /** Two channels bridged: the amp's rating is per channel. */
  bridged: boolean;
  /** Lowest frequency the install is asked to play (a subsonic filter), Hz: the cone's worst case is taken from here up. */
  subsonicHz: number;
  /** The front speakers (door, kick or dash), summed with the sub when enabled. */
  front: CarFront;
  /** The 12 V side: amplifier class, supply voltage, the power cable (gauge and length, the ground return the same), the music duty, the alternator and the car's own loads. */
  ampClass: AmpClass;
  supplyV: number;
  cableAwg: number;
  cableM: number;
  duty: number;
  alternatorA: number;
  otherLoadsA: number;
  space: { id: string; wCm: number; hCm: number; dCm: number };
  shape: CarBoxShape;
  /** Top depth / bottom depth of a wedge, in (0, 1]. */
  taper: number;
  build: BuildOpts;
}

export type CarField = 'ampPowerW' | 'subsonicHz' | 'taper' | 'supplyV' | 'cableM' | 'alternatorA' | 'otherLoadsA';
export const CAR_RANGES: Record<CarField, Range> = {
  ampPowerW: { label: 'Amp power', unit: 'W', min: 50, max: 20000 },
  subsonicHz: { label: 'Subsonic filter', unit: 'Hz', min: 10, max: 60, linear: true },
  taper: { label: 'Top depth / bottom depth', unit: '', min: 0.15, max: 1, linear: true },
  supplyV: { label: 'Supply voltage', unit: 'V', min: 10, max: 15.5, linear: true },
  cableM: { label: 'Cable length', unit: 'm', min: 0.5, max: 15, linear: true },
  alternatorA: { label: 'Alternator', unit: 'A', min: 30, max: 400, linear: true },
  otherLoadsA: { label: 'The car\u2019s other loads', unit: 'A', min: 0, max: 200, linear: true },
};
export const CAR_COUNT_RANGE: Range = { label: 'Subs', unit: '', min: 1, max: 4, linear: true };
export const SPACE_RANGES: Record<'wCm' | 'hCm' | 'dCm', Range> = {
  wCm: { label: 'Space width', unit: 'cm', min: 10, max: 300 },
  hCm: { label: 'Space height', unit: 'cm', min: 5, max: 200 },
  dCm: { label: 'Space depth', unit: 'cm', min: 5, max: 200 },
};

const classIndex = (name: string): number => P.ALL_DRIVER_CLASSES.findIndex((d) => d.name === name);

export const DEFAULT_CAR: CarSub = {
  cabin: 'sedan',
  design: sanitize({ ...DEFAULT_DESIGN, driverClass: classIndex('12 in car sub'), type: 'sealed', volumeL: 40, plotRange: 'low' }),
  count: 1,
  series: 1,
  coils: 2,
  coilSeries: 1,
  ampPowerW: 200,
  ampLoadOhm: 1,
  ampMinLoadOhm: 1,
  bridged: false,
  subsonicHz: 25,
  front: DEFAULT_FRONT,
  ampClass: 'd',
  supplyV: 13.8,
  cableAwg: 4,
  cableM: 5,
  duty: 0.125,
  alternatorA: 120,
  otherLoadsA: 40,
  space: { id: 'trunk-compact', ...pick(spaceOf('trunk-compact')) },
  shape: 'box',
  taper: 0.5,
  build: { ...DEFAULT_BUILD, rw: 1.8, rh: 1, rd: 1 },
};

function pick(s: VehicleSpace): { wCm: number; hCm: number; dCm: number } {
  return { wCm: s.wCm, hCm: s.hCm, dCm: s.dCm };
}

const num = (v: unknown, r: Range, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? P.clamp(v, r.min, r.max) : fallback);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** n drivers in series strings of `series`: the series count divides n, else everything is parallel. */
function groupOf(count: unknown, series: unknown): { count: number; series: number } {
  const n = typeof count === 'number' && Number.isInteger(count) ? P.clamp(count, CAR_COUNT_RANGE.min, CAR_COUNT_RANGE.max) : DEFAULT_CAR.count;
  const s = typeof series === 'number' && Number.isInteger(series) && series >= 1 && n % series === 0 ? series : 1;
  return { count: n, series: s };
}

/** Any stored value to a valid CarSub: unknown fields dropped, numbers clamped, wiring made consistent. */
export function sanitizeCar(input: unknown): CarSub {
  const i = obj(input);
  const d = DEFAULT_CAR;
  const g = groupOf(i.count, i.series);
  const coils = i.coils === 1 ? 1 : 2;
  const coilSeries = coils === 2 && i.coilSeries === 2 ? 2 : 1;
  const sp = obj(i.space);
  const base = spaceOf(typeof sp.id === 'string' ? sp.id : d.space.id);
  const custom = base.id === 'custom';
  const space = {
    id: base.id,
    wCm: custom ? num(sp.wCm, SPACE_RANGES.wCm, base.wCm) : base.wCm,
    hCm: custom ? num(sp.hCm, SPACE_RANGES.hCm, base.hCm) : base.hCm,
    dCm: custom ? num(sp.dCm, SPACE_RANGES.dCm, base.dCm) : base.dCm,
  };
  const design = i.design === undefined ? d.design : sanitize(i.design);
  return {
    cabin: P.CABIN_TYPES.some((c) => c.id === i.cabin) ? (i.cabin as P.CabinId) : d.cabin,
    design,
    ...g,
    coils,
    coilSeries,
    ampPowerW: num(i.ampPowerW, CAR_RANGES.ampPowerW, d.ampPowerW),
    ampLoadOhm: CAR_AMP_LOADS.includes(i.ampLoadOhm as number) ? (i.ampLoadOhm as number) : d.ampLoadOhm,
    ampMinLoadOhm: CAR_AMP_MIN_LOADS.includes(i.ampMinLoadOhm as number) ? (i.ampMinLoadOhm as number) : d.ampMinLoadOhm,
    bridged: i.bridged === true,
    subsonicHz: num(i.subsonicHz, CAR_RANGES.subsonicHz, d.subsonicHz),
    front: sanitizeFront(i.front),
    ampClass: i.ampClass === 'ab' ? 'ab' : 'd',
    supplyV: num(i.supplyV, CAR_RANGES.supplyV, d.supplyV),
    cableAwg: CABLE_AWGS.includes(i.cableAwg as number) ? (i.cableAwg as number) : d.cableAwg,
    cableM: num(i.cableM, CAR_RANGES.cableM, d.cableM),
    duty: MUSIC_DUTIES.some((m) => m.value === i.duty) ? (i.duty as number) : d.duty,
    alternatorA: num(i.alternatorA, CAR_RANGES.alternatorA, d.alternatorA),
    otherLoadsA: num(i.otherLoadsA, CAR_RANGES.otherLoadsA, d.otherLoadsA),
    space,
    shape: i.shape === 'wedge' ? 'wedge' : 'box',
    taper: num(i.taper, CAR_RANGES.taper, d.taper),
    build: sanitizeBuild(i.build ?? d.build),
  };
}

/** The sub chosen as a class of its own and its box, keeping the install around it. */
export const withDesign = (c: CarSub, patch: Partial<Design>): CarSub => sanitizeCar({ ...c, design: { ...c.design, ...patch } });

/**
 * A port for a sub: tuned at Fs (Vas / Vb)^0.31 for each sub's share of the air, with the diameter that gives a tube of
 * `targetLengthM` (default 20 cm), within 4 to 25 cm across. A sub's port is sized by its length, not by half the cone: half the
 * cone of a 12 in would be 12 cm across and most of a metre long.
 */
export function carPortedDefaults(d: Design, count = 1, targetLengthM = 0.2): Pick<Design, 'tuneHz' | 'portDiameterCm'> {
  const driver = driverOf(d);
  const each = d.volumeL / 1000 / Math.max(count, 1);
  const tune = P.clamp(Math.round(driver.fs * (driver.vasM3 / each) ** 0.31), BOX_RANGES.tuneHz.min, BOX_RANGES.tuneHz.max);
  // L = k d^2 - 0.732 d with k = c^2 pi / (16 pi^2 fb^2 V) per metre squared: solve for d
  const k = P.C ** 2 / (16 * Math.PI * tune ** 2 * each);
  const dM = (0.732 + Math.sqrt(0.732 ** 2 + 4 * k * targetLengthM)) / (2 * k);
  return { tuneHz: tune, portDiameterCm: P.clamp(Math.round(dM * 1000) / 10, 4, 25) };
}

export const CAR_FREQS: readonly number[] = Array.from({ length: 240 }, (_, k) => 10 * 50 ** (k / 239));
/** Top of the range averaged for a sub's level, Hz. */
const TOP_HZ = 120;
const LOW_HZ = 25;

const fmt = (v: number, digits = 1): string => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(digits));

/**
 * The install as functions of frequency, set up once. Level is the pressure at 1 m in half space for REF_VOLTS at the amplifier, with the
 * cabin's gain on top. Each of the `count` drivers is in V / count of the enclosure's air.
 */
export function carEvaluator(c: CarSub) {
  const d = c.design;
  const driver = driverOf(d);
  const each: Design = { ...d, volumeL: P.groupVolumeM3(d.volumeL, c.count), frontVolumeL: P.groupVolumeM3(d.frontVolumeL, c.count) };
  const raw = rawEvaluator(each);
  const wiring = P.carWiring(c.count, c.series, c.coils, c.coilSeries);
  const dvc = P.dvcDriver(c.coils, c.coilSeries);
  const pRef = P.referencePressure(driver, REF_VOLTS) * 10 ** (wiring.levelGainDb / 20);
  const free = (f: number): P.Cx => P.scale(raw(f).g, pRef);
  const inCar = (f: number): P.Cx => P.mul(free(f), P.cabinGain(f, c.cabin));
  return { driver, raw, wiring, dvc, free, inCar };
}

export type CarLimitCause = 'amp' | 'heat' | 'excursion';

export interface CarLimits {
  /** The amplifier's full voltage (bridged: twice a channel's) and the power it makes into this load. */
  ampV: number;
  ampIntoLoadW: number;
  heatV: number;
  excursionV: number;
  limitV: number;
  cause: CarLimitCause;
  /** Lowest load the install presents over the band, ohm, and the lowest the amp accepts (bridged: twice the channel's). */
  minLoadOhm: number;
  amplifierMinLoadOhm: number;
  /** Average in-car level at the limit, dB SPL, and the headroom above the reference input, dB. */
  maxDb: number;
  headroomDb: number;
}

export interface CarView {
  freqs: readonly number[];
  /** In-car level (cabin gain included) and the free-field level without it, dB SPL at REF_VOLTS. */
  levelDb: number[];
  freeDb: number[];
  cabinDb: number[];
  /** Average in-car level from 25 to 120 Hz at the reference input. */
  averageDb: number;
  limits: CarLimits;
  loadOhm: number;
  warnings: string[];
  notes: string[];
}

export function computeCarSub(c: CarSub): CarView {
  const ev = carEvaluator(c);
  const floor = (pa: number): number => P.splDb(Math.max(pa, 1e-12));
  const freqs = CAR_FREQS;
  const levelDb = freqs.map((f) => floor(P.abs(ev.inCar(f))));
  const freeDb = freqs.map((f) => floor(P.abs(ev.free(f))));
  const cabinDb = freqs.map((f) => P.dB(P.abs(P.cabinGain(f, c.cabin))));
  const span = levelDb.filter((_, i) => freqs[i]! >= LOW_HZ && freqs[i]! <= TOP_HZ);
  const averageDb = span.reduce((a, b) => a + b, 0) / span.length;

  const driver = ev.driver;
  const ampV = c.bridged ? P.bridgedVolts(c.ampPowerW, c.ampLoadOhm) : P.ampVolts(c.ampPowerW, c.ampLoadOhm);
  const reEff = driver.re * ev.dvc.loadFactor;
  const heatV = P.thermalLimitVolts(driver.pe, reEff, c.series);
  // the cone meets what the install plays from the subsonic filter up; per driver volt a dual coil moves the cone by its level factor
  const worstX = Math.max(...[c.subsonicHz, ...freqs.filter((f) => f > c.subsonicHz && f <= TOP_HZ * 2)].map((f) => P.abs(ev.raw(f).x) * ev.dvc.levelFactor));
  const excursionV = P.excursionLimitVolts(driver.xmax, worstX, c.series);
  const limitV = Math.min(ampV, heatV, excursionV);
  const band = [c.subsonicHz, ...freqs.filter((f) => f > c.subsonicHz && f <= TOP_HZ)];
  const minLoadOhm = Math.min(...band.map((f) => P.abs(ev.raw(f).z))) * ev.wiring.loadFactor;
  const nominalLoad = driver.re * ev.wiring.loadFactor;
  const limits: CarLimits = {
    ampV,
    ampIntoLoadW: (ampV * ampV) / nominalLoad,
    heatV,
    excursionV,
    limitV,
    cause: limitV === ampV ? 'amp' : limitV === heatV ? 'heat' : 'excursion',
    minLoadOhm,
    amplifierMinLoadOhm: c.bridged ? P.bridgedMinLoad(c.ampMinLoadOhm) : c.ampMinLoadOhm,
    maxDb: averageDb + 20 * Math.log10(limitV / REF_VOLTS),
    headroomDb: 20 * Math.log10(limitV / REF_VOLTS),
  };

  const warnings: string[] = [];
  const notes: string[] = [];
  if (limits.minLoadOhm < limits.amplifierMinLoadOhm)
    warnings.push(`The load falls to ${fmt(limits.minLoadOhm)} Ω, under the amp's ${fmt(limits.amplifierMinLoadOhm)} Ω minimum${c.bridged ? ' (bridged: twice a channel’s)' : ''}. Wire the coils or the subs differently.`);
  if (limits.ampV > limits.heatV)
    warnings.push(`At full power the amp puts ${fmt((limits.ampV / c.series) ** 2 / reEff, 0)} W into each driver, rated ${fmt(driver.pe, 0)} W.`);
  if (limits.ampV > limits.excursionV)
    warnings.push(`At full power the cone passes Xmax (${fmt(driver.xmax * 1000)} mm). It gets there at ${fmt(limits.excursionV)} V, about ${fmt(limits.excursionV ** 2 / nominalLoad, 0)} W. Raise the subsonic filter, tune a ported box lower or use a driver with more Xmax.`);
  const wire = ev.wiring;
  if (c.coils === 1 && c.coilSeries !== 1) warnings.push('A single-coil driver has no coils to wire in series.');
  notes.push(`Levels are for ${REF_VOLTS} V at the amplifier output, at 1 m in half space, with the ${P.cabinOf(c.cabin).label.toLowerCase()} cabin gain (${P.cabinOf(c.cabin).gainDb} dB below ${P.cabinOf(c.cabin).cornerHz} Hz) added. The cabin gain is a generic rule of thumb, not a measurement of your car.`);
  notes.push(`Wiring: ${c.count > 1 ? `${c.count} subs, ${c.series === 1 ? 'in parallel' : c.series === c.count ? 'in series' : `${c.series} in series per string`}; ` : ''}${c.coils === 2 ? `dual coils ${c.coilSeries === 2 ? 'in series' : 'in parallel'}; ` : ''}the amplifier sees ${fmt(driver.re * wire.loadFactor)} Ω nominal.`);
  notes.push('Limits are for a steady sine and ignore power compression, the amplifier’s supply and its clipping: treat them as ceilings.');
  return { freqs, levelDb, freeDb, cabinDb, averageDb, limits, loadOhm: nominalLoad, warnings, notes };
}

export interface CarSystemView {
  freqs: readonly number[];
  /** The whole system in the car: the sub and the fronts through their crossover legs, with the cabin gain, dB SPL at REF_VOLTS. */
  totalDb: number[];
  /** Each part through its leg and trim, in the car. */
  subDb: number[];
  wooferDb: number[];
  /** Null for a coaxial. */
  tweeterDb: number[] | null;
  /** The crossover points in use (sub / front, then woofer / tweeter), Hz. */
  xover: number[];
  warnings: string[];
}

/**
 * The sub and the front speakers as one system: a Linkwitz-Riley network (sub, front woofer, tweeter) with the fronts' trims, summed
 * as complex pressure, then the cabin gain. Two speakers play at the front: a pair is 6 dB louder than one at 1 m, which is taken
 * into the trim by the user (the levels here are for one speaker, like every other level in the app).
 */
export function computeCarSystem(c: CarSub): CarSystemView {
  const f = c.front;
  const sub = carEvaluator(c);
  const fp = frontPressures(f);
  const points = f.type === 'component' ? [f.xoverSubHz, f.xoverTweeterHz] : [f.xoverSubHz];
  const xs = P.effectiveCrossovers(points, points.length + 1);
  const gain = (db: number): number => 10 ** (db / 20);
  const floor = (pa: number): number => P.splDb(Math.max(pa, 1e-12));
  const legs = (fr: number): P.Cx[] => P.crossoverBands(fr, xs);
  const subP = (fr: number): P.Cx => P.mul(legs(fr)[0]!, sub.free(fr));
  const wooferP = (fr: number): P.Cx => P.scale(P.mul(legs(fr)[1]!, fp.woofer(fr)), gain(f.trimDb));
  const tweeterP = (fr: number): P.Cx => (fp.tweeter ? P.scale(P.mul(legs(fr)[2]!, fp.tweeter(fr)), gain(f.trimDb + f.tweeterTrimDb)) : P.cx(0));
  const cab = (fr: number): P.Cx => P.cabinGain(fr, c.cabin);
  const freqs = CAR_FREQS_WIDE;
  const inCar = (p: (fr: number) => P.Cx): number[] => freqs.map((fr) => floor(P.abs(P.mul(p(fr), cab(fr)))));
  const totalDb = freqs.map((fr) => floor(P.abs(P.mul(P.systemPressure(fr, [{ pressure: subP(fr), delayS: 0 }, { pressure: wooferP(fr), delayS: 0 }, { pressure: tweeterP(fr), delayS: 0 }]), cab(fr)))));
  const warnings = f.enabled ? checkFront(f).warnings : [];
  return { freqs, totalDb, subDb: inCar(subP), wooferDb: inCar(wooferP), tweeterDb: fp.tweeter ? inCar(tweeterP) : null, xover: xs, warnings };
}

/** The wide frequency axis of the system plot, Hz: the sub's bass to the top of the tweeter. */
export const CAR_FREQS_WIDE: readonly number[] = Array.from({ length: 320 }, (_, k) => 20 * 1000 ** (k / 319));

/**
 * Bring the fronts' level to the sub's: the front trim makes the front woofer's average from 200 Hz to 2 kHz equal the sub's average
 * from 25 to 120 Hz, and a component set's tweeter trim makes the tweeter's average from 4 to 12 kHz equal the woofer's (a dome is a
 * few dB more efficient than a woofer, which would otherwise stick out as a step at the top).
 */
export function levelFront(c: CarSub): CarSub {
  const sub = computeCarSub(c).averageDb;
  const fp = frontPressures(c.front);
  const mean = (p: (fr: number) => P.Cx, lo: number, hi: number): number => {
    const xs = CAR_FREQS_WIDE.filter((fr) => fr >= lo && fr <= hi).map((fr) => P.splDb(P.abs(p(fr))));
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };
  const front = mean(fp.woofer, 200, 2000);
  const tweeterTrimDb = fp.tweeter ? Math.round((front - mean(fp.tweeter, 4000, 12000)) * 10) / 10 + 0 : 0;
  return sanitizeCar({ ...c, front: { ...c.front, trimDb: Math.round((sub - front) * 10) / 10 + 0, tweeterTrimDb } });
}

/** Amplifier efficiency by class: rules of thumb (class D about 0.8 to 0.9, class AB about 0.5 to 0.65), not a measurement. */
export const AMP_EFFICIENCY: Record<AmpClass, number> = { d: 0.85, ab: 0.6 };
/** Cable gauges the page offers, thickest first. */
export const CABLE_AWGS: readonly number[] = [0, 2, 4, 6, 8, 10, 12];
/** Average-to-rated power on music: loud and compressed, typical, dynamic. */
export const MUSIC_DUTIES: readonly { value: number; label: string }[] = [
  { value: 0.25, label: 'Loud, compressed music (a quarter of rated power)' },
  { value: 0.125, label: 'Typical music (an eighth)' },
  { value: 0.0625, label: 'Dynamic music (a sixteenth)' },
];
/** The most the power cable and the ground return may drop, as a share of the supply voltage. */
export const MAX_DROP_FRAC = 0.03;

export interface CarElectric {
  /** Power the amp makes into this install's load at full output, W (it can differ from the rating), and the current that takes. */
  powerW: number;
  peakA: number;
  /** Music-average current, A, and the alternator's headroom over it and the car's own loads, A. */
  musicA: number;
  alternatorMarginA: number;
  /** Cable and ground return: volts lost at the peak current, their share of the supply, and the thinnest gauge within the budget (-1: none). */
  dropV: number;
  dropFrac: number;
  minAwg: number;
  /** The fuse at the battery, A. */
  fuseA: number;
  warnings: string[];
}

/** The 12 V side of the install: what the amp draws, what the cable loses, which fuse, and whether the alternator keeps up. */
export function computeCarElectric(c: CarSub, limits: CarLimits): CarElectric {
  const eff = AMP_EFFICIENCY[c.ampClass];
  const powerW = limits.ampIntoLoadW;
  const peakA = P.ampCurrent(powerW, eff, c.supplyV);
  const musicA = P.musicCurrent(powerW, eff, c.supplyV, c.duty);
  const dropV = P.wireDropVolts(peakA, c.cableAwg, c.cableM);
  const dropFrac = dropV / c.supplyV;
  const thin = P.minAwg(peakA, c.cableM, c.supplyV, MAX_DROP_FRAC);
  const fuseA = P.fuseAmps(peakA);
  const alternatorMarginA = c.alternatorA - c.otherLoadsA - musicA;
  const warnings: string[] = [];
  if (dropFrac > MAX_DROP_FRAC + 1e-12)
    warnings.push(
      `The ${c.cableAwg} AWG cable and ground return lose ${fmt(dropV, 2)} V (${fmt(dropFrac * 100)} % of ${fmt(c.supplyV)} V) at ${fmt(peakA, 0)} A over ${fmt(c.cableM)} m. ${thin >= 0 ? `Use ${thin} AWG or thicker, or a shorter run, to stay within ${fmt(MAX_DROP_FRAC * 100, 0)} %.` : `Even 0 AWG loses more than ${fmt(MAX_DROP_FRAC * 100, 0)} % over this length: shorten the run.`}`,
    );
  if (alternatorMarginA < 0)
    warnings.push(`On music the amp draws about ${fmt(musicA)} A on average and the car's own loads ${fmt(c.otherLoadsA, 0)} A: more than the ${fmt(c.alternatorA, 0)} A alternator makes, by ${fmt(-alternatorMarginA)} A. The battery covers it for a while; a bigger alternator or a second battery is the cure.`);
  return { powerW, peakA, musicA, alternatorMarginA, dropV, dropFrac, minAwg: thin, fuseA, warnings };
}
