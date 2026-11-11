// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Brief to design for a home speaker and a car install: the schema a local language model fills, a strict validator, the prompts
// and the comparison metrics. Same rules as brief.ts: the model names parts and sizes only, the app's calculators judge the result.
import * as P from '@soundsystemdesigner/physics';
import { type DesignOpts, type Validated, designSchema, fmtNum, isObj, num, range, text, unit, validateDesign } from './brief';
import { computeBuild } from './buildlist';
import { FRONT_COAX_CLASSES, FRONT_COMPONENT_CLASSES, FRONT_RANGES, FRONT_TWEETER_CLASSES, MOUNT_DEFAULTS, sanitizeFront } from './carfront';
import {
  CABLE_AWGS,
  CAR_AMP_LOADS,
  CAR_AMP_MIN_LOADS,
  CAR_COUNT_RANGE,
  CAR_RANGES,
  MUSIC_DUTIES,
  SPACES,
  SPACE_RANGES,
  computeCarElectric,
  computeCarSub,
  computeCarSystem,
  levelFront,
  sanitizeCar,
  type CarSub,
} from './carsub';
import {
  ARRANGEMENTS,
  QUANTITY_RANGE,
  SPEAKER_RANGES,
  SPEAKER_XOVER_RANGE,
  type Loudspeaker,
  computeLoudspeaker,
  defaultSpeaker,
  levelSpeaker,
  slotName,
  sanitizeLoudspeaker,
} from './loudspeaker';
import { sanitize } from './model';
import { DEFAULT_PROJECT, sanitizeProject } from './system';

const classIdx = (name: string): number => P.ALL_DRIVER_CLASSES.findIndex((d) => d.name === name);

// ---- home speaker --------------------------------------------------------------------------------------------

/** Woofers and midranges a home speaker may use, and its tweeters. No horn driver and no custom driver. */
export const SPEAKER_DRIVERS: readonly string[] = ['3 in', '4 in', '5.25 in', '6.5 in', '8 in', '10 in', '12 in', '15 in', '3 in mid', '4 in mid'];
export const SPEAKER_TWEETERS: readonly string[] = ['0.75 in dome', '1 in dome', '1.25 in dome', 'Planar tweeter'];

const DRIVER_OPTS: DesignOpts = { classes: SPEAKER_DRIVERS, types: ['sealed', 'ported'] };
const TWEETER_OPTS: DesignOpts = { classes: SPEAKER_TWEETERS, types: ['sealed'] };

export interface SpeakerAnswer {
  speaker: Loudspeaker;
  label: string;
  note: string;
}

