import { describe, expect, it } from 'vitest';
import * as P from '@soundsystemdesigner/physics';
import { DB_CSV_TEMPLATE, parseDriverCsvEntries } from '../src/drivers/csv';
import { type DriverEntry, buildEntry, entryToSpec, genericEntries, sanitizeSnapshot, snapshotOf, snapshotSpec } from '../src/drivers/entry';
import { DB_KEY, MAX_DRIVERS, allDrivers, emptyDb, exportDb, findDriver, importDb, loadDb, mergeImported, parseDb, removeEntry, saveDb, toggleFavourite, upsertEntry } from '../src/drivers/library';
import { LIBRARY_KEY, saveLibrary } from '../src/probe/library';
import { buildRecord } from '../src/probe/record';
import * as M from '../src/model';

const NOW = '2026-11-23';
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};
const counter = () => {
  let n = 0;
  return () => `id${++n}`;
};
const mk = (over: Record<string, unknown> = {}, id = 'u1'): DriverEntry => {
  const r = buildEntry({ fs: 38, re: 3.4, qes: 0.5, qms: 5, vasM3: 0.06, sd: 0.048, xmax: 0.008, pe: 400, manufacturer: 'Acme', series: 'Pro', model: 'W12', ...over } as never, id, NOW);
  if (!r.ok) throw new Error(r.errors.join());
  return r.entry;
};

describe('database store', () => {
  it('starts empty, round-trips user entries and never stores generics', () => {
    const s = mem();
    expect(loadDb(s, NOW, counter())).toEqual(emptyDb());
    const db = upsertEntry(emptyDb(), mk());
    expect(saveDb(db, s)).toBe(true);
    expect(loadDb(s, NOW, counter())).toEqual(db);
    expect(s.m.get(DB_KEY)).not.toContain('generic-');
  });
  it('lists the generics first, then the user entries, with generic favourites applied', () => {
    let db = upsertEntry(emptyDb(), mk());
    db = toggleFavourite(db, 'generic-2');
    const all = allDrivers(db);
    expect(all).toHaveLength(P.ALL_DRIVER_CLASSES.length + 1);
    expect(all[all.length - 1]!.id).toBe('u1');
    expect(all[2]!.favourite).toBe(true);
    expect(all[1]!.favourite).toBe(false);
    expect(findDriver(db, 'u1')!.model).toBe('W12');
    expect(findDriver(db, 'nope')).toBeUndefined();
  });
  it('upsert replaces by id, refuses generic ids and sources, remove deletes', () => {
    let db = upsertEntry(emptyDb(), mk());
    db = upsertEntry(db, mk({ model: 'W15' }));
    expect(db.user).toHaveLength(1);
    expect(db.user[0]!.model).toBe('W15');
    db = upsertEntry(db, mk({}, 'u2'));
    expect(db.user.map((e) => e.id)).toEqual(['u1', 'u2']);
    expect(upsertEntry(db, mk({}, 'generic-0'))).toBe(db);
    expect(upsertEntry(db, mk({ source: 'generic' }, 'zz'))).toBe(db);
    expect(removeEntry(db, 'u1').user.map((e) => e.id)).toEqual(['u2']);
  });
  it('favourite toggles on user entries and on generics, both ways', () => {
    let db = upsertEntry(emptyDb(), mk());
    db = toggleFavourite(db, 'u1');
    expect(db.user[0]!.favourite).toBe(true);
    db = toggleFavourite(db, 'u1');
    expect(db.user[0]!.favourite).toBe(false);
    db = toggleFavourite(db, 'generic-0');
    expect(db.genericFav).toEqual(['generic-0']);
    db = toggleFavourite(db, 'generic-0');
    expect(db.genericFav).toEqual([]);
  });
  it('survives broken storage, bad entries and a generic smuggled into the store', () => {
    const s = mem();
    s.setItem(DB_KEY, '{not json');
    expect(loadDb(s, NOW, counter())).toEqual(emptyDb());
    const good = mk();
    const fake = { ...good, id: 'generic-1' };
    const dup = { ...good };
    const raw = { drivers: [good, fake, dup, { schema: 'x' }, null, mk({}, 'u9')], genericFav: ['generic-3', 'generic-3', 'bogus', 7] };
    const db = parseDb(raw, NOW);
    expect(db.user.map((e) => e.id)).toEqual(['u1', 'u9']);
    expect(db.genericFav).toEqual(['generic-3']);
    expect(parseDb('x', NOW)).toEqual(emptyDb());
    expect(saveDb(emptyDb(), null)).toBe(false);
    expect(saveDb(emptyDb(), { getItem: () => null, setItem: () => { throw new Error('full'); } })).toBe(false);
  });
  it('caps the library size', () => {
    const many = Array.from({ length: MAX_DRIVERS + 5 }, (_, i) => mk({ model: `m${i}` }, `k${i}`));
    expect(parseDb({ drivers: many }, NOW).user).toHaveLength(MAX_DRIVERS);
  });
});

