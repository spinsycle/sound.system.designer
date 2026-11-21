// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The crossover page's model: up to four drivers, an alignment, active circuits or passive networks, and the summed response, polarity,
// time alignment, impedance and warnings that follow. Pure functions; CrossoverView draws what computeCrossover returns.
// Spec: "Crossover filters", "Active crossover circuits", "Driver load model", "Passive crossover networks", "Crossover optimiser".
import * as P from '@soundsystemdesigner/physics';
import type { Range } from './model';

export const ROLES = ['sub', 'woofer', 'mid', 'tweeter'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = { sub: 'Subwoofer', woofer: 'Woofer', mid: 'Midrange', tweeter: 'Tweeter' };
export const MAX_WAYS = 4;
export const SERIES = ['none', 'E24', 'E96'] as const;
export type SeriesChoice = (typeof SERIES)[number];
export const WIRINGS = ['auto', 'normal', 'reversed'] as const;
export type Wiring = (typeof WIRINGS)[number];
/** Most points kept of an imported curve: more are thinned to this many, log-spaced. */
export const MAX_STORED_POINTS = 500;

/** A measured curve kept with the project: frequency, impedance in ohm or level in dB, optional phase in degrees (unwrapped). */
export interface Curve {
  name: string;
  freqHz: number[];
  mag: number[];
  phaseDeg: number[] | null;
}

export interface XoDriver {
  name: string;
  role: Role;
  /** The nominal impedance the passive network is designed for. */
  nomOhm: number;
  reOhm: number;
  leMh: number;
  /** Low corner and its Q (a second-order high-pass in the acoustic response) and the mechanical Q for the impedance peak. */
  fsHz: number;
  qts: number;
  qms: number;
  /** Level at 2.83 V and 1 m, dB SPL. */
  sensDb: number;
  /** Where the response rolls off at 6 dB per octave; 0 for no roll-off. */
  upperHz: number;
  /** How far the acoustic centre sits behind the front plane, mm. */
  setBackMm: number;
  /** Level taken off this way: an L-pad (passive) or a gain (active), dB. */
  padDb: number;
  wiring: Wiring;
  zma: Curve | null;
  frd: Curve | null;
}

export interface Tuned {
  /** What the optimised values belong to; they are ignored when the design has changed since. */
  sig: string;
  values: number[][];
}

export interface XoState {
  mode: 'active' | 'passive';
  ways: number;
  drivers: XoDriver[];
  xover: number[];
  alignment: P.Alignment;
  order: number;
  rippleDb: number;
  topology: P.Topology;
  capNf: number;
  series: SeriesChoice;
  zobel: boolean;
  dcr: boolean;
  ampPowerW: number;
  ampMinLoadOhm: number;
  /** Active only: delay the drivers in front so every driver's sound arrives together. */
  alignDelay: boolean;
  tuned: Tuned | null;
}

export type XoField =
  | 'nomOhm' | 'reOhm' | 'leMh' | 'fsHz' | 'qts' | 'qms' | 'sensDb' | 'upperHz' | 'setBackMm' | 'padDb'
  | 'xover' | 'order' | 'rippleDb' | 'capNf' | 'ampPowerW' | 'ampMinLoadOhm';
export const XO_RANGES: Record<XoField, Range> = {
  nomOhm: { label: 'Nominal impedance', unit: 'Ω', min: 1, max: 64 },
  reOhm: { label: 'Voice-coil resistance', unit: 'Ω', min: 0.5, max: 64 },
  leMh: { label: 'Voice-coil inductance', unit: 'mH', min: 0, max: 100, linear: true },
  fsHz: { label: 'Low corner (Fs)', unit: 'Hz', min: 5, max: 20000 },
  qts: { label: 'Q at the low corner', unit: '', min: 0.1, max: 3 },
  qms: { label: 'Mechanical Q (Qms)', unit: '', min: 0.5, max: 50 },
  sensDb: { label: 'Level at 2.83 V, 1 m', unit: 'dB', min: 60, max: 130, linear: true },
  upperHz: { label: 'Rolls off above (0 = never)', unit: 'Hz', min: 0, max: 40000, linear: true },
  setBackMm: { label: 'Set back', unit: 'mm', min: 0, max: 300, linear: true },
  padDb: { label: 'Level down', unit: 'dB', min: 0, max: 30, linear: true },
  xover: { label: 'Crossover', unit: 'Hz', min: 20, max: 16000 },
  order: { label: 'Order', unit: '', min: 1, max: P.MAX_ORDER, linear: true },
  rippleDb: { label: 'Chebyshev ripple', unit: 'dB', min: P.RIPPLE_MIN_DB, max: P.RIPPLE_MAX_DB },
  capNf: { label: 'Base capacitor', unit: 'nF', min: 1, max: 1000 },
  ampPowerW: { label: 'Amplifier power', unit: 'W', min: 1, max: 20000 },
  ampMinLoadOhm: { label: 'Amplifier minimum load', unit: 'Ω', min: 1, max: 16 },
};

/** Starting values by role: generic, invented, to edit. */
export const ROLE_DEFAULTS: Record<Role, Omit<XoDriver, 'name' | 'role' | 'wiring' | 'zma' | 'frd' | 'padDb' | 'setBackMm'>> = {
  sub: { nomOhm: 8, reOhm: 6.4, leMh: 2.5, fsHz: 35, qts: 0.4, qms: 5, sensDb: 92, upperHz: 200 },
  woofer: { nomOhm: 8, reOhm: 6.4, leMh: 0.9, fsHz: 45, qts: 0.38, qms: 4, sensDb: 88, upperHz: 4000 },
  mid: { nomOhm: 8, reOhm: 6.2, leMh: 0.35, fsHz: 120, qts: 0.5, qms: 4, sensDb: 90, upperHz: 8000 },
  tweeter: { nomOhm: 8, reOhm: 5.6, leMh: 0.05, fsHz: 800, qts: 0.7, qms: 3, sensDb: 92, upperHz: 0 },
};

export const driverFor = (role: Role, name = ROLE_LABEL[role]): XoDriver => ({ name, role, ...ROLE_DEFAULTS[role], setBackMm: 0, padDb: 0, wiring: 'auto', zma: null, frd: null });

/** The roles of the drivers for a number of ways, low to high. */
export const ROLES_FOR: Record<number, readonly Role[]> = { 2: ['woofer', 'tweeter'], 3: ['woofer', 'mid', 'tweeter'], 4: ['sub', 'woofer', 'mid', 'tweeter'] };
/** Crossover points a way count starts with (ascending). */
export const XOVER_FOR: Record<number, readonly number[]> = { 2: [2500], 3: [400, 3000], 4: [100, 500, 3000] };

export const DEFAULT_XO: XoState = {
  mode: 'active',
  ways: 2,
  drivers: [driverFor('woofer'), driverFor('tweeter'), driverFor('mid'), driverFor('sub')],
  xover: [2500, 3000, 3500],
  alignment: 'linkwitz-riley',
  order: 4,
  rippleDb: P.DEFAULT_RIPPLE_DB,
  topology: 'sk-equal',
  capNf: 10,
  series: 'E24',
  zobel: false,
  dcr: true,
  ampPowerW: 100,
  ampMinLoadOhm: 4,
  alignDelay: false,
  tuned: null,
};

/** Starting points: a way count with its roles and crossover points, keeping the alignment and the mode. */
export function startingPoint(s: XoState, ways: number, sub = false): XoState {
  const roles = sub ? (['sub', 'woofer'] as const) : ROLES_FOR[ways]!;
  const xs = sub ? [80] : XOVER_FOR[ways]!;
  return sanitizeXo({ ...s, ways: roles.length, drivers: [...roles.map((r) => driverFor(r)), ...DEFAULT_XO.drivers.slice(roles.length)], xover: [...xs, ...DEFAULT_XO.xover.slice(xs.length)], tuned: null });
}

// -- sanitising -----------------------------------------------------------------------------------------------------------

const obj = (x: unknown): Record<string, unknown> => (typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const num = (x: unknown, r: Range, fallback: number): number => (typeof x === 'number' && Number.isFinite(x) ? P.clamp(x, r.min, r.max) : fallback);
const pick = <T extends string>(x: unknown, all: readonly T[], fallback: T): T => (all.includes(x as T) ? (x as T) : fallback);

export function sanitizeCurve(input: unknown): Curve | null {
  const c = obj(input);
  const f = c.freqHz;
  const m = c.mag;
  if (!Array.isArray(f) || !Array.isArray(m) || f.length !== m.length || f.length < P.MIN_CURVE_POINTS || f.length > MAX_STORED_POINTS) return null;
  if (!f.every((x, i) => typeof x === 'number' && Number.isFinite(x) && x >= P.MIN_CURVE_HZ && x <= P.MAX_CURVE_HZ && (i === 0 || x > (f[i - 1] as number)))) return null;
  if (!m.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= P.MAX_ZMA_OHM)) return null;
  const ph = Array.isArray(c.phaseDeg) && c.phaseDeg.length === f.length && c.phaseDeg.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 1e5) ? (c.phaseDeg as number[]) : null;
  return { name: typeof c.name === 'string' ? c.name.slice(0, 60) : 'curve', freqHz: f as number[], mag: m as number[], phaseDeg: ph };
}

