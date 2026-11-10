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
}

export interface Disc3 {
  band: number;
  kind: 'driver' | 'port';
  center: [number, number, number];
  radius: number;
}

export interface Tube3 {
  band: number;
  /** Front end of the tube (at the baffle), radius and length back into the box. */
  center: [number, number, number];
  radius: number;
  length: number;
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
  prisms: Prism3[];
  /** Overall width, height and depth. */
  extent: [number, number, number];
}

/** Gap between neighbouring bands, m. */
export const GAP = 0.1;
/** How far the front of a disc sits off the baffle, m. */
const LIFT = 0.001;

function cabinetBoxes(c: Cabinet, band: number, cx: number, t: number, z0: number, dividerShare: number | null, out: Layout3): number {
  const g = c.geometry;
  const cy = g.hO / 2;
  const cz = z0 - g.dO / 2; // the baffle is the front: z0 is its outer face
  const origin: [number, number, number] = [cx, cy, cz];
  const add = (kind: Box3['kind'], size: Box3['size'], dx: number, dy: number, dz: number): void => {
    out.boxes.push({ band, kind, size, center: [cx + dx, cy + dy, cz + dz], origin });
  };
  add('panel', [g.wO, g.hO, t], 0, 0, g.dO / 2 - t / 2); // front baffle
  add('panel', [g.wO, g.hO, t], 0, 0, -g.dO / 2 + t / 2); // back
  add('panel', [g.wO, t, g.dO - 2 * t], 0, g.hO / 2 - t / 2, 0); // top
  add('panel', [g.wO, t, g.dO - 2 * t], 0, -g.hO / 2 + t / 2, 0); // bottom
  add('panel', [t, g.hO - 2 * t, g.dO - 2 * t], g.wO / 2 - t / 2, 0, 0); // sides
  add('panel', [t, g.hO - 2 * t, g.dO - 2 * t], -g.wO / 2 + t / 2, 0, 0);
  for (let k = 1; k <= g.braces; k++) add('brace', [g.wI, g.hI, t], 0, 0, -g.dI / 2 + (g.dI * k) / (g.braces + 1));
  if (dividerShare !== null) add('divider', [g.wI, g.hI, t], 0, 0, -g.dI / 2 + g.dI * dividerShare);
  for (const h of holePositions(c)) out.discs.push({ band, kind: h.kind, center: [cx + h.cx - g.wO / 2, g.hO - h.cy, z0 + LIFT], radius: h.r });
  return cz;
}

/**
 * One cabinet per cabinet of each band, side by side, bottoms on y = 0. A horn's sections follow its chambers along +z
 * from the front of the first chamber, `width` wide, centred on the chamber.
 */
export function layout3d(v: BuildView, p: Project): Layout3 {
  const t = p.shop.thicknessMm / 1000;
  const out: Layout3 = { boxes: [], discs: [], tubes: [], prisms: [], extent: [0, 0, 0] };
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
      const share = b.cabinets.length === 1 && p.bands[band]!.design.type === 'bandpass' ? p.bands[band]!.design.volumeL / (p.bands[band]!.design.volumeL + p.bands[band]!.design.frontVolumeL) : null;
      const cz = cabinetBoxes(c, band, cx, t, 0, share, out);
      if (b.port && i === 0) {
        const port = holePositions(c).find((h) => h.kind === 'port');
        if (port) out.tubes.push({ band, center: [cx + port.cx - g.wO / 2, g.hO - port.cy, 0], radius: b.port.diameterM / 2, length: Math.min(b.port.lengthM, g.dI) });
      }
      x += g.wO;
      maxY = Math.max(maxY, g.hO);
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
