// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Cut list, sheet layout and bill of materials for a project. Pure functions; the Build page draws what comes back.
// Spec: "Cabinet, cut list and sheets". Metric only (millimetres on the page, metres inside).
import * as P from '@soundsystemdesigner/physics';
import { arrangementOf, coneDiameterM, slotLabel } from './loudspeaker';
import { compute, driverOf } from './model';
import { type Band, type Project, bandName, summary } from './system';
import { type Units, formatLength } from './units';

/** Joint spacing for screws, m. */
export const SCREW_SPACING = 0.15;
/** Length of joint one bottle of glue does, m. */
export const GLUE_PER_BOTTLE = 10;
/** Margin kept between a hole and the baffle edge or another hole, m. */
export const HOLE_MARGIN = 0.02;
/** Space between two holes on a speaker baffle, m. */
export const HOLE_GAP = 0.03;
/** Smallest interior side and depth of a speaker cabinet, m. */
const MIN_INTERIOR = 0.05;
const MIN_DEPTH = 0.1;
const ceilTenth = (v: number): number => Math.ceil(v * 10 - 1e-9) / 10;

export interface Cutout {
  kind: 'driver' | 'port';
  diameterM: number;
}

export interface Cabinet {
  title: string;
  /** Where the baffle holes sit (m from the top-left of the baffle), when the layout is not the automatic centred stack. */
  holes?: { kind: Cutout['kind']; diameterM: number; cx: number; cy: number }[];
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
  /** Every kind of driver in one cabinet set, with how many each cabinet holds. */
  drivers: { name: string; qty: number }[];
  cabinets: Cabinet[];
  horn: HornRows | null;
  /** Round port tube per cabinet, when the band has one. */
  port: { diameterM: number; lengthM: number } | null;
  /** Every port tube in one cabinet (a speaker may have one per ported driver); `port` is the first. */
  ports: { diameterM: number; lengthM: number }[];
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
  if (c.holes) return c.holes.map((h) => ({ kind: h.kind, cx: h.cx, cy: h.cy, r: h.diameterM / 2 }));
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

  const dname = d.driverClass < P.ALL_DRIVER_CLASSES.length ? `${driver.name} driver` : 'Custom driver';
  return { name, summary: summary(d), count: b.count, driver: dname, drivers: [{ name: dname, qty: 1 }], cabinets, horn, port, ports: port ? [port] : [], warnings };
}

/**
 * One cabinet for a loudspeaker: the baffle is the size asked for, the depth follows from the air its chambers hold plus
 * everything inside (drivers, port tubes, chamber partitions, braces). Drivers sit centred across the baffle in the
 * arrangement's order from the top, the whole stack a third of the way down; ports go under the lowest driver.
 */
export function speakerBuild(p: Project): BandBuild {
  const sp = p.speaker;
  const arr = arrangementOf(sp.arrangement);
  const name = 'Speaker';
  const u = p.units;
  const t = p.shop.thicknessMm / 1000;
  const warnings: string[] = [];
  const wI = Math.max(sp.baffleWidthCm / 100 - 2 * t, MIN_INTERIOR);
  const hI = Math.max(sp.baffleHeightCm / 100 - 2 * t, MIN_INTERIOR);
  const drivers: BandBuild['drivers'] = [];
  const ports: BandBuild['ports'] = [];
  const diameters: number[] = [];
  let air = 0;
  let disp = 0;
  let chambers = 0;
  arr.slots.forEach((spec, k) => {
    const s = sp.slots[k]!;
    const d = s.design;
    const driver = driverOf(d);
    const dname = d.driverClass < P.ALL_DRIVER_CLASSES.length ? `${driver.name} driver` : 'Custom driver';
    drivers.push({ name: dname, qty: spec.count });
    diameters.push(coneDiameterM(driver.sd));
    disp += spec.count * P.driverDisplacement(driver.sd);
    if (s.open) return;
    air += d.volumeL / 1000;
    chambers += sp.chambers === 'separate' ? spec.count : 1;
    if (d.type === 'bandpass' || d.type === 'horn') warnings.push(`${slotLabel(arr, k)}: a ${d.type} slot is built as a sealed chamber here; the cut list has no ${d.type === 'horn' ? 'horn' : 'divider'}. Use sealed or ported.`);
    if (d.type === 'ported') {
      for (let i = 0; i < spec.count; i++) {
        const lengthM = P.portLengthM(d.volumeL / spec.count / 1000, d.tuneHz, d.portDiameterCm / 100);
        if (!(lengthM > 0)) {
          warnings.push(`${slotLabel(arr, k)}: the port does not fit (its length comes out negative), so the cut list has no port tube. Fix the tuning, diameter or volume.`);
          break;
        }
        ports.push({ diameterM: d.portDiameterCm / 100, lengthM });
        disp += P.portDisplacement(d.portDiameterCm / 100, lengthM);
      }
    }
  });
  const partitions = Math.max(chambers - 1, 0);
  disp += partitions * wI * hI * t;
  let braces = 0;
  let nBraces = 0;
  let dI = MIN_DEPTH;
  for (let pass = 0; pass < 8; pass++) {
    dI = Math.max((air + disp + braces) / (wI * hI), MIN_DEPTH);
    nBraces = P.braceCount(sp.brace, dI);
    braces = nBraces * P.braceVolume(wI, hI, t);
  }
  const g: P.BoxGeometry = { wI, hI, dI, wO: wI + 2 * t, hO: hI + 2 * t, dO: dI + 2 * t, braces: nBraces, netM3: wI * hI * dI - disp - braces };
  const panels = P.boxPanels(g, t, false);
  if (partitions > 0) panels.push({ name: 'Chamber partition', l: wI, w: hI, qty: partitions });

  // the holes: drivers in layout order from the top, then the ports
  const stack: Cutout[] = [...arr.layout.map((k) => ({ kind: 'driver' as const, diameterM: diameters[k]! })), ...ports.map((x) => ({ kind: 'port' as const, diameterM: x.diameterM }))];
  const total = stack.reduce((a, h) => a + h.diameterM, 0) + HOLE_GAP * Math.max(stack.length - 1, 0);
  let y = Math.max(HOLE_MARGIN, (g.hO - total) / 3);
  const top = y;
  const holes = stack.map((h) => {
    const cy = y + h.diameterM / 2;
    y += h.diameterM + HOLE_GAP;
    return { ...h, cx: g.wO / 2, cy };
  });
  const widest = Math.max(...stack.map((h) => h.diameterM));
  if (widest + 2 * HOLE_MARGIN > g.wO) warnings.push(`${name}: the ${fl(widest, u)} hole does not fit the ${formatLength(g.wO * 1000, u)} wide baffle. Make the baffle wider or choose a smaller driver.`);
  if (top + total + HOLE_MARGIN > g.hO + 1e-9) warnings.push(`${name}: the drivers and ports do not all fit the ${fl(g.hO, u)} high baffle. Make it taller.`);
  const cab: Cabinet = { title: 'Cabinet', geometry: g, panels, cutouts: stack, holes, liningM2: ceilTenth(2 * (g.wI * g.hI + g.wI * g.dI + g.hI * g.dI) - g.wI * g.hI) };
  const sums = arr.slots.map((spec, k) => `${slotLabel(arr, k)}: ${driverOf(sp.slots[k]!.design).name}`);
  return { name, summary: `${arr.label}. ${sums.join(', ')}`, count: sp.quantity, driver: drivers[0]!.name, drivers, cabinets: [cab], horn: null, port: ports[0] ?? null, ports, warnings };
}

