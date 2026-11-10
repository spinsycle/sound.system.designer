// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The whole system: up to four bands, each a box design behind a Linkwitz-Riley crossover leg, with trim, delay,
// polarity, solo and mute, summed as complex pressure in dB SPL. Pure functions; the page draws what computeSystem
// returns. Spec: "Crossover network and band mixer" and "Absolute level, driver groups and limits".
import * as P from '@soundsystemdesigner/physics';
import { DEFAULT_DESIGN, type Design, type HornDesign, type Range, driverOf, rawEvaluator, sanitize } from './model';

export const MAX_BANDS = 4;
/** The voltage a band at 0 dB trim receives. Every level on the system page is for this input. */
export const REF_VOLTS = 2.83;

export interface Band {
  /** One driver in its box. */
  design: Design;
  /** Identical drivers in the band, each in its own box. */
  count: number;
  /** Drivers in each series string; the strings are in parallel. Divides count. */
  series: number;
  trimDb: number;
  delayMs: number;
  invert: boolean;
  solo: boolean;
  mute: boolean;
}

export interface Project {
  /** Active bands, 1 to 4; bands[0] is the lowest. All four are kept so a band's design survives a change of count. */
  nBands: number;
  /** Requested crossover points, Hz; the first nBands - 1 are used. */
  xover: number[];
  bands: Band[];
  /** Lowest frequency the system is asked to play: the bottom of the lowest band's passband. */
  lowestHz: number;
  /** Listening distance outdoors, m: the levels shown are at this distance. */
  distanceM: number;
  /** Band whose box is open in the designer. */
  selected: number;
  view: 'system' | 'box';
}

export type BandField = 'trimDb' | 'delayMs';
export const BAND_RANGES: Record<BandField, Range> = {
  trimDb: { label: 'Trim', unit: 'dB', min: -40, max: 12, linear: true },
  delayMs: { label: 'Delay', unit: 'ms', min: 0, max: 20, linear: true },
};
export const XOVER_RANGE: Range = { label: 'Crossover', unit: 'Hz', min: 20, max: 16000 };
export const LOWEST_RANGE: Range = { label: 'Lowest frequency played', unit: 'Hz', min: 20, max: 200 };
export const DISTANCE_RANGE: Range = { label: 'Listening distance', unit: 'm', min: 1, max: 200 };

const NAMES: readonly (readonly string[])[] = [['Full range'], ['Low', 'High'], ['Sub', 'Mid', 'High'], ['Sub', 'Low-mid', 'Mid', 'High']];
export const bandName = (nBands: number, b: number): string => NAMES[nBands - 1]![b] ?? `Band ${b + 1}`;

const band = (design: Partial<Design>, more: Partial<Band> = {}): Band => ({
  design: sanitize({ ...DEFAULT_DESIGN, ...design }),
  count: 1,
  series: 1,
  trimDb: 0,
  delayMs: 0,
  invert: false,
  solo: false,
  mute: false,
  ...more,
});

/** A horn given the way the plugin gives it (throat, mouth, length of an exponential flare): the cutoff follows. */
const horn = (throatCm2: number, mouthCm2: number, lengthM: number, more: Partial<HornDesign> = {}): HornDesign => ({
  ...DEFAULT_DESIGN.horn,
  flare: 'exponential',
  cutoffHz: (P.C * Math.log(mouthCm2 / throatCm2)) / (4 * Math.PI * lengthM),
  throatCm2,
  mouthCm2,
  throatChamberL: 0,
  ...more,
});

// The plugin's default band boxes, so a layout here starts where the same layout starts there.
const SUB_18 = { driverClass: 3, type: 'ported', volumeL: 150, tuneHz: 40 } as const;
const MID_12 = { driverClass: 1, type: 'sealed', volumeL: 60 } as const;
const MID_65 = { driverClass: 6, type: 'sealed', volumeL: 8 } as const;
const HF_HORN = { driverClass: 7, type: 'horn', volumeL: 0.2, plotRange: 'high', horn: horn(4, 150, 0.12) } as const;
/** A rear-loaded bass horn: the plugin's box volume becomes the chamber behind the cone. */
const scoop = (driverClass: number, chamberL: number, throat: number, mouth: number, length: number): Partial<Design> => ({
  driverClass,
  type: 'horn',
  horn: horn(throat, mouth, length, { loading: 'rear', throatChamberL: chamberL }),
});
const bin = (driverClass: number, volumeL: number, throat: number, mouth: number, length: number, high = false): Partial<Design> => ({
  driverClass,
  type: 'horn',
  volumeL,
  plotRange: high ? 'high' : 'low',
  horn: horn(throat, mouth, length),
});

