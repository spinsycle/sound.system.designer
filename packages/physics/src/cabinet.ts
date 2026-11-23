// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Cabinet, cut list and sheets (spec: "Cabinet, cut list and sheets"). Rectangular boxes with butt joints; metres.

/** Driver displacement is K Sd^1.5 (m3): an estimate for magnet, frame and cone. */
export const DRIVER_DISP_K = 0.15;
/** Round port tube wall (m). */
export const TUBE_WALL = 0.003;
/** Width of a window brace's bars (m). */
export const BRACE_BAR = 0.05;
/** Window braces: one per this much interior depth, between the walls (m). */
export const BRACE_SPACING = 0.4;

export type Brace = 'none' | 'single' | 'window';

export const driverDisplacement = (sd: number): number => DRIVER_DISP_K * sd ** 1.5;

/** Share of a driver's displacement left inside the box when the motor sticks out through the baffle (spec v0.13). */
export const MAGNET_OUT_KEEP = 0.4;

/** Driver displacement for a mounting: magnet inside the box (the default) or outside (cone, surround and frame stay in). */
export const driverDisplacementMount = (sd: number, magnetOut: boolean): number => driverDisplacement(sd) * (magnetOut ? MAGNET_OUT_KEEP : 1);

/** Outer volume of a rectangular port built from sheet of thickness `wall`, inside w x h, length (m, m3). */
export const rectPortDisplacement = (w: number, h: number, length: number, wall: number): number => (w + 2 * wall) * (h + 2 * wall) * length;

/** Outer volume of a round port tube of inside diameter and length (m, m3). */
export const portDisplacement = (diameter: number, length: number): number => Math.PI * ((diameter + 2 * TUBE_WALL) / 2) ** 2 * length;

export function braceCount(kind: Brace, depth: number): number {
  if (kind === 'single') return depth >= 0.2 ? 1 : 0;
  if (kind === 'window') return Math.max(0, Math.ceil(depth / BRACE_SPACING - 1e-12) - 1);
  return 0;
}

/** One frame brace across an interior w x h: bars BRACE_BAR wide, thickness t (solid when the bars would meet). */
export function braceVolume(w: number, h: number, t: number): number {
  if (w <= 2 * BRACE_BAR || h <= 2 * BRACE_BAR) return w * h * t;
  return (w * h - (w - 2 * BRACE_BAR) * (h - 2 * BRACE_BAR)) * t;
}

export interface BoxGeometry {
  wI: number;
  hI: number;
  dI: number;
  wO: number;
  hO: number;
  dO: number;
  braces: number;
  /** Air left after everything inside the box is taken out. */
  netM3: number;
}

/**
 * Interior dimensions of a rectangular box holding `vNet` m3 of air after `disp` m3 of fixed displacement, braces and
 * (band-pass) a divider panel. Interior proportions rw:rh:rd. Eight fixed-point passes, because braces depend on the size.
 */
export function solveBox(vNet: number, disp: number, rw: number, rh: number, rd: number, t: number, brace: Brace, divider: boolean | number): BoxGeometry {
  const nDiv = typeof divider === 'number' ? divider : divider ? 1 : 0;
  let braces = 0;
  let n = 0;
  let w = 0;
  let h = 0;
  let d = 0;
  for (let pass = 0; pass < 8; pass++) {
    const s = ((vNet + disp + braces) / (rw * rh * rd)) ** (1 / 3);
    w = s * rw;
    h = s * rh;
    d = s * rd;
    n = braceCount(brace, d);
    braces = n * braceVolume(w, h, t) + nDiv * w * h * t;
  }
  return { wI: w, hI: h, dI: d, wO: w + 2 * t, hO: h + 2 * t, dO: d + 2 * t, braces: n, netM3: w * h * d - disp - braces };
}

export interface Panel {
  name: string;
  /** Length and width, m. Braces and the divider are listed by their bounding rectangle. */
  l: number;
  w: number;
  qty: number;
  /** The true outline of a panel that is not a rectangle, m, in the panel's own flat axes (x along l, y along w, origin at the corner of its bounding box). */
  poly?: [number, number][];
  /** Angle the cut edges named in `bevelEdges` are bevelled to, degrees from square. */
  bevelDeg?: number;
  /** Which edges the bevel is on, in words for the cut list. */
  bevelEdges?: string;
}

/** Cut list of the box: front and back full size, top and bottom full width between them, sides between top and bottom. */
export function boxPanels(g: BoxGeometry, t: number, divider: boolean | number): Panel[] {
  const nDiv = typeof divider === 'number' ? divider : divider ? 1 : 0;
  const p: Panel[] = [
    { name: 'Front baffle', l: g.wO, w: g.hO, qty: 1 },
    { name: 'Back', l: g.wO, w: g.hO, qty: 1 },
    { name: 'Top and bottom', l: g.wO, w: g.dO - 2 * t, qty: 2 },
    { name: 'Sides', l: g.hO - 2 * t, w: g.dO - 2 * t, qty: 2 },
  ];
  if (g.braces > 0) p.push({ name: 'Brace frame', l: g.wI, w: g.hI, qty: g.braces });
  if (nDiv > 0) p.push({ name: 'Divider', l: g.wI, w: g.hI, qty: nDiv });
  return p;
}

