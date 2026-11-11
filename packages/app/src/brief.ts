// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Brief to design: the schema a local language model fills, a strict validator that rejects anything outside it, the
// prompt, and the comparison metrics. The model never computes acoustics: it only names parts and sizes, and the same
// calculators as the rest of the app judge the result. Pure functions; no network here.
import * as P from '@soundsystemdesigner/physics';
import { computeBuild } from './buildlist';
import { BOX_KINDS, BOX_RANGES, CUSTOM_CLASS, CUSTOM_RANGES, DEFAULT_DESIGN, type Design, FLARES, HORN_RANGES, type Range, compute, sanitize } from './model';
import { AMP_LOADS, BAND_RANGES, COUNT_RANGE, DEFAULT_PROJECT, DISTANCE_RANGE, LOWEST_RANGE, MAX_BANDS, type Project, XOVER_RANGE, computeSystem, levelTrims, sanitizeProject } from './system';

export type BriefMode = 'system' | 'box' | 'speaker' | 'car';

export const FLAVOURS = [
  { id: 'compact', label: 'Compact', hint: 'Favour the smallest cabinets and the fewest drivers that still meet the brief.' },
  { id: 'loud', label: 'Loud', hint: 'Favour maximum output and headroom: bigger drivers, more of them, a larger amplifier.' },
  { id: 'deep', label: 'Extended', hint: 'Favour the lowest bass extension the brief allows, accepting larger cabinets.' },
] as const;
export type Flavour = (typeof FLAVOURS)[number];

export interface Validated<T> {
  ok: boolean;
  value: T | null;
  errors: string[];
}

const CLASS_NAMES: readonly string[] = [...P.DRIVER_CLASSES.map((d) => d.name), 'custom'];
export const fmtNum = (n: number): string => (Math.abs(n) >= 100 ? n.toFixed(0) : String(Number(n.toPrecision(4))));
export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A number inside its range, else an error naming the field, the value and the limit. */
export function num(v: unknown, r: Range, path: string, errors: string[]): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    errors.push(`${path}: expected a number${r.unit ? ` in ${r.unit}` : ''}, got ${JSON.stringify(v) ?? 'nothing'}`);
    return null;
  }
  if (v < r.min) errors.push(`${path}: ${fmtNum(v)} is below the minimum ${fmtNum(r.min)}${r.unit ? ` ${r.unit}` : ''}`);
  else if (v > r.max) errors.push(`${path}: ${fmtNum(v)} is above the maximum ${fmtNum(r.max)}${r.unit ? ` ${r.unit}` : ''}`);
  else return v;
  return null;
}

export function text(v: unknown, path: string, max: number, errors: string[]): string {
  if (typeof v !== 'string' || v.trim() === '') {
    errors.push(`${path}: expected a short text`);
    return '';
  }
  if (v.length > max) errors.push(`${path}: ${v.length} characters is above the maximum ${max}`);
  return v.slice(0, max);
}

export interface DesignMeta {
  label: string;
  note: string;
}

/**
 * Strict check of one box design. Every required field must be present and inside its range; extra fields are ignored.
 * `meta` also requires a label and a note (the top level of a one-box answer, or of a system).
 */
export interface DesignOpts {
  /** Driver class names allowed (no custom driver); their index is the app-wide class index. Default: the eight PA classes and "custom". */
  classes?: readonly string[];
  /** Box types allowed. Default: all. */
  types?: readonly string[];
}