describe('migration from the Driver Probe library (.v1)', () => {
  const fit = { re: 3.4, fs: 40, qms: 5, qes: 0.5, qts: 0.4545, leMH: 0, bands: { re: 0.01, fs: 0.01, qms: 0.05, qes: 0.05, qts: 0.04, leMH: 0 } } as never;
  it('converts old records once, saves .v2, and leaves .v1 alone', () => {
    const s = mem();
    saveLibrary([buildRecord({ name: 'Bench A', date: '2026-11-18', base: { fit, points: [] } }), buildRecord({ name: 'Bench B', date: '2026-11-19', base: { fit, points: [] } })], s);
    const v1 = s.m.get(LIBRARY_KEY);
    const db = loadDb(s, NOW, counter());
    expect(db.user.map((e) => [e.id, e.name, e.source])).toEqual([['id1', 'Bench A', 'probe'], ['id2', 'Bench B', 'probe']]);
    expect(s.m.get(LIBRARY_KEY)).toBe(v1);
    expect(s.m.has(DB_KEY)).toBe(true);
    // second load reads .v2, so the ids do not change even with a different id source
    expect(loadDb(s, NOW, counter()).user.map((e) => e.id)).toEqual(['id1', 'id2']);
  });
  it('writes nothing when there is nothing to migrate', () => {
    const s = mem();
    loadDb(s, NOW, counter());
    expect(s.m.has(DB_KEY)).toBe(false);
  });
});

describe('merge, export and import', () => {
  it('matches by manufacturer, series and model (or name when all Generic) and keeps id and favourite', () => {
    let db = upsertEntry(emptyDb(), { ...mk(), favourite: true });
    const r = mergeImported(db, [mk({ pe: 500 }, 'new1'), mk({ model: 'W15' }, 'new2')]);
    expect(r).toMatchObject({ added: 1, replaced: 1 });
    expect(r.db.user.map((e) => [e.id, e.model, e.favourite, e.pe])).toEqual([['u1', 'W12', true, 500], ['new2', 'W15', false, 400]]);
    db = upsertEntry(emptyDb(), mk({ manufacturer: undefined, series: undefined, model: undefined, name: 'Salvaged 15' }));
    expect(mergeImported(db, [mk({ manufacturer: undefined, series: undefined, model: undefined, name: ' salvaged 15 ' }, 'z')]).replaced).toBe(1);
    expect(mergeImported(db, [mk({ source: 'generic' }, 'g'), mk({}, 'generic-4')]).added).toBe(0);
  });
  it('exports and imports a library with favourites, merging into what is there', () => {
    let db = upsertEntry(emptyDb(), mk({}, 'a'));
    db = upsertEntry(db, mk({ model: 'W15' }, 'b'));
    db = toggleFavourite(db, 'generic-5');
    const text = exportDb(db);
    expect(text.endsWith('\n')).toBe(true);
    const r = importDb(emptyDb(), text, NOW);
    expect(r.ok && r.db).toEqual(db);
    const again = importDb(db, text, NOW);
    expect(again.ok && [again.added, again.replaced]).toEqual([0, 2]);
  });
  it('refuses files that are not a library, are too new or too big, never throws', () => {
    const err = (t: string) => {
      const r = importDb(emptyDb(), t, NOW);
      return r.ok ? '' : r.error;
    };
    expect(err('nope')).toMatch(/not valid JSON/);
    expect(err('[]')).toMatch(/not a Sound System Designer driver library/);
    expect(err('null')).toMatch(/not a Sound System Designer driver library/);
    expect(err(JSON.stringify({ kind: 'sound-system-designer-drivers', version: 0 }))).toMatch(/no valid version/);
    expect(err(JSON.stringify({ kind: 'sound-system-designer-drivers', version: 2 }))).toMatch(/newer version/);
    expect(err('x'.repeat(5_000_001))).toMatch(/too large/);
    const some = importDb(emptyDb(), JSON.stringify({ kind: 'sound-system-designer-drivers', version: 1, drivers: [mk(), { bad: 1 }] }), NOW);
    expect(some.ok && [some.added, some.skipped]).toEqual([1, 1]);
  });
});