const DEFAULT_BANDS = (): Band[] => [band(SUB_18), band(MID_12), band(MID_65), band(HF_HORN)];

export const DEFAULT_PROJECT: Project = {
  nBands: 1,
  xover: [100, 800, 3500],
  bands: DEFAULT_BANDS(),
  lowestHz: 40,
  distanceM: 1,
  selected: 0,
  view: 'system',
};

interface Template {
  label: string;
  description: string;
  xover: number[];
  bands: Band[];
}

/**
 * Generic starting points: no brand, driver model or named system. The layouts and the Jamaican-style stacks use
 * the same drivers, box sizes, horn geometry and crossover points as the Sound System plugin's factory presets.
 * Bass bins the plugin describes as scoops are rear-loaded here. Trims are set by levelTrims when a template loads.
 */
export const TEMPLATES: readonly Template[] = [
  { label: 'Full range: 12 in sealed', description: 'One 12 in sealed box, no crossover.', xover: [], bands: [band({ ...MID_12, volumeL: 40 })] },
  { label: '2-way: tops and sub', description: '18 in ported sub under 12 in sealed tops, crossed at 100 Hz.', xover: [100], bands: [band(SUB_18), band(MID_12)] },
  { label: '3-way PA', description: '18 in ported sub, 12 in sealed mids, compression-driver horn; 100 Hz and 1.5 kHz.', xover: [100, 1500], bands: [band(SUB_18), band(MID_12), band(HF_HORN)] },
  { label: '4-way PA', description: '18 in ported sub, 12 in low-mids, 6.5 in mids, compression-driver horn; 100 Hz, 800 Hz and 3.5 kHz.', xover: [100, 800, 3500], bands: DEFAULT_BANDS() },
  {
    label: 'Jamaican-style: roots dub stack',
    description: 'Four-way: a deep folded 21 in bass bin, 15 in mid bin, 8 in mid horn and a compression-driver horn; 90 Hz, 400 Hz and 2.5 kHz.',
    xover: [90, 400, 2500],
    bands: [band(bin(4, 60, 450, 6000, 1.9)), band(bin(2, 25, 300, 2500, 0.6)), band(bin(5, 6, 80, 800, 0.12, true)), band(HF_HORN)],
  },
  {
    label: 'Jamaican-style: dancehall stack',
    description: 'Four-way: an 18 in scoop, 12 in mid bin, 6.5 in mid horn and a compression-driver horn; 100 Hz, 450 Hz and 3 kHz.',
    xover: [100, 450, 3000],
    bands: [band(scoop(3, 40, 600, 4000, 1.0)), band(bin(1, 20, 250, 2000, 0.5)), band(bin(6, 4, 60, 900, 0.1, true)), band(HF_HORN)],
  },
  {
    label: 'Jamaican-style: small set',
    description: 'Three-way: a 15 in scoop, a 12 in mid bin and a compression-driver horn; 100 Hz and 2.4 kHz.',
    xover: [100, 2400],
    bands: [band(scoop(2, 30, 400, 3000, 0.9)), band(bin(1, 20, 250, 2000, 0.6)), band({ ...HF_HORN, horn: horn(4, 150, 0.25) })],
  },
  {
    label: "Jamaican-style: selector's rig",
    description: 'Two-way: an 18 in scoop and one 8 in horn-loaded top, crossed at 250 Hz.',
    xover: [250],
    bands: [band(scoop(3, 50, 600, 4000, 1.0)), band(bin(5, 6, 80, 800, 0.2, true))],
  },
];

const num = (v: unknown, r: Range, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? P.clamp(v, r.min, r.max) : fallback);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export const MAX_DRIVERS = 16;
/** A valid driver group: 1 to 16 drivers, and a series count that divides them (else all in parallel). */
export function group(count: unknown, series: unknown): { count: number; series: number } {
  const n = typeof count === 'number' && Number.isInteger(count) ? P.clamp(count, 1, MAX_DRIVERS) : 1;
  const s = typeof series === 'number' && Number.isInteger(series) && series >= 1 && n % series === 0 ? series : 1;
  return { count: n, series: s };
}

