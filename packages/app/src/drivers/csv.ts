// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Bulk import into the driver database (CSV, or pasted from a spreadsheet: comma, semicolon or tab). One row = one driver.
// Units are fixed, as in the template: fs Hz, Re ohm, Vas L, Sd cm2, Xmax mm, Xmech mm, Pe W, Le mH, Mms g, Cms mm/N, Bl T m, Rms N s/m,
// sensitivity dB, Znom ohm. Needs a name or model, fs, Re and two of the three Q values; buildEntry does the checking and the
// deriving, so a row is refused for the same reasons a typed driver is.
import { splitLine, num } from '../probe/csvimport';
import { type DriverEntry, type DriverInput, buildEntry } from './entry';

export const DB_CSV_TEMPLATE =
  'manufacturer,series,model,name,kind,favourite,fs_hz,qts,qes,qms,re_ohm,vas_l,sd_cm2,xmax_mm,pe_w,le_mh,mms_g,cms_mm_n,bl_tm,rms,sens_db,znom_ohm,xmech_mm,notes\n' +
  'Generic,Generic,Example 12 in,,woofer,no,38,0.35,0.40,4.5,5.4,90,520,8,400,1.2,,,,,92,8,,from a datasheet\n';

const ALIASES: Record<string, string[]> = {
  manufacturer: ['manufacturer', 'brand', 'make'],
  series: ['series', 'line'],
  model: ['model', 'modelnumber', 'partnumber'],
  name: ['name', 'driver'],
  kind: ['kind', 'type'],
  favourite: ['favourite', 'favorite', 'fav'],
  notes: ['notes', 'note', 'comment'],
  fs: ['fs', 'fshz'],
  qts: ['qts'],
  qes: ['qes'],
  qms: ['qms'],
  re: ['re', 'rehm', 'reohm', 'dcr'],
  vas: ['vas', 'vasl'],
  sd: ['sd', 'sdcm2'],
  xmax: ['xmax', 'xmaxmm'],
  xmech: ['xmech', 'xmechmm'],
  pe: ['pe', 'pew', 'power', 'powerw'],
  le: ['le', 'lemh'],
  mms: ['mms', 'mmsg'],
  cms: ['cms', 'cmsmmn'],
  bl: ['bl', 'bltm'],
  rms: ['rms'],
  sens: ['sens', 'sensitivity', 'sensdb', 'spl'],
  znom: ['znom', 'znomohm', 'impedance'],
};
const TEXT = new Set(['manufacturer', 'series', 'model', 'name', 'kind', 'favourite', 'notes']);
/** CSV value to the SI number buildEntry wants. */
const SCALE: Record<string, [keyof DriverInput, number]> = {
  fs: ['fs', 1],
  qts: ['qts', 1],
  qes: ['qes', 1],
  qms: ['qms', 1],
  re: ['re', 1],
  vas: ['vasM3', 1e-3],
  sd: ['sd', 1e-4],
  xmax: ['xmax', 1e-3],
  xmech: ['xmechM', 1e-3],
  pe: ['pe', 1],
  le: ['le', 1e-3],
  mms: ['mms', 1e-3],
  cms: ['cms', 1e-3],
  bl: ['bl', 1],
  rms: ['rms', 1],
  sens: ['sensDb', 1],
  znom: ['znomOhm', 1],
};
const YES = new Set(['yes', 'y', 'true', '1', 'x', '*', 'fav', 'favourite', 'favorite']);

export interface DbCsvResult {
  entries: DriverEntry[];
  errors: string[];
}

export function parseDriverCsvEntries(text: string, now: string, mint: () => string): DbCsvResult {
  const entries: DriverEntry[] = [];
  const errors: string[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return { entries, errors: ['The file needs a header row and at least one driver row.'] };
  const delim = [',', '\t', ';'].reduce((a, b) => (lines[0]!.split(b).length > lines[0]!.split(a).length ? b : a));
  const header = splitLine(lines[0]!, delim).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const col: Record<string, number> = {};
  for (const [k, names] of Object.entries(ALIASES)) {
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) col[k] = i;
  }
  const lacking = [col.name === undefined && col.model === undefined && 'name or model', col.fs === undefined && 'fs', col.re === undefined && 're'].filter(Boolean) as string[];
  const qCols = ['qts', 'qes', 'qms'].filter((k) => col[k] !== undefined).length;
  if (lacking.length || qCols < 2) return { entries, errors: [`The header needs name or model, fs, re and at least two of qts, qes, qms. Missing: ${[...lacking, ...(qCols < 2 ? ['two of qts/qes/qms'] : [])].join(', ')}.`] };

  const seen = new Set<string>();
  lines.slice(1).forEach((line, idx) => {
    const f = splitLine(line, delim);
    const cell = (k: string): string => (col[k] === undefined ? '' : (f[col[k]!] ?? '').trim());
    const label = cell('name') || cell('model') || cell('manufacturer');
    const bad = (m: string): void => {
      errors.push(`Row ${idx + 2}${label ? ` (${label})` : ''}: ${m}`);
    };
    if (!label) return bad('no name or model.');
    const input: Record<string, unknown> = { source: 'csv', addedAt: now };
    for (const k of TEXT) if (cell(k)) input[k] = cell(k);
    input.favourite = YES.has(cell('favourite').toLowerCase());
    for (const [k, [to, scale]] of Object.entries(SCALE)) {
      if (col[k] === undefined) continue;
      const x = num(f[col[k]!]);
      if (x === undefined) continue;
      if (!Number.isFinite(x)) return bad(`${k} is not a number.`);
      input[to] = x * scale;
    }
    const key = [cell('manufacturer'), cell('series'), cell('model'), cell('name')].join('|').toLowerCase();
    if (seen.has(key)) return bad('duplicate of an earlier row; skipped.');
    const r = buildEntry(input as DriverInput, mint(), now);
    if (!r.ok) return bad(r.errors.join(' '));
    seen.add(key);
    entries.push(r.entry);
  });
  return { entries, errors };
}
