// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The 3D preview's geometry as plain data (metres; x right, y up, z towards the viewer, baffles face +z), so the scene
// code only draws it and the tests can check it against the cut list.
import type { BuildView, Cabinet } from './buildlist';
import { holePositions } from './buildlist';
import { BRACE_BAR } from '@soundsystemdesigner/physics';
import type { Project } from './system';

/** A hole cut through a plate: centre offset (u across, v up the plate) from the plate's centre, round (radius) or rectangular (w x h), m. */
export interface Hole3 {
  u: number;
  v: number;
  radius: number;
  shape?: 'rect';
  w?: number;
  h?: number;
}

export interface Box3 {
  band: number;
  kind: 'panel' | 'brace' | 'divider';
  /** Width, height, depth. */
  size: [number, number, number];
  center: [number, number, number];
  /** Centre of the cabinet it belongs to, for the exploded view. */
  origin: [number, number, number];
  /** Rotation about the x axis, radians (a sloped septum). */
  tilt?: number;
  /** Holes cut through the plate (driver and port cut-outs, a brace's window). Absent: a solid box. */
  holes?: Hole3[];
  /** The thin direction of a holed plate: 'z' (default, a front or back panel, u = x, v = y) or 'y' (the baffle is the bottom panel, u = x, v = z). */
  holeAxis?: 'z' | 'y';
}

export interface Disc3 {
  band: number;
  kind: 'driver' | 'port';
  /** Rotation about the x axis, radians, for a hole on a sloping baffle. */
  tilt?: number;
  center: [number, number, number];
  radius: number;
  /** A rectangular hole: the width and height (m); `radius` is then the bounding radius. */
  shape?: 'rect';
  w?: number;
  h?: number;
  /** Rotation about the y axis, radians (a hole on the back wall faces away). */
  rotY?: number;
}

/** One driver installed: the flange centre, the way its frame, cone dish and motor extend from the flange, and the cone radius. */
export interface Driver3 {
  band: number;
  flange: [number, number, number];
  /** Unit vector from the flange towards the motor. */
  dir: [number, number, number];
  radius: number;
}

export interface Tube3 {
  band: number;
  /** Front end of the tube (at the baffle), radius and length back into the box. */
  center: [number, number, number];
  radius: number;
  length: number;
  /** A rectangular port: width and height (m). */
  rect?: { w: number; h: number };
  /** 'y': the port runs up from `center` (a baffle that faces down); default 'z', back into the box. */
  axis?: 'y' | 'z';
}

export interface Prism3 {
  band: number;
  /** Eight corners: the four of the throat end (z lower), then the four of the mouth end. */
  points: [number, number, number][];
  /** A plate with holes (the sloping baffle of a wedge): u across from the left edge of the face, v up from its bottom edge. */
  holes?: Hole3[];
  /** Centre of the cabinet it belongs to: in the exploded view the prism moves away from it, as the boxes do. Absent: it stays put (a horn section). */
  origin?: [number, number, number];
  /** A brace is drawn brown and only when the box is see-through or exploded; absent is a wall. */
  kind?: 'panel' | 'brace';
}

export interface Layout3 {
  boxes: Box3[];
  discs: Disc3[];
  tubes: Tube3[];
  drivers: Driver3[];
  prisms: Prism3[];
  /** Overall width, height and depth. */
  extent: [number, number, number];
}

const holeOf = (h: ReturnType<typeof holePositions>[number], u: number, v: number): Hole3 => ({ u, v, radius: h.r, ...(h.shape === 'rect' ? { shape: 'rect' as const, w: h.w, h: h.h } : {}) });

/** Gap between neighbouring bands, m. */
export const GAP = 0.1;
/** How far the front of a disc sits off the baffle, m. */
const LIFT = 0.001;

/**
 * A wedge enclosure in 3D: back, top and bottom as boxes, the two trapezoid sides and the sloping baffle as prisms. z = 0 is the
 * bottom front edge of the baffle, the back is at -(bottom depth), y up from the floor. Returns the lowest z.
 */
