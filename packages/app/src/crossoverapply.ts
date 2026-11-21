// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Applying the crossover on the Crossover page back to a design: the alignment, order and crossover frequencies go into the PA system,
// the home speaker or the car's front speakers. The number of ways must match the design's (this never adds or removes a band or a
// driver), and every value goes through the design's own sanitiser, so what lands is what that page accepts.
import { type XoShape, type XoState, shapeLabel, xoverUsed } from './crossover';
import { arrangementOf } from './loudspeaker';
import { type Project, sanitizeProject } from './system';

export type ApplyTarget = 'system' | 'speaker' | 'car';
export const TARGET_LABEL: Record<ApplyTarget, string> = { system: 'PA system', speaker: 'home speaker', car: 'car fronts' };

export type Applied = { ok: true; project: Project; message: string } | { ok: false; reason: string };

const shapeOf = (xo: XoState): XoShape => ({ alignment: xo.alignment, order: xo.order, rippleDb: xo.rippleDb });
const hz = (v: number): string => `${Math.round(v)} Hz`;

/** What each design's crossover points would become, or why it cannot take this crossover. */
export function applyToDesign(p: Project, target: ApplyTarget): Applied {
  const xo = p.xo;
  const xs = xoverUsed(xo);
  const n = xo.ways;
  const shape = shapeOf(xo);
  const done = (next: Project, got: readonly number[]): Applied => {
    const clamped = got.some((g, k) => Math.abs(g - xs[k]!) > 0.5);
    return { ok: true, project: next, message: `Applied to the ${TARGET_LABEL[target]}: ${shapeLabel(shape)} at ${got.map(hz).join(' and ')}${clamped ? ` (the ${TARGET_LABEL[target]} page limited the request of ${xs.map(hz).join(' and ')})` : ''}. Open that page to see it; "Undo last load" brings back what you had.` };
  };
  if (target === 'system') {
    if (p.nBands !== n) return { ok: false, reason: `The PA system has ${p.nBands} band${p.nBands === 1 ? '' : 's'}; this crossover has ${n} ways. Set the PA system to ${n} bands first.` };
    const next = sanitizeProject({ ...p, xoShape: shape, xover: [...xs, ...p.xover.slice(xs.length)] });
    return done(next, next.xover.slice(0, n - 1));
  }
  if (target === 'speaker') {
    const arr = arrangementOf(p.speaker.arrangement);
    if (arr.slots.length !== n) return { ok: false, reason: `The home speaker is a ${arr.label} with ${arr.slots.length} drivers; this crossover has ${n} ways. Choose a ${n}-way arrangement first.` };
    const next = sanitizeProject({ ...p, speaker: { ...p.speaker, shape, xover: [...xs, ...p.speaker.xover.slice(xs.length)] } });
    return done(next, next.speaker.xover.slice(0, n - 1));
  }
  const f = p.car.front;
  if (!f.enabled) return { ok: false, reason: 'The car has no front speakers turned on.' };
  const subSplit = n === 2 && xo.drivers[0]!.role === 'sub';
  if (n > 3) return { ok: false, reason: 'The car takes at most a sub, a front woofer and a tweeter: three ways.' };
  if (f.type !== 'component' && (n === 3 || !subSplit)) return { ok: false, reason: 'A coaxial has its tweeter built in: only the sub-to-front crossover can be set.' };
  const patch = n === 3 ? { xoverSubHz: xs[0]!, xoverTweeterHz: xs[1]! } : subSplit ? { xoverSubHz: xs[0]! } : { xoverTweeterHz: xs[0]! };
  const next = sanitizeProject({ ...p, car: { ...p.car, front: { ...f, ...patch, shape } } });
  const nf = next.car.front;
  return done(next, n === 3 ? [nf.xoverSubHz, nf.xoverTweeterHz] : subSplit ? [nf.xoverSubHz] : [nf.xoverTweeterHz]);
}

export interface ApplyOption {
  target: ApplyTarget;
  label: string;
  ok: boolean;
  /** Why not, or what it will do. */
  hint: string;
}

/** The three targets with whether each can take the crossover now. */
export function applyOptions(p: Project): ApplyOption[] {
  return (['system', 'speaker', 'car'] as const).map((target) => {
    const r = applyToDesign(p, target);
    return { target, label: `Apply to the ${TARGET_LABEL[target]}`, ok: r.ok, hint: r.ok ? '' : r.reason };
  });
}
