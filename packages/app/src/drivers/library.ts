// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The driver database kept in the browser or webview's storage: the user's own entries plus the favourite flags of the read-only
// generic drivers. Generics are never stored (they come from code), only which of them are favourites. The old measured-driver
// library (key .v1, Driver Probe records) is read once into entries and left untouched; the new store (.v2) is written at once so
// the generated ids stay stable. Unreadable entries are skipped, never fatal.
import { type DriverEntry, GENERIC, genericEntries, isGeneric, entryFromRecord, parseEntry } from './entry';
import { type Store, loadLibrary } from '../probe/library';

export const DB_KEY = 'soundsystemdesigner.drivers.v2';
export const DB_FILE_KIND = 'sound-system-designer-drivers';
export const DB_FILE_VERSION = 1;
/** A whole library is a few hundred kilobytes at most; anything near this is not one. */
export const MAX_DB_BYTES = 5_000_000;
export const MAX_DRIVERS = 5000;

export interface DriverDb {
  /** The user's entries (hand, csv, probe, datasheet). Never generic. */
  user: DriverEntry[];
  /** Ids of the generic drivers marked favourite. */
  genericFav: string[];
}
export const emptyDb = (): DriverDb => ({ user: [], genericFav: [] });

const defaultStore = (): Store | null => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};
export const newId = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

const GENERICS = genericEntries();
const GENERIC_IDS = new Set(GENERICS.map((g) => g.id));
const isReserved = (id: string): boolean => GENERIC_IDS.has(id) || id.startsWith('generic-');

/** Stored text to a database. Bad parts are dropped; a wrong shape is an empty database. */
export function parseDb(raw: unknown, now: string): DriverDb {
  const o = raw as { drivers?: unknown; genericFav?: unknown } | null;
  if (!o || typeof o !== 'object') return emptyDb();
  const user: DriverEntry[] = [];
  const seen = new Set<string>();
  for (const x of Array.isArray(o.drivers) ? o.drivers : []) {
    const r = parseEntry(x, now);
    if (r.ok && !isGeneric(r.entry) && !isReserved(r.entry.id) && !seen.has(r.entry.id)) {
      seen.add(r.entry.id);
      user.push(r.entry);
    }
    if (user.length >= MAX_DRIVERS) break;
  }
  const genericFav = Array.isArray(o.genericFav) ? [...new Set(o.genericFav.filter((s): s is string => typeof s === 'string' && GENERIC_IDS.has(s)))] : [];
  return { user, genericFav };
}

/** Reads the database. With no .v2 yet, converts the .v1 Driver Probe library once and saves the result. */
export function loadDb(store: Store | null = defaultStore(), now = new Date().toISOString().slice(0, 10), mint: () => string = newId): DriverDb {
  try {
    const raw = store?.getItem(DB_KEY);
    if (raw) return parseDb(JSON.parse(raw), now);
  } catch {
    return emptyDb();
  }
  const user: DriverEntry[] = [];
  for (const rec of loadLibrary(store)) {
    const r = entryFromRecord(rec, mint(), now);
    if (r.ok) user.push(r.entry);
  }
  const db = { user, genericFav: [] };
  if (user.length) saveDb(db, store);
  return db;
}

/** False if storage refused (full or unavailable), so the UI can say the change was not remembered. */
export function saveDb(db: DriverDb, store: Store | null = defaultStore()): boolean {
  try {
    if (!store) return false;
    store.setItem(DB_KEY, JSON.stringify({ drivers: db.user, genericFav: db.genericFav }));
    return true;
  } catch {
    return false;
  }
}

/** Generics (favourite flags applied) then the user's entries. */
export const allDrivers = (db: DriverDb): DriverEntry[] => [...GENERICS.map((g) => ({ ...g, favourite: db.genericFav.includes(g.id) })), ...db.user];
export const findDriver = (db: DriverDb, id: string): DriverEntry | undefined => allDrivers(db).find((e) => e.id === id);