export function computeBuild(p: Project): BuildView {
  const bands = p.kind === 'speaker' ? [speakerBuild(p)] : p.bands.slice(0, p.nBands).map((b, k) => bandBuild(b, bandName(p.nBands, k), p.shop, p.units));
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
  for (const bb of bands) for (const dr of bb.drivers) byDriver.set(dr.name, (byDriver.get(dr.name) ?? 0) + bb.count * dr.qty);
  for (const [name, qty] of byDriver) bom.push({ item: name, qty, unit: 'pcs', note: '' });
  for (const bb of bands) {
    const tubes = new Map<string, { qty: number; port: (typeof bb.ports)[number] }>();
    for (const port of bb.ports) {
      const key = `${port.diameterM}/${port.lengthM}`;
      tubes.set(key, { qty: (tubes.get(key)?.qty ?? 0) + bb.count, port });
    }
    for (const { qty, port } of tubes.values()) bom.push({ item: `Round port tube, ${fl(port.diameterM, p.units)} inside, ${fl(port.lengthM, p.units)} long`, qty, unit: 'pcs', note: `${bb.name}; cut from longer stock` });
  }
  const screws = Math.ceil(jointM / SCREW_SPACING - 1e-9);
  if (raw.length > 0) {
    bom.push({ item: 'Wood screws', qty: screws, unit: 'pcs', note: `one per ${fl(SCREW_SPACING, p.units)} of joint (${fj(jointM, p.units)})` });
    bom.push({ item: 'Wood glue', qty: Math.ceil(jointM / GLUE_PER_BOTTLE - 1e-9), unit: 'bottles', note: `one per ${fj(GLUE_PER_BOTTLE, p.units)} of joint` });
  }
  const cabs = bands.reduce((a, b) => a + b.count * Math.max(b.cabinets.length, 1), 0);
  if (cabs > 0) bom.push({ item: 'Speaker terminal or connector', qty: bands.reduce((a, b) => a + b.count, 0), unit: 'pcs', note: p.kind === 'speaker' ? 'one per speaker' : 'one per driver cabinet' });
  const lining = bands.reduce((a, b) => a + b.count * b.cabinets.reduce((s, c) => s + c.liningM2, 0), 0);
  if (lining > 0) bom.push({ item: 'Damping material (wall lining)', qty: Math.round(lining * 10) / 10, unit: 'm2', note: 'all walls except the baffle' });

  const notes = [
    ...(p.kind === 'speaker' ? ['The crossover is not part of this list: the speaker is designed with an active crossover. A passive network, its parts and the wiring are yours to add.'] : []),
    'Butt joints, no rabbets or mitres: add allowance yourself if you cut them. Hole sizes are estimates: check the driver datasheet.',
    'The shelf layout is a heuristic: a good hand layout, or a nesting tool, often saves a sheet. Pieces lie long side along the sheet, so grain direction is not respected.',
    `Driver displacement is estimated at 0.15 Sd^1.5, a round port tube at its outer volume, a window brace as a ${fl(0.05, p.units)} frame: boxes are sized so the air left is the designed volume.`,
  ];
  return { bands, cutList, pieces, sheets: packed.sheets, waste, bom, warnings, notes };
}
