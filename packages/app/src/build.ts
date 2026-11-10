// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// What a user chooses about the physical build: wall material, sheet size, box shape, bracing. Pure data and clamping.
import * as P from '@soundsystemdesigner/physics';
import type { Range } from './model';

/** How the box is shaped and braced; one per band. Interior proportions width : height : depth. */
export interface BuildOpts {
  rw: number;
  rh: number;
  rd: number;
  brace: P.Brace;
}

/** Wall material and sheet stock; one for the whole project. Millimetres. */
export interface Shop {
  thicknessMm: number;
  sheetLmm: number;
  sheetWmm: number;
  kerfMm: number;
}

export const BRACES: readonly { id: P.Brace; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'single', label: 'One window brace' },
  { id: 'window', label: 'Window braces every 0.4 m' },
];

export type BuildField = 'rw' | 'rh' | 'rd';
export const BUILD_RANGES: Record<BuildField, Range> = {
  rw: { label: 'Width', unit: '', min: 0.2, max: 5 },
  rh: { label: 'Height', unit: '', min: 0.2, max: 5 },
  rd: { label: 'Depth', unit: '', min: 0.2, max: 5 },
};
export const DEFAULT_BUILD: BuildOpts = { rw: 1, rh: 1.5, rd: 1, brace: 'none' };

export type ShopField = keyof Shop;
export const SHOP_RANGES: Record<ShopField, Range> = {
  thicknessMm: { label: 'Wall thickness', unit: 'mm', min: 3, max: 50 },
  sheetLmm: { label: 'Sheet length', unit: 'mm', min: 300, max: 6000 },
  sheetWmm: { label: 'Sheet width', unit: 'mm', min: 300, max: 3000 },
  kerfMm: { label: 'Saw kerf', unit: 'mm', min: 0, max: 10, linear: true },
};
export const DEFAULT_SHOP: Shop = { thicknessMm: 18, sheetLmm: 2440, sheetWmm: 1220, kerfMm: 3 };

/** Generic wall stock. Thickness only: the app has no material database. */
export const MATERIALS: readonly { label: string; thicknessMm: number }[] = [
  { label: '12 mm ply', thicknessMm: 12 },
  { label: '18 mm ply', thicknessMm: 18 },
  { label: '19 mm MDF', thicknessMm: 19 },
  { label: '25 mm MDF', thicknessMm: 25 },
];

const num = (v: unknown, r: Range, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? P.clamp(v, r.min, r.max) : fallback);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export function sanitizeBuild(input: unknown): BuildOpts {
  const i = obj(input);
  const d = DEFAULT_BUILD;
  return {
    rw: num(i.rw, BUILD_RANGES.rw, d.rw),
    rh: num(i.rh, BUILD_RANGES.rh, d.rh),
    rd: num(i.rd, BUILD_RANGES.rd, d.rd),
    brace: BRACES.some((b) => b.id === i.brace) ? (i.brace as P.Brace) : d.brace,
  };
}

export function sanitizeShop(input: unknown): Shop {
  const i = obj(input);
  const d = DEFAULT_SHOP;
  return {
    thicknessMm: num(i.thicknessMm, SHOP_RANGES.thicknessMm, d.thicknessMm),
    sheetLmm: num(i.sheetLmm, SHOP_RANGES.sheetLmm, d.sheetLmm),
    sheetWmm: num(i.sheetWmm, SHOP_RANGES.sheetWmm, d.sheetWmm),
    kerfMm: num(i.kerfMm, SHOP_RANGES.kerfMm, d.kerfMm),
  };
}
