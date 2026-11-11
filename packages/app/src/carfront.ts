// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The front speakers of a car system: a component set (woofer and tweeter) or a coaxial, in a door, a kick panel or the dash, with the
// air behind them, the crossovers to the sub and between the two drivers, a fit check against the opening and depth, and the
// adapter ring they sit on. Pure functions; carsub.ts sums them with the sub.
import * as P from '@soundsystemdesigner/physics';
import { coneDiameterM, kaOf, BEAMING_KA, MIN_XOVER_OVER_FS } from './loudspeaker';
import { DEFAULT_DESIGN, type Design, type Range, REF_VOLTS, driverOf, rawEvaluator, sanitize } from './model';

export type FrontType = 'component' | 'coaxial';
export type FrontMount = 'door' | 'kick' | 'dash';

const classIndex = (name: string): number => P.ALL_DRIVER_CLASSES.findIndex((d) => d.name === name);

export interface Cutout {
  /** A round hole of diameter wCm, or an oval of wCm x hCm (a 6x9). */
  kind: 'round' | 'oval';
  wCm: number;
  hCm: number;
}

/** What each front class needs: depth behind the baffle, the hole it is cut into, and whether a tweeter is built in. Generic estimates. */
export const FRONT_INFO: Record<string, { depthCm: number; cutout: Cutout; coax: boolean }> = {
  '5.25 in door': { depthCm: 6, cutout: { kind: 'round', wCm: 11.8, hCm: 11.8 }, coax: false },
  '6.5 in door': { depthCm: 7, cutout: { kind: 'round', wCm: 14.2, hCm: 14.2 }, coax: false },
  '6x9 door': { depthCm: 7.5, cutout: { kind: 'oval', wCm: 21.6, hCm: 14 }, coax: false },
  '5.25 in coax': { depthCm: 6.5, cutout: { kind: 'round', wCm: 11.8, hCm: 11.8 }, coax: true },
  '6.5 in coax': { depthCm: 7.5, cutout: { kind: 'round', wCm: 14.2, hCm: 14.2 }, coax: true },
  '6x9 coax': { depthCm: 8, cutout: { kind: 'oval', wCm: 21.6, hCm: 14 }, coax: true },
};

export const FRONT_COMPONENT_CLASSES: readonly string[] = ['5.25 in door', '6.5 in door', '6x9 door'];
export const FRONT_COAX_CLASSES: readonly string[] = ['5.25 in coax', '6.5 in coax', '6x9 coax'];
export const FRONT_TWEETER_CLASSES: readonly string[] = ['0.75 in dome', '1 in dome', '1.25 in dome'];

/** The air behind a front woofer, the depth it has and the opening, by where it is mounted: starting points to edit. */
export const MOUNT_DEFAULTS: Record<FrontMount, { label: string; airL: number; depthCm: number }> = {
  door: { label: 'Door', airL: 20, depthCm: 9 },
  kick: { label: 'Kick panel pod', airL: 8, depthCm: 10 },
  dash: { label: 'Dash', airL: 5, depthCm: 8 },
};

export interface CarFront {
  enabled: boolean;
  type: FrontType;
  mount: FrontMount;
  /** Class index of the woofer (or the coaxial) and of the separate tweeter. */
  wooferClass: number;
  tweeterClass: number;
  /** Sealed air behind each woofer, L; the depth available behind the baffle, the width of the opening in the panel and the adapter ring's thickness, cm. */
  airL: number;
  depthCm: number;
  openingCm: number;
  ringCm: number;
  /** Where the sub hands over to the fronts, and the woofer to the tweeter, Hz; the fronts' trim and the tweeter's trim against the woofer, dB. */
  xoverSubHz: number;
  xoverTweeterHz: number;
  trimDb: number;
  tweeterTrimDb: number;
}

export type FrontField = 'airL' | 'depthCm' | 'openingCm' | 'ringCm' | 'xoverSubHz' | 'xoverTweeterHz' | 'trimDb' | 'tweeterTrimDb';
export const FRONT_RANGES: Record<FrontField, Range> = {
  airL: { label: 'Air behind each woofer', unit: 'L', min: 0.5, max: 60 },
  depthCm: { label: 'Depth available', unit: 'cm', min: 2, max: 30, linear: true },
  openingCm: { label: 'Opening in the panel', unit: 'cm', min: 8, max: 30, linear: true },
  ringCm: { label: 'Adapter ring thickness', unit: 'cm', min: 0, max: 5, linear: true },
  xoverSubHz: { label: 'Sub / front crossover', unit: 'Hz', min: 50, max: 250 },
  xoverTweeterHz: { label: 'Woofer / tweeter crossover', unit: 'Hz', min: 1000, max: 8000 },
  trimDb: { label: 'Front trim', unit: 'dB', min: -30, max: 12, linear: true },
  tweeterTrimDb: { label: 'Tweeter trim', unit: 'dB', min: -20, max: 6, linear: true },
};

