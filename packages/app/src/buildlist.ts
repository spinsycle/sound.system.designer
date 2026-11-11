// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Cut list, sheet layout and bill of materials for a project. Pure functions; the Build page draws what comes back.
// Spec: "Cabinet, cut list and sheets". Metric only (millimetres on the page, metres inside).
import * as P from '@soundsystemdesigner/physics';
import { type FrontRing, checkFront, ringOf } from './carfront';
import { computeCarElectric, computeCarSub, mountDepthCm } from './carsub';
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
  /** A wedge enclosure's geometry (the baffle drawing uses `geometry` with the sloping baffle as its height). */
  wedge?: P.WedgeGeometry;
  /** Outside width, height and depth for a caption, when `geometry` describes the baffle. */
  outside?: [number, number, number];
  /** Horizontal chamber partitions of a speaker: distance down from the top of the interior to the shelf, m. */
  shelves?: number[];
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
  /** Flat parts that are not panels of a box (adapter rings), listed by their bounding rectangle, in metres. */
  parts?: { part: string; l: number; w: number; qty: number; note: string }[];
  /** Adapter rings to draw. */
  rings?: FrontRing[];
  /** Car install: whether the box fits its vehicle space (outside size and the space, m). */
  fit?: { fits: boolean; outside: [number, number, number]; space: [number, number, number] | null };
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
  arr.slots.forEach((spec, k) => {
    const s = sp.slots[k]!;
    const d = s.design;
    const driver = driverOf(d);
    const dname = d.driverClass < P.ALL_DRIVER_CLASSES.length ? `${driver.name} driver` : 'Custom driver';
    drivers.push({ name: dname, qty: spec.count });
    diameters.push(coneDiameterM(driver.sd));
    disp += spec.count * P.driverDisplacement(driver.sd);
    // an open-baffle driver has no chamber, and a tweeter has its sealed back built in: neither adds air or a partition
    if (s.open || spec.role === 'tweeter') return;
    air += d.volumeL / 1000;
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
  // chambers in baffle order from the top: a shared slot is one chamber (where it first appears), separate ones one per driver
  const chamberAir: number[] = [];
  const seen = new Set<number>();
  for (const k of arr.layout) {
    const s = sp.slots[k]!;
    const spec = arr.slots[k]!;
    if (s.open || spec.role === 'tweeter') continue;
    if (sp.chambers === 'separate') chamberAir.push(s.design.volumeL / spec.count);
    else if (!seen.has(k)) {
      seen.add(k);
      chamberAir.push(s.design.volumeL);
    }
  }
  const partitions = Math.max(chamberAir.length - 1, 0);
  let braces = 0;
  let nBraces = 0;
  let dI = MIN_DEPTH;
  for (let pass = 0; pass < 8; pass++) {
    // the shelves are wI x dI x t each, so their wood grows with the depth: solve for it directly
    dI = Math.max((air + disp + braces) / (wI * Math.max(hI - partitions * t, MIN_INTERIOR)), MIN_DEPTH);
    nBraces = P.braceCount(sp.brace, dI);
    braces = nBraces * P.braceVolume(wI, hI, t);
  }
  const g: P.BoxGeometry = { wI, hI, dI, wO: wI + 2 * t, hO: hI + 2 * t, dO: dI + 2 * t, braces: nBraces, netM3: wI * hI * dI - disp - braces - partitions * wI * dI * t };
  const panels = P.boxPanels(g, t, false);
  if (partitions > 0) panels.push({ name: 'Chamber partition', l: wI, w: dI, qty: partitions });
  // each shelf sits where the air above it has run out: the interior is shared out in proportion to the chambers' air
  const totalAir = chamberAir.reduce((a, b) => a + b, 0);
  let running = 0;
  const shelves = chamberAir.slice(0, -1).map((a) => {
    running += a;
    return (hI * running) / totalAir;
  });

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
  const cab: Cabinet = { title: 'Cabinet', geometry: g, panels, cutouts: stack, holes, shelves, liningM2: ceilTenth(2 * (g.wI * g.hI + g.wI * g.dI + g.hI * g.dI) - g.wI * g.hI) };
  const sums = arr.slots.map((spec, k) => `${slotLabel(arr, k)}: ${driverOf(sp.slots[k]!.design).name}`);
  return { name, summary: `${arr.label}. ${sums.join(', ')}`, count: sp.quantity, driver: drivers[0]!.name, drivers, cabinets: [cab], horn: null, port: ports[0] ?? null, ports, warnings };
}

/**
 * Drivers in a row across the baffle, centred, with the ports in the same row after them when the row fits the width and in a row
 * under them when it does not; positions in metres from the top-left of the baffle.
 */
function rowHoles(drivers: number[], ports: number[], wO: number, hO: number): { kind: Cutout['kind']; diameterM: number; cx: number; cy: number }[] {
  const rowWidth = (row: number[]): number => row.reduce((a, b) => a + b, 0) + HOLE_GAP * Math.max(row.length - 1, 0);
  const rowHeight = (row: number[]): number => (row.length ? Math.max(...row) : 0);
  const oneRow = ports.length > 0 && rowWidth([...drivers, ...ports]) + 2 * HOLE_MARGIN <= wO;
  const rows: { kind: Cutout['kind']; dias: number[] }[] = oneRow
    ? [{ kind: 'driver', dias: [...drivers, ...ports] }]
    : [{ kind: 'driver', dias: drivers }, ...(ports.length ? [{ kind: 'port' as const, dias: ports }] : [])];
  const total = rows.reduce((a, r) => a + rowHeight(r.dias), 0) + HOLE_GAP * (rows.length - 1);
  let y = Math.max(HOLE_MARGIN, (hO - total) / 2);
  const out: { kind: Cutout['kind']; diameterM: number; cx: number; cy: number }[] = [];
  for (const row of rows) {
    let x = Math.max(HOLE_MARGIN, (wO - rowWidth(row.dias)) / 2);
    const h = rowHeight(row.dias);
    row.dias.forEach((dia, k) => {
      out.push({ kind: oneRow ? (k < drivers.length ? 'driver' : 'port') : row.kind, diameterM: dia, cx: x + dia / 2, cy: y + h / 2 });
      x += dia + HOLE_GAP;
    });
    y += h + HOLE_GAP;
  }
  return out;
}

/**
 * The car subwoofer enclosure: sealed or ported, one box shared by all the subs (each sees its share of the air, each ported
 * sub has its own port), rectangular or a wedge, checked against the space it has to fit. A band-pass install is built the
 * way a PA band-pass is, one box per sub.
 */
export function carBuild(p: Project): BandBuild {
  const c = p.car;
  const d = c.design;
  const name = 'Subwoofer';
  const u = p.units;
  const t = p.shop.thicknessMm / 1000;
  const driver = driverOf(d);
  const dname = d.driverClass < P.ALL_DRIVER_CLASSES.length ? `${driver.name} driver` : 'Custom driver';
  if (d.type === 'bandpass') {
    const band: Band = {
      design: { ...d, volumeL: d.volumeL / c.count, frontVolumeL: d.frontVolumeL / c.count },
      count: c.count,
      series: c.series,
      ampPowerW: c.ampPowerW,
      ampLoadOhm: c.ampLoadOhm,
      ampMinLoadOhm: c.ampMinLoadOhm,
      build: c.build,
      trimDb: 0,
      delayMs: 0,
      invert: false,
      solo: false,
      mute: false,
    };
    const bb = bandBuild(band, name, p.shop, u);
    if (c.shape === 'wedge') bb.warnings.push(`${name}: a band-pass box is built rectangular; the wedge shape is for sealed and ported boxes.`);
    return bb;
  }
  const warnings: string[] = [];
  if (d.type === 'horn') warnings.push(`${name}: a horn is built as a sealed box here. Use sealed, ported or band-pass.`);
  const ports: BandBuild['ports'] = [];
  let disp = c.count * P.driverDisplacement(driver.sd);
  if (d.type === 'ported') {
    for (let i = 0; i < c.count; i++) {
      const lengthM = P.portLengthM(d.volumeL / c.count / 1000, d.tuneHz, d.portDiameterCm / 100);
      if (!(lengthM > 0)) {
        warnings.push(`${name}: the port does not fit (its length comes out negative), so the cut list has no port tube. Fix the tuning, diameter or volume.`);
        break;
      }
      ports.push({ diameterM: d.portDiameterCm / 100, lengthM });
      disp += P.portDisplacement(d.portDiameterCm / 100, lengthM);
    }
  }
  const vNet = d.volumeL / 1000;
  const o = c.build;
  const wedge = c.shape === 'wedge';
  const driverDia = coneDiameterM(driver.sd);
  const driverDias = Array.from({ length: c.count }, () => driverDia);
  const portDias = ports.map((x) => x.diameterM);
  let g: P.BoxGeometry;
  let panels: P.Panel[];
  let cabWedge: P.WedgeGeometry | undefined;
  let baffleH: number;
  let outside: [number, number, number];
  let lining: number;
  if (wedge) {
    const w = P.solveWedge(vNet, disp, o.rw, o.rh, o.rd, c.taper, t);
    cabWedge = w;
    g = { wI: w.wI, hI: w.slantO - 2 * t, dI: w.dBottomI, wO: w.wO, hO: w.slantO, dO: w.dBottomI + 2 * t, braces: 0, netM3: w.netM3 };
    panels = P.wedgePanels(w);
    baffleH = w.slantO;
    outside = [w.wO, w.hO, w.dBottomI + 2 * t];
    lining = ceilTenth(w.wI * w.hI + w.wI * w.dBottomI + w.wI * w.dTopI + w.hI * (w.dBottomI + w.dTopI));
  } else {
    g = P.solveBox(vNet, disp, o.rw, o.rh, o.rd, t, o.brace, false);
    panels = P.boxPanels(g, t, false);
    baffleH = g.hO;
    outside = [g.wO, g.hO, g.dO];
    lining = ceilTenth(2 * (g.wI * g.hI + g.wI * g.dI + g.hI * g.dI) - g.wI * g.hI);
  }
  const holes = rowHoles(driverDias, portDias, g.wO, baffleH);
  const cutouts: Cutout[] = holes.map((h) => ({ kind: h.kind, diameterM: h.diameterM }));
  // the holes must stay inside the baffle with a margin: the placement starts at the margin when a row is wider than the baffle
  const left = Math.min(...holes.map((h) => h.cx - h.diameterM / 2));
  const right = Math.max(...holes.map((h) => h.cx + h.diameterM / 2));
  const topEdge = Math.min(...holes.map((h) => h.cy - h.diameterM / 2));
  const bottomEdge = Math.max(...holes.map((h) => h.cy + h.diameterM / 2));
  if (left < HOLE_MARGIN - 1e-9 || right > g.wO - HOLE_MARGIN + 1e-9) warnings.push(`${name}: the holes in a row do not fit the ${formatLength(g.wO * 1000, u)} wide baffle. Make the box wider or use fewer or smaller subs.`);
  if (topEdge < HOLE_MARGIN - 1e-9 || bottomEdge > baffleH - HOLE_MARGIN + 1e-9) warnings.push(`${name}: the sub${ports.length ? 's and ports' : 's'} do not fit the ${fl(baffleH, u)} high baffle. Make the box taller${wedge ? ' or less sloped' : ''}.`);
  // the driver needs depth behind the baffle: the shallowest part of the box is the top of a wedge
  const need = mountDepthCm(driver.name) / 100;
  const depth = cabWedge ? Math.min(cabWedge.dBottomI, cabWedge.dTopI) : g.dI;
  if (need > 0 && depth < need) warnings.push(`${name}: the box is ${fl(depth, u)} deep inside and this driver needs about ${fl(need, u)} behind the baffle. Make it deeper or choose a shallow-mount sub.`);

  // a port runs along the depth of the box: one longer than the inside is deep has to be folded
  const longest = ports.length ? Math.max(...ports.map((x) => x.lengthM)) : 0;
  const portRoom = cabWedge ? cabWedge.dTopI : g.dI;
  if (longest > portRoom + 1e-9) warnings.push(`${name}: the ports are ${fl(longest, u)} long and the box is ${fl(portRoom, u)} deep inside. Fold them (a bent tube or a slot port), use a narrower port, tune higher or add air.`);
  const sp = c.space;
  const limited = sp.id !== 'none';
  const space: [number, number, number] | null = limited ? [sp.wCm / 100, sp.hCm / 100, sp.dCm / 100] : null;
  const fits = !space || (outside[0] <= space[0] + 1e-9 && outside[1] <= space[1] + 1e-9 && outside[2] <= space[2] + 1e-9);
  if (space && !fits) warnings.push(`${name}: the box is ${formatLength(outside[0] * 1000, u)} x ${formatLength(outside[1] * 1000, u)} x ${fl(outside[2], u)} outside and the space is ${formatLength(space[0] * 1000, u)} x ${formatLength(space[1] * 1000, u)} x ${fl(space[2], u)}. Use Fit to the space, a smaller box, or a wedge.`);

  // the front speakers: the adapter rings they sit on, and what the fit check says
  const fr = c.front;
  const ring = fr.enabled ? ringOf(fr) : null;
  const frontDrivers: { name: string; qty: number }[] = [];
  const parts: NonNullable<BandBuild['parts']> = [];
  if (fr.enabled) {
    warnings.push(...checkFront(fr).warnings);
    const wName = P.ALL_DRIVER_CLASSES[fr.wooferClass]!.name;
    frontDrivers.push({ name: `${wName} (front, one each side)`, qty: 2 });
    if (fr.type === 'component') frontDrivers.push({ name: `${P.ALL_DRIVER_CLASSES[fr.tweeterClass]!.name} tweeter (front, one each side)`, qty: 2 });
    if (ring) parts.push({ part: ring.title, l: ring.outer.wCm / 100, w: ring.outer.hCm / 100, qty: 2, note: `${fmtCm(ring.thicknessCm)} cm thick; cut ${ring.outer.kind === 'round' ? 'a round' : 'an oval'} ring: the size listed is the outside's bounding rectangle, the cut-out is ${ring.inner.kind === 'round' ? `${fmtCm(ring.inner.wCm)} cm round` : `${fmtCm(ring.inner.wCm)} x ${fmtCm(ring.inner.hCm)} cm oval`}` });
  }
  const cab: Cabinet = { title: wedge ? 'Wedge box' : 'Box', geometry: g, panels, cutouts, holes, wedge: cabWedge, outside, liningM2: lining };
  const sum = `${c.count > 1 ? `${c.count} x ` : ''}${driver.name}, ${fmtL(d.volumeL)} L ${d.type}${wedge ? ' wedge' : ''}`;
  return { name, summary: sum, count: 1, driver: dname, drivers: [{ name: dname, qty: c.count }, ...frontDrivers], cabinets: [cab], horn: null, port: ports[0] ?? null, ports, warnings, fit: { fits, outside, space }, parts, rings: ring ? [ring] : [] };
}

const fmtCm = (v: number): string => (Math.round(v * 10) / 10).toString();
const fmtL = (v: number): string => (v < 10 ? v.toFixed(1) : v.toFixed(0));

export function computeBuild(p: Project): BuildView {
  const bands = p.kind === 'speaker' ? [speakerBuild(p)] : p.kind === 'car' ? [carBuild(p)] : p.bands.slice(0, p.nBands).map((b, k) => bandBuild(b, bandName(p.nBands, k), p.shop, p.units));
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
    for (const pt of bb.parts ?? []) add(bb, pt.part, pt.l, pt.w, pt.qty, pt.note);
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
  if (cabs > 0) bom.push({ item: 'Speaker terminal or connector', qty: bands.reduce((a, b) => a + b.count, 0), unit: 'pcs', note: p.kind === 'speaker' ? 'one per speaker' : p.kind === 'car' ? 'one per install' : 'one per driver cabinet' });
  const lining = bands.reduce((a, b) => a + b.count * b.cabinets.reduce((s, c) => s + c.liningM2, 0), 0);
  if (p.kind === 'car') {
    // the 12 V parts, sized by the electrical check: a power cable and an equal ground, the fuse and its holder at the battery
    const e = computeCarElectric(p.car, computeCarSub(p.car).limits);
    bom.push({ item: `Power cable, ${p.car.cableAwg} AWG`, qty: Math.round(p.car.cableM * 10) / 10, unit: 'm', note: 'battery to amplifier, through the fuse' });
    bom.push({ item: `Ground cable, ${p.car.cableAwg} AWG`, qty: Math.round(p.car.cableM * 10) / 10, unit: 'm', note: 'the same gauge and length as the power cable (the model counts the return the same)' });
    bom.push({ item: `Fuse and fuse holder, ${e.fuseA} A`, qty: 1, unit: 'pcs', note: 'within about 45 cm of the battery' });
  }
  if (lining > 0) bom.push({ item: 'Damping material (wall lining)', qty: Math.round(lining * 10) / 10, unit: 'm2', note: 'all walls except the baffle' });

  const notes = [
    ...(p.kind === 'car' ? ['The amplifier, ring terminals and the remote lead are not in this list; the cable and fuse follow the 12 V check. A wedge is cut with plain butt joints: expect to bevel the baffle edges and the sides.'] : []),
    ...(p.kind === 'speaker' ? ['The crossover is not part of this list: the speaker is designed with an active crossover. A passive network, its parts and the wiring are yours to add.'] : []),
    'Butt joints, no rabbets or mitres: add allowance yourself if you cut them. Hole sizes are estimates: check the driver datasheet.',
    'The shelf layout is a heuristic: a good hand layout, or a nesting tool, often saves a sheet. Pieces lie long side along the sheet, so grain direction is not respected.',
    `Driver displacement is estimated at 0.15 Sd^1.5, a round port tube at its outer volume, a window brace as a ${fl(0.05, p.units)} frame: boxes are sized so the air left is the designed volume.`,
  ];
  return { bands, cutList, pieces, sheets: packed.sheets, waste, bom, warnings, notes };
}