export function validateDesign(raw: unknown, path: string, meta: boolean, opts: DesignOpts = {}): Validated<Design & Partial<DesignMeta>> {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, value: null, errors: [`${path}: expected an object`] };
  const patch: Partial<Design> = {};
  const out: Partial<DesignMeta> = {};
  if (meta) {
    out.label = text(raw.label, `${path}.label`, 40, errors);
    out.note = text(raw.note, `${path}.note`, 240, errors);
  }

  const names = opts.classes ?? CLASS_NAMES;
  if (typeof raw.driver !== 'string' || !names.includes(raw.driver)) errors.push(`${path}.driver: expected one of ${names.map((n) => `"${n}"`).join(', ')}`);
  else if (raw.driver === 'custom') {
    patch.driverClass = CUSTOM_CLASS;
    const c = raw.custom;
    if (!isObj(c)) errors.push(`${path}.custom: required when driver is "custom": an object with ${Object.keys(CUSTOM_RANGES).join(', ')}`);
    else {
      const fields = { ...DEFAULT_DESIGN.custom };
      for (const k of Object.keys(CUSTOM_RANGES) as (keyof P.CustomDriverFields)[]) {
        const v = num(c[k], CUSTOM_RANGES[k], `${path}.custom.${k}`, errors);
        if (v !== null) fields[k] = v;
      }
      patch.custom = fields;
    }
  } else patch.driverClass = P.ALL_DRIVER_CLASSES.findIndex((d) => d.name === raw.driver);

  const kinds = BOX_KINDS.filter((k) => !opts.types || opts.types.includes(k.id));
  const kind = kinds.find((k) => k.id === raw.type)?.id;
  if (!kind) errors.push(`${path}.type: expected one of ${kinds.map((k) => `"${k.id}"`).join(', ')}`);
  else patch.type = kind;

  const take = (key: keyof typeof BOX_RANGES, field: keyof Design): void => {
    const v = num(raw[key], BOX_RANGES[key], `${path}.${key}`, errors);
    if (v !== null) (patch as Record<string, unknown>)[field] = v;
  };
  if (kind === 'sealed' || kind === 'ported' || kind === 'bandpass' || kind === 'horn') take('volumeL', 'volumeL');
  if (kind === 'ported' || kind === 'bandpass') {
    take('tuneHz', 'tuneHz');
    take('portDiameterCm', 'portDiameterCm');
  }
  if (kind === 'bandpass') take('frontVolumeL', 'frontVolumeL');

  if (kind === 'horn') {
    const h = raw.horn;
    if (!isObj(h)) errors.push(`${path}.horn: required when type is "horn"`);
    else {
      const horn = { ...DEFAULT_DESIGN.horn };
      if (h.loading !== 'front' && h.loading !== 'rear') errors.push(`${path}.horn.loading: expected "front" or "rear"`);
      else horn.loading = h.loading;
      const flare = FLARES.find((f) => f.id === h.flare)?.id;
      if (!flare) errors.push(`${path}.horn.flare: expected one of ${FLARES.map((f) => `"${f.id}"`).join(', ')}`);
      else horn.flare = flare;
      const grab = (k: keyof typeof HORN_RANGES): void => {
        const v = num(h[k], HORN_RANGES[k], `${path}.horn.${k}`, errors);
        if (v !== null) (horn as Record<string, unknown>)[k] = v;
      };
      for (const k of ['throatCm2', 'mouthCm2', 'throatChamberL', 'widthCm'] as const) grab(k);
      if (flare === 'conical') grab('lengthM');
      else grab('cutoffHz');
      if (flare === 'hyperbolic') grab('t');
      if (typeof horn.throatCm2 === 'number' && typeof horn.mouthCm2 === 'number' && horn.mouthCm2 <= horn.throatCm2) errors.push(`${path}.horn.mouthCm2: the mouth must be larger than the throat (${fmtNum(horn.throatCm2)} cm²)`);
      patch.horn = horn;
      patch.plotRange = horn.cutoffHz >= 400 ? 'high' : 'low';
    }
  }

  if (errors.length > 0) return { ok: false, value: null, errors };
  return { ok: true, value: { ...sanitize({ ...DEFAULT_DESIGN, ...patch }), ...out }, errors };
}

export interface SystemAnswer {
  project: Project;
  label: string;
  note: string;
}