function sanitizeDriver(input: unknown, def: XoDriver): XoDriver {
  const d = obj(input);
  const zma = sanitizeCurve(d.zma);
  return {
    name: typeof d.name === 'string' ? d.name.slice(0, 60) : def.name,
    role: pick(d.role, ROLES, def.role),
    nomOhm: num(d.nomOhm, XO_RANGES.nomOhm, def.nomOhm),
    reOhm: num(d.reOhm, XO_RANGES.reOhm, def.reOhm),
    leMh: num(d.leMh, XO_RANGES.leMh, def.leMh),
    fsHz: num(d.fsHz, XO_RANGES.fsHz, def.fsHz),
    qts: num(d.qts, XO_RANGES.qts, def.qts),
    qms: num(d.qms, XO_RANGES.qms, def.qms),
    sensDb: num(d.sensDb, XO_RANGES.sensDb, def.sensDb),
    upperHz: num(d.upperHz, XO_RANGES.upperHz, def.upperHz),
    setBackMm: num(d.setBackMm, XO_RANGES.setBackMm, 0),
    padDb: num(d.padDb, XO_RANGES.padDb, 0),
    wiring: pick(d.wiring, WIRINGS, 'auto'),
    zma: zma && zma.mag.every((x) => x > 0) ? zma : null,
    frd: sanitizeCurve(d.frd),
  };
}

