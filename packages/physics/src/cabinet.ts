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
  /** Frame braces across the interior, counted from the depth as in a rectangular box, spread evenly from the front to the back. */
  braces: number;
  /** Each brace's distance behind the inside of the front, and its interior width (a tower's braces are all the bottom width: they are trapezoids). */
  braceAt: number[];
  braceWidths: number[];
  /** Wood in the braces, m3 (a window of the narrow end's width less two bars, by the height less two bars, is cut out of each). */
  braceM3: number;
  /** Air left after what is inside (drivers, ports, braces) is taken out. */
  netM3: number;
}

/**
 * A box whose width narrows linearly, either front to back (plan) or bottom to top (height): a trapezoidal prism. Interior proportions are
 * wide-end width : height : depth, taper is narrow over wide. The interior volume is (wide + narrow) / 2 x height x depth, so the
 * air of the design is held exactly; disp and the wood of any braces are taken out of it. Walls are t thick, butt joints. Frame braces
 * (`brace`, as for a rectangular box) cross the interior, evenly spaced from the front to the back; the box is sized with eight passes
 * because the braces depend on the size.
 */
export function solveTaper(vNet: number, disp: number, rw: number, rh: number, rd: number, taper: number, axis: TaperAxis, t: number, brace: Brace = 'none'): TaperGeometry {
  let braceM3 = 0;
  let braces = 0;
  let wideI = 0;
  let narrowI = 0;
  let hI = 0;
  let dI = 0;
  let braceAt: number[] = [];
  let braceWidths: number[] = [];
  for (let pass = 0; pass < 8; pass++) {
    const s = ((vNet + disp + braceM3) / ((rw * rh * rd * (1 + taper)) / 2)) ** (1 / 3);
    wideI = s * rw;
    narrowI = taper * wideI;
    hI = s * rh;
    dI = s * rd;
    braces = braceCount(brace, dI);
    braceAt = Array.from({ length: braces }, (_, k) => (dI * (k + 1)) / (braces + 1));
    // a plan trapezoid's brace is as wide as the interior where it sits; a tower's is the whole trapezoid
    braceWidths = braceAt.map((z) => (axis === 'plan' ? wideI - ((wideI - narrowI) * z) / dI : wideI));
    braceM3 = braceWidths.reduce((a, w) => a + (axis === 'plan' ? braceVolume(w, hI, t) : trapezoidBraceVolume(wideI, narrowI, hI, t)), 0);
  }
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
    braces,
    braceAt,
    braceWidths,
    braceM3,
    netM3: ((wideI + narrowI) / 2) * hI * dI - disp - braceM3,
  };
}

