// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The Driver Probe driver record (DriverProbe repo, spec/record.schema.json): what one measured driver is, with a 95 %
// band on every measured number, the raw sweeps kept for a later re-fit, and an `incomplete` flag until the numbers a
// sweep cannot give (Sd, Xmax, Pe, and Vas when no added-mass sweep exists) are entered. SI units inside the record.
import { type CustomDriverFields, type FreeAirFit, type ImpedancePoint, addedMass, vasFromCms } from '@soundsystemdesigner/physics';

export const RECORD_SCHEMA = 'driverprobe.record/1';
export const RECORD_EXTENSION = 'driver.json';

export interface Val {
  v: number;
  /** relative 95 % half-width, 0.02 = +-2 % */
  band: number;
}
export interface Sweep {
  label: 'free-air' | 'added-mass';
  points: [number, number, number][];
}
export interface DriverRecord {
  schema: typeof RECORD_SCHEMA;
  name: string;
  measuredAt: string;
  method: 'free-air' | 'free-air+added-mass';
  probe?: { id: string; fw: string };
  re: Val;
  fs: Val;
  qms: Val;
  qes: Val;
  qts: Val;
  leMH?: Val;
  mms?: Val;
  cms?: Val;
  bl?: Val;
  addedMassKg?: number;
  sd?: number;
  xmax?: number;
  pe?: number;
  vasM3?: Val;
  /** 'measured' = from Cms and Sd; 'entered' = typed from a datasheet (band 0, not a measurement). */
  vasSource?: 'measured' | 'entered';
  incomplete: boolean;
  sweeps?: Sweep[];
}

/** Largest relative 95 % band the app will export or use: a wrong number that looks exact is worse than none. */
export const MAX_BANDS: Record<string, number> = { re: 0.05, fs: 0.05, qms: 0.4, qes: 0.2, qts: 0.15, mms: 0.2, cms: 0.3, bl: 0.2, vasM3: 0.35 };

export interface BuildInput {
  name: string;
  date: string;
  probe?: { id: string; fw: string };
  base: { fit: FreeAirFit; points: ImpedancePoint[] };
  loaded?: { fit: FreeAirFit; points: ImpedancePoint[]; massKg: number; massBand: number };
  sdM2?: number;
  xmaxM?: number;
  peW?: number;
  /** A datasheet Vas, m^3, used only when no measured Vas exists. */
  vasEnteredM3?: number;
}

const pos = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const pts = (p: ImpedancePoint[]): [number, number, number][] => p.map((q) => [q.f, q.re, q.im]);

/** True while anything the Designer needs to use the driver is missing. Never trusted from a file: always recomputed. */
export function isIncomplete(r: Pick<DriverRecord, 'sd' | 'xmax' | 'pe' | 'vasM3'>): boolean {
  return !(pos(r.sd) && pos(r.xmax) && pos(r.pe) && r.vasM3 !== undefined && pos(r.vasM3.v));
}

export function buildRecord(i: BuildInput): DriverRecord {
  const b = i.base.fit;
  const rec: DriverRecord = {
    schema: RECORD_SCHEMA,
    name: i.name.trim() || 'Measured driver',
    measuredAt: i.date,
    method: i.loaded ? 'free-air+added-mass' : 'free-air',
    ...(i.probe ? { probe: i.probe } : {}),
    re: { v: b.re, band: b.bands.re },
    fs: { v: b.fs, band: b.bands.fs },
    qms: { v: b.qms, band: b.bands.qms },
    qes: { v: b.qes, band: b.bands.qes },
    qts: { v: b.qts, band: b.bands.qts },
    ...(b.leMH > 0.001 ? { leMH: { v: b.leMH, band: Math.min(10, b.bands.leMH / b.leMH) } } : {}),
    incomplete: true,
    sweeps: [{ label: 'free-air', points: pts(i.base.points) }],
  };
  if (pos(i.sdM2)) rec.sd = i.sdM2;
  if (pos(i.xmaxM)) rec.xmax = i.xmaxM;
  if (pos(i.peW)) rec.pe = i.peW;
  if (i.loaded) {
    const m = addedMass(b, i.loaded.fit, i.loaded.massKg, i.loaded.massBand);
    rec.mms = { v: m.mms, band: m.bands.mms };
    rec.cms = { v: m.cms, band: m.bands.cms };
    rec.bl = { v: m.bl, band: m.bands.bl };
    rec.addedMassKg = i.loaded.massKg;
    rec.sweeps!.push({ label: 'added-mass', points: pts(i.loaded.points) });
    if (pos(i.sdM2)) {
      const v = vasFromCms(m.cms, i.sdM2, m.bands.cms);
      rec.vasM3 = { v: v.vasM3, band: v.band };
      rec.vasSource = 'measured';
    }
  }
  if (!rec.vasM3 && pos(i.vasEnteredM3)) {
    rec.vasM3 = { v: i.vasEnteredM3, band: 0 };
    rec.vasSource = 'entered';
  }
  rec.incomplete = isIncomplete(rec);
  return rec;
}

