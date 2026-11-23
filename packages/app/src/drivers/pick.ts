// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Choosing a driver for a design, as pure functions: what the picker lists, which option a design is on, what choosing an option
// changes, and where to apply a driver chosen on the Drivers page (a PA band, a home-speaker slot or the car subwoofer).
import { ALL_DRIVER_CLASSES } from '@soundsystemdesigner/physics';
import { CUSTOM_CLASS, type Design, sanitize } from '../model';
import { arrangementOf, slotLabel } from '../loudspeaker';
import { type Project, bandName, sanitizeProject } from '../system';
import { type DriverEntry, type DriverKind, type DriverSnapshot, isGeneric, isUsable, snapshotOf } from './entry';
import { type DriverDb, allDrivers, findDriver } from './library';

/** Usable drivers worth listing by name: favourites (any source) and the user's own, never twice in one list. */
export function pickLists(db: DriverDb, kinds?: readonly DriverKind[], classes?: ReadonlySet<number>): { favourites: DriverEntry[]; mine: DriverEntry[] } {
  const all = allDrivers(db).filter((e) => isUsable(e) && (!kinds || kinds.includes(e.kind)));
  // a generic driver is its class: offered only when that class is one the caller lists
  const offered = (e: DriverEntry): boolean => !isGeneric(e) || !classes || classes.has(classIndex(e));
  return { favourites: all.filter((e) => e.favourite && offered(e)), mine: all.filter((e) => !isGeneric(e)) };
}

const classIndex = (e: DriverEntry): number => (isGeneric(e) ? Number(e.id.slice('generic-'.length)) : -1);

/** The option string a design is on: class:N, lib:ID or custom. */
export function valueOf(d: Design): string {
  if (d.driverClass !== CUSTOM_CLASS) return `class:${d.driverClass}`;
  return d.libDriver ? `lib:${d.libDriver.id}` : 'custom';
}

/** What choosing an option changes in the design, or null when the option is not a driver that can be used. */
export function patchFor(value: string, db: DriverDb): Partial<Design> | null {
  if (value === 'custom') return { driverClass: CUSTOM_CLASS, libDriver: undefined };
  if (value.startsWith('class:')) {
    const i = Number(value.slice(6));
    return Number.isInteger(i) && i >= 0 && i < ALL_DRIVER_CLASSES.length ? { driverClass: i, libDriver: undefined } : null;
  }
  if (!value.startsWith('lib:')) return null;
  const e = findDriver(db, value.slice(4));
  if (!e) return null;
  // a generic driver is the class itself, so a design keeps its exact class numbers and the class list stays the one truth
  if (isGeneric(e)) return { driverClass: classIndex(e), libDriver: undefined };
  const s = snapshotOf(e);
  return s ? { driverClass: CUSTOM_CLASS, libDriver: s } : null;
}

const sameNumbers = (a: DriverSnapshot, b: DriverSnapshot): boolean => a.name === b.name && a.fs === b.fs && a.re === b.re && a.qes === b.qes && a.qms === b.qms && a.vasM3 === b.vasM3 && a.sd === b.sd && a.xmax === b.xmax && a.pe === b.pe && a.le === b.le && a.cutoutWM === b.cutoutWM && a.cutoutHM === b.cutoutHM && a.depthM === b.depthM;

/** The library's current numbers for the driver a design carries, when they differ from the copy in the design. Else null. */
export function libraryUpdate(d: Design, db: DriverDb): DriverSnapshot | null {
  if (d.driverClass !== CUSTOM_CLASS || !d.libDriver) return null;
  const e = findDriver(db, d.libDriver.id);
  const s = e ? snapshotOf(e) : null;
  return s && !sameNumbers(s, d.libDriver) ? s : null;
}
/** True when the design carries a database driver the library no longer has (deleted, or the project came from another machine). */
export const libraryMissing = (d: Design, db: DriverDb): boolean => d.driverClass === CUSTOM_CLASS && !!d.libDriver && !findDriver(db, d.libDriver.id);

export interface Target {
  id: string;
  label: string;
}

/** Where a driver from the Drivers page can go in this project (none in the crossover mode), and the one to offer first. */
export function targetsFor(p: Project): { targets: Target[]; first: string | undefined } {
  if (p.kind === 'crossover') return { targets: [], first: undefined };
  if (p.kind === 'car') return { targets: [{ id: 'car', label: 'The subwoofer' }], first: 'car' };
  if (p.kind === 'speaker') {
    const arr = arrangementOf(p.speaker.arrangement);
    const targets = arr.slots.map((_, k) => ({ id: `slot:${k}`, label: slotLabel(arr, k) }));
    return { targets, first: targets[0]?.id };
  }
  const targets = p.bands.slice(0, p.nBands).map((_, k) => ({ id: `band:${k}`, label: p.nBands === 1 ? 'The box' : `${bandName(p.nBands, k)} box` }));
  return { targets, first: `band:${Math.min(p.selected, p.nBands - 1)}` };
}

const withDriver = (d: Design, s: DriverSnapshot): Design => sanitize({ ...d, driverClass: CUSTOM_CLASS, libDriver: s });

/** The project with the driver set at the target, or null for a target this project does not have. */
export function applyDriver(p: Project, targetId: string, s: DriverSnapshot): Project | null {
  const [kind, n] = targetId.split(':');
  const k = Number(n);
  if (kind === 'car' && p.kind === 'car') return sanitizeProject({ ...p, car: { ...p.car, design: withDriver(p.car.design, s) }, view: 'system' });
  if (kind === 'slot' && p.kind === 'speaker' && Number.isInteger(k) && k >= 0 && k < arrangementOf(p.speaker.arrangement).slots.length) {
    return sanitizeProject({ ...p, speaker: { ...p.speaker, slots: p.speaker.slots.map((x, i) => (i === k ? { ...x, design: withDriver(x.design, s) } : x)) }, view: 'system' });
  }
  if (kind === 'band' && p.kind !== 'speaker' && p.kind !== 'car' && p.kind !== 'crossover' && Number.isInteger(k) && k >= 0 && k < p.nBands) {
    return sanitizeProject({ ...p, bands: p.bands.map((b, i) => (i === k ? { ...b, design: withDriver(b.design, s) } : b)), view: 'box', selected: k });
  }
  return null;
}