export const infoOf = (classIdx: number): (typeof FRONT_INFO)[string] | null => FRONT_INFO[P.ALL_DRIVER_CLASSES[classIdx]?.name ?? ''] ?? null;

export const DEFAULT_FRONT: CarFront = {
  enabled: false,
  type: 'component',
  mount: 'door',
  wooferClass: classIndex('6.5 in door'),
  tweeterClass: classIndex('1 in dome'),
  airL: MOUNT_DEFAULTS.door.airL,
  depthCm: MOUNT_DEFAULTS.door.depthCm,
  openingCm: 15.2,
  ringCm: 1,
  xoverSubHz: 100,
  xoverTweeterHz: 2400,
  trimDb: 0,
  tweeterTrimDb: 0,
};

const num = (v: unknown, r: Range, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? P.clamp(v, r.min, r.max) : fallback);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** Any stored value to a valid CarFront: classes made consistent with the type, numbers clamped. */
export function sanitizeFront(input: unknown): CarFront {
  const i = obj(input);
  const d = DEFAULT_FRONT;
  const type: FrontType = i.type === 'coaxial' ? 'coaxial' : 'component';
  const allowed = (type === 'coaxial' ? FRONT_COAX_CLASSES : FRONT_COMPONENT_CLASSES).map(classIndex);
  const wooferClass = typeof i.wooferClass === 'number' && allowed.includes(i.wooferClass) ? i.wooferClass : allowed[1]!;
  const tweeters = FRONT_TWEETER_CLASSES.map(classIndex);
  const mount: FrontMount = i.mount === 'kick' || i.mount === 'dash' ? i.mount : 'door';
  return {
    enabled: i.enabled === true,
    type,
    mount,
    wooferClass,
    tweeterClass: typeof i.tweeterClass === 'number' && tweeters.includes(i.tweeterClass) ? i.tweeterClass : d.tweeterClass,
    airL: num(i.airL, FRONT_RANGES.airL, MOUNT_DEFAULTS[mount].airL),
    depthCm: num(i.depthCm, FRONT_RANGES.depthCm, MOUNT_DEFAULTS[mount].depthCm),
    openingCm: num(i.openingCm, FRONT_RANGES.openingCm, d.openingCm),
    ringCm: num(i.ringCm, FRONT_RANGES.ringCm, d.ringCm),
    xoverSubHz: num(i.xoverSubHz, FRONT_RANGES.xoverSubHz, d.xoverSubHz),
    xoverTweeterHz: num(i.xoverTweeterHz, FRONT_RANGES.xoverTweeterHz, d.xoverTweeterHz),
    trimDb: num(i.trimDb, FRONT_RANGES.trimDb, d.trimDb),
    tweeterTrimDb: num(i.tweeterTrimDb, FRONT_RANGES.tweeterTrimDb, d.tweeterTrimDb),
  };
}

/** Change the type, mount or class and start the dependent numbers afresh (the air and depth of a mount, the matching class). */
export function applyFront(f: CarFront, patch: Partial<CarFront>): CarFront {
  const next = { ...f, ...patch };
  if (patch.mount !== undefined && patch.mount !== f.mount) {
    next.airL = MOUNT_DEFAULTS[patch.mount].airL;
    next.depthCm = MOUNT_DEFAULTS[patch.mount].depthCm;
  }
  if (patch.type !== undefined && patch.type !== f.type) next.wooferClass = classIndex(patch.type === 'coaxial' ? '6.5 in coax' : '6.5 in door');
  // a different driver has a different cut-out: the opening starts 1 cm wider than it
  if (next.wooferClass !== f.wooferClass) {
    const cut = infoOf(next.wooferClass)?.cutout;
    if (cut) next.openingCm = cut.wCm + 1;
  }
  return sanitizeFront(next);
}

/** The ring's outside size, cm: the opening plus a 1.5 cm flange each side (an oval's both dimensions grow the same). */
export const RING_FLANGE_CM = 1.5;

export interface FrontRing {
  title: string;
  /** Outside and inside (the cut-out for the driver), cm; round rings have equal width and height. */
  outer: { kind: Cutout['kind']; wCm: number; hCm: number };
  inner: Cutout;
  thicknessCm: number;
  /** Mounting screws on a circle (or the oval's centre line), count and their pitch diameter, cm. */
  screws: number;
}

/** The adapter ring each front woofer sits on, or null when the class is unknown. */
export function ringOf(f: CarFront): FrontRing | null {
  const info = infoOf(f.wooferClass);
  if (!info) return null;
  const c = info.cutout;
  const oval = c.kind === 'oval';
  const outW = Math.max(f.openingCm, c.wCm + 1) + 2 * RING_FLANGE_CM;
  const outH = oval ? Math.max(f.openingCm * (c.hCm / c.wCm), c.hCm + 1) + 2 * RING_FLANGE_CM : outW;
  return { title: `${P.ALL_DRIVER_CLASSES[f.wooferClass]!.name} adapter ring`, outer: { kind: c.kind, wCm: outW, hCm: outH }, inner: c, thicknessCm: f.ringCm, screws: 4 };
}