/** Why a record may not be exported or used yet: bands too wide. Empty = fine. Entered values (band 0) never trip it. */
export function bandProblems(r: DriverRecord): string[] {
  const out: string[] = [];
  const chk = (key: string, label: string, v?: Val) => {
    const max = MAX_BANDS[key];
    if (v && max !== undefined && v.band > max) out.push(`${label} is uncertain by ${(v.band * 100).toFixed(0)} % (limit ${(max * 100).toFixed(0)} %): measure again.`);
  };
  chk('re', 'Re', r.re);
  chk('fs', 'fs', r.fs);
  chk('qms', 'Qms', r.qms);
  chk('qes', 'Qes', r.qes);
  chk('qts', 'Qts', r.qts);
  chk('mms', 'Mms', r.mms);
  chk('cms', 'Cms', r.cms);
  chk('bl', 'Bl', r.bl);
  chk('vasM3', 'Vas', r.vasM3);
  return out;
}

/** The Designer's Custom driver fields for a complete record, or null while incomplete. */
export function toCustomFields(r: DriverRecord): CustomDriverFields | null {
  if (isIncomplete(r) || !r.sd || !r.xmax || !r.pe || !r.vasM3) return null;
  return { fsHz: r.fs.v, qts: r.qts.v, qms: r.qms.v, vasL: r.vasM3.v * 1000, sdCm2: r.sd * 1e4, reOhm: r.re.v, xmaxMm: r.xmax * 1000, powerW: r.pe };
}

export function serializeRecord(r: DriverRecord): string {
  return JSON.stringify(r, null, 1);
}

export function recordFileName(r: DriverRecord): string {
  return `${r.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'driver'}.${RECORD_EXTENSION}`;
}

function val(x: unknown, what: string): Val {
  const o = x as { v?: unknown; band?: unknown } | null;
  if (!o || !pos(o.v) || typeof o.band !== 'number' || !Number.isFinite(o.band) || o.band < 0) throw new Error(`${what} is missing or not a positive number with a band.`);
  return { v: o.v, band: o.band };
}

/** Reads and validates a record file. Never throws; `incomplete` is recomputed, not trusted. */
export function parseRecord(text: string): { ok: true; record: DriverRecord } | { ok: false; error: string } {
  try {
    const o = JSON.parse(text);
    if (!o || o.schema !== RECORD_SCHEMA) return { ok: false, error: 'This is not a Driver Probe record (wrong or missing "schema").' };
    if (typeof o.name !== 'string' || !o.name.trim()) throw new Error('name is missing.');
    if (typeof o.measuredAt !== 'string') throw new Error('measuredAt is missing.');
    if (o.method !== 'free-air' && o.method !== 'free-air+added-mass') throw new Error('method must be free-air or free-air+added-mass.');
    const r: DriverRecord = {
      schema: RECORD_SCHEMA,
      name: o.name.trim(),
      measuredAt: o.measuredAt,
      method: o.method,
      re: val(o.re, 'Re'),
      fs: val(o.fs, 'fs'),
      qms: val(o.qms, 'Qms'),
      qes: val(o.qes, 'Qes'),
      qts: val(o.qts, 'Qts'),
      incomplete: true,
    };
    if (o.probe && typeof o.probe.id === 'string') r.probe = { id: o.probe.id, fw: String(o.probe.fw ?? '') };
    for (const k of ['leMH', 'mms', 'cms', 'bl', 'vasM3'] as const) if (o[k] !== undefined) r[k] = val(o[k], k);
    for (const k of ['sd', 'xmax', 'pe', 'addedMassKg'] as const) if (o[k] !== undefined) { if (!pos(o[k])) throw new Error(`${k} must be a positive number.`); r[k] = o[k]; }
    if (r.vasM3) r.vasSource = o.vasSource === 'entered' ? 'entered' : 'measured';
    if (r.method === 'free-air+added-mass' && !(r.mms && r.cms && r.bl && r.addedMassKg)) throw new Error('an added-mass record needs mms, cms, bl and addedMassKg.');
    if (Array.isArray(o.sweeps)) r.sweeps = o.sweeps.filter((s: any) => (s?.label === 'free-air' || s?.label === 'added-mass') && Array.isArray(s.points));
    r.incomplete = isIncomplete(r);
    return { ok: true, record: r };
  } catch (e) {
    return { ok: false, error: e instanceof SyntaxError ? 'The file is not valid JSON.' : e instanceof Error ? e.message : String(e) };
  }
}