/** Strict check of a home speaker; on success it is levelled the same way a starting point is. */
export function validateSpeaker(raw: unknown): Validated<SpeakerAnswer> {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, value: null, errors: ['expected an object'] };
  const label = text(raw.label, 'label', 40, errors);
  const note = text(raw.note, 'note', 240, errors);
  const arr = ARRANGEMENTS.find((a) => a.id === raw.arrangement);
  if (!arr) errors.push(`arrangement: expected one of ${ARRANGEMENTS.map((a) => `"${a.id}"`).join(', ')}`);
  const width = num(raw.baffleWidthCm, SPEAKER_RANGES.baffleWidthCm, 'baffleWidthCm', errors);
  const height = num(raw.baffleHeightCm, SPEAKER_RANGES.baffleHeightCm, 'baffleHeightCm', errors);
  const quantity = num(raw.quantity, QUANTITY_RANGE, 'quantity', errors);
  if (quantity !== null && !Number.isInteger(quantity)) errors.push(`quantity: ${quantity} is not a whole number`);
  if (raw.chambers !== 'shared' && raw.chambers !== 'separate') errors.push('chambers: expected "shared" or "separate"');
  if (typeof raw.baffleStep !== 'boolean') errors.push('baffleStep: expected true or false');

  const xs: number[] = [];
  if (!Array.isArray(raw.xoverHz)) errors.push('xoverHz: expected a list of crossover frequencies in Hz');
  else {
    raw.xoverHz.forEach((x, i) => {
      const v = num(x, SPEAKER_XOVER_RANGE, `xoverHz[${i}]`, errors);
      if (v !== null) xs.push(v);
    });
    if (arr && raw.xoverHz.length !== arr.xover.length) errors.push(`xoverHz: a ${arr.label} needs ${arr.xover.length} crossover ${arr.xover.length === 1 ? 'frequency' : 'frequencies'}, got ${raw.xoverHz.length}`);
    for (let i = 1; i < xs.length; i++) if (xs[i]! < xs[i - 1]! * 1.2) errors.push(`xoverHz: crossover points must rise and be at least 1.2 times apart (${fmtNum(xs[i - 1]!)} then ${fmtNum(xs[i]!)})`);
  }

  const slots: { design: ReturnType<typeof sanitize>; open: boolean }[] = [];
  if (!Array.isArray(raw.slots)) errors.push('slots: expected a list with one entry per driver group, lowest first');
  else {
    if (arr && raw.slots.length !== arr.slots.length) errors.push(`slots: a ${arr.label} has ${arr.slots.length} driver groups, got ${raw.slots.length}`);
    raw.slots.slice(0, 3).forEach((s, k) => {
      const at = `slots[${k}]`;
      const role = arr?.slots[k]?.role;
      if (!isObj(s)) {
        errors.push(`${at}: expected an object`);
        return;
      }
      const d = validateDesign(s, at, false, role === 'tweeter' ? TWEETER_OPTS : DRIVER_OPTS);
      if (!d.ok && arr) errors.push(`${at}: this is the ${arr.slots[k] ? slotName(arr.slots[k]!.role, arr.slots[k]!.count) : 'extra'} group (group ${k + 1} of ${arr.slots.length} for a ${arr.label}): ${role === 'tweeter' ? 'use a tweeter class' : 'use a woofer or midrange class, never a tweeter'}`);
      errors.push(...d.errors);
      if (typeof s.open !== 'boolean') errors.push(`${at}.open: expected true or false`);
      else if (s.open && role !== 'tweeter') errors.push(`${at}.open: only a tweeter can have no box`);
      if (d.ok && typeof s.open === 'boolean') slots.push({ design: sanitize({ ...d.value, plotRange: 'high' }), open: s.open });
    });
  }

  if (errors.length > 0 || !arr || width === null || height === null || quantity === null) return { ok: false, value: null, errors };
  const base = defaultSpeaker(arr.id);
  const speaker = levelSpeaker(
    sanitizeLoudspeaker({
      ...base,
      slots: base.slots.map((s, k) => (slots[k] ? { ...s, design: slots[k]!.design, open: slots[k]!.open } : s)),
      xover: [...xs, ...base.xover.slice(xs.length)],
      baffleWidthCm: width,
      baffleHeightCm: height,
      chambers: raw.chambers,
      baffleStep: raw.baffleStep,
      quantity,
    }),
  );
  return { ok: true, value: { speaker, label, note }, errors };
}

export function speakerSchema(): Record<string, unknown> {
  const slot = designSchema(false, DRIVER_OPTS) as { properties: Record<string, unknown>; required: string[] };
  const item = { type: 'object', properties: { ...slot.properties, driver: { type: 'string', enum: [...SPEAKER_DRIVERS, ...SPEAKER_TWEETERS] }, type: { type: 'string', enum: ['sealed', 'ported'] }, open: { type: 'boolean' } }, required: [...slot.required, 'open'] };
  return {
    type: 'object',
    properties: {
      label: { type: 'string', maxLength: 40 },
      note: { type: 'string', maxLength: 240 },
      arrangement: { type: 'string', enum: ARRANGEMENTS.map((a) => a.id) },
      baffleWidthCm: range(SPEAKER_RANGES.baffleWidthCm),
      baffleHeightCm: range(SPEAKER_RANGES.baffleHeightCm),
      xoverHz: { type: 'array', items: range(SPEAKER_XOVER_RANGE), maxItems: 2 },
      chambers: { type: 'string', enum: ['shared', 'separate'] },
      baffleStep: { type: 'boolean' },
      quantity: { type: 'integer', minimum: QUANTITY_RANGE.min, maximum: QUANTITY_RANGE.max },
      slots: { type: 'array', items: item, maxItems: 3 },
    },
    required: ['label', 'note', 'arrangement', 'baffleWidthCm', 'baffleHeightCm', 'xoverHz', 'chambers', 'baffleStep', 'quantity', 'slots'],
  };
}