describe('CSV into the database', () => {
  const mint = () => counter()();
  it('the template parses to one usable entry with every column', () => {
    const r = parseDriverCsvEntries(DB_CSV_TEMPLATE, NOW, counter());
    expect(r.errors).toEqual([]);
    const e = r.entries[0]!;
    expect([e.manufacturer, e.series, e.model, e.name, e.kind, e.favourite, e.source, e.notes]).toEqual(['Generic', 'Generic', 'Example 12 in', 'Example 12 in', 'woofer', false, 'csv', 'from a datasheet']);
    expect([e.fs, e.qts, e.re, e.sensDb, e.znomOhm]).toEqual([38, 0.35, 5.4, 92, 8]);
    expect(e.vasM3).toBeCloseTo(0.09, 12);
    expect(e.sd).toBeCloseTo(0.052, 12);
    expect(e.xmax).toBeCloseTo(0.008, 12);
    expect(e.le).toBeCloseTo(0.0012, 12);
    expect(entryToSpec(e)).not.toBeNull();
  });
  it('reads identity, favourite, extended columns and units', () => {
    const csv = 'Brand;Series;Model Number;Fav;fs;qts;qms;re;Mms g;Cms mm/N;sd;xmech;Bl\nAcme;Pro;W12;yes;40;0,4;5;3,6;85;0,2;520;12;14\n';
    const r = parseDriverCsvEntries(csv, NOW, counter());
    expect(r.errors).toEqual([]);
    const e = r.entries[0]!;
    expect([e.manufacturer, e.series, e.model, e.name, e.favourite]).toEqual(['Acme', 'Pro', 'W12', 'Acme Pro W12', true]);
    expect([e.mms, e.cms, e.xmechM, e.bl]).toEqual([0.085, 0.0002, 0.012, 14]);
    expect(e.qes).toBeCloseTo((0.4 * 5) / (5 - 0.4), 9);
  });
  it('an old file with only a model column still imports, named by the model', () => {
    const r = parseDriverCsvEntries('model,fs_hz,qts,qes,re_ohm\nOld 8,60,0.4,0.5,5\n', NOW, counter());
    expect(r.errors).toEqual([]);
    expect(r.entries[0]!.name).toBe('Old 8');
  });
  it('reports each bad row and keeps the good ones', () => {
    const csv = 'name,fs_hz,qts,qes,qms,re_ohm\nA,40,0.4,0.5,,5\nB,,0.4,0.5,,5\nC,40,0.4,0.5,,abc\nA,40,0.4,0.5,,5\n,40,0.4,0.5,,5\nD,40,0.4,0.5,5,5\nE,40,0.9,0.5,,5\n';
    const r = parseDriverCsvEntries(csv, NOW, counter());
    expect(r.entries.map((e) => e.name)).toEqual(['A']);
    expect(r.errors).toHaveLength(6);
    expect(r.errors[0]).toMatch(/^Row 3 \(B\): fs is required/);
    expect(r.errors[1]).toMatch(/^Row 4 \(C\): re is not a number/);
    expect(r.errors[2]).toMatch(/^Row 5 \(A\): duplicate/);
    expect(r.errors[3]).toMatch(/^Row 6: no name or model/);
    expect(r.errors[4]).toMatch(/^Row 7 \(D\): Qts 0.4 does not match/);
    expect(r.errors[5]).toMatch(/^Row 8 \(E\)/);
  });
  it('refuses a bad header or an empty file', () => {
    expect(parseDriverCsvEntries('name,fs\n', NOW, mint).errors[0]).toMatch(/needs a header row/);
    expect(parseDriverCsvEntries('name,fs,re\nA,40,5\n', NOW, mint).errors[0]).toMatch(/two of qts\/qes\/qms/);
    expect(parseDriverCsvEntries('fs,re,qts,qes\n40,5,0.4,0.5\n', NOW, mint).errors[0]).toMatch(/name or model/);
  });
});