/** A Linkwitz-Riley order is made even (the next one up); every other alignment takes any order. */
const fixOrder = (alignment: P.Alignment, order: number): number => (!P.isValidOrder(alignment, order) && alignment === 'linkwitz-riley' ? Math.min(order + 1, P.MAX_ORDER) : order);

/** How a crossover is shaped: the alignment, its order and (Chebyshev only) its ripple. The PA, home speaker and car pages each keep one. */
export interface XoShape {
  alignment: P.Alignment;
  order: number;
  rippleDb: number;
}
/** What those pages always used: Linkwitz-Riley 4. */
export const DEFAULT_SHAPE: XoShape = { alignment: 'linkwitz-riley', order: 4, rippleDb: P.DEFAULT_RIPPLE_DB };

export function sanitizeShape(input: unknown): XoShape {
  const i = obj(input);
  const alignment = pick(i.alignment, P.ALIGNMENTS, DEFAULT_SHAPE.alignment);
  const order = fixOrder(alignment, typeof i.order === 'number' && Number.isInteger(i.order) ? P.clamp(i.order, 1, P.MAX_ORDER) : DEFAULT_SHAPE.order);
  return { alignment, order, rippleDb: num(i.rippleDb, XO_RANGES.rippleDb, DEFAULT_SHAPE.rippleDb) };
}

export const isDefaultShape = (s: XoShape): boolean => s.alignment === 'linkwitz-riley' && s.order === 4;
export const shapeLabel = (s: XoShape): string => `${{ butterworth: 'Butterworth', 'linkwitz-riley': 'Linkwitz-Riley', bessel: 'Bessel', chebyshev: 'Chebyshev' }[s.alignment]} ${s.order}${s.alignment === 'chebyshev' ? ` (${s.rippleDb} dB ripple)` : ''}`;

const filterCache = new Map<string, P.XoFilter>();
/** The filter of a shape, built once (a Bessel filter finds its poles by iteration, too slow to redo at every plot point). */
export function shapeFilter(s: XoShape): P.XoFilter {
  const key = `${s.alignment}|${s.order}|${s.alignment === 'chebyshev' ? s.rippleDb : 0}`;
  let f = filterCache.get(key);
  if (!f) {
    f = P.xoFilter({ alignment: s.alignment, order: s.order, rippleDb: s.rippleDb });
    filterCache.set(key, f);
  }
  return f;
}

/** Band responses, lowest first, of a bank of crossover points. Linkwitz-Riley 4 goes through the original network, so every result that had it is unchanged. */
export const shapeBands = (s: XoShape, f: number, xs: readonly number[]): P.Cx[] => (isDefaultShape(s) ? P.crossoverBands(f, xs) : P.xoBands(f, xs, shapeFilter(s)));
/** The low-pass leg alone at one crossover point. */
export const shapeLow = (s: XoShape, f: number, fc: number): P.Cx => (isDefaultShape(s) ? P.lr4Lp(f, fc) : shapeFilter(s).lp(f, fc));

/**
 * Notes for a page that uses a shape: an alignment whose sum needs the upper driver of a split reversed has that reversal inside the
 * sum shown (as on the Crossover page's automatic wiring), so the page says which drivers to wire reversed, and where the sum is not flat.
 */