/** One frame brace across a tower's trapezoid interior: its area less a window (the narrow end's width and the height, each less two bars), by t; solid when the bars would meet. */
function trapezoidBraceVolume(wide: number, narrow: number, h: number, t: number): number {
  const outer = ((wide + narrow) / 2) * h;
  if (narrow <= 2 * BRACE_BAR || h <= 2 * BRACE_BAR) return outer * t;
  return (outer - (narrow - 2 * BRACE_BAR) * (h - 2 * BRACE_BAR)) * t;
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
 * listed by its bounding rectangle with its outline in poly; a side is cut to its slant length with its ends bevelled. Braces follow the walls:
 * one frame for each brace of a plan trapezoid (each as wide as the interior where it sits), or a trapezoid frame repeated for a tower.
 */
export function taperPanels(g: TaperGeometry): Panel[] {
  const panels = taperWalls(g);
  if (g.braces > 0) {
    if (g.axis === 'plan') g.braceWidths.forEach((w, k) => panels.push({ name: `Brace frame ${k + 1} of ${g.braces}`, l: w, w: g.hI, qty: 1 }));
    else panels.push({ name: 'Brace frame (trapezoid)', l: g.wideI, w: g.hI, qty: g.braces, poly: trapezoid(g.wideI, g.narrowI, g.hI) });
  }
  return panels;
}

function taperWalls(g: TaperGeometry): Panel[] {
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
  /** The true outline on the sheet, m (packNested only, for a piece that is not a rectangle); x, y, w, h are its bounding box. */
  poly?: [number, number][];
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

export interface NestPiece {
  l: number;
  w: number;
  /** The true outline in the piece's own axes (see Panel.poly). */
  poly?: [number, number][];
}

/** Area of a polygon, m2. */
export const polyArea = (poly: readonly (readonly [number, number])[]): number =>
  Math.abs(poly.reduce((a, [x, y], i) => a + (x * poly[(i + 1) % poly.length]![1] - poly[(i + 1) % poly.length]![0] * y), 0)) / 2;

/** The parts of an isosceles trapezoid (wide edge along y = 0, narrow along y = h) from its outline; null for anything else, or a rectangle. */
function trapezoidOf(poly: readonly (readonly [number, number])[]): { a: number; b: number; h: number } | null {
  if (poly.length !== 4) return null;
  const [p0, p1, p2, p3] = poly as [number, number][];
  const a = p1![0] - p0![0];
  const b = p2![0] - p3![0];
  const h = p2![1];
  const ok = p0![1] === 0 && p1![1] === 0 && p3![1] === h && a > b && b > 0 && h > 0 && Math.abs(p3![0] - (a - b) / 2) < 1e-9 * Math.max(a, 1);
  return ok ? { a, b, h } : null;
}

/**
 * packSheets for pieces with outlines. Two identical isosceles trapezoids lie head to tail, one turned half a turn, their slanted edges
 * a kerf apart, as one unit (a parallelogram ending in two triangles of waste) shorter than two bounding rectangles by (wide - narrow) / 2;
 * the units are packed as rectangles by packSheets. A trapezoid left over, and anything else, is a piece of its own. A piece with an
 * outline comes back with `poly` in sheet coordinates.
 */
export function packNested(pieces: readonly NestPiece[], sheetL: number, sheetW: number, kerf: number): { sheets: number; placements: Placement[] } {
  type Unit = { members: { i: number; poly?: [number, number][] }[]; bw: number; bh: number };
  const units: Unit[] = [];
  const open = new Map<string, number[]>();
  pieces.forEach((pc, i) => {
    const t = pc.poly ? trapezoidOf(pc.poly) : null;
    if (!t) {
      units.push({ members: [{ i, ...(pc.poly ? { poly: pc.poly } : {}) }], bw: pc.poly ? Math.max(...pc.poly.map((q) => q[0])) : pc.l, bh: pc.poly ? Math.max(...pc.poly.map((q) => q[1])) : pc.w });
      return;
    }
    const key = [t.a, t.b, t.h].join('/');
    const wait = open.get(key);
    if (wait && wait.length > 0) {
      const first = wait.pop()!;
      const shift = (t.a + t.b) / 2 + (kerf * Math.hypot((t.a - t.b) / 2, t.h)) / t.h;
      // turned half a turn; an isosceles trapezoid turned that way is the same shape as one flipped top to bottom
      const flipped = pc.poly!.map(([x, y]): [number, number] => [shift + x, t.h - y]);
      const bw = shift + t.a;
      if (Math.max(bw, t.h) <= sheetL && Math.min(bw, t.h) <= sheetW) units.push({ members: [{ i: first, poly: pieces[first]!.poly! }, { i, poly: flipped }], bw, bh: t.h });
      else {
        // the pair is bigger than a sheet: each lies alone
        units.push({ members: [{ i: first, poly: pieces[first]!.poly! }], bw: t.a, bh: t.h }, { members: [{ i, poly: pc.poly! }], bw: t.a, bh: t.h });
      }
    } else {
      open.set(key, [...(wait ?? []), i]);
      return;
    }
  });
  // a trapezoid with no partner stands alone
  for (const [, left] of open) for (const i of left) units.push({ members: [{ i, poly: pieces[i]!.poly! }], bw: Math.max(...pieces[i]!.poly!.map((q) => q[0])), bh: pieces[i]!.poly![2]![1] });
  const packed = packSheets(units.map((u) => ({ l: u.bw, w: u.bh })), sheetL, sheetW, kerf);
  const out: Placement[] = new Array(pieces.length);
  units.forEach((u, k) => {
    const at = packed.placements[k]!;
    const turned = u.bw < u.bh; // packSheets lays the long side along the sheet
    for (const m of u.members) {
      if (at.sheet < 0 || !m.poly) {
        out[m.i] = { sheet: at.sheet, x: at.x, y: at.y, w: at.w, h: at.h };
        continue;
      }
      const poly = m.poly.map(([x, y]): [number, number] => (turned ? [at.x + y, at.y + x] : [at.x + x, at.y + y]));
      const xs = poly.map((q) => q[0]);
      const ys = poly.map((q) => q[1]);
      out[m.i] = { sheet: at.sheet, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), poly };
    }
  });
  return { sheets: packed.sheets, placements: out };
}