/** Strict check of a whole system; on success the project is levelled the same way a starting point is. */
export function validateSystem(raw: unknown): Validated<SystemAnswer> {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, value: null, errors: ['expected an object'] };
  const label = text(raw.label, 'label', 40, errors);
  const note = text(raw.note, 'note', 240, errors);
  const n = num(raw.nBands, { label: 'Bands', unit: '', min: 1, max: MAX_BANDS, linear: true }, 'nBands', errors);
  if (n !== null && !Number.isInteger(n)) errors.push(`nBands: ${n} is not a whole number`);
  const lowestHz = num(raw.lowestHz, LOWEST_RANGE, 'lowestHz', errors);
  const distanceM = num(raw.distanceM, DISTANCE_RANGE, 'distanceM', errors);

  const xs: number[] = [];
  if (!Array.isArray(raw.xoverHz)) errors.push('xoverHz: expected a list of crossover frequencies in Hz (empty for one band)');
  else {
    raw.xoverHz.forEach((x, i) => {
      const v = num(x, XOVER_RANGE, `xoverHz[${i}]`, errors);
      if (v !== null) xs.push(v);
    });
    if (n !== null && Number.isInteger(n) && raw.xoverHz.length !== n - 1) errors.push(`xoverHz: ${n} bands need ${n - 1} crossover frequencies, got ${raw.xoverHz.length}`);
    for (let i = 1; i < xs.length; i++) if (xs[i]! < xs[i - 1]! * 1.2) errors.push(`xoverHz: crossover points must rise and be at least 1.2 times apart (${fmtNum(xs[i - 1]!)} then ${fmtNum(xs[i]!)})`);
  }

  const bands: Record<string, unknown>[] = [];
  if (!Array.isArray(raw.bands)) errors.push('bands: expected a list with one entry per band');
  else {
    if (n !== null && Number.isInteger(n) && raw.bands.length !== n) errors.push(`bands: ${n} bands need ${n} entries, got ${raw.bands.length}`);
    raw.bands.slice(0, MAX_BANDS).forEach((b, i) => {
      const at = `bands[${i}]`;
      if (!isObj(b)) {
        errors.push(`${at}: expected an object`);
        return;
      }
      const d = validateDesign(b.design, `${at}.design`, false);
      errors.push(...d.errors);
      const count = num(b.count, COUNT_RANGE, `${at}.count`, errors);
      if (count !== null && !Number.isInteger(count)) errors.push(`${at}.count: ${count} is not a whole number`);
      const series = num(b.series, { label: 'Series', unit: '', min: 1, max: COUNT_RANGE.max, linear: true }, `${at}.series`, errors);
      if (count !== null && series !== null && Number.isInteger(count) && (!Number.isInteger(series) || count % series !== 0)) errors.push(`${at}.series: ${fmtNum(series)} must divide the driver count ${count}`);
      const power = num(b.ampPowerW, BAND_RANGES.ampPowerW, `${at}.ampPowerW`, errors);
      if (typeof b.ampLoadOhm !== 'number' || !AMP_LOADS.includes(b.ampLoadOhm)) errors.push(`${at}.ampLoadOhm: expected one of ${AMP_LOADS.join(', ')}`);
      const minLoad = num(b.ampMinLoadOhm, BAND_RANGES.ampMinLoadOhm, `${at}.ampMinLoadOhm`, errors);
      if (d.ok && count !== null && series !== null && power !== null && minLoad !== null) bands.push({ design: d.value, count, series, ampPowerW: power, ampLoadOhm: b.ampLoadOhm, ampMinLoadOhm: minLoad });
    });
  }

  if (errors.length > 0 || n === null || lowestHz === null || distanceM === null) return { ok: false, value: null, errors };
  const base = sanitizeProject({
    ...DEFAULT_PROJECT,
    nBands: n,
    xover: DEFAULT_PROJECT.xover.map((x, k) => xs[k] ?? x),
    bands: [...bands, ...DEFAULT_PROJECT.bands.slice(bands.length)],
    lowestHz,
    distanceM,
    selected: 0,
    view: 'system',
  });
  const trims = levelTrims(base);
  const project = sanitizeProject({ ...base, bands: base.bands.map((b, k) => ({ ...b, trimDb: trims[k] ?? 0 })) });
  return { ok: true, value: { project, label, note }, errors };
}

// ---- schema and prompt ---------------------------------------------------------------------------------------

export const range = (r: Range): { type: 'number'; minimum: number; maximum: number } => ({ type: 'number', minimum: r.min, maximum: r.max });