function wedgeBoxes(c: Cabinet, band: number, cx: number, t: number, out: Layout3): number {
  const w = c.wedge!;
  const { wO, hO, dBottomI: db, dTopI: dt } = w;
  const delta = db - dt;
  const origin: [number, number, number] = [cx, hO / 2, -db / 2];
  const box = (size: Box3['size'], x: number, y: number, z: number): void => {
    out.boxes.push({ band, kind: 'panel', size, center: [cx + x, y, z], origin });
  };
  box([wO, hO, t], 0, hO / 2, -db - t / 2); // back
  box([wO, t, db], 0, t / 2, -db / 2); // bottom
  box([wO, t, dt], 0, hO - t / 2, -db + dt / 2); // top
  const side = (x0: number): void => {
    const quad = (x: number): [number, number, number][] => [[x, 0, -db], [x, 0, 0], [x, hO, -delta], [x, hO, -db]];
    out.prisms.push({ band, points: [...quad(x0), ...quad(x0 + t)], origin });
  };
  side(cx - wO / 2);
  side(cx + wO / 2 - t);
  // the baffle: its outer face runs from the bottom front edge to the top front edge; the plate is t thick, towards the back
  const len = Math.hypot(hO, delta);
  const nz = -hO / len;
  const ny = -delta / len;
  const face = (x: number, y: number, z: number): [number, number, number] => [x, y, z];
  const xl = cx - wO / 2;
  const xr = cx + wO / 2;
  const A = [face(xl, 0, 0), face(xr, 0, 0), face(xr, hO, -delta), face(xl, hO, -delta)];
  const B = A.map(([x, y, z]) => face(x, y + t * ny, z + t * nz));
  const baffle: Prism3 = { band, points: [...A, ...B], holes: [], origin };
  out.prisms.push(baffle);
  // holes lie on the slope: cy runs down the baffle from its top edge
  const tilt = -Math.atan2(delta, hO);
  for (const h of holePositions(c)) {
    baffle.holes!.push(holeOf(h, h.cx, len - h.cy));
    const y = hO - (h.cy * hO) / len;
    const z = -delta + (h.cy * delta) / len;
    out.discs.push({ band, kind: h.kind, center: [cx + h.cx - wO / 2, y - LIFT * ny, z + LIFT * (hO / len)], radius: h.r, tilt, ...(h.shape === 'rect' ? { shape: 'rect' as const, w: h.w, h: h.h } : {}) });
    if (h.kind === 'driver') {
      // the outward normal of the sloping baffle is (0, -ny, -nz); a motor out puts the flange on the inner face, t behind it
      const n: [number, number, number] = [0, -ny, -nz];
      const motorOut = c.magnetOut === true;
      const back = motorOut ? -t : 0;
      out.drivers.push({ band, flange: [cx + h.cx - wO / 2, y + n[1] * back, z + n[2] * back], dir: motorOut ? n : [0, ny, nz], radius: h.r });
    }
  }
  return -db - t;
}

/**
 * A TQWT column in 3D: flat front at z = 0, closed top, the sides and the staircase back as thin prisms, standing on y = 0 with the
 * mouth open at the bottom. Returns the lowest z.
 */