export function shapeNotes(s: XoShape, names: readonly string[]): string[] {
  if (isDefaultShape(s)) return [];
  const f = shapeFilter(s);
  const out: string[] = [];
  const reversed = names.filter((_, k) => k % 2 === 1 && f.polarity < 0);
  if (reversed.length > 0) out.push(`${shapeLabel(s)}: the sum shown has ${reversed.join(' and ')} wired reversed (the alignment wants it); wire it that way, or the sum will not be what is drawn.`);
  if (!f.allPassSum) out.push(`${shapeLabel(s)} does not sum flat at the crossover (a peak or dip near it); the level plot shows how much.`);
  return out;
}

export function sanitizeXo(input: unknown): XoState {
  const i = obj(input);
  const d = DEFAULT_XO;
  const ways = typeof i.ways === 'number' && Number.isInteger(i.ways) ? P.clamp(i.ways, 2, MAX_WAYS) : d.ways;
  const inDrivers = Array.isArray(i.drivers) ? i.drivers : [];
  const xs = Array.isArray(i.xover) ? i.xover : [];
  const alignment = pick(i.alignment, P.ALIGNMENTS, d.alignment);
  const order = fixOrder(alignment, typeof i.order === 'number' && Number.isInteger(i.order) ? P.clamp(i.order, 1, P.MAX_ORDER) : d.order);
  const tuned = obj(i.tuned);
  const tunedOk =
    typeof tuned.sig === 'string' && Array.isArray(tuned.values) && tuned.values.length <= MAX_WAYS && tuned.values.every((v) => Array.isArray(v) && v.length <= 40 && v.every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0));
  return {
    mode: i.mode === 'passive' ? 'passive' : 'active',
    ways,
    drivers: d.drivers.map((def, k) => sanitizeDriver(inDrivers[k], def)),
    xover: d.xover.map((x, k) => num(xs[k], XO_RANGES.xover, x)),
    alignment,
    order,
    rippleDb: num(i.rippleDb, XO_RANGES.rippleDb, d.rippleDb),
    topology: pick(i.topology, P.TOPOLOGIES, d.topology),
    capNf: num(i.capNf, XO_RANGES.capNf, d.capNf),
    series: pick(i.series, SERIES, d.series),
    zobel: i.zobel === true,
    dcr: i.dcr !== false,
    ampPowerW: num(i.ampPowerW, XO_RANGES.ampPowerW, d.ampPowerW),
    ampMinLoadOhm: num(i.ampMinLoadOhm, XO_RANGES.ampMinLoadOhm, d.ampMinLoadOhm),
    alignDelay: i.alignDelay === true,
    tuned: tunedOk ? { sig: tuned.sig as string, values: (tuned.values as number[][]).map((v) => v.slice()) } : null,
  };
}

/** A parsed measurement as a stored curve, thinned to MAX_STORED_POINTS log-spaced points when it has more. */
export function storeCurve(name: string, c: P.MeasuredCurve): Curve {
  const n = c.freqHz.length;
  if (n <= MAX_STORED_POINTS) return { name: name.slice(0, 60), freqHz: c.freqHz.slice(), mag: c.mag.slice(), phaseDeg: c.phaseDeg ? c.phaseDeg.slice() : null };
  const keep: number[] = [];
  for (let k = 0; k < MAX_STORED_POINTS; ++k) {
    const target = c.freqHz[0]! * (c.freqHz[n - 1]! / c.freqHz[0]!) ** (k / (MAX_STORED_POINTS - 1));
    let best = 0;
    for (let j = 0; j < n; ++j) if (Math.abs(Math.log(c.freqHz[j]! / target)) < Math.abs(Math.log(c.freqHz[best]! / target))) best = j;
    if (keep[keep.length - 1] !== best) keep.push(best);
  }
  return { name: name.slice(0, 60), freqHz: keep.map((j) => c.freqHz[j]!), mag: keep.map((j) => c.mag[j]!), phaseDeg: c.phaseDeg ? keep.map((j) => c.phaseDeg![j]!) : null };
}

const asMeasured = (c: Curve, kind: P.CurveKind): P.MeasuredCurve => ({ kind, freqHz: c.freqHz, mag: c.mag, phaseDeg: c.phaseDeg });

// -- the calculation ------------------------------------------------------------------------------------------------------

const N_POINTS = 200;
export const XO_FREQS: readonly number[] = P.logGrid(20, 20000, N_POINTS);
const SPEED = P.C;

export const specOf = (s: XoState): P.FilterSpec => ({ alignment: s.alignment, order: s.order, rippleDb: s.rippleDb });