/** Adds or replaces (by id). Generic ids are refused: those drivers are read-only. */
export function upsertEntry(db: DriverDb, e: DriverEntry): DriverDb {
  if (isGeneric(e) || isReserved(e.id)) return db;
  const i = db.user.findIndex((x) => x.id === e.id);
  return { ...db, user: i < 0 ? [...db.user, e] : db.user.map((x, k) => (k === i ? e : x)) };
}
export const removeEntry = (db: DriverDb, id: string): DriverDb => ({ ...db, user: db.user.filter((x) => x.id !== id) });

export function toggleFavourite(db: DriverDb, id: string): DriverDb {
  if (GENERIC_IDS.has(id)) return { ...db, genericFav: db.genericFav.includes(id) ? db.genericFav.filter((x) => x !== id) : [...db.genericFav, id] };
  return { ...db, user: db.user.map((x) => (x.id === id ? { ...x, favourite: !x.favourite } : x)) };
}

/** What makes two entries "the same driver" on import: manufacturer, series and model, or the name when those are all Generic. */
const identity = (e: DriverEntry): string => {
  const parts = [e.manufacturer, e.series, e.model];
  const key = parts.every((p) => p === GENERIC) ? e.name : parts.join('|');
  return key.trim().toLowerCase();
};

/** Merges new entries in: one that matches an existing user entry's identity replaces it and keeps its id and favourite. */
export function mergeImported(db: DriverDb, incoming: DriverEntry[]): { db: DriverDb; added: number; replaced: number } {
  let user = [...db.user];
  let added = 0;
  let replaced = 0;
  for (const e of incoming) {
    if (isGeneric(e) || isReserved(e.id)) continue;
    const i = user.findIndex((x) => x.id === e.id || identity(x) === identity(e));
    if (i < 0) {
      user.push(e);
      added++;
    } else {
      user = user.map((x, k) => (k === i ? { ...e, id: x.id, favourite: x.favourite || e.favourite } : x));
      replaced++;
    }
  }
  return { db: { ...db, user: user.slice(0, MAX_DRIVERS) }, added, replaced };
}

export function exportDb(db: DriverDb): string {
  return JSON.stringify({ kind: DB_FILE_KIND, version: DB_FILE_VERSION, drivers: db.user, genericFavourites: db.genericFav }, null, 1) + '\n';
}

/** Reads a library file and merges it in. Never throws. */
export function importDb(db: DriverDb, text: string, now: string): { ok: true; db: DriverDb; added: number; replaced: number; skipped: number } | { ok: false; error: string } {
  if (text.length > MAX_DB_BYTES) return { ok: false, error: 'That file is too large to be a driver library.' };
  let f: Record<string, unknown>;
  try {
    f = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
  if (!f || typeof f !== 'object' || f.kind !== DB_FILE_KIND) return { ok: false, error: 'That file is not a Sound System Designer driver library.' };
  if (typeof f.version !== 'number' || !Number.isInteger(f.version) || f.version < 1) return { ok: false, error: 'That driver library has no valid version.' };
  if (f.version > DB_FILE_VERSION) return { ok: false, error: `That library was saved by a newer version of the app (file version ${f.version}, this app reads up to ${DB_FILE_VERSION}).` };
  const list = Array.isArray(f.drivers) ? f.drivers : [];
  const entries: DriverEntry[] = [];
  for (const x of list.slice(0, MAX_DRIVERS)) {
    const r = parseEntry(x, now);
    if (r.ok) entries.push(r.entry);
  }
  const m = mergeImported(db, entries);
  const fav = Array.isArray(f.genericFavourites) ? f.genericFavourites.filter((s): s is string => typeof s === 'string' && GENERIC_IDS.has(s)) : [];
  return { ok: true, db: { ...m.db, genericFav: [...new Set([...m.db.genericFav, ...fav])] }, added: m.added, replaced: m.replaced, skipped: list.length - entries.length };
}
