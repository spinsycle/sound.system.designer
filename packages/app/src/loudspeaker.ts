// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// A loudspeaker: several drivers in ONE cabinet (home stereo speakers, desktop to floorstanding): 2-way, MTM, WTW, TMM,
// 3-way and 2.5-way. Each slot is one driver or a group of identical ones behind an active LR4 crossover leg; the legs
// sum as complex pressure and the baffle step multiplies the sum. Pure functions; the page draws what computeLoudspeaker
// returns. Spec: "Loudspeaker cabinets" (v0.11).
import * as P from '@soundsystemdesigner/physics';
import { BOX_RANGES, DEFAULT_DESIGN, type Design, type Range, REF_VOLTS, driverOf, rawEvaluator, sanitize } from './model';

export type Role = 'woofer' | 'mid' | 'tweeter';

export type ArrangementId = 'two-way' | 'mtm' | 'wtw' | 'tmm' | 'three-way' | 'two-and-half';

export interface Arrangement {
  id: ArrangementId;
  label: string;
  description: string;
  /** Low to high frequency; `count` identical drivers per slot. */
  slots: readonly { role: Role; count: number; /** Shown instead of the role when two slots share one. */ name?: string }[];
  /** Where the slots sit on the baffle from top to bottom (indices into slots, a slot with 2 drivers appears twice). */
  layout: readonly number[];
  /**
   * partition: each slot plays between its neighbours' crossover points and the legs sum flat.
   * assist: slot 0 is a second woofer that plays only below the first crossover (a 2.5-way); slots 1 and 2 split at the second.
   */
  kind: 'partition' | 'assist';
  xover: readonly number[];
  /** Starting baffle, outside width and height, cm. */
  baffleCm: readonly [number, number];
}

export const ARRANGEMENTS: readonly Arrangement[] = [
  { id: 'two-way', label: '2-way', description: 'One woofer and one tweeter.', slots: [{ role: 'woofer', count: 1 }, { role: 'tweeter', count: 1 }], layout: [1, 0], kind: 'partition', xover: [2500], baffleCm: [20, 32] },
  { id: 'mtm', label: 'MTM (D\u2019Appolito)', description: 'Midrange, tweeter, midrange: the tweeter between two matched drivers.', slots: [{ role: 'mid', count: 2 }, { role: 'tweeter', count: 1 }], layout: [0, 1, 0], kind: 'partition', xover: [2500], baffleCm: [16, 45] },
  { id: 'wtw', label: 'WTW', description: 'Woofer, tweeter, woofer: two woofers around the tweeter.', slots: [{ role: 'woofer', count: 2 }, { role: 'tweeter', count: 1 }], layout: [0, 1, 0], kind: 'partition', xover: [2200], baffleCm: [20, 55] },
  { id: 'tmm', label: 'TMM', description: 'Tweeter on top of two matched drivers.', slots: [{ role: 'mid', count: 2 }, { role: 'tweeter', count: 1 }], layout: [1, 0, 0], kind: 'partition', xover: [2500], baffleCm: [16, 45] },
  { id: 'three-way', label: '3-way', description: 'Woofer, midrange and tweeter.', slots: [{ role: 'woofer', count: 1 }, { role: 'mid', count: 1 }, { role: 'tweeter', count: 1 }], layout: [2, 1, 0], kind: 'partition', xover: [400, 3000], baffleCm: [26, 85] },
  { id: 'two-and-half', label: '2.5-way', description: 'Two woofers, the second playing only the bass, plus a tweeter.', slots: [{ role: 'woofer', count: 1, name: 'Bass woofer' }, { role: 'woofer', count: 1, name: 'Main woofer' }, { role: 'tweeter', count: 1 }], layout: [2, 1, 0], kind: 'assist', xover: [300, 2500], baffleCm: [20, 75] },
];

export const arrangementOf = (id: ArrangementId): Arrangement => ARRANGEMENTS.find((a) => a.id === id) ?? ARRANGEMENTS[0]!;

export interface Slot {
  /** Driver class and the chamber behind it. `volumeL` is the TOTAL net air for the slot's drivers; each sees volume / count. */
  design: Design;
  /** No box behind the driver (planar, ribbon): a high-pass at its own Fs. */
  open: boolean;
  /** How far the voice coil sits behind the baffle plane, cm. */
  backCm: number;
  trimDb: number;
  invert: boolean;
}