/** The crossover points in use: ascending, at least 1.2x apart. */
export const xoverUsed = (s: XoState): number[] => P.effectiveCrossovers(s.xover, s.ways);

/** The driver's acoustic response per 2.83 V (dB SPL at 1 m as a complex gain): its own model or an imported response. */
export function driverResponse(d: XoDriver): (f: number) => P.Cx {
  if (d.frd) {
    const c = asMeasured(d.frd, 'frd');
    return (f) => P.curveValue(c, f); // a response file's dB is dB SPL at 2.83 V and 1 m, as the model's level is
  }
  const level = 10 ** (d.sensDb / 20);
  const w0 = d.fsHz;
  return (f) => {
    const x = f / w0;
    const hp = P.div(P.cx(-x * x), P.cx(1 - x * x, x / d.qts)); // second-order high-pass: s^2/(s^2 + s w0/Q + w0^2)
    const lp = d.upperHz > 0 ? P.div(P.cx(1), P.cx(1, f / d.upperHz)) : P.cx(1);
    return P.scale(P.mul(hp, lp), level);
  };
}
/** The driver's impedance: an imported curve, or Re + s Le in series with a resonance at Fs. */
export function driverLoad(d: XoDriver): P.LoadFn {
  if (d.zma) {
    const c = asMeasured(d.zma, 'zma');
    return (f) => P.curveValue(c, f);
  }
  const qes = (d.qts * d.qms) / Math.max(d.qms - d.qts, 1e-6);
  const rm = d.reOhm * (d.qms / Math.max(qes, 1e-6));
  return P.seriesLoad(d.reOhm, d.leMh * 1e-3, (f) => P.div(P.cx(rm), P.cx(1, d.qms * (f / d.fsHz - d.fsHz / f))));
}

const sumAt = (terms: readonly P.Cx[]): P.Cx => terms.reduce((a, b) => P.add(a, b), P.cx(0));
const fmt = (v: number, digits = 1): string => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(digits));

/** Wiring advice for a split, and what each driver's polarity ends up being. */
export interface Advice {
  split: number;
  lower: string;
  upper: string;
  /** The filter pair needs the upper driver reversed (relative to the lower one) for a flat sum. */
  invertUpper: boolean;
}

export interface ActiveSplit {
  split: number;
  fcHz: number;
  lp: P.ActiveDesign;
  hp: P.ActiveDesign;
  /** The same circuits with exact (unsnapped) values: what the parts are meant to be. */
  lpIdeal: P.ActiveDesign;
  hpIdeal: P.ActiveDesign;
  lpError: P.DesignError;
  hpError: P.DesignError;
  /** True when the parts shown were snapped to a series. */
  snapped: boolean;
}

export interface PassiveWay {
  name: string;
  /** What the way is: "low-pass 2.5 kHz" and so on. */
  kind: string;
  network: P.Network;
  /** Reactive and other parts in order, for the parts table. */
  parts: { name: string; type: P.PartType; value: number }[];
  /** Worst voltage across and current through each branch at the amplifier's full output, over 20 Hz to 20 kHz. */
  stress: P.ElementStress[];
}

export interface Computed {
  freqs: readonly number[];
  ways: { name: string; levelDb: number[]; filterDb: number[] }[];
  sumDb: number[];
  /** The electrical sum of the filters alone (before the drivers), dB: flat for an all-pass alignment wired as advised. */
  filterSumDb: number[];
  sumPhaseDeg: number[];
  sumDelayMs: number[];
  /** Impedance the amplifier sees, ohm (passive only). */
  zAmp: number[] | null;
  /** Shape error of the sum over the crossover region, dB rms with the mean removed. */
  rmsFlatDb: number;
  advice: Advice[];
  /** Polarity each way is wired with after 'auto': -1 reversed. */
  polarity: (1 | -1)[];
  /** Electrical delay applied to each way (active, alignDelay), ms. */
  delayMs: number[];
  active: ActiveSplit[] | null;
  passive: PassiveWay[] | null;
  /** Why the passive networks could not be built, if so. */
  passiveError: string | null;
  warnings: string[];
  notes: string[];
}

