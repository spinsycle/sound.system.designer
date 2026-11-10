// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Length units for the Build page and the exported files: millimetres or inches. Everything is stored in millimetres (or
// metres inside the libraries); only what is shown, typed and written to files is converted. Pure functions.
import type { Shop } from './build';

export type Units = 'mm' | 'in';
export const MM_PER_IN = 25.4;
export const UNITS: readonly { id: Units; label: string }[] = [
  { id: 'mm', label: 'Millimetres' },
  { id: 'in', label: 'Inches' },
];

/** A length in millimetres as the number to show in the chosen unit. */
export const fromMm = (mm: number, u: Units): number => (u === 'in' ? mm / MM_PER_IN : mm);
/** A length in the chosen unit as millimetres. */
export const toMm = (v: number, u: Units): number => (u === 'in' ? v * MM_PER_IN : v);

/** A length as a shop would write it: whole millimetres, or inches to the nearest 1/16 as "15 5/8". */
export function formatLength(mm: number, u: Units): string {
  if (u === 'mm') return String(Math.round(mm));
  const sixteenths = Math.round((mm / MM_PER_IN) * 16);
  const whole = Math.floor(sixteenths / 16);
  const rest = sixteenths % 16;
  if (rest === 0) return String(whole);
  let n = rest;
  let d = 16;
  while (n > 0 && n % 2 === 0) {
    n /= 2;
    d /= 2;
  }
  return whole === 0 ? `${n}/${d}` : `${whole} ${n}/${d}`;
}

/** A length as a plain decimal for a spreadsheet or a file: millimetres to 0.1, inches to 0.001. */
export function formatDecimal(mm: number, u: Units): string {
  return u === 'mm' ? String(Math.round(mm * 10) / 10) : String(Math.round((mm / MM_PER_IN) * 1000) / 1000);
}

/** "mm" or "in" after a number. */
export const unitName = (u: Units): string => u;

/**
 * Read a typed length into millimetres. Accepts decimals ("0.75"), fractions ("3/4"), mixed numbers ("1 1/2"), and an
 * optional unit that overrides the chosen one ("19 mm", "3/4 in", 3/4"). Null when it is not a length.
 */
export function parseLength(text: string, u: Units): number | null {
  let t = text.trim().toLowerCase();
  let unit = u;
  const m = /\s*(mm|in|")$/.exec(t);
  if (m) {
    unit = m[1] === 'mm' ? 'mm' : 'in';
    t = t.slice(0, m.index).trim();
  }
  if (t === '') return null;
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t);
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  let v: number;
  if (mixed) {
    v = Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  } else if (frac) {
    v = Number(frac[1]) / Number(frac[2]);
  } else if (/^\d*\.?\d+$/.test(t) || /^\d+\.$/.test(t)) {
    v = Number(t);
  } else return null;
  return Number.isFinite(v) ? toMm(v, unit) : null;
}

/** The wall and sheet defaults of each system: 18 mm and 1220 x 2440 mm, or 3/4 in and 4 x 8 ft. */
export const DEFAULT_SHOP_MM: Shop = { thicknessMm: 18, sheetLmm: 2440, sheetWmm: 1220, kerfMm: 3 };
export const DEFAULT_SHOP_IN: Shop = { thicknessMm: 19.05, sheetLmm: 2438.4, sheetWmm: 1219.2, kerfMm: 3.175 };

/**
 * Switching units swaps each value that is still the old system's default for the new system's default, so a fresh project
 * shows 3/4 in and 48 x 96 in rather than 47.992; a value the user changed is left alone.
 */
export function swapShopDefaults(shop: Shop, to: Units): Shop {
  const [from, next] = to === 'in' ? [DEFAULT_SHOP_MM, DEFAULT_SHOP_IN] : [DEFAULT_SHOP_IN, DEFAULT_SHOP_MM];
  const pick = (k: keyof Shop): number => (shop[k] === from[k] ? next[k] : shop[k]);
  return { thicknessMm: pick('thicknessMm'), sheetLmm: pick('sheetLmm'), sheetWmm: pick('sheetWmm'), kerfMm: pick('kerfMm') };
}

/** Wall stock offered as buttons in each system (thickness only; no material database). */
export const MATERIALS_IN: readonly { label: string; thicknessMm: number }[] = [
  { label: '1/2 in ply', thicknessMm: 12.7 },
  { label: '5/8 in MDF', thicknessMm: 15.875 },
  { label: '3/4 in ply', thicknessMm: 19.05 },
  { label: '1 in MDF', thicknessMm: 25.4 },
];