/** JSON Schema for one design, from the same ranges the validator uses; passed to Ollama so it constrains the syntax. */
export function designSchema(meta: boolean, opts: DesignOpts = {}): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    driver: { type: 'string', enum: opts.classes ? [...opts.classes] : P.DRIVER_CLASSES.map((d) => d.name) },
    custom: { type: 'object', properties: Object.fromEntries(Object.entries(CUSTOM_RANGES).map(([k, r]) => [k, range(r)])) },
    type: { type: 'string', enum: BOX_KINDS.map((k) => k.id).filter((k) => !opts.types || opts.types.includes(k)) },
    volumeL: range(BOX_RANGES.volumeL),
    tuneHz: range(BOX_RANGES.tuneHz),
    frontVolumeL: range(BOX_RANGES.frontVolumeL),
    portDiameterCm: range(BOX_RANGES.portDiameterCm),
    horn: {
      type: 'object',
      properties: {
        loading: { type: 'string', enum: ['front', 'rear'] },
        flare: { type: 'string', enum: FLARES.map((f) => f.id) },
        cutoffHz: range(HORN_RANGES.cutoffHz),
        t: range(HORN_RANGES.t),
        throatCm2: range(HORN_RANGES.throatCm2),
        mouthCm2: range(HORN_RANGES.mouthCm2),
        lengthM: range(HORN_RANGES.lengthM),
        throatChamberL: range(HORN_RANGES.throatChamberL),
        widthCm: range(HORN_RANGES.widthCm),
      },
      required: ['loading', 'flare', 'cutoffHz', 't', 'lengthM', 'throatCm2', 'mouthCm2', 'throatChamberL', 'widthCm'],
    },
  };
  // the port fields are always asked for: the model forgot them on ported and band-pass boxes when they were optional (first tuneHz, then frontVolumeL); they are ignored for the other types
  const required = ['driver', 'type', 'volumeL', 'tuneHz', 'portDiameterCm', 'frontVolumeL'];
  if (meta) {
    properties.label = { type: 'string', maxLength: 40 };
    properties.note = { type: 'string', maxLength: 240 };
    required.push('label', 'note');
  }
  if (opts.classes) {
    delete properties.custom; // a restricted list has no custom driver and no horn
    delete properties.horn;
  }
  if (opts.types && !opts.types.includes('bandpass')) {
    delete properties.frontVolumeL;
    required.splice(required.indexOf('frontVolumeL'), 1);
  }
  return { type: 'object', properties, required };
}

export function systemSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      label: { type: 'string', maxLength: 40 },
      note: { type: 'string', maxLength: 240 },
      nBands: { type: 'integer', minimum: 1, maximum: MAX_BANDS },
      xoverHz: { type: 'array', items: range(XOVER_RANGE), maxItems: MAX_BANDS - 1 },
      lowestHz: range(LOWEST_RANGE),
      distanceM: range(DISTANCE_RANGE),
      bands: {
        type: 'array',
        maxItems: MAX_BANDS,
        items: {
          type: 'object',
          properties: {
            design: designSchema(false),
            count: { type: 'integer', minimum: COUNT_RANGE.min, maximum: COUNT_RANGE.max },
            series: { type: 'integer', minimum: 1, maximum: COUNT_RANGE.max },
            ampPowerW: range(BAND_RANGES.ampPowerW),
            ampLoadOhm: { type: 'integer', enum: [...AMP_LOADS] },
            ampMinLoadOhm: range(BAND_RANGES.ampMinLoadOhm),
          },
          required: ['design', 'count', 'series', 'ampPowerW', 'ampLoadOhm', 'ampMinLoadOhm'],
        },
      },
    },
    required: ['label', 'note', 'nBands', 'xoverHz', 'lowestHz', 'distanceM', 'bands'],
  };
}

const classTable = (): string =>
  P.DRIVER_CLASSES.map((d) => `- "${d.name}": Fs ${d.fs} Hz, Qts ${P.deriveDriver(d).qts.toFixed(2)}, Vas ${(d.vasM3 * 1000).toFixed(0)} L, Sd ${(d.sd * 1e4).toFixed(0)} cm2, Xmax ${(d.xmax * 1000).toFixed(1)} mm, ${d.pe} W, ${d.re} ohm`).join('\n');

