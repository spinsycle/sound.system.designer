// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// A loudspeaker: several drivers in ONE cabinet (home stereo speakers, desktop to floorstanding): 2-way, MTM, WTW, TMM,
// 3-way and 2.5-way. Each slot is one driver or a group of identical ones behind an active LR4 crossover leg; the legs
// sum as complex pressure and the baffle step multiplies the sum. Pure functions; the page draws what computeLoudspeaker
// returns. Spec: "Loudspeaker cabinets" (v0.11).
import * as P from '@soundsystemdesigner/physics';
import { DEFAULT_DESIGN, type Design, type Range, REF_VOLTS, driverOf, rawEvaluator, sanitize } from './model';

export type Role = 'woofer' | 'mid' | 'tweeter';

export type ArrangementId = 'two-way' | 'mtm' | 'wtw' | 'tmm' | 'three-way' | 'two-and-half';

export interface Arrangement {
  id: ArrangementId;
  label: string;
  description: string;
  /** Low to high frequency; `count` identical drivers per slot. */
  slots: readonly { role: Role; count: number }[];
  /** Where the slots sit on the baffle from top to bottom (indices into slots, a slot with 2 drivers appears twice). */
  layout: readonly number[];
  /**
   * partition: each slot plays between its neighbours' crossover points and the legs sum flat.
   * assist: slot 0 is a second woofer that plays only below the first crossover (a 2.5-way); slots 1 and 2 split at the second.
   */
  kind: 'partition' | 'assist';
  xover: readonly number[];
}

export const ARRANGEMENTS: readonly Arrangement[] = [
  { id: 'two-way', label: '2-way', description: 'One woofer and one tweeter.', slots: [{ role: 'woofer', count: 1 }, { role: 'tweeter', count: 1 }], layout: [1, 0], kind: 'partition', xover: [2500] },
  { id: 'mtm', label: 'MTM (D’Appolito)', description: 'Midrange, tweeter, midrange: the tweeter between two matched drivers.', slots: [{ role: 'mid', count: 2 }, { role: 'tweeter', count: 1 }], layout: [0, 1, 0], kind: 'partition', xover: [2500] },
  { id: 'wtw', label: 'WTW', description: 'Woofer, tweeter, woofer: two woofers around the tweeter.', slots: [{ role: 'woofer', count: 2 }, { role: 'tweeter', count: 1 }], layout: [0, 1, 0], kind: 'partition', xover: [2200] },
  { id: 'tmm', label: 'TMM', description: 'Tweeter on top of two matched drivers.', slots: [{ role: 'mid', count: 2 }, { role: 'tweeter', count: 1 }], layout: [1, 0, 0], kind: 'partition', xover: [2500] },
  { id: 'three-way', label: '3-way', description: 'Woofer, midrange and tweeter.', slots: [{ role: 'woofer', count: 1 }, { role: 'mid', count: 1 }, { role: 'tweeter', count: 1 }], layout: [2, 1, 0], kind: 'partition', xover: [400, 3000] },
  { id: 'two-and-half', label: '2.5-way', description: 'Two woofers, the second playing only the bass, plus a tweeter.', slots: [{ role: 'woofer', count: 1 }, { role: 'woofer', count: 1 }, { role: 'tweeter', count: 1 }], layout: [2, 1, 0], kind: 'assist', xover: [300, 2500] },
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
export const SPEAKER_XOVER_RANGE: Range = { label: 'Crossover', unit: 'Hz', min: 100, max: 8000 };

const classIndex = (name: string): number => P.ALL_DRIVER_CLASSES.findIndex((d) => d.name === name);

const slotOf = (cls: string, more: Partial<Design> = {}, open = false): Slot => ({
  design: sanitize({ ...DEFAULT_DESIGN, type: 'sealed', plotRange: 'high', driverClass: classIndex(cls), ...more }),
  open,
  backCm: 0,
  trimDb: 0,
  invert: false,
});

/** Where a speaker starts: a sensible small bookshelf with an arrangement's roles, one driver class per role. */
export function defaultSpeaker(id: ArrangementId = 'two-way'): Loudspeaker {
  return {
    arrangement: id,
    slots: [slotOf('5.25 in', { volumeL: 8 }), slotOf('1 in dome', { volumeL: 0.5 }), slotOf('1 in dome', { volumeL: 0.5 })],
    xover: [...arrangementOf(id).xover, ...[400, 3000].slice(arrangementOf(id).xover.length)],
    baffleWidthCm: 20,
    baffleHeightCm: 32,
    chambers: 'shared',
    baffleStep: true,
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
  };
}

/** Change the arrangement, keeping each slot's design, the baffle and the stage settings; the crossover points restart at the arrangement's. */
export function applyArrangement(sp: Loudspeaker, id: ArrangementId): Loudspeaker {
  return sanitizeLoudspeaker({ ...sp, arrangement: id, xover: defaultSpeaker(id).xover });
}

/** Diameter of a driver's cone (piston), m, from its area. */
export const coneDiameterM = (sdM2: number): number => 2 * Math.sqrt(sdM2 / Math.PI);
/** ka at frequency f for a piston of the given diameter: above about 3 the driver narrows its beam noticeably. */
export const kaOf = (f: number, diameterM: number): number => (Math.PI * f * diameterM) / P.C;
export const BEAMING_KA = 3;
/** A sealed dome or open-baffle driver should be crossed at least this many times above its Fs. */
export const MIN_XOVER_OVER_FS = 2;

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
    return { spec, s, driver, leg, g, played, delayS };
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
    name: slotName(x.spec.role, x.spec.count),
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
    const top = ev.arr.kind === 'partition' ? (k < ev.n - 1 ? ev.xover[k]! : Infinity) : k === 0 ? ev.xover[0]! : k === 1 ? ev.xover[1]! : Infinity;
    const bottom = ev.arr.kind === 'partition' ? (k > 0 ? ev.xover[k - 1]! : 0) : k === 2 ? ev.xover[1]! : 0;
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