const classRows = (names: readonly string[]): string =>
  names
    .map((n) => P.ALL_DRIVER_CLASSES[classIdx(n)]!)
    .map((d) => `- "${d.name}": Fs ${d.fs} Hz, Qts ${P.deriveDriver(d).qts.toFixed(2)}, Vas ${fmtNum(d.vasM3 * 1000)} L, cone ${(2 * Math.sqrt(d.sd / Math.PI) * 100).toFixed(1)} cm, Xmax ${(d.xmax * 1000).toFixed(1)} mm, ${d.pe} W`)
    .join('\n');

const COMMON = `You design loudspeakers for a design program. You choose parts and sizes only: the program does all the acoustics, so never calculate or claim measured results. Reply with one JSON object and nothing else. Use only the numbers, units and options listed here, and keep every number inside its range. "label" is a name of at most 40 characters; "note" is one or two sentences saying why you chose this.`;

export function speakerPrompt(): string {
  const arrs = ARRANGEMENTS.map((a) => `- "${a.id}" (${a.label}): ${a.description} Slots, lowest first: ${a.slots.map((s, k) => `slots[${k}] = ${s.count > 1 ? `${s.count} x ` : ''}${s.name ?? s.role}`).join(', ')} (${a.slots.length} slots in all). ${a.xover.length} crossover ${a.xover.length === 1 ? 'frequency' : 'frequencies'}. Starting baffle ${a.baffleCm[0]} x ${a.baffleCm[1]} cm.`).join('\n');
  const example = '{"label":"Example","note":"Format example only, not a recommendation.","arrangement":"two-way","baffleWidthCm":20,"baffleHeightCm":34,"xoverHz":[2500],"chambers":"shared","baffleStep":true,"quantity":2,"slots":[{"driver":"5.25 in","type":"sealed","volumeL":8,"tuneHz":50,"portDiameterCm":5,"open":false},{"driver":"1 in dome","type":"sealed","volumeL":0.5,"tuneHz":50,"portDiameterCm":5,"open":false}]}';
  return `${COMMON}\n\nDesign ONE home stereo loudspeaker: several drivers in one cabinet behind an active crossover. The object has "label", "note", "arrangement" (one of the ids below), "baffleWidthCm" (${unit(SPEAKER_RANGES.baffleWidthCm)}) and "baffleHeightCm" (${unit(SPEAKER_RANGES.baffleHeightCm)}): the outside front of the cabinet, "xoverHz" (the crossover frequencies in rising order, each ${unit(SPEAKER_XOVER_RANGE)} and at least 1.2 times apart; as many as the arrangement says), "chambers" ("shared" or "separate": whether the drivers of one group share a chamber), "baffleStep" (true for a free-standing speaker, false for one built into a wall), "quantity" (${unit(QUANTITY_RANGE)}: identical speakers to build; 2 is a stereo pair) and "slots": a list with one object per driver group, lowest first, in the order the arrangement lists them: ONE slot per driver group, never one per driver (an MTM has 2 slots: the pair of midranges as one, then the tweeter; a WTW 2: the woofer pair, then the tweeter; a 2.5-way 3). Each slot has "driver" (a class name below), "type" ("sealed" or "ported"), "volumeL" (${unit({ label: '', unit: 'L', min: 0.1, max: 1000 })}: the TOTAL air for all the drivers of that group; tweeters 0.2 to 1 L), "tuneHz" and "portDiameterCm" (ALWAYS include both; the port tuning and width of a ported box; ignored when sealed, then give 50 and 5) and "open" (true only for a tweeter without a box, such as a planar; otherwise false).\n\nArrangements:\n${arrs}\n\nWoofers and midranges (generic, invented values; use these names exactly):\n${classRows(SPEAKER_DRIVERS)}\n\nTweeters (a tweeter group uses these only, always "sealed"):\n${classRows(SPEAKER_TWEETERS)}\n\nSizing rules: a sealed box wants about 0.5 to 1.5 times the driver's Vas per driver, a ported box 1 to 2 times, tuned at or a little below Fs (a bigger box tunes lower) with a port wide enough to stay short: 4 to 6 cm for a 5.25 in, 6 to 8 cm for an 8 in, 8 to 10 cm for 10 in and larger. A midrange is always sealed and small (1 to 3 L). The baffle is at least the widest cone plus 4 cm; narrow baffles lose bass at a higher frequency (the baffle step), so a floorstander is 20 to 30 cm wide and 80 to 110 cm tall, a bookshelf 16 to 24 cm wide and 25 to 40 cm tall, a desktop speaker 12 to 16 cm wide. Cross the tweeter at least 2 times the woofer's Fs and below where the woofer's cone narrows its beam (a 5.25 in at about 3 kHz, an 8 in at about 2 kHz, a 10 in at about 1.2 kHz); a dome tweeter's own resonance is its Fs, so cross it at least twice that. A three-way crosses the woofer to the midrange at 250 to 500 Hz.\n\nFormat example (a different brief needs different numbers): ${example}`;
}