export interface Loudspeaker {
  arrangement: ArrangementId;
  /** Always three kept so a slot's design survives a change of arrangement; only the arrangement's slots are used. */
  slots: Slot[];
  /** Crossover points, Hz: between slots 0-1 and 1-2 (the 'assist' kind uses both; 'partition' with two slots uses the first). */
  xover: number[];
  baffleWidthCm: number;
  baffleHeightCm: number;
  /** One chamber for a slot's drivers, or one each. The response is the same; the cut list differs. */
  chambers: 'shared' | 'separate';
  baffleStep: boolean;
  /** Identical speakers to build (2 is a stereo pair). */
  quantity: number;
  /** Bracing across the cabinet, for the cut list. */
  brace: P.Brace;
}

export type SpeakerField = 'baffleWidthCm' | 'baffleHeightCm';
export const SPEAKER_RANGES: Record<SpeakerField, Range> = {
  baffleWidthCm: { label: 'Baffle width', unit: 'cm', min: 8, max: 80 },
  baffleHeightCm: { label: 'Baffle height', unit: 'cm', min: 10, max: 200 },
};
export const SLOT_RANGES = {
  backCm: { label: 'Set back', unit: 'cm', min: 0, max: 30, linear: true },
  trimDb: { label: 'Trim', unit: 'dB', min: -20, max: 6, linear: true },
} as const satisfies Record<string, Range>;
export const QUANTITY_RANGE: Range = { label: 'Speakers to build', unit: '', min: 1, max: 8, linear: true };
export const SPEAKER_XOVER_RANGE: Range = { label: 'Crossover', unit: 'Hz', min: 100, max: 8000 };

const classIndex = (name: string): number => P.ALL_DRIVER_CLASSES.findIndex((d) => d.name === name);

const slotOf = (cls: string, more: Partial<Design> = {}, open = false): Slot => ({
  design: sanitize({ ...DEFAULT_DESIGN, type: 'sealed', plotRange: 'high', driverClass: classIndex(cls), ...more }),
  open,
  backCm: 0,
  trimDb: 0,
  invert: false,
});

/** A starting slot for a role in an arrangement: a driver that suits the role and air for all of its drivers. */
function defaultSlot(id: ArrangementId, k: number): Slot {
  const spec = arrangementOf(id).slots[k];
  if (!spec) return slotOf('1 in dome', { volumeL: 0.5 });
  if (spec.role === 'tweeter') return slotOf('1 in dome', { volumeL: 0.5 });
  if (spec.role === 'mid') return slotOf('4 in mid', { volumeL: 2 * spec.count });
  return id === 'three-way' ? slotOf('8 in', { volumeL: 25 }) : slotOf('5.25 in', { volumeL: 8 * spec.count });
}

/** Where a speaker starts: a sensible build of the arrangement, one driver class per role. */
export function defaultSpeaker(id: ArrangementId = 'two-way'): Loudspeaker {
  const arr = arrangementOf(id);
  return {
    arrangement: id,
    slots: [0, 1, 2].map((k) => defaultSlot(id, k)),
    xover: [...arr.xover, ...[400, 3000].slice(arr.xover.length)],
    baffleWidthCm: arr.baffleCm[0],
    baffleHeightCm: arr.baffleCm[1],
    chambers: 'shared',
    baffleStep: true,
    quantity: 2,
    brace: 'none',
  };
}

const num = (v: unknown, r: Range, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? P.clamp(v, r.min, r.max) : fallback);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** Any stored value to a valid Loudspeaker: unknown fields dropped, numbers clamped, always three slots. */
export function sanitizeLoudspeaker(input: unknown): Loudspeaker {
  const i = obj(input);
  const id = ARRANGEMENTS.some((a) => a.id === i.arrangement) ? (i.arrangement as ArrangementId) : 'two-way';
  const d = defaultSpeaker(id);
  const inSlots = Array.isArray(i.slots) ? i.slots : [];
  const xs = Array.isArray(i.xover) ? i.xover : [];
  return {
    arrangement: id,
    slots: d.slots.map((def, k) => {
      const s = obj(inSlots[k]);
      return {
        design: s.design === undefined ? def.design : sanitize(s.design),
        open: s.open === true,
        backCm: num(s.backCm, SLOT_RANGES.backCm, 0),
        trimDb: num(s.trimDb, SLOT_RANGES.trimDb, 0),
        invert: s.invert === true,
      };
    }),
    xover: d.xover.map((x, k) => num(xs[k], SPEAKER_XOVER_RANGE, x)),
    baffleWidthCm: num(i.baffleWidthCm, SPEAKER_RANGES.baffleWidthCm, d.baffleWidthCm),
    baffleHeightCm: num(i.baffleHeightCm, SPEAKER_RANGES.baffleHeightCm, d.baffleHeightCm),
    chambers: i.chambers === 'separate' ? 'separate' : 'shared',
    baffleStep: i.baffleStep !== false,
    quantity: Math.round(num(i.quantity, QUANTITY_RANGE, d.quantity)),
    brace: i.brace === 'single' || i.brace === 'window' ? i.brace : 'none',
  };
}

