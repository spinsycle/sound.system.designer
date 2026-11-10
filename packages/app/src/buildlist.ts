// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Cut list, sheet layout and bill of materials for a project. Pure functions; the Build page draws what comes back.
// Spec: "Cabinet, cut list and sheets". Metric only (millimetres on the page, metres inside).
import * as P from '@soundsystemdesigner/physics';
import { compute, driverOf } from './model';
import { type Band, type Project, bandName, summary } from './system';
import { type Units, formatLength } from './units';

/** Joint spacing for screws, m. */
export const SCREW_SPACING = 0.15;
/** Length of joint one bottle of glue does, m. */
export const GLUE_PER_BOTTLE = 10;
/** Margin kept between a hole and the baffle edge or another hole, m. */
export const HOLE_MARGIN = 0.02;
const ceilTenth = (v: number): number => Math.ceil(v * 10 - 1e-9) / 10;

export interface Cutout {
  kind: 'driver' | 'port';
  diameterM: number;
}

export interface Cabinet {
  title: string;
  geometry: P.BoxGeometry;
  panels: P.Panel[];
  cutouts: Cutout[];
  /** Damping lining to cover the walls other than the baffle, m2. */
  liningM2: number;
}

export interface HornRows {
  sections: P.HornSection[];
}

export interface BandBuild {
  name: string;
  summary: string;
  /** Identical cabinets of this band (one per driver). */
  count: number;
  driver: string;
  cabinets: Cabinet[];
  horn: HornRows | null;
  /** Round port tube per cabinet, when the band has one. */
  port: { diameterM: number; lengthM: number } | null;
  warnings: string[];
}

export interface CutRow {
  band: string;
  part: string;
  /** mm */
  l: number;
  w: number;
  qty: number;
  note: string;
}

export interface BomLine {
  item: string;
  qty: number;
  unit: string;
  note: string;
}

export interface SheetPiece {
  label: string;
  /** Index of the band the piece belongs to, for colouring. */
  band: number;
  placement: P.Placement;
}

export interface BuildView {
  bands: BandBuild[];
  cutList: CutRow[];
  /** One entry per physical piece, with where it sits on its sheet (metres). */
  pieces: SheetPiece[];
  sheets: number;
  /** Share of the sheet area not covered by pieces, 0 to 1. */
  waste: number;
  bom: BomLine[];
  warnings: string[];
  notes: string[];
}

const mm = (m: number): number => Math.round(m * 1000);
/** A length in metres as text in the chosen unit, with its unit: "465 mm" or "18 5/16 in". */
const fl = (m: number, u: Units): string => `${formatLength(m * 1000, u)} ${u}`;
/** Joint length in metres as text: metres, or feet. */
const fj = (m: number, u: Units): string => (u === 'in' ? `${(m / 0.3048).toFixed(1)} ft` : `${m.toFixed(1)} m`);

/** Where a cabinet's baffle holes sit, to scale: centred across, stacked and centred down, y from the top edge (m). */
export function holePositions(c: Cabinet): { kind: Cutout['kind']; cx: number; cy: number; r: number }[] {
  const gap = 0.02;
  const total = c.cutouts.reduce((a, h) => a + h.diameterM, 0) + gap * Math.max(c.cutouts.length - 1, 0);
  let y = (c.geometry.hO - total) / 2;
  return c.cutouts.map((h) => {
    const cy = y + h.diameterM / 2;
    y += h.diameterM + gap;
    return { kind: h.kind, cx: c.geometry.wO / 2, cy, r: h.diameterM / 2 };
  });
}

function cabinet(title: string, vNetM3: number, dispM3: number, b: Band, tM: number, divider: boolean, cutouts: Cutout[]): Cabinet {
  const o = b.build;
  const g = P.solveBox(vNetM3, dispM3, o.rw, o.rh, o.rd, tM, o.brace, divider);
  return {
    title,
    geometry: g,
    panels: P.boxPanels(g, tM, divider),
    cutouts,
    liningM2: ceilTenth(2 * (g.wI * g.hI + g.wI * g.dI + g.hI * g.dI) - g.wI * g.hI),
  };
}