/** Screw holes of a ring, cm from its centre: on the circle (or the ellipse) halfway between the cut-out and the edge, at 45, 135, 225 and 315 degrees. */
export function ringScrews(r: FrontRing): { x: number; y: number }[] {
  const rx = (r.outer.wCm + r.inner.wCm) / 4;
  const ry = (r.outer.hCm + r.inner.hCm) / 4;
  return Array.from({ length: r.screws }, (_, k) => {
    const a = Math.PI / 4 + (k * 2 * Math.PI) / r.screws;
    return { x: rx * Math.cos(a), y: ry * Math.sin(a) };
  });
}
/** Diameter of a ring's screw holes, cm. */
export const RING_SCREW_CM = 0.4;

const fmt = (v: number, digits = 1): string => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(digits));

export interface FrontView {
  /** Sealed corner of the woofer in its air, Hz, and the depth and opening it needs against what is available. */
  fcHz: number;
  needDepthCm: number;
  warnings: string[];
}

/** Checks on the front speakers that do not need the sub: fit, crossovers, the woofer's own roll-off. */
export function checkFront(f: CarFront): FrontView {
  const warnings: string[] = [];
  const driver = driverOf(wooferDesign(f));
  const qts = P.deriveDriver(driver).qts;
  const fcHz = P.sealedParams(driver.fs, qts, driver.vasM3, f.airL / 1000).fc;
  const info = infoOf(f.wooferClass);
  const needDepthCm = (info?.depthCm ?? 0) + f.ringCm;
  const name = P.ALL_DRIVER_CLASSES[f.wooferClass]?.name ?? 'front';
  if (info && needDepthCm > f.depthCm + 1e-9)
    warnings.push(`The ${name} needs about ${fmt(needDepthCm)} cm behind the baffle (${fmt(info.depthCm)} cm driver and ${fmt(f.ringCm)} cm ring) and ${mountText(f.mount)} has ${fmt(f.depthCm)} cm. Use a thinner ring, a shallower driver or more room.`);
  if (info && f.openingCm < info.cutout.wCm + 0.5 - 1e-9)
    warnings.push(`The ${fmt(f.openingCm)} cm opening is smaller than the ${name}'s ${fmt(info.cutout.wCm)} cm cut-out. Open it up or use a smaller driver.`);
  if (f.xoverSubHz < fcHz - 1e-9)
    warnings.push(`The front speakers are still rolling off at the ${fmt(f.xoverSubHz, 0)} Hz crossover: they are a sealed ${fmt(f.airL)} L box with a corner at ${fmt(fcHz, 0)} Hz. Cross higher or give them more air.`);
  if (f.type === 'component') {
    const tw = P.ALL_DRIVER_CLASSES[f.tweeterClass]!;
    if (f.xoverTweeterHz < MIN_XOVER_OVER_FS * tw.fs) warnings.push(`The ${tw.name} is crossed at ${fmt(f.xoverTweeterHz, 0)} Hz, under twice its ${fmt(tw.fs, 0)} Hz resonance. Cross higher.`);
    const dia = coneDiameterM(driver.sd);
    if (kaOf(f.xoverTweeterHz, dia) > BEAMING_KA) warnings.push(`The ${fmt(f.xoverTweeterHz, 0)} Hz tweeter crossover is above where a ${fmt(dia * 100)} cm cone starts to narrow its beam. Cross lower.`);
  }
  return { fcHz, needDepthCm, warnings };
}

const mountText = (m: FrontMount): string => ({ door: 'the door', kick: 'the kick panel pod', dash: 'the dash' }[m]);

/** The front woofer (or the coaxial) in its sealed air, as a box design. */
export function wooferDesign(f: CarFront): Design {
  return sanitize({ ...DEFAULT_DESIGN, driverClass: f.wooferClass, type: 'sealed', volumeL: f.airL, plotRange: 'low' });
}
export function tweeterDesign(f: CarFront): Design {
  return sanitize({ ...DEFAULT_DESIGN, driverClass: f.tweeterClass, type: 'sealed', volumeL: 0.5, plotRange: 'high' });
}

/** The front drivers' pressure at 1 m for the reference voltage, one speaker, before the crossover legs and the trims. */
export function frontPressures(f: CarFront): { woofer: (fr: number) => P.Cx; tweeter: ((fr: number) => P.Cx) | null } {
  const wd = wooferDesign(f);
  const wRaw = rawEvaluator(wd);
  const wRef = P.referencePressure(driverOf(wd), REF_VOLTS);
  const woofer = (fr: number): P.Cx => P.scale(wRaw(fr).g, wRef);
  if (f.type === 'coaxial') return { woofer, tweeter: null };
  const td = tweeterDesign(f);
  const tRaw = rawEvaluator(td);
  const tRef = P.referencePressure(driverOf(td), REF_VOLTS);
  return { woofer, tweeter: (fr: number): P.Cx => P.scale(tRaw(fr).g, tRef) };
}