export interface SpeakerMetrics {
  /** Average level from 300 Hz to 3 kHz at the reference input, dB SPL at 1 m. */
  sensitivityDb: number;
  /** Lowest frequency within 3 dB of that average, before the baffle step, Hz. */
  f3Hz: number;
  arrangement: string;
  volumeL: number;
  sheets: number;
  warnings: number;
}

export function speakerMetricsOf(sp: Loudspeaker): SpeakerMetrics {
  const v = computeLoudspeaker(sp);
  const b = computeBuild(sanitizeProject({ ...DEFAULT_PROJECT, kind: 'speaker', speaker: sp, view: 'system' }));
  // the box's own -3 dB point: the baffle step is a 6 dB shelf of its own and would hide it
  const bare = sp.baffleStep ? computeLoudspeaker({ ...sp, baffleStep: false }) : v;
  const first = bare.levelDb.findIndex((l) => l >= bare.sensitivityDb - 3);
  const arr = ARRANGEMENTS.find((a) => a.id === sp.arrangement)!;
  const volumeL = sp.slots.slice(0, arr.slots.length).reduce((a, s) => a + (s.open ? 0 : s.design.volumeL), 0);
  return { sensitivityDb: v.sensitivityDb, f3Hz: first < 0 ? Number.NaN : bare.freqs[first]!, arrangement: arr.label, volumeL, sheets: b.sheets, warnings: v.warnings.length + b.warnings.length };
}

// ---- car install ---------------------------------------------------------------------------------------------

export const CAR_SUB_CLASSES: readonly string[] = ['8 in car sub', '10 in car sub', '12 in car sub', '15 in car sub', '10 in shallow sub', '12 in shallow sub'];
const SUB_OPTS: DesignOpts = { classes: CAR_SUB_CLASSES, types: ['sealed', 'ported', 'bandpass'] };
const SPACE_IDS = SPACES.map((s) => s.id);
const CABIN_IDS = P.CABIN_TYPES.map((c) => c.id);
const MOUNTS = Object.keys(MOUNT_DEFAULTS);

export interface CarAnswer {
  car: CarSub;
  label: string;
  note: string;
}

const section = (raw: Record<string, unknown>, key: string, errors: string[]): Record<string, unknown> | null => {
  const v = raw[key];
  if (!isObj(v)) {
    errors.push(`${key}: expected an object`);
    return null;
  }
  return v;
};