function bandBuild(b: Band, name: string, shop: Project['shop'], u: Units): BandBuild {
  const d = b.design;
  const t = shop.thicknessMm / 1000;
  const driver = driverOf(d);
  const driverHole: Cutout = { kind: 'driver', diameterM: 2 * Math.sqrt(driver.sd / Math.PI) };
  const dDisp = P.driverDisplacement(driver.sd);
  const warnings: string[] = [];
  const cabinets: Cabinet[] = [];
  let horn: HornRows | null = null;
  let port: BandBuild['port'] = null;

  const portFor = (chamberL: number): { diameterM: number; lengthM: number } | null => {
    const lengthM = P.portLengthM(chamberL / 1000, d.tuneHz, d.portDiameterCm / 100);
    if (!(lengthM > 0)) {
      warnings.push(`${name}: the port does not fit (its length comes out negative), so the cut list has no port tube. Fix it on the box page.`);
      return null;
    }
    return { diameterM: d.portDiameterCm / 100, lengthM };
  };

  if (d.type === 'sealed') {
    cabinets.push(cabinet('Box', d.volumeL / 1000, dDisp, b, t, false, [driverHole]));
  } else if (d.type === 'ported') {
    port = portFor(d.volumeL);
    const disp = dDisp + (port ? P.portDisplacement(port.diameterM, port.lengthM) : 0);
    cabinets.push(cabinet('Box', d.volumeL / 1000, disp, b, t, false, port ? [driverHole, { kind: 'port', diameterM: port.diameterM }] : [driverHole]));
  } else if (d.type === 'bandpass') {
    port = portFor(d.frontVolumeL);
    const disp = dDisp + (port ? P.portDisplacement(port.diameterM, port.lengthM) : 0);
    cabinets.push(cabinet('Band-pass box', (d.volumeL + d.frontVolumeL) / 1000, disp, b, t, true, port ? [driverHole, { kind: 'port', diameterM: port.diameterM }] : [driverHole]));
    warnings.push(`${name}: the band-pass box is one cabinet; the divider belongs ${((d.volumeL / (d.volumeL + d.frontVolumeL)) * 100).toFixed(0)} % of the interior depth from the back, and the driver mounts on it.`);
  } else {
    const rear = d.horn.loading === 'rear';
    if (rear) {
      if (d.horn.throatChamberL >= 0.05) cabinets.push(cabinet('Chamber behind the cone', d.horn.throatChamberL / 1000, dDisp, b, t, false, [driverHole]));
    } else {
      cabinets.push(cabinet('Rear chamber', d.volumeL / 1000, dDisp, b, t, false, [driverHole]));
      if (d.horn.throatChamberL >= 0.05) cabinets.push(cabinet('Throat chamber', d.horn.throatChamberL / 1000, 0, b, t, false, []));
    }
    const view = compute(d).horn;
    if (view) {
      horn = { sections: P.hornPanels(view.table.map((r) => ({ x: r.xCm / 100, h: r.heightCm / 100 })), d.horn.widthCm / 100, t) };
      if (d.horn.panelsCm.trim() === '') warnings.push(`${name}: no panel lengths are entered, so the horn is cut as ${view.table.length - 1} straight sections along the ideal flare. Enter panel lengths on the box page to build it as simulated.`);
    }
  }

  // the driver and port have to fit on the baffle
  for (const c of cabinets) {
    const baffle = Math.min(c.geometry.wO, c.geometry.hO);
    const holes = c.cutouts.map((x) => x.diameterM);
    if (holes.length > 0 && Math.max(...holes) + 2 * HOLE_MARGIN > baffle) warnings.push(`${name}: the ${fl(Math.max(...holes), u)} hole does not fit the ${formatLength(c.geometry.wO * 1000, u)} x ${fl(c.geometry.hO, u)} baffle. Change the proportions or the volume.`);
    else if (holes.length === 2 && holes[0]! + holes[1]! + 3 * HOLE_MARGIN > Math.max(c.geometry.wO, c.geometry.hO)) warnings.push(`${name}: the driver and port holes do not both fit the baffle. Change the proportions.`);
  }

  const dname = d.driverClass < P.DRIVER_CLASSES.length ? `${driver.name} driver` : 'Custom driver';
  return { name, summary: summary(d), count: b.count, driver: dname, cabinets, horn, port, warnings };
}