/** The ways of the passive design as the optimiser sees them (networks, loads, responses, wiring, set-back delay). */
export function passiveWays(s: XoState): { ways: P.Way[]; kinds: string[]; error: string | null } {
  const spec = specOf(s);
  const xs = xoverUsed(s);
  const n = s.ways;
  if (spec.order > P.MAX_PASSIVE_ORDER) return { ways: [], kinds: [], error: `A passive network goes up to order ${P.MAX_PASSIVE_ORDER}; this is order ${spec.order}. Lower the order or use the active tab.` };
  if (spec.alignment === 'chebyshev' && spec.order % 2 === 0) return { ways: [], kinds: [], error: 'An even-order Chebyshev cannot be built as a passive network (it starts below 0 dB at low frequency). Use an odd order or another alignment.' };
  const polarity = effectivePolarity(s);
  const ways: P.Way[] = [];
  const kinds: string[] = [];
  for (let k = 0; k < n; ++k) {
    const d = s.drivers[k]!;
    let net: P.Network;
    if (k === 0) {
      net = P.designPassive(spec, 'lp', xs[0]!, d.nomOhm, { dcr: s.dcr });
      kinds.push(`low-pass ${fmt(xs[0]!, 0)} Hz`);
    } else if (k === n - 1) {
      net = P.designPassive(spec, 'hp', xs[n - 2]!, d.nomOhm, { dcr: s.dcr });
      kinds.push(`high-pass ${fmt(xs[n - 2]!, 0)} Hz`);
    } else {
      net = P.designPassiveBand(spec, xs[k - 1]!, xs[k]!, d.nomOhm, { dcr: s.dcr });
      kinds.push(`band-pass ${fmt(xs[k - 1]!, 0)} to ${fmt(xs[k]!, 0)} Hz`);
    }
    if (d.padDb > 0) net = [...net, ...P.lPad(d.padDb, d.nomOhm)];
    const driver = driverLoad(d);
    if (s.zobel && !d.zma && d.leMh > 0) net = [...net, P.zobel(d.reOhm, d.leMh * 1e-3)];
    ways.push({ network: net, load: driver, response: driverResponse(d), polarity: polarity[k]!, delayS: d.setBackMm / 1000 / SPEED });
  }
  return { ways, kinds, error: null };
}

/** The signature of everything an optimised design depends on; tuned values are used only while it matches. */
export function passiveSig(s: XoState): string {
  return JSON.stringify({ ways: s.ways, drivers: s.drivers.slice(0, s.ways), xover: xoverUsed(s), a: s.alignment, o: s.order, r: s.rippleDb, z: s.zobel, c: s.dcr, amin: s.ampMinLoadOhm, series: s.series });
}

/** Polarity the alignment wants for each way (the product of the splits' polarities below it). */
export function wantedPolarities(s: XoState): (1 | -1)[] {
  const pol = P.xoFilter(specOf(s)).polarity as 1 | -1;
  const out: (1 | -1)[] = [1];
  for (let k = 1; k < s.ways; ++k) out.push((out[k - 1]! * pol) as 1 | -1);
  return out;
}

/** Wiring each driver ends up with: 'auto' follows what the alignment wants. */
export function effectivePolarity(s: XoState): (1 | -1)[] {
  const want = wantedPolarities(s);
  return s.drivers.slice(0, s.ways).map((d, k) => (d.wiring === 'reversed' ? -1 : d.wiring === 'normal' ? 1 : want[k]!));
}

/** The passive design with its optimised values applied while the signature still matches. */
export function passiveDesigned(s: XoState): { ways: P.Way[]; kinds: string[]; error: string | null; tunedUsed: boolean } {
  const base = passiveWays(s);
  if (base.error || !s.tuned || s.tuned.sig !== passiveSig(s)) return { ...base, tunedUsed: false };
  return { ...base, ways: P.withReactiveValues(base.ways, s.tuned.values), tunedUsed: true };
}

/** Optimise the passive parts (and snap them to the series when one is chosen). Returns the state with the result stored. */
export function optimisePassive(s: XoState): { state: XoState; before: number; after: number; zMinOhm: number } | { error: string } {
  const base = passiveWays(s);
  if (base.error) return { error: base.error };
  const xs = xoverUsed(s);
  const freqs = P.logGrid(Math.max(20, xs[0]! / 4), Math.min(20000, xs[xs.length - 1]! * 4), 61);
  const opts: P.OptimiseOptions = { freqs, zMinOhm: s.ampMinLoadOhm };
  const before = P.cost(base.ways, opts);
  let r = P.optimise(base.ways, opts);
  if (s.series !== 'none') r = P.snapOptimised(r.ways, s.series, opts);
  const zMin = P.evaluate(r.ways, freqs).zMinOhm;
  return { state: { ...s, tuned: { sig: passiveSig(s), values: P.reactiveValues(r.ways) } }, before, after: P.cost(r.ways, opts), zMinOhm: zMin };
}

