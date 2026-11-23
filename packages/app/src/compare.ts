// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Two questions about a box, answered by running the same model over more than one design: "what would this driver do in another kind of
// box" (candidates) and "which drivers suit this box" (a ranking). Pure functions. A candidate is a design; its numbers come from
// compute() and are reduced to a few plain figures (metricsOf); the score is a transparent weighted sum, documented on scoreOf.
import * as P from '@soundsystemdesigner/physics';
import { type DriverEntry, isGeneric, snapshotOf } from './drivers/entry';
import { BOX_RANGES, type BoxKind, type Computed, CUSTOM_CLASS, type Design, compute, driverOf, passband, portDiameterCmFor, sanitize, tlSettingsFor, tqwtSettingsFor } from './model';

/** The box kinds the compare tab offers (a horn is a different design question). */
export const COMPARE_KINDS: readonly BoxKind[] = ['sealed', 'ported', 'passive', 'bandpass', 'bandpass6', 'bandpass8', 'tline', 'tqwt'];
/** 'alignment': each kind sized for this driver the way the Cookbook designs it. 'same-air': the same air, tuning and port as the current box. */
export type CompareMode = 'alignment' | 'same-air';

export interface Candidate {
  kind: BoxKind;
  design: Design;
  /** Why the design is not quite what was asked for (an alignment that cannot be reached), or ''. */
  note: string;
}

const t4 = (v: number): number => Number(v.toPrecision(4));

// The alignment solvers search numerically and take up to a second each, and the compare panel asks again on every change of the box:
// their answers depend only on the driver and a few numbers, so they are kept (a few hundred at most).
const solved = new Map<string, unknown>();
function memo<T>(key: string, f: () => T): T {
  if (solved.has(key)) return solved.get(key) as T;
  const v = f();
  if (solved.size >= 200) solved.clear();
  solved.set(key, v);
  return v;
}
const driverKey = (d: P.DriverSpec): string => [d.fs, d.qes, d.qms, d.vasM3, d.sd, d.re, d.xmax, d.pe, d.le ?? 0].join(',');

/**
 * The design of `kind` for the driver and plot of `base`. In 'alignment' mode a sealed, ported, passive-radiator or band-pass box is sized
 * from the driver (the same solvers the box page's design buttons use); a line or TQWT is sized from the driver as the page does. In
 * 'same-air' mode only the type changes. Never throws: a solver with no answer keeps the base numbers and says so in `note`.
 */