/** Strict check of a car install; on success the fronts are levelled to the sub like a starting point. */
export function validateCar(raw: unknown): Validated<CarAnswer> {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, value: null, errors: ['expected an object'] };
  const label = text(raw.label, 'label', 40, errors);
  const note = text(raw.note, 'note', 240, errors);
  if (typeof raw.cabin !== 'string' || !CABIN_IDS.includes(raw.cabin as P.CabinId)) errors.push(`cabin: expected one of ${CABIN_IDS.map((c) => `"${c}"`).join(', ')}`);

  // the subwoofer and its box
  const sub = section(raw, 'sub', errors);
  let design: ReturnType<typeof sanitize> | null = null;
  let count = 1;
  let series = 1;
  let coils = 2;
  let coilSeries = 1;
  if (sub) {
    const d = validateDesign(sub, 'sub', false, SUB_OPTS);
    errors.push(...d.errors);
    if (d.ok) design = sanitize({ ...d.value, plotRange: 'low' });
    const c = num(sub.count, CAR_COUNT_RANGE, 'sub.count', errors);
    if (c !== null && !Number.isInteger(c)) errors.push(`sub.count: ${c} is not a whole number`);
    else if (c !== null) count = c;
    const sr = num(sub.series, { label: 'Series', unit: '', min: 1, max: CAR_COUNT_RANGE.max, linear: true }, 'sub.series', errors);
    if (sr !== null && c !== null && Number.isInteger(c) && (!Number.isInteger(sr) || c % sr !== 0)) errors.push(`sub.series: ${fmtNum(sr)} must divide the sub count ${c}`);
    else if (sr !== null) series = sr;
    if (sub.coils !== 1 && sub.coils !== 2) errors.push('sub.coils: expected 1 or 2 voice coils per sub');
    else coils = sub.coils;
    if (sub.coilSeries !== 1 && sub.coilSeries !== 2) errors.push('sub.coilSeries: expected 1 (coils in parallel) or 2 (coils in series)');
    else if (sub.coilSeries === 2 && sub.coils === 1) errors.push('sub.coilSeries: 2 needs a dual voice coil sub (coils 2)');
    else coilSeries = sub.coilSeries;
  }

  // the amplifier
  const amp = section(raw, 'amp', errors);
  let power = 0;
  let load = 0;
  let minLoad = 0;
  let subsonic = 0;
  if (amp) {
    power = num(amp.powerW, CAR_RANGES.ampPowerW, 'amp.powerW', errors) ?? 0;
    if (typeof amp.loadOhm !== 'number' || !CAR_AMP_LOADS.includes(amp.loadOhm)) errors.push(`amp.loadOhm: expected one of ${CAR_AMP_LOADS.join(', ')}`);
    else load = amp.loadOhm;
    if (typeof amp.minLoadOhm !== 'number' || !CAR_AMP_MIN_LOADS.includes(amp.minLoadOhm)) errors.push(`amp.minLoadOhm: expected one of ${CAR_AMP_MIN_LOADS.join(', ')}`);
    else minLoad = amp.minLoadOhm;
    if (typeof amp.bridged !== 'boolean') errors.push('amp.bridged: expected true or false');
    if (amp.class !== 'd' && amp.class !== 'ab') errors.push('amp.class: expected "d" or "ab"');
    subsonic = num(amp.subsonicHz, CAR_RANGES.subsonicHz, 'amp.subsonicHz', errors) ?? 0;
  }

  // the 12 V side
  const sup = section(raw, 'supply', errors);
  const supply: Record<string, number> = {};
  if (sup) {
    for (const k of ['supplyV', 'cableM', 'alternatorA', 'otherLoadsA'] as const) {
      const v = num(sup[k], CAR_RANGES[k], `supply.${k}`, errors);
      if (v !== null) supply[k] = v;
    }
    if (typeof sup.cableAwg !== 'number' || !CABLE_AWGS.includes(sup.cableAwg)) errors.push(`supply.cableAwg: expected one of ${CABLE_AWGS.join(', ')}`);
    else supply.cableAwg = sup.cableAwg;
    if (typeof sup.duty !== 'number' || !MUSIC_DUTIES.some((m) => m.value === sup.duty)) errors.push(`supply.duty: expected one of ${MUSIC_DUTIES.map((m) => m.value).join(', ')}`);
    else supply.duty = sup.duty;
  }

  // the space and the box shape
  const sp = section(raw, 'space', errors);
  const space: Record<string, unknown> = {};
  let shape: 'box' | 'wedge' = 'box';
  let taper = 0.5;
  if (sp) {
    if (typeof sp.id !== 'string' || !SPACE_IDS.includes(sp.id)) errors.push(`space.id: expected one of ${SPACE_IDS.map((i) => `"${i}"`).join(', ')}`);
    else {
      space.id = sp.id;
      if (sp.id === 'custom') for (const k of ['wCm', 'hCm', 'dCm'] as const) space[k] = num(sp[k], SPACE_RANGES[k], `space.${k}`, errors);
    }
    if (sp.shape !== 'box' && sp.shape !== 'wedge') errors.push('space.shape: expected "box" or "wedge"');
    else shape = sp.shape;
    taper = num(sp.taper, CAR_RANGES.taper, 'space.taper', errors) ?? 0.5;
  }

  // the front speakers
  const fr = section(raw, 'front', errors);
  let front: unknown = { enabled: false };
  if (fr) {
    if (typeof fr.enabled !== 'boolean') errors.push('front.enabled: expected true or false');
    else if (fr.enabled) {
      const f: Record<string, unknown> = { enabled: true };
      if (fr.type !== 'component' && fr.type !== 'coaxial') errors.push('front.type: expected "component" or "coaxial"');
      else {
        f.type = fr.type;
        const woofers = fr.type === 'coaxial' ? FRONT_COAX_CLASSES : FRONT_COMPONENT_CLASSES;
        if (typeof fr.woofer !== 'string' || !woofers.includes(fr.woofer)) errors.push(`front.woofer: for a ${fr.type} expected one of ${woofers.map((n) => `"${n}"`).join(', ')}`);
        else f.wooferClass = classIdx(fr.woofer);
      }
      if (typeof fr.mount !== 'string' || !MOUNTS.includes(fr.mount)) errors.push(`front.mount: expected one of ${MOUNTS.map((m) => `"${m}"`).join(', ')}`);
      else f.mount = fr.mount;
      if (fr.type === 'component') {
        if (typeof fr.tweeter !== 'string' || !FRONT_TWEETER_CLASSES.includes(fr.tweeter)) errors.push(`front.tweeter: expected one of ${FRONT_TWEETER_CLASSES.map((n) => `"${n}"`).join(', ')}`);
        else f.tweeterClass = classIdx(fr.tweeter);
        f.xoverTweeterHz = num(fr.xoverTweeterHz, FRONT_RANGES.xoverTweeterHz, 'front.xoverTweeterHz', errors);
      }
      for (const k of ['airL', 'depthCm', 'openingCm', 'ringCm', 'xoverSubHz'] as const) f[k] = num(fr[k], FRONT_RANGES[k], `front.${k}`, errors);
      front = f;
    }
  }

  if (errors.length > 0 || !design) return { ok: false, value: null, errors };
  let car = sanitizeCar({
    cabin: raw.cabin,
    design,
    count,
    series,
    coils,
    coilSeries,
    ampPowerW: power,
    ampLoadOhm: load,
    ampMinLoadOhm: minLoad,
    bridged: amp!.bridged,
    subsonicHz: subsonic,
    ampClass: amp!.class,
    ...supply,
    space,
    shape,
    taper,
    front: sanitizeFront(front),
  });
  if (car.front.enabled) car = levelFront(car);
  return { ok: true, value: { car, label, note }, errors };
}