/**
 * Change the arrangement. A slot keeps its driver and box when it has the same role as before and starts afresh when it
 * does not (a tweeter must not become the midrange); the crossovers and the baffle restart at the arrangement's.
 */
export function applyArrangement(sp: Loudspeaker, id: ArrangementId): Loudspeaker {
  const before = arrangementOf(sp.arrangement).slots;
  const d = defaultSpeaker(id);
  const slots = d.slots.map((fresh, k) => (arrangementOf(id).slots[k]?.role !== undefined && arrangementOf(id).slots[k]!.role === before[k]?.role ? sp.slots[k]! : fresh));
  return sanitizeLoudspeaker({ ...sp, arrangement: id, slots, xover: d.xover, baffleWidthCm: d.baffleWidthCm, baffleHeightCm: d.baffleHeightCm });
}

/** Diameter of a driver's cone (piston), m, from its area. */
export const coneDiameterM = (sdM2: number): number => 2 * Math.sqrt(sdM2 / Math.PI);
/** ka at frequency f for a piston of the given diameter: above about 3 the driver narrows its beam noticeably. */
export const kaOf = (f: number, diameterM: number): number => (Math.PI * f * diameterM) / P.C;
export const BEAMING_KA = 3;
/** A sealed dome or open-baffle driver should be crossed at least this many times above its Fs. */
export const MIN_XOVER_OVER_FS = 2;

export const slotLabel = (arr: Arrangement, k: number): string => arr.slots[k]!.name ?? slotName(arr.slots[k]!.role, arr.slots[k]!.count);
export const slotName = (role: Role, count: number): string => `${count > 1 ? `${count} ` : ''}${{ woofer: 'Woofer', mid: 'Midrange', tweeter: 'Tweeter' }[role]}${count > 1 ? 's' : ''}`;

const SENS_LO = 300;
const SENS_HI = 3000;
const fmt = (v: number, digits = 1): string => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(digits));

/**
 * The speaker as functions of frequency, set up once. Pressure at 1 m on axis, half space, for REF_VOLTS at each driver,
 * the drivers wired in parallel (a passive crossover, if any, is outside this model).
 */
export function loudspeakerEvaluator(sp: Loudspeaker) {
  const arr = arrangementOf(sp.arrangement);
  const n = arr.slots.length;
  const xs = P.effectiveCrossovers(sp.xover, n);
  const slots = arr.slots.map((spec, k) => {
    const s = sp.slots[k]!;
    const driver = driverOf(s.design);
    // n drivers see volume / n each, whether they share the chamber or have one each
    const each: Design = { ...s.design, volumeL: P.groupVolumeM3(s.design.volumeL, spec.count), frontVolumeL: P.groupVolumeM3(s.design.frontVolumeL, spec.count) };
    const raw = rawEvaluator(each);
    const pRef = P.referencePressure(driver, REF_VOLTS) * spec.count;
    const gain = 10 ** (s.trimDb / 20) * (s.invert ? -1 : 1);
    const g = (f: number): P.Cx => (s.open ? P.openBaffleG(f, driver.fs, P.deriveDriver(driver).qts) : raw(f).g);
    const leg = (f: number): P.Cx => {
      if (arr.kind === 'partition') return P.crossoverBands(f, xs)[k]!;
      return k === 0 ? P.lr4Lp(f, xs[0]!) : P.crossoverBands(f, [xs[1]!])[k - 1]!;
    };
    const delayS = s.backCm / 100 / P.C;
    const played = (f: number): P.Cx => P.scale(P.mul(leg(f), g(f)), pRef * gain);
    /** The driver or group alone: no crossover leg, 0 dB trim. */
    const box = (f: number): P.Cx => P.scale(g(f), pRef);
    /** The range the slot plays, Hz: 0 and Infinity when it is not bounded on that side. */
    const bottomHz = arr.kind === 'partition' ? (k > 0 ? xs[k - 1]! : 0) : k === 2 ? xs[1]! : 0;
    const topHz = arr.kind === 'partition' ? (k < n - 1 ? xs[k]! : Infinity) : k === 0 ? xs[0]! : k === 1 ? xs[1]! : Infinity;
    return { spec, s, driver, leg, g, played, box, delayS, bottomHz, topHz };
  });
  const step = (f: number): P.Cx => (sp.baffleStep ? P.baffleStepShelf(f, sp.baffleWidthCm / 100) : P.cx(1));
  const total = (f: number): P.Cx => P.mul(P.systemPressure(f, slots.map((x) => ({ pressure: x.played(f), delayS: x.delayS }))), step(f));
  return { arr, n, xover: xs, slots, step, total };
}

