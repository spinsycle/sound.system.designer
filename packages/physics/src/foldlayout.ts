// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// A horn folded into stacked legs inside a rectangular box (spec: "Folded horn", app only, v0.14; tapered legs v0.15). A layout problem: the
// physics sees the horn only as the area-versus-centreline profile, which this returns as joints. Metres.
import { type Flare, type Joint, flareArea, flareLength } from './hornsim';

/** Fixed passes for the leg heights and turn lengths (the same convention as the box solver's passes). */
export const FOLD_PASSES = 8;
/** A leg is never shorter than this share of an equal split of the horn: when the turns alone are longer than the horn the fold is not feasible. */
export const MIN_LEG_SHARE = 0.05;

/**
 * 'stepped': every leg has one height (the flare's at its middle) and the septa are horizontal. 'tapered' (the scoop): a leg's
 * height is the flare's at each end, so the area grows linearly through it and the septa are sloped plates.
 */
export type FoldStyle = 'stepped' | 'tapered';

export interface FoldLayout {
  style: FoldStyle;
  /** Channel height of each leg at the front wall and at the back wall, m (both the leg's height when stepped). */
  heightsFront: number[];
  heightsBack: number[];
  /** Septum k's top face: distance down from the inside top at the front wall and at the back wall, m (equal when stepped). */
  septaFrontTop: number[];
  septaBackTop: number[];
  /** Length of septum k along its slope (its length front to back when stepped), m, and its angle: positive slopes down towards the back, rad. */
  septaSlant: number[];
  septaAngle: number[];
  /** Centreline length of the whole horn (the flare's), m. */
  length: number;
  /** Centreline length of each leg, m. */
  leg: number;
  /**
   * False when the turns alone are longer than the horn (the legs would be as tall as the flare is wide): the layout is then a
   * finite stand-in, with legs held to a minimum length, and the path runs past the end of the flare.
   */
  feasible: boolean;
  /** Start and end of each leg along the centreline, m. */
  starts: number[];
  ends: number[];
  /** Channel height of each leg, m. */
  heights: number[];
  /** Turn gaps between neighbouring legs (the larger of their heights), m. */
  gaps: number[];
  /** Smallest inside depth the legs and their turns need, m. */
  minDepthI: number;
  wI: number;
  hI: number;
  /** Inside depth used: the one asked for, or the minimum when that is more. */
  dI: number;
  wO: number;
  hO: number;
  dO: number;
  /** Septum k separates legs k and k+1: its length front to back, and its top face's distance down from the inside top, m. */
  septaLength: number[];
  septaTop: number[];
  /** Septum k is fixed to the front wall when k is even, to the back wall when odd (the gap is at the other end). */
  septaAnchor: ('front' | 'back')[];
  /** The mouth is on the front face when the leg count is even. */
  mouthAtFront: boolean;
  /** The horn as simulated: constant area through each leg, conical through each turn. */
  joints: Joint[];
}

/**
 * Fold the flare into `legs` legs (2 and up) of a box `widthM` wide inside, wall `t`, outside depth `depthOutM`, stepped (the
 * default) or tapered. The first leg starts at the front.
 */
export function foldHorn(fl: Flare, widthM: number, legs: number, depthOutM: number, t: number, style: FoldStyle = 'stepped'): FoldLayout {
  return style === 'tapered' ? foldTapered(fl, widthM, legs, depthOutM, t) : foldStepped(fl, widthM, legs, depthOutM, t);
}

/**
 * Stepped fold: leg k has the flare's height (area / width) at its middle; a turn adds (h_k + h_(k+1) + t) / 2 of path; the leg
 * length follows from the total. Septum k is `dI - gap_k` long.
 */