export function candidateFor(base: Design, kind: BoxKind, mode: CompareMode): Candidate {
  const driver = driverOf(base);
  const qts = P.deriveDriver(driver).qts;
  const vasL = driver.vasM3 * 1000;
  const ql = base.qL > 0 ? base.qL : 7;
  const needsQl = kind === 'passive' || kind === 'bandpass' || kind === 'bandpass6' || kind === 'bandpass8' || kind === 'ported';
  let patch: Partial<Design> = { type: kind };
  let note = '';
  if (needsQl && base.qL === 0) patch.qL = 7;
  if (kind === 'tline') patch.tl = tlSettingsFor(driver, base.tl.kind, base.tl.table, base.tl.stuffing);
  if (kind === 'tqwt') patch.tl = tqwtSettingsFor(driver, base.tl.stuffing);
  if (mode === 'alignment') {
    try {
      if (kind === 'sealed') {
        if (qts < 0.707) patch.volumeL = t4(vasL / ((0.707 / qts) ** 2 - 1));
        else note = `Qts ${qts.toFixed(2)} is already above 0.707: no sealed box makes it flat, so the air is unchanged.`;
      } else if (kind === 'ported') {
        const s = memo(`qb3|${qts}|${ql}`, () => P.solveVented(qts, 'QB3', ql));
        const volumeL = t4(vasL / s.alpha);
        const tuneHz = t4(s.h * driver.fs);
        patch = { ...patch, qL: ql, volumeL, tuneHz, portShape: 'round', portDiameterCm: portDiameterCmFor(driver, volumeL, tuneHz) };
      } else if (kind === 'passive') {
        // the box page's Cookbook starting point: air about Vas / alpha, tuned for the lowest f3, a radiator that copies the cone
        const alpha = P.recommendedPassiveAlpha(qts);
        const s = memo(`pr|${qts}|${alpha}|${ql}`, () => P.solvePassiveTuning(qts, alpha, ql));
        if (s) {
          const volumeL = t4(P.clamp(vasL / alpha, BOX_RANGES.volumeL.min, BOX_RANGES.volumeL.max));
          patch = { ...patch, qL: ql, volumeL, tuneHz: t4(P.clamp(s.h * driver.fs, BOX_RANGES.tuneHz.min, BOX_RANGES.tuneHz.max)), pr: { ...base.pr, sdpCm2: 0, vapL: 0, massG: 0 } };
        } else note = `No passive-radiator tuning exists for Qts ${qts.toFixed(2)}; the base numbers are used.`;
      } else if (kind === 'bandpass') {
        const b = P.bandpassDesign(driver, qts, 0.7, Math.max(qts * 2.18, qts * 1.2));
        patch = { ...patch, qL: ql, volumeL: t4(b.vrM3 * 1000), frontVolumeL: t4(b.vfM3 * 1000), tuneHz: t4(b.fbHz) };
      } else if (kind === 'bandpass6') {
        const a = memo(`bp6|${driverKey(driver)}|${base.bp6.loHz}|${base.bp6.hiHz}|${ql}`, () => P.bandpass6Design(driver, base.bp6.loHz, base.bp6.hiHz, ql));
        patch = {
          ...patch,
          qL: ql,
          volumeL: t4(a.rearL),
          frontVolumeL: t4(a.frontL),
          tuneHz: t4(a.frontHz),
          portShape: 'round',
          portDiameterCm: portDiameterCmFor(driver, t4(a.frontL), t4(a.frontHz)),
          bp6: { ...base.bp6, rearTuneHz: t4(a.rearHz), rearPortDiameterCm: portDiameterCmFor(driver, t4(a.rearL), t4(a.rearHz)) },
        };
      } else if (kind === 'bandpass8') {
        const a = memo(`bp8|${driverKey(driver)}|${base.bp6.loHz}|${base.bp6.hiHz}|${ql}|${base.bp8.layout}`, () => P.bandpass8Design(driver, base.bp6.loHz, base.bp6.hiHz, ql, base.bp8.layout));
        patch = {
          ...patch,
          qL: ql,
          volumeL: t4(a.rearL),
          frontVolumeL: t4(a.outerL),
          tuneHz: t4(a.outerHz),
          portShape: 'round',
          portDiameterCm: portDiameterCmFor(driver, t4(a.outerL), t4(a.outerHz)),
          bp6: { ...base.bp6, rearTuneHz: t4(a.rearHz), rearPortDiameterCm: portDiameterCmFor(driver, t4(a.rearL), t4(a.rearHz), 8, base.bp8.layout === 'chain') },
          bp8: { ...base.bp8, innerVolumeL: t4(a.innerL), innerTuneHz: t4(a.innerHz), innerPortDiameterCm: portDiameterCmFor(driver, t4(a.innerL), t4(a.innerHz), 8, true) },
        };
      }
    } catch {
      note = 'The alignment solver found no answer for this driver; the base numbers are used.';
    }
  }
  return { kind, design: sanitize({ ...base, ...patch }), note };
}

export interface CompareMetrics {
  /** Low -3 dB edge of the response (below its peak), Hz, or null when it is below the plot. */
  f3Hz: number | null;
  /** High -3 dB edge, Hz, or null when it is above the plot (a band-pass has one). */
  hiHz: number | null;
  peakDb: number;
  /** The peak above the middle of the passband, dB: how far from flat the response is. */
  rippleDb: number;
  /** Peak cone excursion at the design's chosen power, mm, and against the driver's Xmax. */
  excursionMm: number;
  xmaxMm: number;
  excursionRatio: number;
  groupDelayPeakMs: number;
  impedanceMinOhm: number;
  warnings: number;
  /** The air of the design (the rear chamber for a band-pass), L. */
  volumeL: number;
}