function columnBoxes(c: Cabinet, band: number, cx: number, t: number, out: Layout3): number {
  const col = c.column!;
  const g = c.geometry;
  const L = col.lengthM;
  const xl = cx - g.wO / 2;
  const xr = cx + g.wO / 2;
  const origin: [number, number, number] = [cx, g.hO / 2, -g.dO / 2];
  const box = (size: Box3['size'], y: number, z: number): Box3 => {
    const b: Box3 = { band, kind: 'panel', size, center: [cx, y, z], origin };
    out.boxes.push(b);
    return b;
  };
  const front = box([g.wO, g.hO, t], g.hO / 2, -t / 2); // front baffle, full height
  box([g.wO, t, col.depthTopI + t], g.hO - t / 2, -t - (col.depthTopI + t) / 2); // closed top
  for (const s of col.sections) {
    const y1 = L - s.x1;
    const y2 = L - s.x2;
    // a side: the trapezoid between the flat front (z = -t) and the back at each end of the section
    const side = (x0: number): void => {
      const quad = (x: number): [number, number, number][] => [[x, y1, -t], [x, y1, -t - s.d1], [x, y2, -t - s.d2], [x, y2, -t]];
      out.prisms.push({ band, points: [...quad(x0), ...quad(x0 + t)], origin });
    };
    side(xl);
    side(xr - t);
    // the back: a sloping sheet t thick (along z) between the sides
    const x0 = xl + t;
    const x1 = xr - t;
    const back = (y: number, d: number): [number, number, number][] => [[x0, y, -t - d], [x1, y, -t - d], [x1, y, -t - d - t], [x0, y, -t - d - t]];
    out.prisms.push({ band, points: [...back(y1, s.d1), ...back(y2, s.d2)], origin });
  }
  for (const h of holePositions(c)) {
    (front.holes ??= []).push(holeOf(h, h.cx - g.wO / 2, g.hO / 2 - h.cy));
    out.discs.push({ band, kind: h.kind, center: [cx + h.cx - g.wO / 2, g.hO - h.cy, LIFT], radius: h.r });
    if (h.kind === 'driver') out.drivers.push({ band, flange: [cx + h.cx - g.wO / 2, g.hO - h.cy, 0], dir: [0, 0, -1], radius: h.r });
  }
  return -g.dO;
}

/**
 * A tapered box in 3D (plan trapezoid or tower): front baffle face at z = 0 facing +z, the back at -depth, standing on y = 0. Every wall is a
 * hexahedron (a prism with eight corners) or a box; a plan trapezoid's front is a plain holed plate, a tower's is a trapezoid, so its holes
 * are drawn as discs over it. Returns the lowest z.
 */
