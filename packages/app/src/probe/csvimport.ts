// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Bulk import of datasheet drivers the user typed or collected themselves (CSV, or pasted from a spreadsheet: comma,
// semicolon or tab). One row = one driver, stored as a `datasheet` record with band 0 (a typed number, not a measurement).
// Units are fixed, as in the template: fs Hz, Re ohm, Vas L, Sd cm2, Xmax mm, Pe W, Le mH. If exactly one of Qts, Qes,
// Qms is missing it is derived from the other two; if all three are given they must agree within 10 %.
import { type DriverRecord, RECORD_SCHEMA, isIncomplete } from './record';

export const CSV_TEMPLATE = 'name,fs_hz,qts,qes,qms,re_ohm,vas_l,sd_cm2,xmax_mm,pe_w,le_mh\nExample 12 in,38,0.35,0.40,4.5,5.4,90,520,8,400,1.2\n';

const ALIASES: Record<string, string[]> = {
  name: ['name', 'model', 'driver'],
  fs: ['fs', 'fshz'],
  qts: ['qts'],
  qes: ['qes'],
  qms: ['qms'],
  re: ['re', 'rehm', 'reohm', 'dcr'],
  vas: ['vas', 'vasl'],
  sd: ['sd', 'sdcm2'],
  xmax: ['xmax', 'xmaxmm'],
  pe: ['pe', 'pew', 'power', 'powerw'],
  le: ['le', 'lemh'],
};

/** Splits one CSV line; double quotes may wrap a field and contain the delimiter, "" is a quote. */
function splitLine(line: string, d: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === d) { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

const num = (s: string | undefined): number | undefined => {
  if (s === undefined || s.trim() === '') return undefined;
  const n = Number(s.trim().replace(',', '.')); // 0,35 from a European spreadsheet
  return Number.isFinite(n) ? n : NaN;
};

export interface CsvResult {
  records: DriverRecord[];
  errors: string[];
}

export function parseDriverCsv(text: string, date: string): CsvResult {
  const records: DriverRecord[] = [];
  const errors: string[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return { records, errors: ['The file needs a header row and at least one driver row.'] };
  const delim = [',', '\t', ';'].reduce((a, b) => (lines[0]!.split(b).length > lines[0]!.split(a).length ? b : a));
  const header = splitLine(lines[0]!, delim).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const col: Record<string, number> = {};
  for (const [k, names] of Object.entries(ALIASES)) {
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) col[k] = i;
  }
  const lacking = ['name', 'fs', 're'].filter((k) => col[k] === undefined);
  const qCols = ['qts', 'qes', 'qms'].filter((k) => col[k] !== undefined).length;
  if (lacking.length || qCols < 2) return { records, errors: [`The header needs name, fs, re and at least two of qts, qes, qms. Missing: ${[...lacking, ...(qCols < 2 ? ['two of qts/qes/qms'] : [])].join(', ')}.`] };

  const seen = new Set<string>();
  lines.slice(1).forEach((line, idx) => {
    const row = idx + 2;
    const f = splitLine(line, delim);
    const get = (k: string) => (col[k] === undefined ? undefined : num(f[col[k]!]));
    const name = (f[col.name!] ?? '').trim();
    const bad = (m: string): void => {
      errors.push(`Row ${row}${name ? ` (${name})` : ''}: ${m}`);
    };
    if (!name) return bad('no name.');
    if (seen.has(name)) return bad('duplicate name in this file; the later row is skipped.');
    const v: Record<string, number | undefined> = {};
    for (const k of Object.keys(ALIASES)) if (k !== 'name') v[k] = get(k);
    for (const [k, x] of Object.entries(v)) if (x !== undefined && !(x > 0)) return bad(`${k} must be a positive number.`);
    const { fs, re } = v;
    if (fs === undefined || re === undefined) return bad('fs and re are required.');
    let { qts, qes, qms } = v;
    const given = [qts, qes, qms].filter((x) => x !== undefined).length;
    if (given < 2) return bad('needs at least two of qts, qes, qms.');
    if (given === 2) {
      if (qts === undefined) qts = (qes! * qms!) / (qes! + qms!);
      else if (qes === undefined) {
        if (!(qms! > qts)) return bad('qms must be larger than qts.');
        qes = (qts * qms!) / (qms! - qts);
      } else {
        if (!(qes > qts)) return bad('qes must be larger than qts.');
        qms = (qts * qes) / (qes - qts);
      }
    } else if (Math.abs(1 / qts! - (1 / qes! + 1 / qms!)) > 0.1 * (1 / qts!)) return bad('qts, qes and qms do not agree (1/Qts should equal 1/Qes + 1/Qms within 10 %).');
    const val = (x: number) => ({ v: x, band: 0 });
    const r: DriverRecord = {
      schema: RECORD_SCHEMA,
      name,
      measuredAt: date,
      method: 'datasheet',
      re: val(re),
      fs: val(fs),
      qms: val(qms!),
      qes: val(qes!),
      qts: val(qts!),
      incomplete: true,
    };
    if (v.le) r.leMH = val(v.le);
    if (v.sd) r.sd = v.sd / 1e4;
    if (v.xmax) r.xmax = v.xmax / 1000;
    if (v.pe) r.pe = v.pe;
    if (v.vas) { r.vasM3 = val(v.vas / 1000); r.vasSource = 'entered'; }
    r.incomplete = isIncomplete(r);
    seen.add(name);
    records.push(r);
  });
  return { records, errors };
}
