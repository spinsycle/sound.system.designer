// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Starting a crossover from the design that is open on another page: the PA bands, the home speaker's drivers or the car's front
// speakers. Each driver comes over as its generic datasheet numbers (level, resonance, resistance, an estimated inductance) to edit.
import * as P from '@soundsystemdesigner/physics';
import { type Role, ROLES_FOR, ROLE_DEFAULTS, type XoDriver, type XoState, XOVER_FOR, driverFor, sanitizeXo } from './crossover';
import { arrangementOf } from './loudspeaker';
import { driverOf } from './model';
import { type Project, bandName } from './system';
import { DEFAULT_XO } from './crossover';

export type Imported = { ok: true; label: string; drivers: XoDriver[]; xover: number[] } | { ok: false; reason: string };

const NOMINAL = [2, 3, 4, 6, 8, 16] as const;

/** A generic driver spec as a crossover driver in the given role. */
export function driverFromSpec(spec: P.DriverSpec, role: Role, name: string, setBackMm = 0): XoDriver {
  const nom = NOMINAL.reduce((a, b) => (Math.abs(Math.log(b / (spec.re * 1.2))) < Math.abs(Math.log(a / (spec.re * 1.2))) ? b : a));
  return {
    ...driverFor(role, name),
    nomOhm: nom,
    reOhm: P.clamp(spec.re, 0.5, 64),
    leMh: Math.round(P.estimateLeH(spec) * 1e6) / 1000,
    fsHz: P.clamp(spec.fs, 5, 20000),
    qts: P.clamp(P.deriveDriver(spec).qts, 0.1, 3),
    qms: P.clamp(spec.qms, 0.5, 50),
    sensDb: P.clamp(Math.round(P.splDb(P.referencePressure(spec, 2.83, 1)) * 10) / 10, 60, 130),
    upperHz: ROLE_DEFAULTS[role].upperHz,
    setBackMm,
  };
}

/** What the open design gives: its drivers low to high and its crossover points; or why it gives none. */
export function importFromDesign(p: Project, kind: 'system' | 'speaker' | 'car'): Imported {
  if (kind === 'speaker') {
    const arr = arrangementOf(p.speaker.arrangement);
    const slots = arr.slots.slice(0, 3);
    return {
      ok: true,
      label: `home speaker (${arr.label})`,
      drivers: slots.map((s, k) => driverFromSpec(driverOf(p.speaker.slots[k]!.design), s.role === 'mid' ? 'mid' : s.role, s.name ?? `${s.role[0]!.toUpperCase()}${s.role.slice(1)}`, p.speaker.slots[k]!.backCm * 10)),
      xover: p.speaker.xover.slice(0, slots.length - 1),
    };
  }
  if (kind === 'car') {
    const f = p.car.front;
    if (!f.enabled) return { ok: false, reason: 'The car has no front speakers turned on.' };
    if (f.type !== 'component') return { ok: false, reason: 'A coaxial has its tweeter built in: there is nothing to cross over.' };
    return {
      ok: true,
      label: 'car front speakers',
      drivers: [driverFromSpec(P.ALL_DRIVER_CLASSES[f.wooferClass]!, 'woofer', 'Woofer'), driverFromSpec(P.ALL_DRIVER_CLASSES[f.tweeterClass]!, 'tweeter', 'Tweeter')],
      xover: [f.xoverTweeterHz],
    };
  }
  const n = p.nBands;
  if (n < 2) return { ok: false, reason: 'The PA system has one band.' };
  return {
    ok: true,
    label: `PA system (${n} bands)`,
    drivers: p.bands.slice(0, n).map((b, k) => driverFromSpec(driverOf(b.design), ROLES_FOR[n]![k]!, `${bandName(n, k)} (${driverOf(b.design).name})`)),
    xover: p.xover.slice(0, n - 1),
  };
}

/** The crossover state with the imported drivers and points in place. */
export function applyImport(s: XoState, imp: Extract<Imported, { ok: true }>): XoState {
  const ways = imp.drivers.length;
  return sanitizeXo({
    ...s,
    ways,
    drivers: [...imp.drivers, ...DEFAULT_XO.drivers.slice(ways)],
    xover: [...imp.xover, ...XOVER_FOR[Math.max(ways, 2)]!.slice(imp.xover.length), ...DEFAULT_XO.xover].slice(0, 3),
    tuned: null,
  });
}
