// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Searching, filtering and sorting the driver list. Pure functions; the page keeps the filter and the sort in its own state.
import { type DriverEntry, type DriverKind, type DriverSource, isUsable } from './entry';

export interface Range {
  min?: number;
  max?: number;
}
export interface DriverFilter {
  /** Words that must all appear somewhere in name, manufacturer, series, model, notes or kind. */
  text: string;
  favouritesOnly: boolean;
  usableOnly: boolean;
  kind: DriverKind | 'all';
  source: DriverSource | 'all';
  manufacturer: string;
  /** Datasheet units: Hz, litres, inches of cone diameter. */
  fs: Range;
  qts: Range;
  vasL: Range;
  coneIn: Range;
}
export const NO_FILTER: DriverFilter = { text: '', favouritesOnly: false, usableOnly: false, kind: 'all', source: 'all', manufacturer: 'all', fs: {}, qts: {}, vasL: {}, coneIn: {} };

/** Diameter of a circle with the cone area, inches (the effective cone, smaller than the nominal size). */
export const coneIn = (e: DriverEntry): number | undefined => (e.sd === undefined ? undefined : (2 * Math.sqrt(e.sd / Math.PI)) / 0.0254);

const within = (v: number | undefined, r: Range): boolean => {
  if (r.min === undefined && r.max === undefined) return true;
  if (v === undefined) return false; // a driver with no value cannot be in a range
  return (r.min === undefined || v >= r.min) && (r.max === undefined || v <= r.max);
};

export const manufacturers = (list: readonly DriverEntry[]): string[] => [...new Set(list.map((e) => e.manufacturer))].sort((a, b) => a.localeCompare(b));

export function filterDrivers(list: readonly DriverEntry[], f: DriverFilter): DriverEntry[] {
  const words = f.text.toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((e) => {
    if (f.favouritesOnly && !e.favourite) return false;
    if (f.usableOnly && !isUsable(e)) return false;
    if (f.kind !== 'all' && e.kind !== f.kind) return false;
    if (f.source !== 'all' && e.source !== f.source) return false;
    if (f.manufacturer !== 'all' && e.manufacturer !== f.manufacturer) return false;
    if (!within(e.fs, f.fs) || !within(e.qts, f.qts)) return false;
    if (!within(e.vasM3 === undefined ? undefined : e.vasM3 * 1000, f.vasL)) return false;
    if (!within(coneIn(e), f.coneIn)) return false;
    if (words.length) {
      const hay = `${e.name} ${e.manufacturer} ${e.series} ${e.model} ${e.notes} ${e.kind}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

export const SORT_KEYS = ['favourite', 'name', 'manufacturer', 'kind', 'fs', 'qts', 'vas', 'sd', 'xmax', 'pe'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

const numKey = (e: DriverEntry, k: SortKey): number | undefined => (k === 'fs' ? e.fs : k === 'qts' ? e.qts : k === 'vas' ? e.vasM3 : k === 'sd' ? e.sd : k === 'xmax' ? e.xmax : k === 'pe' ? e.pe : undefined);

/** Sorted copy. 'favourite' puts favourites first, then by name; a missing number always goes last, in either direction. */
export function sortDrivers(list: readonly DriverEntry[], key: SortKey, dir: 'asc' | 'desc'): DriverEntry[] {
  const sign = dir === 'asc' ? 1 : -1;
  const byName = (a: DriverEntry, b: DriverEntry): number => a.name.localeCompare(b.name);
  return [...list].sort((a, b) => {
    if (key === 'favourite') return (Number(b.favourite) - Number(a.favourite)) * sign || byName(a, b);
    if (key === 'name') return byName(a, b) * sign;
    if (key === 'manufacturer' || key === 'kind') return a[key].localeCompare(b[key]) * sign || byName(a, b);
    const x = numKey(a, key);
    const y = numKey(b, key);
    if (x === undefined || y === undefined) return x === y ? byName(a, b) : x === undefined ? 1 : -1;
    return (x - y) * sign || byName(a, b);
  });
}
