// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// One entry of the driver database: identity (manufacturer, series, model, all user-entered, "Generic" when unknown), the full
// Thiele-Small set in SI units (core plus extended), a favourite flag and where the numbers came from. Pure functions only; storage
// is a later milestone. Numbers the user did not type are derived (1/Qts = 1/Qes + 1/Qms, Vas <-> Cms, Mms, Bl, Rms) and listed in
// `derived` so the UI can tell typed from computed. No bundled commercial data: the only seeded entries are the generic classes.
import { ALL_DRIVER_CLASSES, C, type DriverSpec, RHO } from '@soundsystemdesigner/physics';
import type { DriverRecord } from '../probe/record';

export const ENTRY_SCHEMA = 'ssd.driver/1';
export const GENERIC = 'Generic';

export const DRIVER_KINDS = ['woofer', 'subwoofer', 'midrange', 'tweeter', 'fullrange', 'coaxial', 'compression'] as const;
export type DriverKind = (typeof DRIVER_KINDS)[number];
export const DRIVER_SOURCES = ['generic', 'hand', 'probe', 'csv', 'datasheet'] as const;
export type DriverSource = (typeof DRIVER_SOURCES)[number];

/** SI numbers of an entry. The first five are always present; the rest are optional and filled when they can be derived. */
export const CORE_KEYS = ['fs', 're', 'qes', 'qms', 'qts'] as const;
export const OPTIONAL_KEYS = ['vasM3', 'sd', 'xmax', 'pe', 'le', 'mms', 'cms', 'bl', 'rms', 'sensDb', 'znomOhm', 'xmechM'] as const;
type OptionalKey = (typeof OPTIONAL_KEYS)[number];

export interface DriverEntry {
  schema: typeof ENTRY_SCHEMA;
  id: string;
  /** Free label; defaults to "manufacturer series model". */
  name: string;
  manufacturer: string;
  series: string;
  model: string;
  kind: DriverKind;
  favourite: boolean;
  source: DriverSource;
  notes: string;
  addedAt: string;
  /** Free-air resonance, Hz. */
  fs: number;
  /** Voice-coil DC resistance, ohm. */
  re: number;
  qes: number;
  qms: number;
  qts: number;
  /** Equivalent compliance volume, m^3. */
  vasM3?: number;
  /** Cone area, m^2. */
  sd?: number;
  /** One-way linear excursion, m. */
  xmax?: number;
  /** Thermal power, W. */
  pe?: number;
  /** Voice-coil inductance, H. */
  le?: number;
  mms?: number;
  cms?: number;
  bl?: number;
  rms?: number;
  /** Sensitivity, dB SPL at 1 W (2.83 V) and 1 m, as entered; never computed here. */
  sensDb?: number;
  /** Nominal impedance, ohm. */
  znomOhm?: number;
  /** Mechanical (physical) excursion limit, one way, m. */
  xmechM?: number;
  /** Keys that were computed, not entered. */
  derived: string[];
  /** The Driver Probe record this came from, kept for a later re-fit. */
  record?: DriverRecord;
}

/** What a form, CSV row or probe record can hand in: any numbers, text optional. Everything is checked by buildEntry. */
export type DriverInput = Partial<Pick<DriverEntry, 'id' | 'name' | 'manufacturer' | 'series' | 'model' | 'kind' | 'favourite' | 'source' | 'notes' | 'addedAt' | 'record'>> &
  Partial<Record<(typeof CORE_KEYS)[number] | OptionalKey, number>>;

/** Accepted range per number (SI). Outside it the entry is refused, not clamped: a wrong number that looks fine is worse than none. */
export const RANGES: Record<(typeof CORE_KEYS)[number] | OptionalKey, [number, number]> = {
  fs: [5, 5000],
  re: [0.5, 64],
  qes: [0.05, 50],
  qms: [0.3, 50],
  qts: [0.05, 5],
  vasM3: [1e-9, 5],
  sd: [1e-6, 0.5],
  xmax: [1e-5, 0.1],
  pe: [0.5, 10000],
  le: [0, 0.1],
  mms: [1e-5, 5],
  cms: [1e-8, 1],
  bl: [0.05, 100],
  rms: [1e-3, 1000],
  sensDb: [50, 130],
  znomOhm: [0.5, 64],
  xmechM: [1e-5, 0.2],
};
const LABEL: Record<string, string> = { fs: 'fs', re: 'Re', qes: 'Qes', qms: 'Qms', qts: 'Qts', vasM3: 'Vas', sd: 'Sd', xmax: 'Xmax', pe: 'Pe', le: 'Le', mms: 'Mms', cms: 'Cms', bl: 'Bl', rms: 'Rms', sensDb: 'Sensitivity', znomOhm: 'Znom', xmechM: 'Xmech' };

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const text = (x: unknown, fallback: string, max = 120): string => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : fallback);