export interface WedgeGeometry {
  wI: number;
  hI: number;
  /** Interior depth along the bottom and along the top. */
  dBottomI: number;
  dTopI: number;
  wO: number;
  hO: number;
  /** Length of the sloping baffle, outside (from the bottom panel's outer corner to the top panel's). */
  slantO: number;
  /** Air left after everything inside is taken out. */
  netM3: number;
}

/**
 * A wedge enclosure for a trunk or truck corner: vertical back and sides, flat top and bottom, and a baffle sloping from the
 * front of the bottom up to the front of the top. Interior proportions width : height : bottom depth, `taper` = top depth /
 * bottom depth in (0, 1] (1 is a plain box). Interior volume w h (dBottom + dTop) / 2; `disp` is taken out of it.
 */
export function solveWedge(vNet: number, disp: number, rw: number, rh: number, rd: number, taper: number, t: number): WedgeGeometry {
  const s = ((vNet + disp) / ((rw * rh * rd * (1 + taper)) / 2)) ** (1 / 3);
  const wI = s * rw;
  const hI = s * rh;
  const dBottomI = s * rd;
  const dTopI = taper * dBottomI;
  const wO = wI + 2 * t;
  const hO = hI + 2 * t;
  return { wI, hI, dBottomI, dTopI, wO, hO, slantO: Math.hypot(hO, dBottomI - dTopI), netM3: (wI * hI * (dBottomI + dTopI)) / 2 - disp };
}

/** Back, sloping baffle (outside size), bottom, top (between the baffle and the back) and the trapezoid sides (bounding box). */
export function wedgePanels(g: WedgeGeometry): Panel[] {
  return [
    { name: 'Back', l: g.wO, w: g.hO, qty: 1 },
    { name: 'Front baffle', l: g.wO, w: g.slantO, qty: 1 },
    { name: 'Bottom', l: g.wO, w: g.dBottomI, qty: 1 },
    { name: 'Top', l: g.wO, w: g.dTopI, qty: 1 },
    { name: 'Sides', l: g.hI, w: g.dBottomI, qty: 2 },
  ];
}

/** Which way a tapered box narrows: 'plan' (the side walls angle in, front wide and back narrow) or 'height' (a tower: wide at the bottom, narrow at the top). */
export type TaperAxis = 'plan' | 'height';

export interface TaperGeometry {
  axis: TaperAxis;
  /** Narrow end over wide end of the interior width, in (0, 1]. */
  taper: number;
  /** Interior widths at the wide and the narrow end, height and depth. */
  wideI: number;
  narrowI: number;
  hI: number;
  dI: number;
  /** The same outside: each width plus two walls, height and depth likewise. */
  wideO: number;
  narrowO: number;
  hO: number;
  dO: number;
  /** How far each side wall leans in, over the whole depth (plan) or height (tower): half the difference of the interior widths. */
  insetI: number;
  /** Interior length of a side wall along its slant. */
  slantI: number;
  /** The lean of a side wall from straight, degrees: the bevel its edges are cut to. */
  angleDeg: number;
  /** Air left after what is inside is taken out. */
  netM3: number;
}

/**
 * A box whose width narrows linearly, either front to back (plan) or bottom to top (height): a trapezoidal prism. Interior proportions are
 * wide-end width : height : depth, taper is narrow over wide. The interior volume is (wide + narrow) / 2 x height x depth, so the
 * air of the design is held exactly; disp is taken out of it. Walls are t thick, butt joints; no bracing.
 */
export function solveTaper(vNet: number, disp: number, rw: number, rh: number, rd: number, taper: number, axis: TaperAxis, t: number): TaperGeometry {
  const s = ((vNet + disp) / ((rw * rh * rd * (1 + taper)) / 2)) ** (1 / 3);
  const wideI = s * rw;
  const narrowI = taper * wideI;
  const hI = s * rh;
  const dI = s * rd;
  const insetI = (wideI - narrowI) / 2;
  const along = axis === 'plan' ? dI : hI;
  return {
    axis,
    taper,
    wideI,
    narrowI,
    hI,
    dI,
    wideO: wideI + 2 * t,
    narrowO: narrowI + 2 * t,
    hO: hI + 2 * t,
    dO: dI + 2 * t,
    insetI,
    slantI: Math.hypot(along, insetI),
    angleDeg: (Math.atan2(insetI, along) * 180) / Math.PI,
    netM3: ((wideI + narrowI) / 2) * hI * dI - disp,
  };
}

/** The trapezoid with parallel edges wide (along y = 0) and narrow (along y = h), centred: corners in order round the outline. */
const trapezoid = (wide: number, narrow: number, h: number): [number, number][] => [
  [0, 0],
  [wide, 0],
  [(wide + narrow) / 2, h],
  [(wide - narrow) / 2, h],
];