function taperBoxes(c: Cabinet, band: number, cx: number, t: number, out: Layout3): number {
  const g = c.taper!;
  const F = g.wideO / 2;
  const B = g.narrowO / 2;
  const origin: [number, number, number] = [cx, g.hO / 2, -g.dO / 2];
  type V3 = [number, number, number];
  const prism = (a: V3[], b: V3[]): void => void out.prisms.push({ band, points: [...a, ...b], origin });
  const box = (size: Box3['size'], x: number, y: number, z: number): Box3 => {
    const b: Box3 = { band, kind: 'panel', size, center: [cx + x, y, z], origin };
    out.boxes.push(b);
    return b;
  };
  let front: Box3 | null = null;
  let towerFront: Prism3 | null = null;
  let backPlate: Box3 | null = null;
  let towerBack: Prism3 | null = null;
  if (g.axis === 'plan') {
    // half width at depth z (z from 0 at the front to -dO at the back)
    const hw = (z: number): number => F + ((B - F) * -z) / g.dO;
    front = box([g.wideO, g.hO, t], 0, g.hO / 2, -t / 2);
    backPlate = box([g.narrowO, g.hO, t], 0, g.hO / 2, -g.dO + t / 2);
    const z0 = -t;
    const z1 = -(g.dO - t);
    const flat = (y: number): V3[] => [[cx - hw(z0), y, z0], [cx + hw(z0), y, z0], [cx + hw(z1), y, z1], [cx - hw(z1), y, z1]];
    prism(flat(0), flat(t)); // bottom
    prism(flat(g.hO - t), flat(g.hO)); // top
    // the side walls: the outer edge runs from the front corner to the back corner; the plate is t thick, inwards
    const len = Math.hypot(F - B, g.dO);
    const nx = g.dO / len; // outward normal (x, z) of the right wall, up to sign
    const nz = (B - F) / len;
    const wall = (sign: 1 | -1): void => {
      const xo = (z: number): number => cx + sign * hw(z);
      const quad = (y: number): V3[] => [
        [xo(0), y, 0],
        [xo(-g.dO), y, -g.dO],
        [xo(-g.dO) - sign * t * nx, y, -g.dO - t * nz],
        [xo(0) - sign * t * nx, y, -t * nz],
      ];
      prism(quad(0), quad(g.hO));
    };
    wall(1);
    wall(-1);
  } else {
    // half width at height y
    const hw = (y: number): number => F + ((B - F) * y) / g.hO;
    const face = (z: number): V3[] => [[cx - F, 0, z], [cx + F, 0, z], [cx + B, g.hO, z], [cx - B, g.hO, z]];
    // the front is a trapezoid plate; its driver and port holes are cut through it by the scene (u across from the bottom left corner, v up)
    towerFront = { band, points: [...face(0), ...face(-t)], holes: [], origin };
    out.prisms.push(towerFront);
    towerBack = { band, points: [...face(-g.dO + t), ...face(-g.dO)], holes: [], origin }; // back, a trapezoid plate like the front
    out.prisms.push(towerBack);
    box([g.wideO, t, g.dO - 2 * t], 0, t / 2, -g.dO / 2); // bottom
    box([g.narrowO, t, g.dO - 2 * t], 0, g.hO - t / 2, -g.dO / 2); // top
    const len = Math.hypot(F - B, g.hO);
    const nx = g.hO / len; // outward normal (x, y) of the right wall, up to sign
    const ny = (F - B) / len;
    const wall = (sign: 1 | -1): void => {
      const quad = (z: number): V3[] => [
        [cx + sign * hw(0), 0, z],
        [cx + sign * hw(g.hO), g.hO, z],
        [cx + sign * hw(g.hO) - sign * t * nx, g.hO - t * ny, z],
        [cx + sign * hw(0) - sign * t * nx, -t * ny, z],
      ];
      prism(quad(-t), quad(-(g.dO - t)));
    };
    wall(1);
    wall(-1);
  }
  // frame braces across the interior: a plan trapezoid's are rectangles as wide as the interior where they sit, a tower's are trapezoids; each has a
  // window of bars BRACE_BAR wide (for a trapezoid the window is the narrow end's width, so it fits everywhere)
  g.braceAt.forEach((d, k) => {
    const zc = -t - d;
    if (g.axis === 'plan') {
      const w = g.braceWidths[k]!;
      const b = box([w, g.hI, t], 0, g.hO / 2, zc);
      b.kind = 'brace';
      if (w > 2 * BRACE_BAR && g.hI > 2 * BRACE_BAR) b.holes = [{ u: 0, v: 0, radius: 0, shape: 'rect', w: w - 2 * BRACE_BAR, h: g.hI - 2 * BRACE_BAR }];
    } else {
      const quad = (z: number): V3[] => [[cx - g.wideI / 2, t, z], [cx + g.wideI / 2, t, z], [cx + g.narrowI / 2, g.hO - t, z], [cx - g.narrowI / 2, g.hO - t, z]];
      const brace: Prism3 = { band, points: [...quad(zc), ...quad(zc - t)], origin, kind: 'brace' };
      if (g.narrowI > 2 * BRACE_BAR && g.hI > 2 * BRACE_BAR) brace.holes = [{ u: g.wideI / 2, v: g.hI / 2, radius: 0, shape: 'rect', w: g.narrowI - 2 * BRACE_BAR, h: g.hI - 2 * BRACE_BAR }];
      out.prisms.push(brace);
    }
  });
  // chamber partitions lie flat, g.shelfAt[k] below the top of the interior: a trapezoid (plan) or a rectangle as wide as the interior there (tower)
  g.shelfAt.forEach((s, k) => {
    const y = g.hO - t - s;
    if (g.axis === 'plan') {
      const flat = (yy: number): V3[] => [[cx - g.wideI / 2, yy, -t], [cx + g.wideI / 2, yy, -t], [cx + g.narrowI / 2, yy, -(g.dO - t)], [cx - g.narrowI / 2, yy, -(g.dO - t)]];
      const shelf: Prism3 = { band, points: [...flat(y - t / 2), ...flat(y + t / 2)], origin };
      out.prisms.push(shelf);
    } else {
      out.boxes.push({ band, kind: 'divider', size: [g.shelfWidths[k]!, t, g.dI], center: [cx, y, -g.dO / 2], origin });
    }
  });
  // the back wall's holes (a rear port): seen from behind, so across is mirrored
  const rearW = g.axis === 'plan' ? g.narrowO : g.wideO;
  for (const h of holePositions(c, true)) {
    if (backPlate) (backPlate.holes ??= []).push(holeOf(h, rearW / 2 - h.cx, g.hO / 2 - h.cy));
    if (towerBack) towerBack.holes!.push(holeOf(h, rearW - h.cx, g.hO - h.cy));
    out.discs.push({ band, kind: h.kind, center: [cx + rearW / 2 - h.cx, g.hO - h.cy, -g.dO - LIFT], radius: h.r, rotY: Math.PI, ...(h.shape === 'rect' ? { shape: 'rect' as const, w: h.w, h: h.h } : {}) });
  }
  const motorOut = c.magnetOut === true;
  for (const h of holePositions(c)) {
    const x = cx + h.cx - g.wideO / 2;
    const y = g.hO - h.cy;
    if (front) (front.holes ??= []).push(holeOf(h, h.cx - g.wideO / 2, g.hO / 2 - h.cy));
    if (towerFront) towerFront.holes!.push(holeOf(h, h.cx, g.hO - h.cy));
    out.discs.push({ band, kind: h.kind, center: [x, y, LIFT], radius: h.r, ...(h.shape === 'rect' ? { shape: 'rect' as const, w: h.w, h: h.h } : {}) });
    if (h.kind === 'driver') out.drivers.push({ band, flange: [x, y, (h.magnetOut ?? motorOut) ? -t : 0], dir: (h.magnetOut ?? motorOut) ? [0, 0, 1] : [0, 0, -1], radius: h.r });
  }
  return -g.dO;
}