export interface SlotView {
  name: string;
  /** Driver and chamber, in a line. */
  summary: string;
  /** Level through its crossover leg, with trim, dB SPL at 1 m, before the baffle step. */
  levelDb: number[];
}

export interface LoudspeakerView {
  freqs: readonly number[];
  /** The summed speaker with the baffle step, dB SPL at 1 m on axis. */
  levelDb: number[];
  slots: SlotView[];
  xover: number[];
  /** Baffle-step -3 dB frequency, Hz (0 when the step is off). */
  stepHz: number;
  /** Average level from 300 Hz to 3 kHz, dB SPL at REF_VOLTS: the speaker's sensitivity. */
  sensitivityDb: number;
  warnings: string[];
  notes: string[];
}

const N_POINTS = 320;
export const SPEAKER_FREQS: readonly number[] = Array.from({ length: N_POINTS }, (_, k) => 20 * 1000 ** (k / (N_POINTS - 1)));

export function computeLoudspeaker(sp: Loudspeaker): LoudspeakerView {
  const ev = loudspeakerEvaluator(sp);
  const freqs = SPEAKER_FREQS;
  const floor = (pa: number): number => P.splDb(Math.max(pa, 1e-12));
  const levelDb = freqs.map((f) => floor(P.abs(ev.total(f))));
  const slots: SlotView[] = ev.slots.map((x) => ({
    name: slotLabel(ev.arr, ev.slots.indexOf(x)),
    summary: `${x.driver.name}${x.spec.count > 1 ? ` x ${x.spec.count}` : ''}, ${x.s.open ? 'open baffle' : `${fmt(x.s.design.volumeL, x.s.design.volumeL < 10 ? 1 : 0)} L ${x.s.design.type}${x.spec.count > 1 ? ` (${sp.chambers})` : ''}`}`,
    levelDb: freqs.map((f) => floor(P.abs(x.played(f)))),
  }));
  const span = levelDb.filter((_, i) => freqs[i]! >= SENS_LO && freqs[i]! <= SENS_HI);
  const sensitivityDb = span.reduce((a, b) => a + b, 0) / span.length;

  const warnings: string[] = [];
  const notes: string[] = [];
  const widthM = sp.baffleWidthCm / 100;
  ev.slots.forEach((x, k) => {
    const name = slots[k]!.name;
    const top = x.topHz;
    const bottom = x.bottomHz;
    if (bottom > 0 && bottom < MIN_XOVER_OVER_FS * x.driver.fs)
      warnings.push(`${name}: crossed at ${fmt(bottom, 0)} Hz, under twice its ${fmt(x.driver.fs, 0)} Hz resonance. It will be asked for more excursion than it has; cross higher.`);
    const dia = coneDiameterM(x.driver.sd);
    if (Number.isFinite(top) && kaOf(top, dia) > BEAMING_KA)
      warnings.push(`${name}: the ${fmt(top, 0)} Hz crossover is above where a ${fmt(dia * 100)} cm cone starts to narrow its beam (about ${fmt((BEAMING_KA * P.C) / (Math.PI * dia), 0)} Hz). Cross lower or use a smaller driver.`);
    if (dia + 0.02 > widthM) warnings.push(`${name}: the ${fmt(dia * 100)} cm cone does not fit a ${fmt(sp.baffleWidthCm, 0)} cm wide baffle.`);
  });
  ev.xover.forEach((fx, k) => {
    if (Math.abs(fx - sp.xover[k]!) > 1e-9) notes.push(`Crossover ${k + 1} is used at ${fmt(fx, 0)} Hz, not ${fmt(sp.xover[k]!, 0)} Hz: points must rise by at least 1.2x.`);
  });
  const stepHz = sp.baffleStep ? P.baffleStepCornerHz(widthM) : 0;
  if (sp.baffleStep) notes.push(`Baffle step: the bass falls 6 dB below about ${fmt(stepHz, 0)} Hz for a free-standing box on a ${fmt(sp.baffleWidthCm, 0)} cm baffle. Against a wall the step is smaller; turn it off for an in-wall speaker.`);
  notes.push(`Levels are for ${REF_VOLTS} V at each driver, on axis at 1 m in half space. Drivers are taken as wired in parallel behind an active crossover; vertical lobing between drivers, the tweeter's beaming and edge diffraction are not modelled.`);
  return { freqs, levelDb, slots, xover: ev.xover, stepHz, sensitivityDb, warnings, notes };
}

