import { describe, expect, it } from 'vitest';
import * as P from '@soundsystemdesigner/physics';
import { type DriverEntry, buildEntry, snapshotOf } from '../src/drivers/entry';
import { type DriverDb, emptyDb, toggleFavourite, upsertEntry } from '../src/drivers/library';
import { applyDriver, libraryMissing, libraryUpdate, patchFor, pickLists, targetsFor, valueOf } from '../src/drivers/pick';
import { arrangementOf } from '../src/loudspeaker';
import * as M from '../src/model';
import * as S from '../src/system';

const mk = (over: Record<string, unknown>, id: string): DriverEntry => {
  const r = buildEntry({ fs: 1500, re: 4, qes: 1, qms: 2.5, vasM3: 6e-6, sd: 6e-4, xmax: 5e-4, pe: 30, manufacturer: 'Zed', model: id, ...over } as never, id, '2026-11-23');
  if (!r.ok) throw new Error(r.errors.join());
  return r.entry;
};
const T1 = mk({}, 't1');
const HALF = mk({ vasM3: undefined }, 'half'); // not usable
const db0: DriverDb = upsertEntry(upsertEntry(emptyDb(), T1), HALF);

const proj = (kind: S.Project['kind']): S.Project => S.sanitizeProject({ ...S.DEFAULT_PROJECT, kind });

describe('pickLists', () => {
  it('favourites are usable drivers of any source, mine are the user entries, neither has an unusable one', () => {
    const db = toggleFavourite(toggleFavourite(db0, 'generic-3'), 't1');
    const { favourites, mine } = pickLists(db);
    expect(favourites.map((e) => e.id).sort()).toEqual(['generic-3', 't1']);
    expect(mine.map((e) => e.id)).toEqual(['t1']);
    expect(pickLists(toggleFavourite(db0, 'half')).favourites).toEqual([]);
    expect(pickLists(emptyDb())).toEqual({ favourites: [], mine: [] });
  });
});

describe('valueOf and patchFor', () => {
  it('describes where a design is', () => {
    expect(valueOf(M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: 5 }))).toBe('class:5');
    expect(valueOf(M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: M.CUSTOM_CLASS }))).toBe('custom');
    expect(valueOf(M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: M.CUSTOM_CLASS, libDriver: snapshotOf(T1)! }))).toBe('lib:t1');
  });
  it('choosing a class, custom or a database driver changes only the driver', () => {
    expect(patchFor('class:7', db0)).toEqual({ driverClass: 7, libDriver: undefined });
    expect(patchFor('custom', db0)).toEqual({ driverClass: M.CUSTOM_CLASS, libDriver: undefined });
    expect(patchFor('lib:t1', db0)).toEqual({ driverClass: M.CUSTOM_CLASS, libDriver: snapshotOf(T1) });
  });
  it('a generic driver is its class, so the design keeps the exact class numbers', () => {
    expect(patchFor('lib:generic-12', db0)).toEqual({ driverClass: 12, libDriver: undefined });
    const d = M.sanitize({ ...M.DEFAULT_DESIGN, ...patchFor('lib:generic-12', db0) });
    expect(M.driverOf(d)).toBe(P.ALL_DRIVER_CLASSES[12]);
  });
  it('refuses what cannot be used', () => {
    expect(patchFor('class:999', db0)).toBeNull();
    expect(patchFor('class:-1', db0)).toBeNull();
    expect(patchFor('class:x', db0)).toBeNull();
    expect(patchFor('class:1.5', db0)).toBeNull();
    expect(patchFor('lib:nope', db0)).toBeNull();
    expect(patchFor('lib:half', db0)).toBeNull();
    expect(patchFor('weird', db0)).toBeNull();
  });
  it('the patch, applied through sanitize, gives the database driver unclamped, and a class change drops it', () => {
    const d = M.sanitize({ ...M.DEFAULT_DESIGN, ...patchFor('lib:t1', db0) });
    expect(M.driverOf(d).fs).toBe(1500);
    const back = M.sanitize({ ...d, ...patchFor('class:2', db0) });
    expect(back.libDriver).toBeUndefined();
    expect(M.driverOf(back)).toBe(P.ALL_DRIVER_CLASSES[2]);
  });
});

