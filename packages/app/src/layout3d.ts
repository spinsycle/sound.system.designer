// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The 3D preview's geometry as plain data (metres; x right, y up, z towards the viewer, baffles face +z), so the scene
// code only draws it and the tests can check it against the cut list.
import type { BuildView, Cabinet } from './buildlist';
import { holePositions } from './buildlist';
import type { Project } from './system';

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
    out.prisms.push({ band, points: [...quad(x0), ...quad(x0 + t)] });
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
  out.prisms.push({ band, points: [...A, ...B] });
  // holes lie on the slope: cy runs down the baffle from its top edge
  const tilt = -Math.atan2(delta, hO);
  for (const h of holePositions(c)) {
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
  const box = (size: Box3['size'], y: number, z: number): void => {
    out.boxes.push({ band, kind: 'panel', size, center: [cx, y, z], origin });
  };
  box([g.wO, g.hO, t], g.hO / 2, -t / 2); // front baffle, full height
  box([g.wO, t, col.depthTopI + t], g.hO - t / 2, -t - (col.depthTopI + t) / 2); // closed top
  for (const s of col.sections) {
    const y1 = L - s.x1;
    const y2 = L - s.x2;
    // a side: the trapezoid between the flat front (z = -t) and the back at each end of the section
    const side = (x0: number): void => {
      const quad = (x: number): [number, number, number][] => [[x, y1, -t], [x, y1, -t - s.d1], [x, y2, -t - s.d2], [x, y2, -t]];
      out.prisms.push({ band, points: [...quad(x0), ...quad(x0 + t)] });
    };
    side(xl);
    side(xr - t);
    // the back: a sloping sheet t thick (along z) between the sides
    const x0 = xl + t;
    const x1 = xr - t;
    const back = (y: number, d: number): [number, number, number][] => [[x0, y, -t - d], [x1, y, -t - d], [x1, y, -t - d - t], [x0, y, -t - d - t]];
    out.prisms.push({ band, points: [...back(y1, s.d1), ...back(y2, s.d2)] });
  }
  for (const h of holePositions(c)) {
    out.discs.push({ band, kind: h.kind, center: [cx + h.cx - g.wO / 2, g.hO - h.cy, LIFT], radius: h.r });
    if (h.kind === 'driver') out.drivers.push({ band, flange: [cx + h.cx - g.wO / 2, g.hO - h.cy, 0], dir: [0, 0, -1], radius: h.r });
  }
  return -g.dO;
}

function cabinetBoxes(c: Cabinet, band: number, cx: number, t: number, z0: number, dividerShares: readonly number[], out: Layout3): number {
  const g = c.geometry;
  const lift = c.facing === 'down' ? (c.clearanceM ?? 0) : 0;
  const cy = g.hO / 2 + lift;
  const cz = z0 - g.dO / 2; // the baffle is the front: z0 is its outer face
  const origin: [number, number, number] = [cx, cy, cz];
  const add = (kind: Box3['kind'], size: Box3['size'], dx: number, dy: number, dz: number, tilt?: number): void => {
    out.boxes.push({ band, kind, size, center: [cx + dx, cy + dy, cz + dz], origin, ...(tilt ? { tilt } : {}) });
  };
  add('panel', [g.wO, g.hO, t], 0, 0, g.dO / 2 - t / 2); // front baffle
  add('panel', [g.wO, g.hO, t], 0, 0, -g.dO / 2 + t / 2); // back
  add('panel', [g.wO, t, g.dO - 2 * t], 0, g.hO / 2 - t / 2, 0); // top
  add('panel', [g.wO, t, g.dO - 2 * t], 0, -g.hO / 2 + t / 2, 0); // bottom
  add('panel', [t, g.hO - 2 * t, g.dO - 2 * t], g.wO / 2 - t / 2, 0, 0); // sides
  add('panel', [t, g.hO - 2 * t, g.dO - 2 * t], -g.wO / 2 + t / 2, 0, 0);
  for (let k = 1; k <= g.braces; k++) add('brace', [g.wI, g.hI, t], 0, 0, -g.dI / 2 + (g.dI * k) / (g.braces + 1));
  for (const share of dividerShares) add('divider', [g.wI, g.hI, t], 0, 0, -g.dI / 2 + g.dI * share);
  // a speaker's chamber shelves lie flat, wI x dI, at the depth the cut list's air shares put them
  for (const fromTop of c.shelves ?? []) add('divider', [g.wI, t, g.dI], 0, g.hO / 2 - t - fromTop, 0);
  // a folded horn's septa: fixed to the front wall (even index) or the back wall, stopping short of the other for the U-turn.
  // A sloped septum (tapered fold) runs from its top height at one wall to its height at the other, so it is tilted about x.
  const fold = c.fold;
  fold?.septaLength.forEach((len, k) => {
    const front = fold.septaAnchor[k] === 'front';
    const dMid = front ? len / 2 : fold.dI - len / 2; // depth of the plate's middle from the front inner face
    const topMid = fold.septaFrontTop[k]! + ((fold.septaBackTop[k]! - fold.septaFrontTop[k]!) * dMid) / fold.dI;
    add('divider', [g.wI, t, fold.septaSlant[k]!], 0, g.hO / 2 - t - topMid - t / 2, g.dO / 2 - t - dMid, -fold.septaAngle[k]!);
  });
  const motorOut = c.magnetOut === true;
  const rect = (h: ReturnType<typeof holePositions>[number]): Pick<Disc3, 'shape' | 'w' | 'h'> => (h.shape === 'rect' ? { shape: 'rect', w: h.w, h: h.h } : {});
  if (c.facing === 'down') {
    // the baffle is the bottom panel: cy runs back from the front edge, the discs lie flat facing the floor
    for (const h of holePositions(c)) {
      out.discs.push({ band, kind: h.kind, center: [cx + h.cx - g.wO / 2, lift - LIFT, z0 - h.cy], radius: h.r, tilt: Math.PI / 2, ...rect(h) });
      if (h.kind === 'driver') {
        const mo = h.magnetOut ?? motorOut;
        out.drivers.push({ band, flange: [cx + h.cx - g.wO / 2, lift + (mo ? t : 0), z0 - h.cy], dir: mo ? [0, -1, 0] : [0, 1, 0], radius: h.r });
      }
    }
  } else {
    for (const h of holePositions(c)) {
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
    out.discs.push({ band, kind: h.kind, center: [x, y, zb - LIFT], radius: h.r, rotY: Math.PI });
    out.drivers.push({ band, flange: [x, y, zb + (motorOut ? t : 0)], dir: motorOut ? [0, 0, -1] : [0, 0, 1], radius: h.r });
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