/**
 * Cut list of a tapered box. Plan: a front baffle at the wide end and a back at the narrow end (both rectangles), trapezoid top and
 * bottom, and two angled sides. Tower: trapezoid front and back, a wide bottom and a narrow top, and two leaning sides. A trapezoid is
 * listed by its bounding rectangle with its outline in poly; a side is cut to its slant length with its ends bevelled.
 */
export function taperPanels(g: TaperGeometry): Panel[] {
  const bevel = { bevelDeg: g.angleDeg, bevelEdges: g.axis === 'plan' ? 'the two edges that meet the front and the back' : 'the two edges that meet the top and the bottom' };
  if (g.axis === 'plan') {
    return [
      { name: 'Front baffle (wide end)', l: g.wideO, w: g.hO, qty: 1 },
      { name: 'Back (narrow end)', l: g.narrowO, w: g.hO, qty: 1 },
      { name: 'Top and bottom (trapezoid)', l: g.wideO, w: g.dI, qty: 2, poly: trapezoid(g.wideO, g.narrowO, g.dI) },
      { name: 'Sides (angled)', l: g.slantI, w: g.hI, qty: 2, ...bevel },
    ];
  }
  return [
    { name: 'Front baffle (trapezoid)', l: g.wideO, w: g.hO, qty: 1, poly: trapezoid(g.wideO, g.narrowO, g.hO) },
    { name: 'Back (trapezoid)', l: g.wideO, w: g.hO, qty: 1, poly: trapezoid(g.wideO, g.narrowO, g.hO) },
    { name: 'Bottom (wide end)', l: g.wideO, w: g.dI, qty: 1 },
    { name: 'Top (narrow end)', l: g.narrowO, w: g.dI, qty: 1 },
    { name: 'Sides (leaning)', l: g.slantI, w: g.dI, qty: 2, ...bevel },
  ];
}

export interface HornSection {
  /** Top and bottom: slant length x the horn width. */
  slant: number;
  width: number;
  /** Each of the two trapezoid sides, by bounding box. */
  sideLen: number;
  sideH: number;
  /** Inside heights at the throat end and the mouth end. */
  h1: number;
  h2: number;
}

/** Straight horn sections between stations (distance along the axis, inside height), the horn `width` wide inside. */
export function hornPanels(stations: readonly { x: number; h: number }[], width: number, t: number): HornSection[] {
  const out: HornSection[] = [];
  for (let k = 0; k < stations.length - 1; k++) {
    const a = stations[k]!;
    const b = stations[k + 1]!;
    const len = b.x - a.x;
    out.push({ slant: Math.hypot(len, (b.h - a.h) / 2), width, sideLen: len, sideH: Math.max(a.h, b.h) + 2 * t, h1: a.h, h2: b.h });
  }
  return out;
}

export interface Placement {
  /** Sheet index, or -1 when the piece is longer or wider than a sheet. */
  sheet: number;
  x: number;
  y: number;
  /** Size as placed: long side along the sheet length. */
  w: number;
  h: number;
}

/**
 * First-fit-decreasing shelf packing of rectangles (l, w) onto sheets of sheetL x sheetW with a saw kerf between pieces.
 * Each piece lies long side along the sheet length; sorted by shelf height (short side) then length, both descending,
 * ties in input order. A heuristic: not an optimal nesting.
 */
export function packSheets(pieces: readonly { l: number; w: number }[], sheetL: number, sheetW: number, kerf: number): { sheets: number; placements: Placement[] } {
  const items = pieces.map((p, i) => ({ i, x: Math.max(p.l, p.w), y: Math.min(p.l, p.w) }));
  const order = [...items].sort((a, b) => b.y - a.y || b.x - a.x || a.i - b.i);
  const sheets: { y0: number; h: number; used: number }[][] = [];
  const out: Placement[] = new Array(pieces.length);
  const EPS = 1e-12;
  for (const it of order) {
    if (!(it.x <= sheetL && it.y <= sheetW)) {
      out[it.i] = { sheet: -1, x: 0, y: 0, w: it.x, h: it.y };
      continue;
    }
    let placed = false;
    for (let s = 0; s < sheets.length && !placed; s++) {
      const shelves = sheets[s]!;
      for (const sh of shelves) {
        if (it.y <= sh.h + EPS && sh.used + it.x <= sheetL + EPS) {
          out[it.i] = { sheet: s, x: sh.used, y: sh.y0, w: it.x, h: it.y };
          sh.used += it.x + kerf;
          placed = true;
          break;
        }
      }
      if (placed) break;
      const last = shelves[shelves.length - 1];
      const top = last ? last.y0 + last.h + kerf : 0;
      if (top + it.y <= sheetW + EPS) {
        shelves.push({ y0: top, h: it.y, used: it.x + kerf });
        out[it.i] = { sheet: s, x: 0, y: top, w: it.x, h: it.y };
        placed = true;
      }
    }
    if (!placed) {
      sheets.push([{ y0: 0, h: it.y, used: it.x + kerf }]);
      out[it.i] = { sheet: sheets.length - 1, x: 0, y: 0, w: it.x, h: it.y };
    }
  }
  return { sheets: sheets.length, placements: out };
}
