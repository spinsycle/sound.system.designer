// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The saved measured drivers, kept in the browser or webview's own storage, one record per name. A name saved again
// replaces the old record. Unreadable entries are skipped, never fatal.
import { type DriverRecord, parseRecord, serializeRecord } from './record';

export const LIBRARY_KEY = 'soundsystemdesigner.drivers.v1';

export interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}
const defaultStore = (): Store | null => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

export function loadLibrary(store: Store | null = defaultStore()): DriverRecord[] {
  try {
    const raw = store?.getItem(LIBRARY_KEY);
    if (!raw) return [];
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.flatMap((t) => {
      const r = typeof t === 'string' ? parseRecord(t) : null;
      return r?.ok ? [r.record] : [];
    });
  } catch {
    return [];
  }
}

/** Returns false if storage refused (full or unavailable), so the UI can say the driver was not remembered. */
export function saveLibrary(list: DriverRecord[], store: Store | null = defaultStore()): boolean {
  try {
    if (!store) return false;
    store.setItem(LIBRARY_KEY, JSON.stringify(list.map(serializeRecord)));
    return true;
  } catch {
    return false;
  }
}

export const upsert = (list: DriverRecord[], r: DriverRecord): DriverRecord[] => [...list.filter((x) => x.name !== r.name), r];
export const remove = (list: DriverRecord[], name: string): DriverRecord[] => list.filter((x) => x.name !== name);
