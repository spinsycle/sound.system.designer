// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Tapered quarter-wave tube (spec: "TQWT", app only, v0.17). The response is the transmission-line simulation of
// transmissionline.ts: a stuffed, tapered line whose driver sits part way up it, so this file holds only the design rule
// (a starting line for a driver) and the column geometry a builder cuts. Metres.
import { C } from './constants';
import { type DriverSpec } from './drivers';
import { TL_TAPER, type TlDesign, type TlGeometry } from './transmissionline';

/** Driver position along the line from the closed end, as a share of the line: the classic TQWT puts it about a third of the way up. */
export const TQWT_OFFSET = 1 / 3;
/** Light stuffing: lb/ft^3, over the closed-end share of the line below. */
export const TQWT_DENSITY_LB = 0.5;
export const TQWT_STUFFED_SHARE = 0.5;

/**
 * A starting TQWT for a driver: quarter-wave length c / 4 Fs (the pipe resonates about at the driver's Fs), the mouth the area of
 * the cone, the closed end TL_TAPER times that, the driver a third of the way up from the closed end, no coupling chamber.
 * `f3Hz` is 0: unlike the book's transmission-line tables there is no predicted f3 here.
 */
export function tqwtDesign(d: DriverSpec): TlDesign {
  const lengthM = C / (4 * d.fs);
  const exitM2 = d.sd;
  const startM2 = TL_TAPER * exitM2;
  return { kind: 'offset', fpHz: d.fs, lengthM, volumeM3: (lengthM * (startM2 - exitM2)) / Math.log(TL_TAPER), startM2, exitM2, chamberM3: 0, offset: TQWT_OFFSET, f3Hz: 0 };
}

/** Straight sections the exponential taper is cut into for the column's back panel. */
export const TQWT_SECTIONS = 8;

export interface ColumnSection {
  /** Distance from the closed end along the line, at the start and the end of the section, m. */
  x1: number;
  x2: number;
  /** Inside depth at each end (the front is flat, so this is how far the back stands off it), m. */
  d1: number;
  d2: number;
  /** Length of the sloping back panel of the section, m (the flat front is `x2 - x1`). */
  slant: number;
}

export interface Column {
  /** Inside width, m: the same all the way down (the taper is in the depth). */
  wI: number;
  /** Inside height: the line length, m. */
  lengthM: number;
  /** Inside depth at the closed end and at the mouth, m. */
  depthTopI: number;
  depthMouthI: number;
  sections: ColumnSection[];
  /** Distance from the closed end down to the driver's centre on the front, m. */
  driverFromTop: number;
  /** Air volume of the column as built (straight sections), m^3. */
  volumeM3: number;
}

/**
 * The column a builder cuts for a line: flat front, closed top, mouth open at the bottom, the back a staircase of straight
 * sloping sections that follows the line's exponential area (area / width = depth). The width is the largest of the driver's hole plus a margin each
 * side, `minWidthM` and 0.8 sqrt(closed-end area) (so the top is no deeper than 1.25 times its width). The line runs straight down, so the height is the line length (the back's slope adds
 * a little path, which is ignored).
 */
export function tqwtColumn(geo: TlGeometry, driverDiameterM: number, margin: number, minWidthM = 0.2): Column {
  const wI = Math.max(driverDiameterM + 2 * margin, minWidthM, 0.8 * Math.sqrt(geo.startM2));
  const area = (x: number): number => geo.startM2 * (geo.exitM2 / geo.startM2) ** (x / geo.lengthM);
  const sections: ColumnSection[] = [];
  let volume = 0;
  for (let k = 0; k < TQWT_SECTIONS; ++k) {
    const x1 = (geo.lengthM * k) / TQWT_SECTIONS;
    const x2 = (geo.lengthM * (k + 1)) / TQWT_SECTIONS;
    const d1 = area(x1) / wI;
    const d2 = area(x2) / wI;
    sections.push({ x1, x2, d1, d2, slant: Math.hypot(x2 - x1, d2 - d1) });
    volume += (wI * (d1 + d2) * (x2 - x1)) / 2;
  }
  return { wI, lengthM: geo.lengthM, depthTopI: geo.startM2 / wI, depthMouthI: geo.exitM2 / wI, sections, driverFromTop: geo.offset * geo.lengthM, volumeM3: volume };
}