describe('library update and missing', () => {
  const d = M.sanitize({ ...M.DEFAULT_DESIGN, ...patchFor('lib:t1', db0) });
  it('nothing to update while the copy matches', () => {
    expect(libraryUpdate(d, db0)).toBeNull();
    expect(libraryMissing(d, db0)).toBe(false);
    expect(libraryUpdate(M.DEFAULT_DESIGN, db0)).toBeNull();
    expect(libraryMissing(M.DEFAULT_DESIGN, db0)).toBe(false);
  });
  it('offers the new numbers once the library entry changed, or a rename', () => {
    const edited = upsertEntry(db0, mk({ pe: 60 }, 't1'));
    expect(libraryUpdate(d, edited)!.pe).toBe(60);
    const renamed = upsertEntry(db0, mk({ name: 'New name' }, 't1'));
    expect(libraryUpdate(d, renamed)!.name).toBe('New name');
    expect(libraryUpdate(d, upsertEntry(db0, mk({ qes: 0.8 }, 't1')))).not.toBeNull();
    expect(libraryUpdate(d, upsertEntry(db0, mk({ le: 0.0002 }, 't1')))).not.toBeNull();
    const unusable = upsertEntry(db0, mk({ vasM3: undefined }, 't1'));
    expect(libraryUpdate(d, unusable)).toBeNull();
  });
  it('knows when the library no longer has the driver', () => {
    expect(libraryMissing(d, emptyDb())).toBe(true);
    expect(libraryUpdate(d, emptyDb())).toBeNull();
  });
});

describe('where a driver can go', () => {
  it('PA system: one target per band, the selected one first; none in the crossover mode', () => {
    const p = S.sanitizeProject({ ...S.applyTemplate(S.DEFAULT_PROJECT, S.TEMPLATES.findIndex((t) => t.label.includes('3-way'))), selected: 2 });
    const t = targetsFor(p);
    expect(t.targets).toHaveLength(p.nBands);
    expect(t.targets.map((x) => x.id)).toEqual(Array.from({ length: p.nBands }, (_, k) => `band:${k}`));
    expect(t.first).toBe('band:2');
    expect(targetsFor(S.sanitizeProject({ ...S.DEFAULT_PROJECT, selected: 3 })).targets).toEqual([{ id: 'band:0', label: 'The box' }]);
    // a selected band past the last one (never produced by the sanitiser, but a caller may hold one) still points at a real band
    expect(targetsFor({ ...S.sanitizeProject(S.DEFAULT_PROJECT), selected: 3 }).first).toBe('band:0');
    expect(targetsFor(proj('crossover'))).toEqual({ targets: [], first: undefined });
  });
  it('home speaker: one target per slot of the arrangement; car: the subwoofer', () => {
    const p = proj('speaker');
    const arr = arrangementOf(p.speaker.arrangement);
    expect(targetsFor(p).targets.map((x) => x.id)).toEqual(arr.slots.map((_, k) => `slot:${k}`));
    expect(targetsFor(p).first).toBe('slot:0');
    expect(targetsFor(proj('car'))).toEqual({ targets: [{ id: 'car', label: 'The subwoofer' }], first: 'car' });
  });
});

describe('applyDriver', () => {
  const snap = snapshotOf(T1)!;
  it('sets a PA band, opens its box page and keeps the rest', () => {
    const p = S.sanitizeProject({ ...S.applyTemplate(S.DEFAULT_PROJECT, S.TEMPLATES.findIndex((t) => t.label.includes('2-way'))), view: 'system' });
    const n = applyDriver(p, 'band:1', snap)!;
    expect(M.driverOf(n.bands[1]!.design).fs).toBe(1500);
    expect(M.driverOf(n.bands[0]!.design)).toBe(M.driverOf(p.bands[0]!.design));
    expect([n.view, n.selected]).toEqual(['box', 1]);
    expect(n.bands[1]!.design.volumeL).toBe(p.bands[1]!.design.volumeL);
  });
  it('sets a home-speaker slot and the car subwoofer, and the driver survives the project sanitiser', () => {
    const sp = proj('speaker');
    const n = applyDriver(sp, 'slot:0', snap)!;
    expect(M.driverOf(n.speaker.slots[0]!.design).fs).toBe(1500);
    expect(M.driverOf(n.speaker.slots[1]!.design)).toBe(M.driverOf(sp.speaker.slots[1]!.design));
    expect(n.view).toBe('system');
    const c = applyDriver(proj('car'), 'car', snap)!;
    expect(M.driverOf(c.car.design).fs).toBe(1500);
    expect(c.car.design.libDriver).toEqual(snap);
  });
  it('refuses a target the project does not have', () => {
    expect(applyDriver(proj('car'), 'band:0', snap)).toBeNull();
    expect(applyDriver(proj('speaker'), 'car', snap)).toBeNull();
    expect(applyDriver(proj('system'), 'slot:0', snap)).toBeNull();
    expect(applyDriver(proj('system'), 'band:9', snap)).toBeNull();
    expect(applyDriver(proj('system'), 'band:x', snap)).toBeNull();
    expect(applyDriver(proj('speaker'), 'slot:7', snap)).toBeNull();
    const slots = arrangementOf(proj('speaker').speaker.arrangement).slots.length;
    expect(applyDriver(proj('speaker'), `slot:${slots}`, snap)).toBeNull();
    expect(applyDriver(proj('speaker'), `slot:${slots - 1}`, snap)).not.toBeNull();
    expect(applyDriver(proj('crossover'), 'band:0', snap)).toBeNull();
    expect(applyDriver(proj('system'), 'nonsense', snap)).toBeNull();
  });
});