export function computeCrossover(s: XoState): Computed {
  const spec = specOf(s);
  const n = s.ways;
  const xs = xoverUsed(s);
  const filter = P.xoFilter(spec);
  const warnings: string[] = [];
  const notes: string[] = [];
  const drivers = s.drivers.slice(0, n);
  const wanted = wantedPolarities(s);
  const pol = effectivePolarity(s);

  // time alignment: the sound of a driver set back arrives later; in the active case a delay brings the nearer drivers back in line
  const back = drivers.map((d) => d.setBackMm / 1000);
  const maxBack = Math.max(...back);
  const elec = drivers.map((_, k) => (s.mode === 'active' && s.alignDelay ? (maxBack - back[k]!) / SPEED : 0));
  const delay = drivers.map((_, k) => back[k]! / SPEED + elec[k]!);

  const resp = drivers.map(driverResponse);
  const pad = drivers.map((d) => 10 ** (-d.padDb / 20));

  let passive: PassiveWay[] | null = null;
  let passiveError: string | null = null;
  let netWays: P.Way[] = [];
  if (s.mode === 'passive') {
    const d = passiveDesigned(s);
    passiveError = d.error;
    netWays = d.ways;
    if (!d.error) {
      const vIn = P.ampVoltsRms(s.ampPowerW, Math.min(...drivers.map((x) => x.nomOhm)));
      passive = d.ways.map((w, k) => ({
        name: drivers[k]!.name,
        kind: d.kinds[k]!,
        network: w.network,
        parts: P.networkValues(w.network),
        stress: P.worstStress(w.network, P.STRESS_FREQS, w.load, vIn),
      }));
      if (d.tunedUsed) notes.push('The parts shown are the optimised ones. Changing anything else clears them.');
    } else warnings.push(d.error);
  }

  const filterAt = (k: number, f: number): P.Cx => {
    if (s.mode === 'passive' && netWays[k]) return P.networkGain(netWays[k]!.network, f, netWays[k]!.load);
    // active: the ideal bank (its polarity included), wiring against what the alignment wants applied below
    return P.xoBands(f, xs, filter)[k]!;
  };
  const term = (k: number, f: number): P.Cx => {
    const a = delay[k]! ? -2 * Math.PI * f * delay[k]! : 0;
    const wiring = s.mode === 'active' ? pol[k]! * wanted[k]! : pol[k]!; // active: the bank already carries `wanted`; passive: the ladders carry none
    let t = P.mul(P.mul(filterAt(k, f), resp[k]!(f)), P.cx(Math.cos(a), Math.sin(a)));
    t = P.scale(t, wiring * (s.mode === 'active' ? pad[k]! : 1));
    return t;
  };

  const sumFn = (f: number): P.Cx => sumAt(drivers.map((_, k) => term(k, f)));
  const ways = drivers.map((d, k) => ({
    name: d.name,
    levelDb: XO_FREQS.map((f) => 20 * Math.log10(P.abs(term(k, f)) + 1e-30)),
    filterDb: XO_FREQS.map((f) => 20 * Math.log10(P.abs(filterAt(k, f)) + 1e-30)),
  }));
  const filterSum = (f: number): P.Cx => sumAt(drivers.map((_, k) => P.scale(filterAt(k, f), s.mode === 'active' ? pol[k]! * wanted[k]! : pol[k]!)));
  const filterSumDb = XO_FREQS.map((f) => 20 * Math.log10(P.abs(filterSum(f)) + 1e-30));
  const sums = XO_FREQS.map(sumFn);
  const sumDb = sums.map((z) => 20 * Math.log10(P.abs(z) + 1e-30));
  const sumPhaseDeg = sums.map((z) => (Math.atan2(z.im, z.re) * 180) / Math.PI);
  const sumDelayMs = XO_FREQS.map((f) => 1000 * P.groupDelayS(sumFn, f));

  let zAmp: number[] | null = null;
  if (passive && netWays.length === n) zAmp = XO_FREQS.map((f) => P.abs(P.parallelZ(netWays.map((w) => P.networkInputZ(w.network, f, w.load)))));

  // shape error over the crossover region
  const band = P.logGrid(Math.max(20, xs[0]! / 3), Math.min(20000, xs[xs.length - 1]! * 3), 41);
  const dbs = band.map((f) => 20 * Math.log10(P.abs(sumFn(f)) + 1e-30));
  const mean = dbs.reduce((a, b) => a + b, 0) / dbs.length;
  const rmsFlatDb = Math.sqrt(dbs.reduce((a, b) => a + (b - mean) ** 2, 0) / dbs.length);

  const advice: Advice[] = xs.map((_, k) => ({ split: k, lower: drivers[k]!.name, upper: drivers[k + 1]!.name, invertUpper: filter.polarity < 0 }));

  // active circuits for every split
  let active: ActiveSplit[] | null = null;
  if (s.mode === 'active') {
    active = xs.map((fc, k) => {
      const make = (b: P.Band): { d: P.ActiveDesign; e: P.DesignError; raw: P.ActiveDesign } => {
        const raw = P.designActive(spec, fc, b, s.topology, s.capNf * 1e-9);
        const d = s.series === 'none' ? raw : P.snapDesign(raw, s.series);
        return { d, e: P.designError(d), raw };
      };
      const lp = make('lp');
      const hp = make('hp');
      return { split: k, fcHz: fc, lp: lp.d, hp: hp.d, lpIdeal: lp.raw, hpIdeal: hp.raw, lpError: lp.e, hpError: hp.e, snapped: s.series !== 'none' };
    });
    const inv = active.some((a) => a.lp.inverts || a.hp.inverts);
    if (inv) notes.push('The multiple-feedback and state-variable stages invert the signal; each driver is wired with the polarity shown, so an inverting circuit adds to or cancels that: check the polarity column against your circuit.');
  }

  // warnings
  xs.forEach((fc, k) => {
    const lo = drivers[k]!;
    const hi = drivers[k + 1]!;
    if (hi.fsHz > fc / 2) warnings.push(`${hi.name} has its low corner at ${fmt(hi.fsHz, 0)} Hz, too close to the ${fmt(fc, 0)} Hz crossover: it should be below half of it.`);
    if (lo.upperHz > 0 && lo.upperHz < fc) warnings.push(`${lo.name} rolls off above ${fmt(lo.upperHz, 0)} Hz, below its ${fmt(fc, 0)} Hz crossover.`);
    const diff = hi.sensDb - hi.padDb - (lo.sensDb - lo.padDb);
    if (Math.abs(diff) > 3 && !hi.frd && !lo.frd) warnings.push(`${hi.name} is ${fmt(Math.abs(diff))} dB ${diff > 0 ? 'louder' : 'quieter'} than ${lo.name} at the ${fmt(fc, 0)} Hz crossover: ${diff > 0 ? `take ${fmt(diff)} dB off ${hi.name}` : `take ${fmt(-diff)} dB off ${lo.name}`}.`);
  });
  drivers.forEach((d, k) => {
    if (d.wiring !== 'auto' && pol[k]! !== wanted[k]!) warnings.push(`${d.name} is wired ${pol[k]! < 0 ? 'reversed' : 'normal'}, but this alignment wants it ${wanted[k]! < 0 ? 'reversed' : 'normal'}: the drivers will partly cancel at the crossover.`);
  });
  if (s.mode === 'passive' && zAmp) {
    const z = Math.min(...zAmp);
    if (z < s.ampMinLoadOhm) warnings.push(`The amplifier sees as little as ${fmt(z)} Ω (${fmt(XO_FREQS[zAmp.indexOf(z)]!, 0)} Hz), below its ${fmt(s.ampMinLoadOhm)} Ω minimum.`);
    passive?.forEach((w) => w.stress.forEach((st, i) => {
      if (w.network[i]!.groups.flat().some((p) => p.type === 'C') && P.capacitorVoltageRating(st.vRms) === Infinity) warnings.push(`${w.name}: capacitor ${w.network[i]!.name} sees ${fmt(st.vRms, 0)} V rms: above any standard film capacitor rating.`);
    }));
  }
  if (s.mode === 'active' && maxBack > 0 && !s.alignDelay && back.some((b) => b !== back[0])) notes.push(`The drivers are not level: ${fmt(maxBack * 1000, 0)} mm of set-back is ${fmt((maxBack / SPEED) * 1000, 2)} ms. Turn on "Delay the nearer drivers" to line them up.`);
  if (s.mode === 'passive' && back.some((b) => b !== back[0])) notes.push('A passive network cannot delay a driver: move the drivers (or tilt the baffle) to line up the acoustic centres.');
  if (!filter.allPassSum) notes.push(`${spec.alignment === 'butterworth' ? 'Even-order Butterworth' : spec.alignment === 'bessel' ? 'Bessel' : 'Chebyshev'} filters do not sum flat at the crossover (a ${spec.alignment === 'butterworth' ? 'peak or dip' : 'dip or peak'} near it); the plot shows how much.`);
  if (drivers.some((d) => d.frd)) notes.push('A response file stands in for that driver\'s own response model (its dB is read as dB SPL at 2.83 V and 1 m). It should be measured on the same baffle.');
  if (s.mode === 'active' && s.series === 'none') notes.push('Component values are exact; pick E24 or E96 to see them as parts you can buy.');

  return { freqs: XO_FREQS, ways, sumDb, filterSumDb, sumPhaseDeg, sumDelayMs, zAmp, rmsFlatDb, advice, polarity: pol, delayMs: elec.map((x) => x * 1000), active, passive, passiveError, warnings, notes };
}