function foldStepped(fl: Flare, widthM: number, legs: number, depthOutM: number, t: number): FoldLayout {
  const length = flareLength(fl);
  let heights = Array.from({ length: legs }, (_, k) => flareArea(fl, (length * (k + 0.5)) / legs) / widthM);
  let leg = length / legs;
  let feasible = true;
  const minLeg = (MIN_LEG_SHARE * length) / legs;
  let starts: number[] = [];
  let ends: number[] = [];
  for (let pass = 0; pass < FOLD_PASSES; ++pass) {
    const turns = Array.from({ length: legs - 1 }, (_, k) => (heights[k]! + heights[k + 1]! + t) / 2);
    const raw = (length - turns.reduce((a, b) => a + b, 0)) / legs;
    feasible = raw >= minLeg;
    leg = Math.max(raw, minLeg);
    starts = [];
    ends = [];
    let x = 0;
    for (let k = 0; k < legs; ++k) {
      starts.push(x);
      ends.push(x + leg);
      x += leg + (k < legs - 1 ? turns[k]! : 0);
    }
    heights = starts.map((s, k) => flareArea(fl, Math.min(Math.max((s + ends[k]!) / 2, 0), length)) / widthM);
  }
  const gaps = Array.from({ length: legs - 1 }, (_, k) => Math.max(heights[k]!, heights[k + 1]!));
  let minDepthI = 0;
  for (let k = 0; k < legs; ++k) minDepthI = Math.max(minDepthI, leg + (k > 0 ? gaps[k - 1]! : 0) + (k < legs - 1 ? gaps[k]! : 0));
  const dI = Math.max(depthOutM - 2 * t, minDepthI);
  const hI = heights.reduce((a, b) => a + b, 0) + (legs - 1) * t;
  const joints: Joint[] = [];
  for (let k = 0; k < legs; ++k) {
    const a = widthM * heights[k]!;
    joints.push({ x: starts[k]!, area: a }, { x: ends[k]!, area: a });
  }
  const septaTop = gaps.map((_, k) => heights.slice(0, k + 1).reduce((a, b) => a + b, 0) + k * t);
  const septaLength = gaps.map((g) => dI - g);
  return {
    style: 'stepped',
    heightsFront: heights,
    heightsBack: heights,
    septaFrontTop: septaTop,
    septaBackTop: septaTop,
    septaSlant: septaLength,
    septaAngle: gaps.map(() => 0),
    length,
    leg,
    feasible,
    starts,
    ends,
    heights,
    gaps,
    minDepthI,
    wI: widthM,
    hI,
    dI,
    wO: widthM + 2 * t,
    hO: hI + 2 * t,
    dO: dI + 2 * t,
    septaLength,
    septaTop,
    septaAnchor: gaps.map((_, k) => (k % 2 === 0 ? 'front' : 'back')),
    mouthAtFront: legs % 2 === 0,
    joints,
  };
}

/**
 * Tapered fold: leg k's height is the flare's at its start and at its end (a conical channel), turns add (b_k + a_(k+1) + t) / 2
 * of path. Legs run front to back when k is even. The septa are sloped plates joining the heights at the two walls; the floor is
 * flat, so the last leg takes the height the floor leaves it at each wall (never less than the flare's).
 */
function foldTapered(fl: Flare, widthM: number, legs: number, depthOutM: number, t: number): FoldLayout {
  const length = flareLength(fl);
  const minLeg = (MIN_LEG_SHARE * length) / legs;
  const at = (x: number): number => flareArea(fl, Math.min(Math.max(x, 0), length)) / widthM;
  let a = Array.from({ length: legs }, (_, k) => at((length * k) / legs));
  let b = Array.from({ length: legs }, (_, k) => at((length * (k + 1)) / legs));
  let leg = length / legs;
  let feasible = true;
  let starts: number[] = [];
  let ends: number[] = [];
  for (let pass = 0; pass < FOLD_PASSES; ++pass) {
    const turns = Array.from({ length: legs - 1 }, (_, k) => (b[k]! + a[k + 1]! + t) / 2);
    const raw = (length - turns.reduce((x, y) => x + y, 0)) / legs;
    feasible = raw >= minLeg;
    leg = Math.max(raw, minLeg);
    starts = [];
    ends = [];
    let x = 0;
    for (let k = 0; k < legs; ++k) {
      starts.push(x);
      ends.push(x + leg);
      x += leg + (k < legs - 1 ? turns[k]! : 0);
    }
    a = starts.map(at);
    b = ends.map(at);
  }
  const hf = a.map((v, k) => (k % 2 === 0 ? v : b[k]!));
  const hb = a.map((v, k) => (k % 2 === 0 ? b[k]! : v));
  const gaps = Array.from({ length: legs - 1 }, (_, k) => Math.max(b[k]!, a[k + 1]!));
  let minDepthI = 0;
  for (let k = 0; k < legs; ++k) minDepthI = Math.max(minDepthI, leg + (k > 0 ? gaps[k - 1]! : 0) + (k < legs - 1 ? gaps[k]! : 0));
  const dI = Math.max(depthOutM - 2 * t, minDepthI);
  const sum = (xs: number[], n: number): number => xs.slice(0, n).reduce((p, q) => p + q, 0);
  const hI = Math.max(sum(hf, legs) + (legs - 1) * t, sum(hb, legs) + (legs - 1) * t);
  const topF = Array.from({ length: legs - 1 }, (_, k) => sum(hf, k + 1) + k * t);
  const topB = Array.from({ length: legs - 1 }, (_, k) => sum(hb, k + 1) + k * t);
  const heightsFront = [...hf.slice(0, legs - 1), hI - (topF[legs - 2]! + t)];
  const heightsBack = [...hb.slice(0, legs - 1), hI - (topB[legs - 2]! + t)];
  const septaLength = gaps.map((g) => dI - g);
  const slope = topF.map((f, k) => (topB[k]! - f) / dI);
  const joints: Joint[] = [];
  for (let k = 0; k < legs; ++k) {
    const first = k % 2 === 0 ? heightsFront[k]! : heightsBack[k]!;
    const last = k % 2 === 0 ? heightsBack[k]! : heightsFront[k]!;
    joints.push({ x: starts[k]!, area: widthM * first }, { x: ends[k]!, area: widthM * last });
  }
  return {
    style: 'tapered',
    heightsFront,
    heightsBack,
    septaFrontTop: topF,
    septaBackTop: topB,
    septaSlant: septaLength.map((l, k) => l * Math.sqrt(1 + slope[k]! ** 2)),
    septaAngle: slope.map(Math.atan),
    length,
    leg,
    feasible,
    starts,
    ends,
    heights: heightsFront.map((f, k) => (f + heightsBack[k]!) / 2),
    gaps,
    minDepthI,
    wI: widthM,
    hI,
    dI,
    wO: widthM + 2 * t,
    hO: hI + 2 * t,
    dO: dI + 2 * t,
    septaLength,
    septaTop: topF,
    septaAnchor: gaps.map((_, k) => (k % 2 === 0 ? 'front' : 'back')),
    mouthAtFront: legs % 2 === 0,
    joints,
  };
}