export function carSchema(): Record<string, unknown> {
  const obj = (properties: Record<string, unknown>, required: string[]): Record<string, unknown> => ({ type: 'object', properties, required });
  const subDesign = designSchema(false, SUB_OPTS) as { properties: Record<string, unknown>; required: string[] };
  return obj(
    {
      label: { type: 'string', maxLength: 40 },
      note: { type: 'string', maxLength: 240 },
      cabin: { type: 'string', enum: CABIN_IDS },
      sub: obj(
        {
          ...subDesign.properties,
          count: { type: 'integer', minimum: CAR_COUNT_RANGE.min, maximum: CAR_COUNT_RANGE.max },
          series: { type: 'integer', minimum: 1, maximum: CAR_COUNT_RANGE.max },
          coils: { type: 'integer', enum: [1, 2] },
          coilSeries: { type: 'integer', enum: [1, 2] },
        },
        [...subDesign.required, 'count', 'series', 'coils', 'coilSeries'],
      ),
      amp: obj(
        {
          powerW: range(CAR_RANGES.ampPowerW),
          loadOhm: { type: 'number', enum: [...CAR_AMP_LOADS] },
          minLoadOhm: { type: 'number', enum: [...CAR_AMP_MIN_LOADS] },
          bridged: { type: 'boolean' },
          class: { type: 'string', enum: ['d', 'ab'] },
          subsonicHz: range(CAR_RANGES.subsonicHz),
        },
        ['powerW', 'loadOhm', 'minLoadOhm', 'bridged', 'class', 'subsonicHz'],
      ),
      supply: obj(
        {
          supplyV: range(CAR_RANGES.supplyV),
          cableAwg: { type: 'integer', enum: [...CABLE_AWGS] },
          cableM: range(CAR_RANGES.cableM),
          duty: { type: 'number', enum: MUSIC_DUTIES.map((m) => m.value) },
          alternatorA: range(CAR_RANGES.alternatorA),
          otherLoadsA: range(CAR_RANGES.otherLoadsA),
        },
        ['supplyV', 'cableAwg', 'cableM', 'duty', 'alternatorA', 'otherLoadsA'],
      ),
      space: obj(
        {
          id: { type: 'string', enum: SPACE_IDS },
          wCm: range(SPACE_RANGES.wCm),
          hCm: range(SPACE_RANGES.hCm),
          dCm: range(SPACE_RANGES.dCm),
          shape: { type: 'string', enum: ['box', 'wedge'] },
          taper: range(CAR_RANGES.taper),
        },
        ['id', 'shape', 'taper'],
      ),
      front: obj(
        {
          enabled: { type: 'boolean' },
          type: { type: 'string', enum: ['component', 'coaxial'] },
          mount: { type: 'string', enum: MOUNTS },
          woofer: { type: 'string', enum: [...FRONT_COMPONENT_CLASSES, ...FRONT_COAX_CLASSES] },
          tweeter: { type: 'string', enum: [...FRONT_TWEETER_CLASSES] },
          airL: range(FRONT_RANGES.airL),
          depthCm: range(FRONT_RANGES.depthCm),
          openingCm: range(FRONT_RANGES.openingCm),
          ringCm: range(FRONT_RANGES.ringCm),
          xoverSubHz: range(FRONT_RANGES.xoverSubHz),
          xoverTweeterHz: range(FRONT_RANGES.xoverTweeterHz),
        },
        ['enabled'],
      ),
    },
    ['label', 'note', 'cabin', 'sub', 'amp', 'supply', 'space', 'front'],
  );
}