/** Any stored value to a valid Project: unknown fields dropped, numbers clamped, always four bands. */
export function sanitizeProject(input: unknown): Project {
  const i = obj(input);
  const d = DEFAULT_PROJECT;
  const inBands = Array.isArray(i.bands) ? i.bands : [];
  const xs = Array.isArray(i.xover) ? i.xover : [];
  const nBands = typeof i.nBands === 'number' && Number.isInteger(i.nBands) ? P.clamp(i.nBands, 1, MAX_BANDS) : d.nBands;
  return {
    nBands,
    xover: d.xover.map((x, k) => num(xs[k], XOVER_RANGE, x)),
    bands: d.bands.map((def, k) => {
      const b = obj(inBands[k]);
      return {
        design: b.design === undefined ? def.design : sanitize(b.design),
        ...group(b.count, b.series),
        trimDb: num(b.trimDb, BAND_RANGES.trimDb, 0),
        delayMs: num(b.delayMs, BAND_RANGES.delayMs, 0),
        invert: b.invert === true,
        solo: b.solo === true,
        mute: b.mute === true,
      };
    }),
    lowestHz: num(i.lowestHz, LOWEST_RANGE, d.lowestHz),
    distanceM: num(i.distanceM, DISTANCE_RANGE, d.distanceM),
    selected: typeof i.selected === 'number' && Number.isInteger(i.selected) ? P.clamp(i.selected, 0, nBands - 1) : 0,
    view: i.view === 'box' ? 'box' : 'system',
  };
}

const N_POINTS = 320;
export const SYSTEM_FREQS: readonly number[] = Array.from({ length: N_POINTS }, (_, k) => 20 * 1000 ** (k / (N_POINTS - 1)));
/** Top of the highest band's passband for averaging, Hz. */
const TOP_HZ = 12000;

export interface BandView {
  name: string;
  /** What the band is, in a line: driver and box. */
  summary: string;
  audible: boolean;
  /** Level through its crossover leg, with trim, at the listening distance. */
  levelDb: number[];
  /** The band's passband, Hz. */
  loHz: number;
  hiHz: number;
  /** Average level of the box itself (no crossover leg) over its passband, at 0 dB trim. */
  nativeDb: number;
}

export interface SystemView {
  freqs: readonly number[];
  /** The summed system, dB SPL. */
  levelDb: number[];
  bands: BandView[];
  /** The crossover points in use (ordered, at least 1.2x apart). */
  xover: number[];
  warnings: string[];
  notes: string[];
}

const fmt = (v: number, digits = 1): string => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(digits));