/**
 * Bring each driver's own passband level (its box response over the range it plays, at 0 dB trim, 1 m) down to the quietest
 * driver's, which stays at 0 dB. Rounded to 0.1 dB and limited to the trim range. A driver with no passband is left alone.
 */
export function nativeLevels(sp: Loudspeaker): number[] {
  const ev = loudspeakerEvaluator(sp);
  return ev.slots.map((x) => {
    const lo = Math.max(x.bottomHz, LEVEL_LO_HZ);
    const hi = Math.min(x.topHz, LEVEL_HI_HZ);
    const inBand = SPEAKER_FREQS.filter((f) => f >= lo && f <= hi).map((f) => P.splDb(P.abs(x.box(f))));
    return inBand.length ? inBand.reduce((a, b) => a + b, 0) / inBand.length : Number.NaN;
  });
}

export function levelSpeaker(sp: Loudspeaker): Loudspeaker {
  const arr = arrangementOf(sp.arrangement);
  const native = nativeLevels(sp); // the box response has no trim in it, so old trims do not matter
  const target = Math.min(...native.filter(Number.isFinite));
  return sanitizeLoudspeaker({ ...sp, slots: sp.slots.map((s, k) => ({ ...s, trimDb: k < arr.slots.length && Number.isFinite(native[k]!) ? Math.round((target - native[k]!) * 10) / 10 + 0 : 0 })) });
}

/**
 * A ported box's tuning and port for a slot: tuned at Fs (Vas / Vb)^0.31, a port half the cone's diameter, widened until its
 * tube is at least 2 cm long (a tube's length is k d^2 - 0.732 d, so a port too narrow for its chamber has no length at all:
 * it grows with the diameter). The chamber is shared by `count` drivers, each with a port of this size.
 */
export function portedDefaults(d: Design, count = 1): Pick<Design, 'tuneHz' | 'portDiameterCm'> {
  const driver = driverOf(d);
  const each = d.volumeL / Math.max(count, 1);
  const tune = P.clamp(Math.round(driver.fs * (driver.vasM3 / (each / 1000)) ** 0.31), BOX_RANGES.tuneHz.min, BOX_RANGES.tuneHz.max);
  let dia = P.clamp(Math.round(coneDiameterM(driver.sd) * 50 * 10) / 10, BOX_RANGES.portDiameterCm.min, BOX_RANGES.portDiameterCm.max);
  while (dia < BOX_RANGES.portDiameterCm.max && P.portLengthM(each / 1000, tune, dia / 100) < MIN_PORT_LENGTH_M) dia = Math.min(BOX_RANGES.portDiameterCm.max, Math.round(dia * 1.15 * 10) / 10 + 0.1);
  return { tuneHz: tune, portDiameterCm: dia };
}
const MIN_PORT_LENGTH_M = 0.02;
const LEVEL_LO_HZ = 200;
const LEVEL_HI_HZ = 12000;

export interface SpeakerTemplate {
  label: string;
  description: string;
  speaker: Loudspeaker;
}

