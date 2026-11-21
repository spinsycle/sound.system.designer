// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Measured driver curves (spec "Driver load model (app only, v0.22)"): a ZMA-style impedance file (frequency, ohm, optional phase
// in degrees) and an FRD-style response file (frequency, dB, optional phase in degrees). Parsing is strict and size-limited;
// values between points are interpolated against log frequency.
import { type Cx, cx } from './complex';

export type CurveKind = 'zma' | 'frd';

export interface MeasuredCurve {
  kind: CurveKind;
  /** Ascending, Hz. */
  freqHz: number[];
  /** Ohm (zma) or dB (frd). */
  mag: number[];
  /** Unwrapped degrees, or null when the file has no phase column. */
  phaseDeg: number[] | null;
}

export type ParseResult = { ok: true; curve: MeasuredCurve } | { ok: false; error: string };

export const MAX_CURVE_BYTES = 2_000_000;
export const MAX_CURVE_LINES = 20_000;
export const MAX_CURVE_POINTS = 5000;
export const MIN_CURVE_POINTS = 5;
export const MIN_CURVE_HZ = 1;
export const MAX_CURVE_HZ = 200_000;
export const MAX_ZMA_OHM = 10_000;
export const MAX_FRD_DB = 200;
export const MAX_PHASE_DEG = 3600;

const fail = (error: string): ParseResult => ({ ok: false, error });
const COMMENT = /^(\*|#|;|\/\/|%)/;
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Adds or subtracts 360 degrees step by step so successive phases never jump by more than 180. */
export function unwrapDeg(deg: readonly number[]): number[] {
  const out: number[] = [];
  for (const x of deg) {
    if (out.length === 0) out.push(x);
    else {
      const prev = out[out.length - 1]!;
      out.push(prev + ((((x - prev + 180) % 360) + 360) % 360) - 180);
    }
  }
  return out;
}

/**
 * Text lines of two or three numbers (frequency, magnitude, optional phase) separated by spaces, tabs, commas or semicolons.
 * Blank lines and lines starting with * # ; // % are skipped, and so are non-numeric header lines before the first row. Anything
 * else is an error with its line number. Rows may come in any order; they are sorted, and a repeated frequency is refused.
 */
export function parseCurve(text: string, kind: CurveKind): ParseResult {
  if (text.length > MAX_CURVE_BYTES) return fail(`the file is larger than ${MAX_CURVE_BYTES / 1e6} MB`);
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  if (lines.length > MAX_CURVE_LINES) return fail(`the file has more than ${MAX_CURVE_LINES} lines`);
  const rows: number[][] = [];
  let cols = 0;
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i]!.trim();
    if (line === '' || COMMENT.test(line)) continue;
    const tok = line.split(/[\s,;]+/).filter((t) => t !== '');
    const numeric = tok.every((t) => NUMBER.test(t));
    if (!numeric) {
      if (rows.length === 0) continue; // a header line before the data
      return fail(`line ${i + 1} is not numbers: "${line.slice(0, 40)}"`);
    }
    if (tok.length < 2 || tok.length > 3) return fail(`line ${i + 1} has ${tok.length} columns; expected 2 or 3 (frequency, ${kind === 'zma' ? 'ohm' : 'dB'}, optional phase)`);
    if (cols === 0) cols = tok.length;
    else if (tok.length !== cols) return fail(`line ${i + 1} has ${tok.length} columns but the first row had ${cols}`);
    const nums = tok.map(Number);
    if (!nums.every(Number.isFinite)) return fail(`line ${i + 1} has a number that is not finite`);
    rows.push(nums);
    if (rows.length > MAX_CURVE_POINTS) return fail(`more than ${MAX_CURVE_POINTS} points`);
  }
  if (rows.length < MIN_CURVE_POINTS) return fail(`only ${rows.length} data rows; at least ${MIN_CURVE_POINTS} are needed`);
  rows.sort((a, b) => a[0]! - b[0]!);
  for (let i = 0; i < rows.length; ++i) {
    const [f, m, p] = rows[i]!;
    if (f! < MIN_CURVE_HZ || f! > MAX_CURVE_HZ) return fail(`frequency ${f} Hz is outside ${MIN_CURVE_HZ} to ${MAX_CURVE_HZ} Hz`);
    if (i > 0 && f === rows[i - 1]![0]) return fail(`frequency ${f} Hz appears twice`);
    if (kind === 'zma' && !(m! > 0 && m! <= MAX_ZMA_OHM)) return fail(`impedance ${m} ohm at ${f} Hz is outside 0 to ${MAX_ZMA_OHM} ohm`);
    if (kind === 'frd' && Math.abs(m!) > MAX_FRD_DB) return fail(`level ${m} dB at ${f} Hz is outside +-${MAX_FRD_DB} dB`);
    if (p !== undefined && Math.abs(p) > MAX_PHASE_DEG) return fail(`phase ${p} degrees at ${f} Hz is outside +-${MAX_PHASE_DEG}`);
  }
  const phase = cols === 3 ? unwrapDeg(rows.map((r) => r[2]!)) : null;
  return { ok: true, curve: { kind, freqHz: rows.map((r) => r[0]!), mag: rows.map((r) => r[1]!), phaseDeg: phase } };
}

/**
 * The curve's complex value at f: an impedance in ohms (zma) or a linear response (frd, from dB). Magnitude is interpolated
 * in the log domain against log frequency, phase linearly against log frequency; beyond the ends the end values hold.
 */
export function curveValue(c: MeasuredCurve, f: number): Cx {
  const n = c.freqHz.length;
  let i: number;
  let t: number;
  if (f <= c.freqHz[0]!) {
    i = 0;
    t = 0;
  } else if (f >= c.freqHz[n - 1]!) {
    i = n - 2;
    t = 1;
  } else {
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c.freqHz[mid]! <= f) lo = mid;
      else hi = mid;
    }
    i = lo;
    t = (Math.log(f) - Math.log(c.freqHz[i]!)) / (Math.log(c.freqHz[i + 1]!) - Math.log(c.freqHz[i]!));
  }
  const a = c.mag[i]!;
  const b = c.mag[i + 1]!;
  const m = c.kind === 'frd' ? 10 ** ((a + t * (b - a)) / 20) : Math.exp(Math.log(a) + t * (Math.log(b) - Math.log(a)));
  const ph = c.phaseDeg === null ? 0 : ((c.phaseDeg[i]! + t * (c.phaseDeg[i + 1]! - c.phaseDeg[i]!)) * Math.PI) / 180;
  return cx(m * Math.cos(ph), m * Math.sin(ph));
}