/** Qts, Qes, Qms: given any two, the third. Returns the key that was computed, if any. */
function fillQ(v: Record<string, number | undefined>, derived: string[]): void {
  const { qts, qes, qms } = v;
  if (qts === undefined && qes !== undefined && qms !== undefined) (v.qts = 1 / (1 / qes + 1 / qms)), derived.push('qts');
  else if (qes === undefined && qts !== undefined && qms !== undefined && qms > qts) (v.qes = (qts * qms) / (qms - qts)), derived.push('qes');
  else if (qms === undefined && qts !== undefined && qes !== undefined && qes > qts) (v.qms = (qts * qes) / (qes - qts)), derived.push('qms');
}

/** A rough label from the numbers, only used when the user gives none. */
export function guessKind(d: { fs: number; sd?: number }, name = ''): DriverKind {
  const n = name.toLowerCase();
  if (/coax/.test(n)) return 'coaxial';
  if (/compression|\bhf\b/.test(n)) return 'compression';
  if (/full-range/.test(n)) return 'fullrange';
  if (/sub/.test(n)) return 'subwoofer';
  if (/dome|planar|tweeter/.test(n) || d.fs >= 400) return 'tweeter';
  if (/mid/.test(n)) return 'midrange';
  if (d.sd !== undefined && d.sd < 0.005) return 'midrange';
  if (d.sd !== undefined && d.sd >= 0.02 && d.fs <= 35) return 'subwoofer';
  return 'woofer';
}

/** The name made from manufacturer, series and model (Generic parts left out), or "Generic" when all three are. */
export const autoName = (e: Pick<DriverEntry, 'manufacturer' | 'series' | 'model'>): string => [e.manufacturer, e.series, e.model].filter((s) => s && s !== GENERIC).join(' ') || GENERIC;

/**
 * Checks and completes one driver. Needs fs, Re and two of Qts / Qes / Qms; everything else is optional. Out-of-range numbers,
 * Qms not above Qts and three Q values that disagree by more than 10 % are refused with a message each. Missing numbers are derived
 * where the physics allows (third Q, Vas <-> Cms, then Mms, Bl, Rms) and listed in `derived`.
 */
