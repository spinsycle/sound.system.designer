// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Comparing crossovers: the same drivers and crossover points run through other orders, other alignments, or the other kind of network
// (active or passive), side by side. A variant is the current crossover state with three settings changed; its numbers come from
// computeCrossover() and are reduced to a few plain figures. Pure functions.
import * as P from '@soundsystemdesigner/physics';
import { type Computed, type XoState, computeCrossover, sanitizeXo, xoverUsed } from './crossover';

export type XoMode = 'active' | 'passive';
export interface VariantSpec {
  mode: XoMode;
  alignment: P.Alignment;
  order: number;
}

export const ALIGN_NAME: Record<P.Alignment, string> = { butterworth: 'Butterworth', 'linkwitz-riley': 'Linkwitz-Riley', bessel: 'Bessel', chebyshev: 'Chebyshev' };
/** Slope of one filter, dB per octave (6 per order). */
export const slopeDbPerOct = (order: number): number => 6 * order;

export const specOf = (s: XoState): VariantSpec => ({ mode: s.mode, alignment: s.alignment, order: s.order });
export const specKey = (v: VariantSpec): string => `${v.mode}|${v.alignment}|${v.order}`;
export const variantLabel = (v: VariantSpec): string => `${v.mode === 'active' ? 'Active' : 'Passive'} ${ALIGN_NAME[v.alignment]} ${v.order} (${slopeDbPerOct(v.order)} dB/oct)`;

/** Why a combination cannot be built, or null: an order the alignment does not have, a passive network beyond order 4, an even-order Chebyshev passively. */
export function variantProblem(v: VariantSpec): string | null {
  if (!Number.isInteger(v.order) || v.order < 1 || v.order > P.MAX_ORDER) return `The order must be a whole number from 1 to ${P.MAX_ORDER}.`;
  if (!P.isValidOrder(v.alignment, v.order)) return `${ALIGN_NAME[v.alignment]} has no order ${v.order}${v.alignment === 'linkwitz-riley' ? ' (Linkwitz-Riley takes even orders only)' : ''}.`;
  if (v.mode === 'passive' && v.order > P.MAX_PASSIVE_ORDER) return `A passive network goes up to order ${P.MAX_PASSIVE_ORDER}.`;
  if (v.mode === 'passive' && v.alignment === 'chebyshev' && v.order % 2 === 0) return 'An even-order Chebyshev cannot be built as a passive network.';
  return null;
}

/** The crossover state with the variant's mode, alignment and order; the optimised passive values are kept only while those are unchanged. */
export function variantState(base: XoState, v: VariantSpec): XoState {
  const same = specKey(specOf(base)) === specKey(v);
  return sanitizeXo({ ...base, ...v, tuned: same ? base.tuned : null });
}

/** The orders of one alignment in one mode that can be built, low to high. */
export const validOrders = (mode: XoMode, alignment: P.Alignment): number[] =>
  Array.from({ length: P.MAX_ORDER }, (_, i) => i + 1).filter((order) => variantProblem({ mode, alignment, order }) === null);

export interface XoMetrics {
  /** Shape error of the summed level across the crossover region, dB rms with the mean removed (computeCrossover's rmsFlatDb). */
  rmsFlatDb: number;
  /** The most the filters alone sum away from 0 dB within an octave of a crossover point, dB. */
  filterDevDb: number;
  /** The upper driver of a split must be reversed for a flat sum. */
  reversed: boolean;
  /** Peak of the summed group delay, ms (positive part only). */
  groupDelayPeakMs: number;
  /** Active: filter stages (one op-amp each). Passive: parts. */
  stages: number | null;
  parts: number | null;
  /** Passive: how far the filters sit below 0 dB in their passbands (worst way), dB; 0 for active. */
  passbandLossDb: number;
  /** Passive: the lowest impedance the amplifier sees, ohm. */
  ampMinOhm: number | null;
  /** Passive: the most heat in any one part at the amplifier's full power, W. */
  hottestPartW: number | null;
  /** Why a passive network could not be built (then the other figures are empty), or null. */
  error: string | null;
  warnings: number;
}

/** The plain figures of one computed crossover. `xs` are the crossover points actually used. */
export function metricsOf(c: Computed, xs: readonly number[]): XoMetrics {
  const f = c.freqs;
  let dev = 0;
  f.forEach((fr, i) => {
    if (xs.some((x) => fr >= x / 2 && fr <= x * 2)) dev = Math.max(dev, Math.abs(c.filterSumDb[i]!));
  });
  const passiveOk = c.passive !== null && c.passiveError === null;
  const stress = (c.passive ?? []).flatMap((w) => w.stress);
  return {
    rmsFlatDb: c.rmsFlatDb,
    filterDevDb: dev,
    reversed: c.advice.some((a) => a.invertUpper),
    groupDelayPeakMs: Math.max(0, ...c.sumDelayMs.filter(Number.isFinite)),
    stages: c.active ? c.active.reduce((n, a) => n + a.lp.sections.length + a.hp.sections.length, 0) : null,
    parts: passiveOk ? c.passive!.reduce((n, w) => n + w.parts.length, 0) : null,
    passbandLossDb: passiveOk ? Math.max(0, ...c.ways.map((w) => -Math.max(...w.filterDb))) : 0,
    ampMinOhm: c.zAmp ? Math.min(...c.zAmp) : null,
    hottestPartW: passiveOk && stress.length ? Math.max(...stress.map((e) => e.powerW)) : null,
    error: c.passiveError,
    warnings: c.warnings.length,
  };
}

export interface Variant {
  key: string;
  spec: VariantSpec;
  label: string;
  state: XoState;
  c: Computed;
  m: XoMetrics;
}

/** One variant computed against `base`. */
export function computeVariant(base: XoState, spec: VariantSpec): Variant {
  const state = variantState(base, spec);
  const c = computeCrossover(state);
  return { key: specKey(spec), spec, label: variantLabel(spec), state, c, m: metricsOf(c, xoverUsed(state)) };
}

/** The usual comparisons as lists of specs: every order in the current mode and alignment, every alignment at the current order, the other mode. */
export function presetSpecs(base: XoState, kind: 'orders' | 'alignments' | 'modes'): VariantSpec[] {
  const cur = specOf(base);
  const list: VariantSpec[] =
    kind === 'orders'
      ? validOrders(cur.mode, cur.alignment)
          .filter((o) => o <= 4)
          .map((order) => ({ ...cur, order }))
      : kind === 'alignments'
        ? P.ALIGNMENTS.map((alignment) => ({ ...cur, alignment })).filter((v) => variantProblem(v) === null)
        : [{ ...cur, mode: cur.mode === 'active' ? ('passive' as const) : ('active' as const) }].filter((v) => variantProblem(v) === null);
  return list.filter((v) => specKey(v) !== specKey(cur));
}