export const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/** The plain figures of one computed design. */
export function metricsOf(c: Computed, d: Design): CompareMetrics {
  const f = c.freqs;
  const db = c.curves.responseDb;
  const pb = passband(f, db);
  const f3Hz = pb.loHz > f[0]! * 1.0001 ? pb.loHz : null;
  const hiHz = pb.hiHz < f[f.length - 1]! * 0.9999 ? pb.hiHz : null;
  // the middle of the passband: from one and a half times the low edge up to the high edge (or four times the low edge when it has none)
  const lo = (f3Hz ?? f[0]!) * 1.5;
  const hi = hiHz ?? lo * 4 / 1.5;
  const mid = db.filter((_, i) => f[i]! >= lo && f[i]! <= hi);
  const rippleDb = pb.peakDb - median(mid.length ? mid : [pb.peakDb]);
  const excursionMm = Math.max(...c.curves.excursionMm);
  const xmaxMm = c.driver.xmax * 1000;
  return {
    f3Hz,
    hiHz,
    peakDb: pb.peakDb,
    rippleDb,
    excursionMm,
    xmaxMm,
    excursionRatio: excursionMm / xmaxMm,
    groupDelayPeakMs: Math.max(...c.curves.groupDelayMs),
    impedanceMinOhm: Math.min(...c.curves.impedanceOhm),
    warnings: c.warnings.length,
    volumeL: d.volumeL,
  };
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export interface Score {
  /** 0 to 100. */
  score: number;
  /** Each part 0 to 1: reaching the target low end, a flat passband, headroom before Xmax. */
  low: number;
  flat: number;
  headroom: number;
}

/**
 * How well a design suits a purpose, 0 to 100: 40 % the low end (full marks at or below the target F3, falling to none at twice it), 30 % a flat
 * passband (full marks up to 1 dB above the middle of the passband, none at 6 dB), 30 % excursion headroom (full marks while the cone stays within
 * Xmax at the chosen power, none at twice Xmax); then 10 points off for each warning, at most 30. A rule of thumb to sort a list, not a verdict.
 */
export function scoreOf(m: CompareMetrics, targetF3Hz: number): Score {
  const low = m.f3Hz === null ? 1 : clamp01(1 - Math.max(0, m.f3Hz - targetF3Hz) / targetF3Hz);
  const flat = clamp01(1 - (m.rippleDb - 1) / 5);
  const headroom = m.excursionRatio <= 1 ? 1 : clamp01(2 - m.excursionRatio);
  const raw = 100 * (0.4 * low + 0.3 * flat + 0.3 * headroom) - Math.min(30, 10 * m.warnings);
  return { score: Math.max(0, Math.round(raw)), low, flat, headroom };
}

/** `base` with another driver, or null when the entry cannot be used (a generic is its class, anything else needs Vas, Sd, Xmax and Pe). */
export function designWithDriver(base: Design, e: DriverEntry): Design | null {
  if (isGeneric(e)) return sanitize({ ...base, driverClass: Number(e.id.slice('generic-'.length)) });
  const s = snapshotOf(e);
  return s ? sanitize({ ...base, driverClass: CUSTOM_CLASS, libDriver: s }) : null;
}

export interface RankRow {
  entry: DriverEntry;
  design: Design;
  metrics: CompareMetrics;
  score: Score;
  responseDb: number[];
}

/** Every usable entry in the box of `base`, best first (ties by name). The base's box, tuning and chosen power are kept. */
export function rankDrivers(base: Design, entries: readonly DriverEntry[], targetF3Hz: number, wallM?: number): RankRow[] {
  const rows: RankRow[] = [];
  for (const entry of entries) {
    const design = designWithDriver(base, entry);
    if (!design) continue;
    const c = compute(design, wallM);
    const metrics = metricsOf(c, design);
    rows.push({ entry, design, metrics, score: scoreOf(metrics, targetF3Hz), responseDb: c.curves.responseDb });
  }
  return rows.sort((a, b) => b.score.score - a.score.score || a.entry.name.localeCompare(b.entry.name));
}