/** The widest and deepest box a recommendation may use, m. */
export const FOLD_MAX_WIDTH_M = 3;
export const FOLD_MAX_DEPTH_M = 10;
/** A recommendation prefers a box no deeper than this (widening first); deeper boxes are the fallback, m. */
export const FOLD_PRACTICAL_DEPTH_M = 2;
/** Each wider candidate is this much wider than the last. */
export const FOLD_WIDTH_STEP = 1.25;

export interface FoldSuggestion {
  legs: number;
  widthM: number;
  /** Outside depth that holds the folds with no slack, rounded up to the centimetre, m. */
  depthOutM: number;
}

/**
 * Settings that make the fold work: an even leg count (2, 4, 6 or 8), feasible, with the mouth on the front, the narrowest width
 * (the given one first, then wider in steps up to FOLD_MAX_WIDTH_M) that has a box up to FOLD_PRACTICAL_DEPTH_M deep, and among its
 * leg counts the smallest outside volume; if none is that shallow, the same search up to FOLD_MAX_DEPTH_M. Null when nothing folds.
 */
export function suggestFold(fl: Flare, widthM: number, t: number, style: FoldStyle = 'stepped'): FoldSuggestion | null {
  return suggestUnder(fl, widthM, t, FOLD_PRACTICAL_DEPTH_M, style) ?? suggestUnder(fl, widthM, t, FOLD_MAX_DEPTH_M, style);
}

function suggestUnder(fl: Flare, widthM: number, t: number, maxDepthM: number, style: FoldStyle): FoldSuggestion | null {
  // the given width, then 25 % wider each step up to the limit
  const widths = [widthM];
  while (widths[widths.length - 1]! < FOLD_MAX_WIDTH_M - 1e-12) widths.push(Math.min(widths[widths.length - 1]! * FOLD_WIDTH_STEP, FOLD_MAX_WIDTH_M));
  for (const w of widths) {
    let best: { legs: number; dO: number; volume: number } | null = null;
    for (const legs of [2, 4, 6, 8]) {
      const f = foldHorn(fl, w, legs, 0, t, style);
      if (!f.feasible || f.dO > maxDepthM) continue; // an even leg count always has its mouth on the front
      const volume = f.wO * f.hO * f.dO;
      if (best === null || volume < best.volume) best = { legs, dO: f.dO, volume };
    }
    if (best) return { legs: best.legs, widthM: w, depthOutM: Math.ceil(best.dO * 100 - 1e-9) / 100 };
  }
  return null;
}

/**
 * The largest mouth area (m2, up to the flare's own) at which suggestFold finds a box, at the given width; null when even the
 * smallest mouth does not fold. The flare's other settings are kept.
 */
export function maxFoldableMouthM2(fl: Flare, widthM: number, t: number, style: FoldStyle = 'stepped'): number | null {
  let lo = fl.throatM2 * 1.05;
  let hi = fl.mouthM2;
  if (suggestFold({ ...fl, mouthM2: hi }, widthM, t, style)) return hi;
  if (!suggestFold({ ...fl, mouthM2: lo }, widthM, t, style)) return null;
  for (let i = 0; i < 40; ++i) {
    const mid = (lo + hi) / 2;
    if (suggestFold({ ...fl, mouthM2: mid }, widthM, t, style)) lo = mid;
    else hi = mid;
  }
  return lo;
}