export const unit = (r: Range): string => `${fmtNum(r.min)} to ${fmtNum(r.max)}${r.unit ? ` ${r.unit}` : ''}`;

/** Mouth areas that suit a horn cutoff (circumference of the mouth equal to the wavelength): a sizing table for the model. */
const HORN_TABLE = '50 Hz: 37000 cm2, 100 Hz: 9400 cm2, 200 Hz: 2300 cm2, 500 Hz: 375 cm2, 1000 Hz: 94 cm2, 2000 Hz: 23 cm2';

/** The instructions the model gets. It chooses parts and sizes only; it is told the app will do the acoustics. */
export function systemPrompt(mode: 'system' | 'box'): string {
  const design = `A box design object has: "driver" (one of the class names below), "type" ("sealed", "ported", "bandpass" or "horn"), "volumeL" (${unit(BOX_RANGES.volumeL)}; for a band-pass box the sealed rear chamber; for a front-loaded horn the sealed chamber behind the cone), "tuneHz" (${unit(BOX_RANGES.tuneHz)}), "portDiameterCm" (${unit(BOX_RANGES.portDiameterCm)}) and "frontVolumeL" (${unit(BOX_RANGES.frontVolumeL)}): ALWAYS include all three; they are the port tuning, the port width and the front chamber of a ported or band-pass box, and are ignored for sealed boxes and horns (there give tuneHz 40, portDiameterCm 10 and frontVolumeL 10), and for horns a "horn" object that ALWAYS has all of: "loading" ("front", or "rear" for a scoop), "flare" ("exponential", "hyperbolic", "tractrix" or "conical"), "cutoffHz" (${unit(HORN_RANGES.cutoffHz)}), "t" (0 to 1, use 0.6), "lengthM" (${unit(HORN_RANGES.lengthM)}, only used by conical), "throatCm2" (${unit(HORN_RANGES.throatCm2)}), "mouthCm2" (${unit(HORN_RANGES.mouthCm2)}, larger than the throat), "throatChamberL" (${unit(HORN_RANGES.throatChamberL)}) and "widthCm" (${unit(HORN_RANGES.widthCm)}).`;
  const common = `You design loudspeaker enclosures for a design program. You choose parts and sizes only: the program does all the acoustics, so never calculate or claim measured results. Reply with one JSON object and nothing else. Use only the numbers, units and options listed here, and keep every number inside its range. "label" is a name of at most 40 characters; "note" is one or two sentences saying why you chose this.`;
  const classes = `Driver classes (generic, invented values; use these names exactly):\n${classTable()}`;
  const sizing = `Sizing rules: a sealed box wants about 0.5 to 1.5 times the driver's Vas. A ported box wants about 1 to 2 times Vas, tuned at or a little below Fs, with a port wide enough to stay short: 8 to 10 cm for under 60 L, 12 to 15 cm for 60 to 200 L, 15 to 25 cm above that; never a box over 300 L unless the brief asks for a bin. A band-pass box ALWAYS has volumeL, frontVolumeL, tuneHz and portDiameterCm: its sealed rear volume is about 0.5 to 1 times Vas, its front volume of about 1 to 2 times Vas, and a tuning of 40 to 80 Hz for a subwoofer. The "1 in HF" class is only for horns above about 800 Hz; "8 in" and "6.5 in" suit mids; "12 in" and "15 in" suit tops or mid-bass; "18 in" and "21 in" suit bass. Horn mouth area for a cutoff (use the nearest row): ${HORN_TABLE}; the throat is 3 to 10 percent of the mouth, never more than the driver's Sd, and always smaller than the mouth. Set a horn's cutoff at or just below the bottom of its band. A scoop or bass bin is a "horn" with loading "rear": its "throatChamberL" is the chamber behind the cone (20 to 80 L for an 18 in) and "volumeL" is 1.`;
  const exampleBox = '{"label":"Example","note":"Format example only, not a recommendation.","driver":"12 in","type":"ported","volumeL":70,"tuneHz":42,"portDiameterCm":10}';
  if (mode === 'box') return `${common}\n\nDesign ONE box. The object is a box design with "label" and "note" added.\n${design}\n\n${classes}\n\n${sizing}\n\nFormat example (a different brief needs different numbers): ${exampleBox}`;
  const exampleSystem = '{"label":"Example","note":"Format example only, not a recommendation.","nBands":2,"xoverHz":[100],"lowestHz":45,"distanceM":8,"bands":[{"design":{"driver":"18 in","type":"ported","volumeL":160,"tuneHz":40,"portDiameterCm":12},"count":1,"series":1,"ampPowerW":900,"ampLoadOhm":4,"ampMinLoadOhm":2},{"design":{"driver":"12 in","type":"sealed","volumeL":50},"count":2,"series":1,"ampPowerW":400,"ampLoadOhm":4,"ampMinLoadOhm":2}]}';
  return `${common}\n\nDesign a whole system of 1 to ${MAX_BANDS} bands, lowest band first. The object has "label", "note", "nBands" (whole number, as many as the brief needs), "xoverHz" (a list of nBands - 1 rising crossover frequencies, each ${unit(XOVER_RANGE)}, at least 1.2 times apart, in rising order such as [100, 1200, 3500]; an empty list for one band), "lowestHz" (${unit(LOWEST_RANGE)}: the lowest frequency the system must play, near the bottom of the lowest band's drivers), "distanceM" (${unit(DISTANCE_RANGE)}: listening distance) and "bands": a list with one object per band, each with "design" (a box design), "count" (${unit(COUNT_RANGE)}: identical drivers, each in its own box), "series" (drivers per series string; must divide count; 1 means all in parallel), "ampPowerW" (${unit(BAND_RANGES.ampPowerW)}), "ampLoadOhm" (one of ${AMP_LOADS.join(', ')}: the load that power is rated into) and "ampMinLoadOhm" (${unit(BAND_RANGES.ampMinLoadOhm)}: the lowest load the amplifier accepts).\n${design}\n\n${classes}\n\n${sizing}\n\nSystem rules: pick an amplifier near the drivers' rated power per channel (never far above it); typical crossovers are 80 to 120 Hz below the mids, 500 to 1500 Hz for mids to highs and 2 to 4 kHz into a compression-driver horn; each band's drivers must be able to play across its crossover points.\n\nFormat example (a different brief needs different numbers): ${exampleSystem}`;
}