describe('a database driver inside a design', () => {
  const tweeter = mk({ fs: 1500, re: 4, qes: 1, qms: 2.5, vasM3: 6e-6, sd: 6e-4, xmax: 5e-4, pe: 30 }, 't1');
  it('snapshots only usable entries and gives the same driver back', () => {
    expect(snapshotOf(mk({ pe: undefined }))).toBeNull();
    const s = snapshotOf(tweeter)!;
    expect(s).toMatchObject({ id: 't1', fs: 1500 });
    expect(snapshotSpec(s)).toEqual(entryToSpec(tweeter));
    expect(snapshotOf(mk({ le: 0.001 }))!.le).toBe(0.001);
    expect(snapshotSpec(snapshotOf(mk({ le: 0.001 }))!).le).toBe(0.001);
  });
  it('sanitizeSnapshot refuses anything outside the entry ranges instead of clamping', () => {
    const s = snapshotOf(tweeter)!;
    expect(sanitizeSnapshot(s)).toEqual(s);
    expect(sanitizeSnapshot({ ...s, fs: 9999 })).toBeUndefined();
    expect(sanitizeSnapshot({ ...s, sd: 'x' })).toBeUndefined();
    expect(sanitizeSnapshot({ ...s, le: 5 })).toBeUndefined();
    expect(sanitizeSnapshot({ ...s, id: '' })).toBeUndefined();
    expect(sanitizeSnapshot(null)).toBeUndefined();
    expect(sanitizeSnapshot({ ...s, name: '   ' })!.name).toBe('Generic');
  });
  it('the design uses it only while the class is Custom, unclamped; a class change drops it', () => {
    const s = snapshotOf(tweeter)!;
    const d = M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: M.CUSTOM_CLASS, libDriver: s });
    expect(d.libDriver).toEqual(s);
    expect(M.driverOf(d).fs).toBe(1500);
    expect(M.driverOf(d).name).toBe('Generic Pro W12' === s.name ? s.name : s.name);
    expect(M.sanitize({ ...d, driverClass: 3 }).libDriver).toBeUndefined();
    expect(M.driverOf(M.sanitize({ ...d, driverClass: 3 })).name).toBe(P.ALL_DRIVER_CLASSES[3]!.name);
    expect(M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: M.CUSTOM_CLASS, libDriver: { ...s, fs: 99999 } }).libDriver).toBeUndefined();
    expect(M.driverOf(M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: M.CUSTOM_CLASS })).name).toBe('Custom');
  });
  it('does not warn about Qms for a database driver', () => {
    const s = snapshotOf(tweeter)!;
    const d = M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: M.CUSTOM_CLASS, libDriver: s, custom: { ...M.DEFAULT_DESIGN.custom, qms: 0.2, qts: 1 } });
    expect(M.compute(d, 0.018).warnings.join(' ')).not.toMatch(/Qms must be above Qts/);
    const c = M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: M.CUSTOM_CLASS, custom: { ...M.DEFAULT_DESIGN.custom, qms: 0.5, qts: 1 } });
    expect(M.compute(c, 0.018).warnings.join(' ')).toMatch(/Qms must be above Qts/);
  });
  it('generic entries still reproduce the class list exactly', () => {
    expect(genericEntries().map((e) => entryToSpec(e)!.fs)).toEqual(P.ALL_DRIVER_CLASSES.map((d) => d.fs));
  });
});