export function buildEntry(input: DriverInput, id: string, now: string): { ok: true; entry: DriverEntry } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const v: Record<string, number | undefined> = {};
  for (const k of [...CORE_KEYS, ...OPTIONAL_KEYS]) {
    const x = input[k];
    if (x === undefined) continue;
    const [lo, hi] = RANGES[k];
    if (!num(x) || x < lo || x > hi) errors.push(`${LABEL[k]} must be a number from ${lo} to ${hi}.`);
    else v[k] = x;
  }
  const derived: string[] = [];
  if (v.qts !== undefined && v.qes !== undefined && v.qms !== undefined) {
    const q = 1 / (1 / v.qes + 1 / v.qms);
    if (Math.abs(q - v.qts) > 0.1 * v.qts) errors.push(`Qts ${v.qts} does not match Qes and Qms (they give ${q.toFixed(3)}).`);
  }
  for (const other of ['qms', 'qes'] as const) if (v.qts !== undefined && v[other] !== undefined && v[other]! <= v.qts) errors.push(`${LABEL[other]} must be larger than Qts.`);
  fillQ(v, derived);
  if (v.fs === undefined) errors.push('fs is required.');
  if (v.re === undefined) errors.push('Re is required.');
  if (v.qts === undefined || v.qes === undefined || v.qms === undefined) errors.push('Give two of Qts, Qes and Qms (the third is worked out).');
  if (errors.length) return { ok: false, errors };
  const fs = v.fs!;
  const re = v.re!;
  const qes = v.qes!;
  const qms = v.qms!;
  const ws = 2 * Math.PI * fs;
  // Vas <-> Cms needs Sd; Mms from Cms and fs; Bl and Rms from Mms
  const k = RHO * C * C;
  if (v.sd !== undefined) {
    if (v.vasM3 === undefined && v.cms !== undefined) (v.vasM3 = v.cms * k * v.sd * v.sd), derived.push('vasM3');
    else if (v.cms === undefined && v.vasM3 !== undefined) (v.cms = v.vasM3 / (k * v.sd * v.sd)), derived.push('cms');
  }
  if (v.mms === undefined && v.cms !== undefined) (v.mms = 1 / (ws * ws * v.cms)), derived.push('mms');
  else if (v.cms === undefined && v.mms !== undefined) (v.cms = 1 / (ws * ws * v.mms)), derived.push('cms');
  if (v.mms !== undefined) {
    if (v.bl === undefined) (v.bl = Math.sqrt((ws * v.mms * re) / qes)), derived.push('bl');
    if (v.rms === undefined) (v.rms = (ws * v.mms) / qms), derived.push('rms');
  }
  const manufacturer = text(input.manufacturer, GENERIC);
  const series = text(input.series, GENERIC);
  const model = text(input.model, GENERIC);
  const entry: DriverEntry = {
    schema: ENTRY_SCHEMA,
    id,
    name: '',
    manufacturer,
    series,
    model,
    kind: DRIVER_KINDS.includes(input.kind as DriverKind) ? (input.kind as DriverKind) : guessKind({ fs, sd: v.sd }, text(input.name, '')),
    favourite: input.favourite === true,
    source: DRIVER_SOURCES.includes(input.source as DriverSource) ? (input.source as DriverSource) : 'hand',
    notes: text(input.notes, '', 2000),
    addedAt: text(input.addedAt, now, 40),
    fs,
    re,
    qes,
    qms,
    qts: v.qts!,
    derived,
    ...(input.record ? { record: input.record } : {}),
  };
  for (const key of OPTIONAL_KEYS) if (v[key] !== undefined) entry[key] = v[key] as number;
  entry.name = text(input.name, '') || autoName(entry);
  return { ok: true, entry };
}

/** True when the driver can be used in a design: Sd, Xmax, Pe and Vas are all known (what the Driver Probe cannot measure). */
export const isUsable = (e: DriverEntry): boolean => e.sd !== undefined && e.xmax !== undefined && e.pe !== undefined && e.vasM3 !== undefined;

/** What is still missing before the driver is usable, in the order a form asks for it. */
export const missingFields = (e: DriverEntry): string[] => [e.vasM3 === undefined && 'Vas', e.sd === undefined && 'Sd', e.xmax === undefined && 'Xmax', e.pe === undefined && 'Pe'].filter((s): s is string => !!s);

/** The physics model's driver, or null while Sd, Xmax, Pe or Vas is missing. */
export function entryToSpec(e: DriverEntry): DriverSpec | null {
  if (!isUsable(e)) return null;
  return { name: e.name, fs: e.fs, qes: e.qes, qms: e.qms, vasM3: e.vasM3!, sd: e.sd!, re: e.re, xmax: e.xmax!, pe: e.pe!, ...(e.le !== undefined ? { le: e.le } : {}) };
}

/**
 * A driver copied into a design: the library id (for "update from library" later) and the nine SI numbers, so a project file opens
 * with no library and a tweeter with fs 1500 Hz is not squeezed through the Custom fields' clamps.
 */
export interface DriverSnapshot {
  id: string;
  name: string;
  fs: number;
  re: number;
  qes: number;
  qms: number;
  vasM3: number;
  sd: number;
  xmax: number;
  pe: number;
  le?: number;
}
const SNAP_KEYS = ['fs', 're', 'qes', 'qms', 'vasM3', 'sd', 'xmax', 'pe'] as const;

export function snapshotOf(e: DriverEntry): DriverSnapshot | null {
  const s = entryToSpec(e);
  return s ? { id: e.id, name: e.name, fs: s.fs, re: s.re, qes: s.qes, qms: s.qms, vasM3: s.vasM3, sd: s.sd, xmax: s.xmax, pe: s.pe, ...(s.le !== undefined ? { le: s.le } : {}) } : null;
}
export const snapshotSpec = (s: DriverSnapshot): DriverSpec => ({ name: s.name, fs: s.fs, qes: s.qes, qms: s.qms, vasM3: s.vasM3, sd: s.sd, re: s.re, xmax: s.xmax, pe: s.pe, ...(s.le !== undefined ? { le: s.le } : {}) });

