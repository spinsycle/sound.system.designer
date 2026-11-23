// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The driver form: which numbers it asks for, in datasheet units, and the two-way conversion between the text a person types and the
// SI numbers of a DriverInput. Numbers that were derived (not typed) are left out of a form built from an entry, so saving never turns
// a computed value into a typed one.
import { DRIVER_KINDS, type DriverEntry, type DriverInput, type DriverKind, autoName } from './entry';

type NumKey = 'fs' | 're' | 'qts' | 'qes' | 'qms' | 'vasM3' | 'sd' | 'xmax' | 'pe' | 'le' | 'mms' | 'cms' | 'bl' | 'rms' | 'sensDb' | 'znomOhm' | 'xmechM';

export interface FieldDef {
  key: NumKey;
  label: string;
  unit: string;
  /** SI value = typed value x scale. */
  scale: number;
  /** In the first group (needed to make a driver at all, with two of the three Q values). */
  core: boolean;
}

export const FIELDS: readonly FieldDef[] = [
  { key: 'fs', label: 'fs', unit: 'Hz', scale: 1, core: true },
  { key: 're', label: 'Re', unit: 'ohm', scale: 1, core: true },
  { key: 'qts', label: 'Qts', unit: '', scale: 1, core: true },
  { key: 'qes', label: 'Qes', unit: '', scale: 1, core: true },
  { key: 'qms', label: 'Qms', unit: '', scale: 1, core: true },
  { key: 'vasM3', label: 'Vas', unit: 'L', scale: 1e-3, core: false },
  { key: 'sd', label: 'Sd', unit: 'cm²', scale: 1e-4, core: false },
  { key: 'xmax', label: 'Xmax', unit: 'mm', scale: 1e-3, core: false },
  { key: 'pe', label: 'Pe', unit: 'W', scale: 1, core: false },
  { key: 'le', label: 'Le', unit: 'mH', scale: 1e-3, core: false },
  { key: 'mms', label: 'Mms', unit: 'g', scale: 1e-3, core: false },
  { key: 'cms', label: 'Cms', unit: 'mm/N', scale: 1e-3, core: false },
  { key: 'bl', label: 'Bl', unit: 'T m', scale: 1, core: false },
  { key: 'rms', label: 'Rms', unit: 'N s/m', scale: 1, core: false },
  { key: 'sensDb', label: 'Sensitivity', unit: 'dB (1 W, 1 m)', scale: 1, core: false },
  { key: 'znomOhm', label: 'Znom', unit: 'ohm', scale: 1, core: false },
  { key: 'xmechM', label: 'Xmech', unit: 'mm', scale: 1e-3, core: false },
];

export type FormState = Record<NumKey, string> & { name: string; manufacturer: string; series: string; model: string; kind: DriverKind | ''; notes: string };

export const blankForm = (): FormState => ({
  ...(Object.fromEntries(FIELDS.map((f) => [f.key, ''])) as Record<NumKey, string>),
  name: '',
  manufacturer: '',
  series: '',
  model: '',
  kind: '',
  notes: '',
});

/** A number as short text: six significant digits, no trailing zeros. */
export const fmt = (x: number): string => String(Number(x.toPrecision(6)));
/** Same number in datasheet units for a field. */
export const shown = (f: FieldDef, si: number): string => fmt(si / f.scale);

const GENERIC = 'Generic';
export function formFromEntry(e: DriverEntry): FormState {
  const f = blankForm();
  for (const d of FIELDS) {
    const v = e[d.key];
    if (v !== undefined && !e.derived.includes(d.key)) f[d.key] = shown(d, v);
  }
  f.name = e.name === autoName(e) ? '' : e.name; // an automatic name keeps following manufacturer, series and model
  f.manufacturer = e.manufacturer === GENERIC ? '' : e.manufacturer;
  f.series = e.series === GENERIC ? '' : e.series;
  f.model = e.model === GENERIC ? '' : e.model;
  f.kind = e.kind;
  f.notes = e.notes;
  return f;
}

/** What the form says, as a DriverInput; `errors` lists the fields that are not numbers. `base` keeps identity (source, id, record). */
export function inputFromForm(f: FormState, base?: DriverEntry): { input: DriverInput; errors: string[] } {
  const errors: string[] = [];
  const input: Record<string, unknown> = {};
  for (const d of FIELDS) {
    const t = f[d.key].trim().replace(',', '.');
    if (t === '') continue;
    const n = Number(t);
    if (!Number.isFinite(n)) errors.push(`${d.label} is not a number.`);
    else input[d.key] = Number((n * d.scale).toPrecision(12));
  }
  input.name = f.name;
  input.manufacturer = f.manufacturer;
  input.series = f.series;
  input.model = f.model;
  input.notes = f.notes;
  if (DRIVER_KINDS.includes(f.kind as DriverKind)) input.kind = f.kind;
  if (base) {
    input.favourite = base.favourite;
    input.source = base.source === 'generic' ? 'hand' : base.source;
    input.addedAt = base.addedAt;
    if (base.record) input.record = base.record;
  }
  return { input: input as DriverInput, errors };
}