export function carPrompt(): string {
  const cabins = P.CABIN_TYPES.map((c) => `"${c.id}" (${c.label})`).join(', ');
  const spaces = SPACES.map((s) => `"${s.id}" (${s.label}${s.id === 'custom' ? '' : s.wCm ? `, ${s.wCm} x ${s.hCm} x ${s.dCm} cm` : ''})`).join(', ');
  const mounts = Object.entries(MOUNT_DEFAULTS).map(([k, m]) => `"${k}" (${m.label}: about ${m.airL} L of air and ${m.depthCm} cm of depth)`).join(', ');
  const example = '{"label":"Example","note":"Format example only, not a recommendation.","cabin":"sedan","sub":{"driver":"12 in car sub","type":"sealed","volumeL":40,"tuneHz":40,"portDiameterCm":10,"frontVolumeL":20,"count":1,"series":1,"coils":2,"coilSeries":1},"amp":{"powerW":500,"loadOhm":1,"minLoadOhm":1,"bridged":false,"class":"d","subsonicHz":25},"supply":{"supplyV":13.8,"cableAwg":4,"cableM":5,"duty":0.125,"alternatorA":120,"otherLoadsA":40},"space":{"id":"trunk-compact","shape":"box","taper":0.5},"front":{"enabled":false}}';
  return `${COMMON}\n\nDesign ONE car audio install: one to four identical subwoofers in a shared box, the amplifier for them, the 12 V supply, the space in the car and, if the brief asks for it, front speakers. The object has "label", "note", "cabin" (${cabins}), and these groups.\n"sub": the box design with "driver" (a class below), "type" ("sealed", "ported" or "bandpass"), "volumeL" (${unit({ label: '', unit: 'L', min: 0.1, max: 1000 })}: the air of the WHOLE enclosure, shared by all the subs; for a band-pass the sealed rear chamber), "tuneHz" (${unit({ label: '', unit: 'Hz', min: 10, max: 200 })}), "portDiameterCm" (${unit({ label: '', unit: 'cm', min: 2, max: 40 })}) and "frontVolumeL" (${unit({ label: '', unit: 'L', min: 1, max: 1000 })}): ALWAYS include all three; they are the port tuning, the port width and the front chamber, ignored for a sealed box (there give 40, 10 and 20); plus "count" (${unit(CAR_COUNT_RANGE)}), "series" (subs per series string, must divide count; 1 is all parallel), "coils" (1 or 2 voice coils per sub) and "coilSeries" (1: a dual-coil sub's coils in parallel, 2: in series; 2 only with coils 2).\n"amp": "powerW" (${unit(CAR_RANGES.ampPowerW)}: rated power per channel, or per channel when bridged), "loadOhm" (one of ${CAR_AMP_LOADS.join(', ')}: the load that power is rated into), "minLoadOhm" (one of ${CAR_AMP_MIN_LOADS.join(', ')}: the lowest load the amp accepts), "bridged" (two channels bridged into one load), "class" ("d" or "ab") and "subsonicHz" (${unit(CAR_RANGES.subsonicHz)}).\n"supply": "supplyV" (${unit(CAR_RANGES.supplyV)}), "cableAwg" (one of ${CABLE_AWGS.join(', ')}: the power cable gauge), "cableM" (${unit(CAR_RANGES.cableM)}: its length), "duty" (one of ${MUSIC_DUTIES.map((m) => m.value).join(', ')}: average-to-rated power on music, 0.25 loud, 0.125 typical, 0.0625 dynamic), "alternatorA" (${unit(CAR_RANGES.alternatorA)}) and "otherLoadsA" (${unit(CAR_RANGES.otherLoadsA)}: the car's own load).\n"space": "id" (${spaces}; for "custom" also "wCm", "hCm" and "dCm", the largest outside size in cm), "shape" ("box" or "wedge": a wedge slopes to lean against a seat back or hatch) and "taper" (${unit(CAR_RANGES.taper)}: top depth over bottom depth of a wedge; ignored for a box, give 0.5).\n"front": "enabled" (false when the brief has no front speakers: then give nothing else) and, when true: "type" ("component" or "coaxial"), "mount" (${mounts}), "woofer" (a front class below; component classes for a component set, coax classes for a coaxial), "tweeter" (a dome class below; used by a component set only), "airL" (${unit(FRONT_RANGES.airL)}: sealed air behind each front woofer), "depthCm" (${unit(FRONT_RANGES.depthCm)}), "openingCm" (${unit(FRONT_RANGES.openingCm)}: the hole in the panel, about 1 cm wider than the driver's cut-out), "ringCm" (${unit(FRONT_RANGES.ringCm)}: adapter ring thickness), "xoverSubHz" (${unit(FRONT_RANGES.xoverSubHz)}: where the sub hands over to the fronts, 80 to 100 Hz usual) and "xoverTweeterHz" (${unit(FRONT_RANGES.xoverTweeterHz)}: woofer to tweeter, about 2400 Hz for a 6.5 in).\n\nSubwoofer classes (generic, invented values; each coil is ${P.ALL_DRIVER_CLASSES[classIdx('12 in car sub')]!.re} ohm):\n${classRows(CAR_SUB_CLASSES)}\n\nFront woofer classes: ${[...FRONT_COMPONENT_CLASSES, ...FRONT_COAX_CLASSES].map((n) => `"${n}"`).join(', ')}. Front tweeter classes: ${FRONT_TWEETER_CLASSES.map((n) => `"${n}"`).join(', ')}.\n\nSizing rules: a sealed box wants about 0.5 to 1 times the Vas of ONE sub, times the number of subs for the shared box; a ported box about 1 to 1.5 times that, tuned at 32 to 45 Hz with a port wide enough to stay short (8 to 15 cm). The amplifier should match the subs: about the subs' combined rated power, into a load the amp accepts. A dual-coil sub's coils in parallel are half one coil's resistance, in series twice one coil's; subs in series strings add, in parallel divide. The box must fit the space (width x height x depth; a trunk takes a box of 60 to 100 L, a seat space only a shallow sub in under 20 L). The cable must carry the amp's peak current with under 3 percent drop: 4 AWG to about 100 A over 5 m, 2 AWG to about 200 A, 0 AWG above. The alternator should cover the music-average current plus the car's own load.\n\nFormat example (a different brief needs different numbers): ${example}`;
}

export interface CarMetrics {
  /** Average in-car level from 25 to 120 Hz at the reference input, dB SPL. */
  levelDb: number;
  /** How far the install can be raised before something stops it, dB. */
  headroomDb: number;
  loadOhm: number;
  fuseA: number;
  sheets: number;
  warnings: number;
}

export function carMetricsOf(c: CarSub): CarMetrics {
  const v = computeCarSub(c);
  const e = computeCarElectric(c, v.limits);
  const b = computeBuild(sanitizeProject({ ...DEFAULT_PROJECT, kind: 'car', car: c, view: 'system' }));
  const front = c.front.enabled ? computeCarSystem(c).warnings.length : 0;
  return { levelDb: v.averageDb, headroomDb: v.limits.headroomDb, loadOhm: v.loadOhm, fuseA: e.fuseA, sheets: b.sheets, warnings: v.warnings.length + e.warnings.length + b.warnings.length + front };
}