function cabinetBoxes(c: Cabinet, band: number, cx: number, t: number, z0: number, dividerShares: readonly number[], out: Layout3): number {
  const g = c.geometry;
  const lift = c.facing === 'down' ? (c.clearanceM ?? 0) : 0;
  const cy = g.hO / 2 + lift;
  const cz = z0 - g.dO / 2; // the baffle is the front: z0 is its outer face
  const origin: [number, number, number] = [cx, cy, cz];
  const add = (kind: Box3['kind'], size: Box3['size'], dx: number, dy: number, dz: number, tilt?: number): Box3 => {
    const b: Box3 = { band, kind, size, center: [cx + dx, cy + dy, cz + dz], origin, ...(tilt ? { tilt } : {}) };
    out.boxes.push(b);
    return b;
  };
  const frontPlate = add('panel', [g.wO, g.hO, t], 0, 0, g.dO / 2 - t / 2); // front baffle
  const backPlate = add('panel', [g.wO, g.hO, t], 0, 0, -g.dO / 2 + t / 2); // back
  add('panel', [g.wO, t, g.dO - 2 * t], 0, g.hO / 2 - t / 2, 0); // top
  const bottomPlate = add('panel', [g.wO, t, g.dO - 2 * t], 0, -g.hO / 2 + t / 2, 0); // bottom
  add('panel', [t, g.hO - 2 * t, g.dO - 2 * t], g.wO / 2 - t / 2, 0, 0); // sides
  add('panel', [t, g.hO - 2 * t, g.dO - 2 * t], -g.wO / 2 + t / 2, 0, 0);
  // a window brace is a frame: bars BRACE_BAR wide round an opening (solid when the bars would meet)
  const frame: Hole3[] = g.wI > 2 * BRACE_BAR && g.hI > 2 * BRACE_BAR ? [{ u: 0, v: 0, radius: 0, shape: 'rect', w: g.wI - 2 * BRACE_BAR, h: g.hI - 2 * BRACE_BAR }] : [];
  for (let k = 1; k <= g.braces; k++) {
    const b = add('brace', [g.wI, g.hI, t], 0, 0, -g.dI / 2 + (g.dI * k) / (g.braces + 1));
    if (frame.length) b.holes = frame;
  }
  for (const share of dividerShares) add('divider', [g.wI, g.hI, t], 0, 0, -g.dI / 2 + g.dI * share);
  // a speaker's chamber shelves lie flat, wI x dI, at the depth the cut list's air shares put them
  for (const fromTop of c.shelves ?? []) add('divider', [g.wI, t, g.dI], 0, g.hO / 2 - t - fromTop, 0);
  // a folded horn's septa: fixed to the front wall (even index) or the back wall, stopping short of the other for the U-turn.
  // A sloped septum (tapered fold) runs from its top height at one wall to its height at the other, so it is tilted about x.
  const fold = c.fold;
  const ch = c.chamber;
  const drop = ch ? ch.heightM + t : 0; // the chamber and its shelf sit above the legs, so the septa measure from lower down
  fold?.septaLength.forEach((len, k) => {
    const front = fold.septaAnchor[k] === 'front';
    const dMid = front ? len / 2 : fold.dI - len / 2; // depth of the plate's middle from the front inner face
    const topMid = fold.septaFrontTop[k]! + ((fold.septaBackTop[k]! - fold.septaFrontTop[k]!) * dMid) / fold.dI;
    add('divider', [g.wI, t, fold.septaSlant[k]!], 0, g.hO / 2 - t - drop - topMid - t / 2, g.dO / 2 - t - dMid, -fold.septaAngle[k]!);
  });
  // the driver's chamber at the top of a folded box: a shelf over the first leg with the opening to it (or the driver's hole), and a back
  // wall when the chamber is shallower than the box
  if (ch) {
    const shelfY = g.hO / 2 - t - ch.heightM - t / 2; // centre, from the middle of the box
    const front = g.dI / 2; // the front inner face, from the middle of the box, along z
    const shelf = add('divider', [g.wI, t, g.dI], 0, shelfY, 0);
    shelf.holeAxis = 'y';
    if (ch.driverOn === 'shelf') shelf.holes = [{ u: 0, v: front - ch.depthM / 2, radius: ch.driverM / 2 }];
    else shelf.holes = [{ u: 0, v: front - ch.throatDepthM / 2, radius: Math.max(g.wI, ch.throatDepthM) / 2, shape: 'rect', w: g.wI, h: ch.throatDepthM }];
    if (ch.depthM < g.dI - 1e-9) add('divider', [g.wI, ch.heightM, t], 0, g.hO / 2 - t - ch.heightM / 2, front - ch.depthM - t / 2);
    if (ch.driverOn === 'shelf') {
      const x = cx;
      const zD = z0 - t - ch.depthM / 2;
      const yBottom = cy + shelfY - t / 2;
      out.discs.push({ band, kind: 'driver', center: [x, yBottom - LIFT, zD], radius: ch.driverM / 2, tilt: Math.PI / 2 });
      out.drivers.push({ band, flange: [x, yBottom + t, zD], dir: [0, 1, 0], radius: ch.driverM / 2 });
    }
  }
  const motorOut = c.magnetOut === true;
  const rect = (h: ReturnType<typeof holePositions>[number]): Pick<Disc3, 'shape' | 'w' | 'h'> => (h.shape === 'rect' ? { shape: 'rect', w: h.w, h: h.h } : {});
  if (c.facing === 'down') {
    // the baffle is the bottom panel: cy runs back from the front edge, the discs lie flat facing the floor
    bottomPlate.holeAxis = 'y';
    for (const h of holePositions(c)) {
      (bottomPlate.holes ??= []).push(holeOf(h, h.cx - g.wO / 2, g.dO / 2 - h.cy));
      out.discs.push({ band, kind: h.kind, center: [cx + h.cx - g.wO / 2, lift - LIFT, z0 - h.cy], radius: h.r, tilt: Math.PI / 2, ...rect(h) });
      if (h.kind === 'driver') {
        const mo = h.magnetOut ?? motorOut;
        out.drivers.push({ band, flange: [cx + h.cx - g.wO / 2, lift + (mo ? t : 0), z0 - h.cy], dir: mo ? [0, -1, 0] : [0, 1, 0], radius: h.r });
      }
    }
  } else {
    for (const h of holePositions(c)) {
      (frontPlate.holes ??= []).push(holeOf(h, h.cx - g.wO / 2, g.hO / 2 - h.cy));
      out.discs.push({ band, kind: h.kind, center: [cx + h.cx - g.wO / 2, g.hO - h.cy, z0 + LIFT], radius: h.r, ...rect(h) });
      if (h.kind === 'driver') {
        const mo = h.magnetOut ?? motorOut;
        out.drivers.push({ band, flange: [cx + h.cx - g.wO / 2, g.hO - h.cy, z0 - (mo ? t : 0)], dir: mo ? [0, 0, 1] : [0, 0, -1], radius: h.r });
      }
    }
  }
  // push-pull: the second set of drivers on the back wall, seen from behind, mounted the other way round
  for (const h of holePositions(c, true)) {
    const x = cx + g.wO / 2 - h.cx;
    const y = c.facing === 'down' ? lift + g.hO - h.cy : g.hO - h.cy;
    const zb = z0 - g.dO;
    (backPlate.holes ??= []).push(holeOf(h, g.wO / 2 - h.cx, g.hO / 2 - h.cy));
    out.discs.push({ band, kind: h.kind, center: [x, y, zb - LIFT], radius: h.r, rotY: Math.PI });
    if (h.kind === 'driver') out.drivers.push({ band, flange: [x, y, zb + (motorOut ? t : 0)], dir: motorOut ? [0, 0, -1] : [0, 0, 1], radius: h.r });
  }
  return cz;
}