function summary(d: Design): string {
  const driver = driverOf(d).name;
  if (d.type === 'horn') return `${driver}, ${d.horn.loading === 'rear' ? 'scoop' : 'horn'}, ${fmt(d.horn.cutoffHz, 0)} Hz ${d.horn.flare}`;
  const box = { sealed: 'sealed', ported: `ported at ${fmt(d.tuneHz, 0)} Hz`, bandpass: `band-pass at ${fmt(d.tuneHz, 0)} Hz` }[d.type];
  return `${driver}, ${fmt(d.volumeL, d.volumeL < 10 ? 1 : 0)} L ${box}`;
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * The system as functions of frequency, set up once (box geometry, crossover points): each band's pressure at 1 V
 * reference input, and their complex sum. computeSystem maps these over the plot frequencies; the tests call them at
 * the shared vectors' frequencies.
 */
export function systemEvaluator(p: Project) {
  const n = p.nBands;
  const xover = P.effectiveCrossovers(p.xover, n);
  const active = p.bands.slice(0, n);
  const anySolo = active.some((b) => b.solo);
  // level at the listening distance outdoors: the distance law and air absorption, free field
  const room: P.RoomParams = { distanceM: p.distanceM, held: false, boundary: 0, boundaryDistM: 1, indoor: false, rt60: 1, volumeM3: 1000 };
  const bands = active.map((b, k) => {
    const raw = rawEvaluator(b.design);
    // the group as one coherent source: every driver at its share of the reference voltage
    const pRef = P.referencePressure(driverOf(b.design), REF_VOLTS * P.wiring(b.count, b.series).voltsFactor) * b.count;
    const gain = 10 ** (b.trimDb / 20) * (b.invert ? -1 : 1);
    /** The boxes alone at 0 dB trim, 1 m: no crossover leg. */
    const box = (f: number): P.Cx => P.scale(raw(f).g, pRef);
    /** The band as it plays: crossover leg, trim, polarity, distance. Everything but its delay. */
    const played = (f: number): P.Cx => P.scale(P.mul(P.crossoverBands(f, xover)[k]!, box(f)), gain * P.abs(P.roomDirectResponse(room, f)));
    return { b, box, played, audible: !b.mute && (!anySolo || b.solo), loHz: k === 0 ? p.lowestHz : xover[k - 1]!, hiHz: k === n - 1 ? TOP_HZ : xover[k]! };
  });
  const total = (f: number): P.Cx => P.systemPressure(f, bands.filter((x) => x.audible).map((x) => ({ pressure: x.played(f), delayS: x.b.delayMs / 1000 })));
  return { n, xover, bands, total, anySolo };
}

export function computeSystem(p: Project): SystemView {
  const sys = systemEvaluator(p);
  const { n, xover, anySolo } = sys;
  const freqs = SYSTEM_FREQS;
  const perBand = sys.bands.map((x) => {
    const inBand = freqs.filter((f) => f >= x.loHz && f <= x.hiHz).map((f) => P.splDb(P.abs(x.box(f))));
    return { ...x, played: freqs.map((f) => x.played(f)), nativeDb: inBand.length ? mean(inBand) : Number.NaN };
  });
  const floor = (pa: number): number => P.splDb(Math.max(pa, 1e-12));
  const levelDb = freqs.map((f) => floor(P.abs(sys.total(f))));
  const bands: BandView[] = perBand.map((x, k) => ({
    name: bandName(n, k),
    summary: summary(x.b.design),
    audible: x.audible,
    levelDb: x.played.map((v) => floor(P.abs(v))),
    loHz: x.loHz,
    hiHz: x.hiHz,
    nativeDb: x.nativeDb,
  }));

  const warnings: string[] = [];
  const notes: string[] = [];
  const at = (values: number[], f: number): number => values[freqs.findIndex((x) => x >= f)]!;
  xover.forEach((fx, k) => {
    const lower = perBand[k]!;
    const upper = perBand[k + 1]!;
    if (!lower.audible || !upper.audible) return;
    // two bands in step add to +6 dB over either leg at the crossover; far less means they are fighting
    const legsDb = Math.max(at(bands[k]!.levelDb, fx), at(bands[k + 1]!.levelDb, fx));
    const short = legsDb + 6 - at(levelDb, fx);
    if (short > 6) warnings.push(`${bands[k]!.name} and ${bands[k + 1]!.name} cancel at the ${fmt(fx, 0)} Hz crossover: the sum is ${fmt(short)} dB under what two bands in step would give. Try inverting ${bands[k + 1]!.name}, or delay.`);
    if (Math.abs(fx - p.xover[k]!) > 1e-9) notes.push(`Crossover ${k + 1} is used at ${fmt(fx, 0)} Hz, not ${fmt(p.xover[k]!, 0)} Hz: points must rise by at least 1.2x.`);
  });
  if (anySolo) notes.push('A band is soloed: the sum shows the soloed bands only.');
  notes.push(`Levels are for ${REF_VOLTS} V into a band at 0 dB trim, in half space, at ${fmt(p.distanceM)} m outdoors. Horn bands are radiated power, not on-axis level.`);

  return { freqs, levelDb, bands, xover, warnings, notes };
}

/**
 * Trims that bring every active band's own passband level down to the quietest band's (which stays at 0 dB),
 * rounded to 0.1 dB. Muted and soloed bands are levelled too.
 */
export function levelTrims(p: Project): number[] {
  const native = computeSystem(p).bands.map((b) => b.nativeDb);
  // a band with no passband (the lowest frequency set above its crossover) has no level to match: leave it alone
  const target = Math.min(...native.filter(Number.isFinite));
  return native.map((v) => (Number.isFinite(v) ? Math.round((target - v) * 10) / 10 + 0 : 0));
}

/** A template as a project: its bands and crossovers, the rest of the current project kept, trims levelled. */
export function applyTemplate(p: Project, index: number): Project {
  const t = TEMPLATES[index]!;
  const bands = DEFAULT_BANDS().map((def, k) => t.bands[k] ?? def);
  const next: Project = { ...p, nBands: t.bands.length, xover: DEFAULT_PROJECT.xover.map((x, k) => t.xover[k] ?? x), bands, selected: 0, view: 'system' };
  const trims = levelTrims(next);
  return sanitizeProject({ ...next, bands: bands.map((b, k) => ({ ...b, trimDb: trims[k] ?? 0 })) });
}