export function computeBuild(p: Project): BuildView {
  const bands = p.bands.slice(0, p.nBands).map((b, k) => bandBuild(b, bandName(p.nBands, k), p.shop, p.units));
  const cutList: CutRow[] = [];
  const raw: { label: string; band: number; l: number; w: number }[] = [];
  const add = (band: BandBuild, part: string, l: number, w: number, qtyEach: number, note: string): void => {
    const qty = qtyEach * band.count;
    cutList.push({ band: band.name, part, l: mm(l), w: mm(w), qty, note: band.count > 1 ? `${note}${note ? '; ' : ''}${band.count} cabinets` : note });
    for (let i = 0; i < qty; i++) raw.push({ label: `${band.name} ${part}`, band: bands.indexOf(band), l, w });
  };
  for (const bb of bands) {
    for (const c of bb.cabinets) {
      for (const pn of c.panels) add(bb, bb.cabinets.length > 1 ? `${c.title}: ${pn.name}` : pn.name, pn.l, pn.w, pn.qty, pn.name.endsWith('frame') ? 'cut the window out' : '');
    }
    bb.horn?.sections.forEach((s, k) => {
      add(bb, `Horn ${k + 1}: top and bottom`, s.slant, s.width, 2, 'straight, across the horn width');
      add(bb, `Horn ${k + 1}: sides`, s.sideLen, s.sideH, 2, 'trapezoid, bounding box listed');
    });
  }

  const sheetL = p.shop.sheetLmm / 1000;
  const sheetW = p.shop.sheetWmm / 1000;
  const packed = P.packSheets(raw, sheetL, sheetW, p.shop.kerfMm / 1000);
  const pieces = raw.map((r, i) => ({ label: r.label, band: r.band, placement: packed.placements[i]! }));
  const warnings = bands.flatMap((b) => b.warnings);
  const oversize = [...new Set(pieces.filter((x) => x.placement.sheet < 0).map((x) => x.label))];
  for (const label of oversize) warnings.push(`${label} is larger than a ${formatLength(p.shop.sheetLmm, p.units)} x ${fl(p.shop.sheetWmm / 1000, p.units)} sheet: split it or choose a bigger sheet. It is left off the sheet count.`);
  const usedArea = pieces.filter((x) => x.placement.sheet >= 0).reduce((a, x) => a + x.placement.w * x.placement.h, 0);
  const waste = packed.sheets > 0 ? 1 - usedArea / (packed.sheets * sheetL * sheetW) : 0;

  const jointM = raw.reduce((a, r) => a + 2 * (r.l + r.w), 0) / 2;
  const bom: BomLine[] = [];
  if (packed.sheets > 0) bom.push({ item: `Sheet ${formatLength(p.shop.sheetLmm, p.units)} x ${formatLength(p.shop.sheetWmm, p.units)} ${p.units}, ${fl(p.shop.thicknessMm / 1000, p.units)}`, qty: packed.sheets, unit: 'sheets', note: `${(waste * 100).toFixed(0)} % waste with this layout` });
  const byDriver = new Map<string, number>();
  for (const bb of bands) byDriver.set(bb.driver, (byDriver.get(bb.driver) ?? 0) + bb.count);
  for (const [name, qty] of byDriver) bom.push({ item: name, qty, unit: 'pcs', note: '' });
  const tubes = bands.filter((b) => b.port);
  for (const bb of tubes) bom.push({ item: `Round port tube, ${fl(bb.port!.diameterM, p.units)} inside, ${fl(bb.port!.lengthM, p.units)} long`, qty: bb.count, unit: 'pcs', note: `${bb.name}; cut from longer stock` });
  const screws = Math.ceil(jointM / SCREW_SPACING - 1e-9);
  if (raw.length > 0) {
    bom.push({ item: 'Wood screws', qty: screws, unit: 'pcs', note: `one per ${fl(SCREW_SPACING, p.units)} of joint (${fj(jointM, p.units)})` });
    bom.push({ item: 'Wood glue', qty: Math.ceil(jointM / GLUE_PER_BOTTLE - 1e-9), unit: 'bottles', note: `one per ${fj(GLUE_PER_BOTTLE, p.units)} of joint` });
  }
  const cabs = bands.reduce((a, b) => a + b.count * Math.max(b.cabinets.length, 1), 0);
  if (cabs > 0) bom.push({ item: 'Speaker terminal or connector', qty: bands.reduce((a, b) => a + b.count, 0), unit: 'pcs', note: 'one per driver cabinet' });
  const lining = bands.reduce((a, b) => a + b.count * b.cabinets.reduce((s, c) => s + c.liningM2, 0), 0);
  if (lining > 0) bom.push({ item: 'Damping material (wall lining)', qty: Math.round(lining * 10) / 10, unit: 'm2', note: 'all walls except the baffle' });

  const notes = [
    'Butt joints, no rabbets or mitres: add allowance yourself if you cut them. Hole sizes are estimates: check the driver datasheet.',
    'The shelf layout is a heuristic: a good hand layout, or a nesting tool, often saves a sheet. Pieces lie long side along the sheet, so grain direction is not respected.',
    `Driver displacement is estimated at 0.15 Sd^1.5, a round port tube at its outer volume, a window brace as a ${fl(0.05, p.units)} frame: boxes are sized so the air left is the designed volume.`,
  ];
  return { bands, cutList, pieces, sheets: packed.sheets, waste, bom, warnings, notes };
}