/**
 * One cabinet per cabinet of each band, side by side, bottoms on y = 0. A horn's sections follow its chambers along +z
 * from the front of the first chamber, `width` wide, centred on the chamber.
 */
export function layout3d(v: BuildView, p: Project): Layout3 {
  const t = p.shop.thicknessMm / 1000;
  const out: Layout3 = { boxes: [], discs: [], tubes: [], drivers: [], prisms: [], extent: [0, 0, 0] };
  let x = 0;
  let maxY = 0;
  let minZ = 0;
  let maxZ = 0;
  v.bands.forEach((b, band) => {
    const hornWidth = p.bands[band]!.design.horn.widthCm / 100;
    const bandLeft = x;
    b.cabinets.forEach((c, i) => {
      const g = c.geometry;
      const cx = x + g.wO / 2;
      if (c.column) {
        const zMin = columnBoxes(c, band, cx, t, out);
        x += g.wO;
        maxY = Math.max(maxY, g.hO);
        minZ = Math.min(minZ, zMin);
        maxZ = Math.max(maxZ, 0);
        return;
      }
      if (c.taper) {
        const zMin = taperBoxes(c, band, cx, t, out);
        if (i === 0) {
          const holes = holePositions(c).filter((h) => h.kind === 'port');
          b.ports.forEach((pt, j) => {
            const port = holes[j];
            if (!port) return;
            const rect = pt.shape === 'rect' ? { rect: { w: port.w, h: port.h } } : {};
            out.tubes.push({ band, center: [cx + port.cx - c.taper!.wideO / 2, c.taper!.hO - port.cy, 0], radius: pt.diameterM / 2, length: Math.min(pt.lengthM, c.taper!.dI), ...rect });
          });
        }
        x += c.taper.wideO;
        maxY = Math.max(maxY, c.taper.hO);
        minZ = Math.min(minZ, zMin);
        maxZ = Math.max(maxZ, 0);
        return;
      }
      if (c.wedge) {
        const zMin = wedgeBoxes(c, band, cx, t, out);
        if (i === 0) {
          const slope = holePositions(c).filter((h) => h.kind === 'port');
          const len = Math.hypot(c.wedge.hO, c.wedge.dBottomI - c.wedge.dTopI);
          b.ports.forEach((pt, j) => {
            const port = slope[j];
            if (!port) return;
            const delta = c.wedge!.dBottomI - c.wedge!.dTopI;
            out.tubes.push({ band, center: [cx + port.cx - g.wO / 2, c.wedge!.hO - (port.cy * c.wedge!.hO) / len, -delta + (port.cy * delta) / len], radius: pt.diameterM / 2, length: Math.min(pt.lengthM, c.wedge!.dTopI) });
          });
        }
        x += g.wO;
        maxY = Math.max(maxY, c.wedge.hO);
        minZ = Math.min(minZ, zMin);
        maxZ = Math.max(maxZ, 0);
        return;
      }
      // depth shares, from the back, of the dividers of a band-pass box: the rear chamber's, and (8th order) the inner front chamber's too
      // the PA band's box, or the car sub's (the volumes are only compared with each other, so their sharing out among the subs does not matter)
      const des = p.kind === 'car' ? p.car.design : p.bands[band]!.design;
      const boxed = (p.kind === 'system' || p.kind === 'car') && b.cabinets.length === 1;
      const split = boxed && (des.type === 'bandpass' || des.type === 'bandpass6') ? [des.volumeL, des.frontVolumeL] : boxed && des.type === 'bandpass8' ? [des.volumeL, des.bp8.innerVolumeL, des.frontVolumeL] : [];
      const total = split.reduce((a, v) => a + v, 0);
      const shares = split.slice(0, -1).map((_, k) => split.slice(0, k + 1).reduce((a, v) => a + v, 0) / total);
      const cz = cabinetBoxes(c, band, cx, t, 0, shares, out);
      if (i === 0) {
        const holes = holePositions(c).filter((h) => h.kind === 'port');
        const down = c.facing === 'down';
        const lift = down ? (c.clearanceM ?? 0) : 0;
        b.ports.forEach((pt, j) => {
          const port = holes[j];
          if (!port) return;
          const rect = pt.shape === 'rect' ? { rect: { w: port.w, h: port.h } } : {};
          const length = Math.min(pt.lengthM, down ? g.hI : g.dI);
          if (down) out.tubes.push({ band, center: [cx + port.cx - g.wO / 2, lift, -port.cy], radius: pt.diameterM / 2, length, axis: 'y', ...rect });
          else out.tubes.push({ band, center: [cx + port.cx - g.wO / 2, g.hO - port.cy, 0], radius: pt.diameterM / 2, length, ...rect });
        });
      }
      x += g.wO;
      maxY = Math.max(maxY, g.hO + (c.facing === 'down' ? (c.clearanceM ?? 0) : 0));
      minZ = Math.min(minZ, cz - g.dO / 2);
      maxZ = Math.max(maxZ, 0);
    });
    if (b.horn) {
      const first = b.cabinets[0];
      const midX = first ? bandLeft + first.geometry.wO / 2 : x + hornWidth / 2;
      const hw = hornWidth / 2;
      const quad = (z: number, h: number): [number, number, number][] => [
        [midX - hw, 0, z],
        [midX + hw, 0, z],
        [midX + hw, h, z],
        [midX - hw, h, z],
      ];
      let z = 0;
      for (const s of b.horn.sections) {
        out.prisms.push({ band, points: [...quad(z, s.h1), ...quad(z + s.sideLen, s.h2)] });
        z += s.sideLen;
        maxY = Math.max(maxY, s.h1, s.h2);
        maxZ = Math.max(maxZ, z);
      }
      x = Math.max(x, midX + hw);
    }
    x += GAP;
  });
  out.extent = [Math.max(x - GAP, 0), maxY, maxZ - minZ];
  return out;
}