/** A starting design: the arrangement's defaults with the given drivers, a box for each, and the baffle; levelled on load. */
function template(id: ArrangementId, baffle: [number, number], xover: number[], slots: { cls: string; volumeL: number; ported?: boolean }[], more: Partial<Loudspeaker> = {}): Loudspeaker {
  const d = defaultSpeaker(id);
  const arr = arrangementOf(id);
  const built = d.slots.map((s, k) => {
    const want = slots[k];
    if (!want) return s;
    const base: Design = { ...s.design, driverClass: classIndex(want.cls), volumeL: want.volumeL, type: 'sealed' };
    return { ...s, design: want.ported ? { ...base, type: 'ported', ...portedDefaults(base, arr.slots[k]!.count) } : base };
  });
  return levelSpeaker(sanitizeLoudspeaker({ ...d, ...more, slots: built, xover: [...xover, ...d.xover.slice(xover.length)], baffleWidthCm: baffle[0], baffleHeightCm: baffle[1] }));
}

/** Generic starting points: invented driver values, no brand or model. Desktop to floorstanding. */
export const SPEAKER_TEMPLATES: readonly SpeakerTemplate[] = [
  { label: 'Desktop 2-way (4 in)', description: 'A small sealed speaker for a desk or shelf: 4 in woofer, 0.75 in dome, crossed at 3 kHz.', speaker: template('two-way', [14, 22], [3000], [{ cls: '4 in', volumeL: 3 }, { cls: '0.75 in dome', volumeL: 0.3 }]) },
  { label: 'Bookshelf 2-way, sealed (5.25 in)', description: 'The classic bookshelf: 5.25 in woofer in 8 L sealed, 1 in dome, 2.5 kHz.', speaker: template('two-way', [20, 32], [2500], [{ cls: '5.25 in', volumeL: 8 }, { cls: '1 in dome', volumeL: 0.5 }]) },
  { label: 'Bookshelf 2-way, ported (5.25 in)', description: 'The same drivers in a bigger ported box for more bass, 2.5 kHz.', speaker: template('two-way', [20, 36], [2500], [{ cls: '5.25 in', volumeL: 12, ported: true }, { cls: '1 in dome', volumeL: 0.5 }]) },
  { label: 'Floorstander 2-way (8 in)', description: 'A tall ported speaker: 8 in woofer in 25 L, 1.25 in dome, crossed at 1.8 kHz.', speaker: template('two-way', [24, 95], [1800], [{ cls: '8 in', volumeL: 25, ported: true }, { cls: '1.25 in dome', volumeL: 0.6 }]) },
  { label: "D'Appolito bookshelf (2 x 4 in)", description: 'MTM: two 4 in drivers either side of a dome, sealed, crossed at 2.5 kHz. Narrow, with a tall, even sound field.', speaker: template('mtm', [16, 40], [2500], [{ cls: '4 in mid', volumeL: 5 }, { cls: '1 in dome', volumeL: 0.5 }]) },
  { label: 'MTM tower (2 x 5.25 in)', description: 'A ported tower: two 5.25 in drivers around a dome, 2.5 kHz.', speaker: template('mtm', [18, 100], [2500], [{ cls: '5.25 in', volumeL: 20, ported: true }, { cls: '1 in dome', volumeL: 0.6 }]) },
  { label: '3-way floorstander', description: '10 in ported woofer, 4 in midrange, dome tweeter; 350 Hz and 3 kHz.', speaker: template('three-way', [28, 110], [350, 3000], [{ cls: '10 in', volumeL: 40, ported: true }, { cls: '4 in mid', volumeL: 2 }, { cls: '1 in dome', volumeL: 0.5 }]) },
  { label: '2.5-way tower (2 x 5.25 in)', description: 'Two woofers, the lower playing only the bass (below 300 Hz), plus a dome; 2.5 kHz.', speaker: template('two-and-half', [20, 85], [300, 2500], [{ cls: '5.25 in', volumeL: 8 }, { cls: '5.25 in', volumeL: 8 }, { cls: '1 in dome', volumeL: 0.5 }]) },
];

/** A starting design as the speaker, keeping how many to build and the bracing. */
export function applySpeakerTemplate(sp: Loudspeaker, index: number): Loudspeaker {
  const t = SPEAKER_TEMPLATES[index]!.speaker;
  return sanitizeLoudspeaker({ ...t, quantity: sp.quantity, brace: sp.brace, chambers: sp.chambers });
}