export function userPrompt(brief: string, flavour: Flavour): string {
  return `Brief: ${brief.trim()}\n\nVariant: ${flavour.label}. ${flavour.hint}`;
}

/** The message sent back when an answer was rejected. */
export function retryPrompt(errors: readonly string[]): string {
  return `That answer was rejected by the validator:\n${errors.slice(0, 12).map((e) => `- ${e}`).join('\n')}\nReturn the corrected JSON object only, with every number inside its range.`;
}

// ---- comparison ----------------------------------------------------------------------------------------------

export interface Metrics {
  /** Average level of the system from the lowest frequency played, dB SPL at the listening distance. */
  levelDb: number;
  /** How far the system can be raised before a band stops, dB. */
  headroomDb: number;
  lowestHz: number;
  bands: number;
  sheets: number;
  /** Warnings from the system model and the build, counted. */
  warnings: number;
}

export function metricsOf(p: Project): Metrics {
  const s = computeSystem(p);
  const b = computeBuild(p);
  return { levelDb: s.limits.referenceDb, headroomDb: s.limits.headroomDb, lowestHz: p.lowestHz, bands: p.nBands, sheets: b.sheets, warnings: s.warnings.length + b.warnings.length };
}

export interface BoxMetrics {
  /** First two readouts of the box (e.g. fc and F3). */
  readouts: string[];
  volumeL: number;
  sheets: number;
  warnings: number;
}

export function boxMetricsOf(d: Design): BoxMetrics {
  const c = compute(d);
  const p = sanitizeProject({ ...DEFAULT_PROJECT, nBands: 1, bands: [{ design: d }] });
  const b = computeBuild(p);
  return { readouts: c.readouts.slice(0, 3).map((r) => `${r.label} ${r.value}`), volumeL: d.volumeL, sheets: b.sheets, warnings: c.warnings.length + b.warnings.length };
}