/** A stored snapshot made valid, or undefined: every number must sit inside the entry ranges (refused, not clamped). */
export function sanitizeSnapshot(x: unknown): DriverSnapshot | undefined {
  const o = x as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !o.id) return undefined;
  const out: Record<string, unknown> = { id: o.id.slice(0, 64), name: text(o.name, GENERIC) };
  for (const k of SNAP_KEYS) {
    const v = o[k];
    if (!num(v) || v < RANGES[k][0] || v > RANGES[k][1]) return undefined;
    out[k] = v;
  }
  if (o.le !== undefined) {
    if (!num(o.le) || o.le < RANGES.le[0] || o.le > RANGES.le[1]) return undefined;
    out.le = o.le;
  }
  return out as unknown as DriverSnapshot;
}

/** Figures of merit shown in the database and used to rank drivers: one-way displacement volume Vd (m^3) and EBP = fs / Qes. */
export const vdM3 = (e: DriverEntry): number | undefined => (e.sd !== undefined && e.xmax !== undefined ? e.sd * e.xmax : undefined);
export const ebp = (e: DriverEntry): number => e.fs / e.qes;

/** The generic classes as read-only starting entries. Ids are `generic-<class index>`, so they stay stable; the list only ever grows. */
export function genericEntries(now = '2026-01-01'): DriverEntry[] {
  return ALL_DRIVER_CLASSES.map((d, i) => {
    const r = buildEntry({ name: d.name, series: GENERIC, model: d.name, source: 'generic', fs: d.fs, re: d.re, qes: d.qes, qms: d.qms, vasM3: d.vasM3, sd: d.sd, xmax: d.xmax, pe: d.pe, ...(d.le !== undefined ? { le: d.le } : {}), addedAt: now }, `generic-${i}`, now);
    if (!r.ok) throw new Error(`generic class ${d.name} is invalid: ${r.errors.join(' ')}`); // a bug in the table, caught by the tests
    return r.entry;
  });
}
export const isGeneric = (e: DriverEntry): boolean => e.source === 'generic';

/** A saved Driver Probe record as an entry (still incomplete until Sd, Xmax, Pe and Vas exist). */
export function entryFromRecord(rec: DriverRecord, id: string, now: string): ReturnType<typeof buildEntry> {
  const kind = rec.method === 'datasheet' ? 'datasheet' : 'probe';
  return buildEntry(
    {
      name: rec.name,
      source: kind,
      addedAt: rec.measuredAt,
      record: rec,
      fs: rec.fs.v,
      re: rec.re.v,
      qes: rec.qes.v,
      qms: rec.qms.v,
      qts: rec.qts.v,
      ...(rec.vasM3 ? { vasM3: rec.vasM3.v } : {}),
      ...(rec.sd !== undefined ? { sd: rec.sd } : {}),
      ...(rec.xmax !== undefined ? { xmax: rec.xmax } : {}),
      ...(rec.pe !== undefined ? { pe: rec.pe } : {}),
      ...(rec.leMH ? { le: rec.leMH.v * 1e-3 } : {}),
      ...(rec.mms ? { mms: rec.mms.v } : {}),
      ...(rec.cms ? { cms: rec.cms.v } : {}),
      ...(rec.bl ? { bl: rec.bl.v } : {}),
    },
    id,
    now,
  );
}

/**
 * Reads one stored entry back. Never throws. Numbers listed in `derived` are dropped and worked out again, so a stored entry never
 * keeps a stale computed value; anything unreadable is refused.
 */
export function parseEntry(x: unknown, now: string): { ok: true; entry: DriverEntry } | { ok: false; errors: string[] } {
  const o = x as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || o.schema !== ENTRY_SCHEMA) return { ok: false, errors: ['Not a driver entry (wrong or missing "schema").'] };
  if (typeof o.id !== 'string' || !o.id) return { ok: false, errors: ['id is missing.'] };
  const skip = new Set(Array.isArray(o.derived) ? o.derived.filter((s): s is string => typeof s === 'string') : []);
  const input: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(o)) if (!skip.has(k) && k !== 'derived' && k !== 'schema') input[k] = val;
  for (const k of [...CORE_KEYS, ...OPTIONAL_KEYS]) if (input[k] !== undefined && !num(input[k])) return { ok: false, errors: [`${LABEL[k]} is not a number.`] };
  return buildEntry(input as DriverInput, o.id, now);
}
