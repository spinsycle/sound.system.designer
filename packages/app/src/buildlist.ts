// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Cut list, sheet layout and bill of materials for a project. Pure functions; the Build page draws what comes back.
// Spec: "Cabinet, cut list and sheets". Metric only (millimetres on the page, metres inside).
import * as P from '@soundsystemdesigner/physics';
import { type FrontRing, checkFront, ringOf } from './carfront';
import { computeCarElectric, computeCarSub, mountDepthCm } from './carsub';
import { arrangementOf, coneDiameterM, slotLabel } from './loudspeaker';
import { type Design, compute, driverOf, flareOf, portLengthOf, portOpeningM, prOf, tlGeometryOf, tlLineVolumeM3 } from './model';
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
  /** Round: the hole's diameter. Rectangular: the longer side, so every fit check can treat it as a bounding size. */
  diameterM: number;
  /** A rectangular port hole (shape 'rect') has these sides; absent means round. */
  shape?: 'round' | 'rect';
  wM?: number;
  hM?: number;
  /** A driver mounted the other way from the cabinet's setting (push-pull side by side): true = motor outside. */
  magnetOut?: boolean;
}

/** A positioned hole on a baffle (m from the top-left). */
export interface Hole extends Cutout {
  cx: number;
  cy: number;
}

/** A port as built: round tube, or rectangular opening built from sheet. `diameterM` is the equivalent diameter for a rectangle. */
export interface PortBuild {
  diameterM: number;
  lengthM: number;
  shape?: 'round' | 'rect';
  wM?: number;
  hM?: number;
}

export interface Cabinet {
  title: string;
  /** Where the baffle holes sit (m from the top-left of the baffle), when the layout is not the automatic centred stack. */
  holes?: Hole[];
  /** Push-pull: the holes of the drivers on the back wall, positions as seen from behind. */
  rearHoles?: Hole[];
  /** The baffle is the bottom panel and the drivers fire at the floor. */
  facing?: 'front' | 'down';
  /** Driver motors stick out through the baffle (the cone stays inside). */
  magnetOut?: boolean;
  /** Gap under a cabinet whose baffle faces down, m. */
  clearanceM?: number;
  /** A folded horn's layout: the legs, the septa (also in `panels`) and the box. */
  fold?: P.FoldLayout;
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
  port: PortBuild | null;
  /** Every port tube in one cabinet (a speaker may have one per ported driver); `port` is the first. */
  ports: PortBuild[];
  /** Flat parts that are not panels of a box (adapter rings), listed by their bounding rectangle, in metres. */
  parts?: { part: string; l: number; w: number; qty: number; note: string }[];
  /** Adapter rings to draw. */
  rings?: FrontRing[];
  /** Car install: whether the box fits its vehicle space (outside size and the space, m). */
  fit?: { fits: boolean; outside: [number, number, number]; space: [number, number, number] | null };
  /** Loose fibre stuffing for a transmission line, kg per cabinet set. */
  stuffingKg?: number;
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

/** The cutout a design's port makes in a baffle. */
const portCutout = (d: Design): Cutout => {
  if (d.portShape !== 'rect') return { kind: 'port', diameterM: d.portDiameterCm / 100 };
  const o = portOpeningM(d);
  return { kind: 'port', shape: 'rect', wM: o.wM, hM: o.hM, diameterM: Math.max(o.wM, o.hM) };
};
/** A port of the design at a length. */
const portBuilt = (d: Design, lengthM: number): PortBuild => {
  const c = portCutout(d);
  return c.shape === 'rect' ? { diameterM: Math.sqrt((4 * c.wM! * c.hM!) / Math.PI), lengthM, shape: 'rect', wM: c.wM, hM: c.hM } : { diameterM: c.diameterM, lengthM };
};
const portCut = (x: PortBuild): Cutout => (x.shape === 'rect' ? { kind: 'port', shape: 'rect', wM: x.wM, hM: x.hM, diameterM: Math.max(x.wM!, x.hM!) } : { kind: 'port', diameterM: x.diameterM });
/** Air displaced by a port: a round tube at its outer volume, a rectangular port at its outer box (walls of the box material). */
const portDispOf = (x: PortBuild, wallM: number): number => (x.shape === 'rect' ? P.rectPortDisplacement(x.wM!, x.hM!, x.lengthM, wallM) : P.portDisplacement(x.diameterM, x.lengthM));
/** The sheet pieces of rectangular ports (inside w x h, length l): top and bottom, and two sides. */
function rectPortParts(ports: PortBuild[], wallM: number): NonNullable<BandBuild['parts']> {
  const out: NonNullable<BandBuild['parts']> = [];
  const groups = new Map<string, { x: PortBuild; n: number }>();
  for (const x of ports) if (x.shape === 'rect') {
    const k = `${x.wM}/${x.hM}/${x.lengthM}`;
    groups.set(k, { x, n: (groups.get(k)?.n ?? 0) + 1 });
  }
  for (const { x, n } of groups.values()) {
    out.push({ part: 'Rectangular port: top and bottom', l: x.lengthM, w: x.wM! + 2 * wallM, qty: 2 * n, note: `inside ${mm(x.wM!)} x ${mm(x.hM!)} mm, ${mm(x.lengthM)} mm long` });
    out.push({ part: 'Rectangular port: sides', l: x.lengthM, w: x.hM!, qty: 2 * n, note: 'between the top and bottom pieces' });
  }
  return out;
}
/** Warnings when the placed holes run outside the baffle or each other. */
function fitHoles(name: string, holes: Hole[], wO: number, hO: number, u: Units, warnings: string[]): void {
  if (holes.length === 0) return;
  const ext = holes.map((h) => ({ ...sizeOf(h), cx: h.cx, cy: h.cy }));
  const left = Math.min(...ext.map((h) => h.cx - h.w / 2));
  const right = Math.max(...ext.map((h) => h.cx + h.w / 2));
  const top = Math.min(...ext.map((h) => h.cy - h.h / 2));
  const bottom = Math.max(...ext.map((h) => h.cy + h.h / 2));
  if (left < HOLE_MARGIN - 1e-9 || right > wO - HOLE_MARGIN + 1e-9) warnings.push(`${name}: the holes do not fit the ${formatLength(wO * 1000, u)} wide baffle. Use fewer columns, a wider box or smaller parts.`);
  if (top < HOLE_MARGIN - 1e-9 || bottom > hO - HOLE_MARGIN + 1e-9) warnings.push(`${name}: the holes do not fit the ${fl(hO, u)} high baffle. Use fewer rows, a taller box or smaller parts.`);
}
/** Drivers firing at the floor need room to breathe: about a quarter of the cone diameter, and the port the same. */
function floorWarning(name: string, l: Design['layout'], widest: number, u: Units, warnings: string[]): void {
  if (l.facing === 'down' && l.clearanceCm / 100 < widest / 4 - 1e-9) warnings.push(`${name}: the drivers fire down with ${fl(l.clearanceCm / 100, u)} of floor clearance; leave at least ${fl(widest / 4, u)} (a quarter of the widest hole) or the output chokes.`);
}
/** Front and back counts of a push-pull cabinet; an odd or single driver is not push-pull. */
const pushPullSplit = (n: number, on: boolean): { front: number; back: number } => (on && n >= 2 ? { front: Math.ceil(n / 2), back: Math.floor(n / 2) } : { front: n, back: 0 });

/** Where a cabinet's baffle holes sit, to scale: centred across, stacked and centred down, y from the top edge (m). */
export interface HolePos {
  kind: Cutout['kind'];
  cx: number;
  cy: number;
  /** Bounding radius: half the diameter, or half the longer side of a rectangle. */
  r: number;
  shape: 'round' | 'rect';
  /** Per-driver motor position when it differs from the cabinet's; absent follows the cabinet. */
  magnetOut?: boolean;
  /** Width and height of the hole (both the diameter when round), m. */
  w: number;
  h: number;
}

const holePos = (h: Cutout, cx: number, cy: number): HolePos => ({ kind: h.kind, cx, cy, r: h.diameterM / 2, shape: h.shape === 'rect' ? 'rect' : 'round', w: h.shape === 'rect' ? h.wM! : h.diameterM, h: h.shape === 'rect' ? h.hM! : h.diameterM, ...(h.magnetOut === undefined ? {} : { magnetOut: h.magnetOut }) });

export function holePositions(c: Cabinet, rear = false): HolePos[] {
  if (rear) return (c.rearHoles ?? []).map((h) => holePos(h, h.cx, h.cy));
  if (c.holes) return c.holes.map((h) => holePos(h, h.cx, h.cy));
  const gap = 0.02;
  const total = c.cutouts.reduce((a, h) => a + h.diameterM, 0) + gap * Math.max(c.cutouts.length - 1, 0);
  let y = (c.geometry.hO - total) / 2;
  return c.cutouts.map((h) => {
    const cy = y + h.diameterM / 2;
    y += h.diameterM + gap;
    return holePos(h, c.geometry.wO / 2, cy);
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

/**
 * The box of a folded horn (spec v0.14): six walls, one septum panel per fold, a rectangular mouth on the front when the leg
 * count is even, and the throat opening at the top front where the throat chamber joins.
 */
function foldedCabinet(f: P.FoldLayout, throatM2: number, t: number): Cabinet {
  const g: P.BoxGeometry = { wI: f.wI, hI: f.hI, dI: f.dI, wO: f.wO, hO: f.hO, dO: f.dO, braces: 0, netM3: 0 };
  const panels = P.boxPanels(g, t, false);
  // a sloped septum is cut to its length along the slope; the angle is in the name (positive: lower at the back)
  f.septaSlant.forEach((len, k) => panels.push({ name: f.style === 'tapered' ? `Fold septum ${k + 1} (sloped ${(Math.abs(f.septaAngle[k]!) * 180 / Math.PI).toFixed(1)} deg ${f.septaAngle[k]! >= 0 ? 'down to the back' : 'up to the back'})` : `Fold septum ${k + 1}`, l: len, w: f.wI, qty: 1 }));
  g.netM3 = f.wI * f.hI * f.dI - f.septaSlant.reduce((a, l) => a + f.wI * l * t, 0);
  const rect = (w: number, h: number): Cutout => ({ kind: 'port', shape: 'rect', wM: w, hM: h, diameterM: Math.max(w, h) });
  const throat = rect(f.wI, Math.min(throatM2 / f.wI, f.heightsFront[0]!));
  const holes: Hole[] = [{ ...throat, cx: f.wO / 2, cy: t + f.heightsFront[0]! / 2 }];
  const cutouts: Cutout[] = [throat];
  if (f.mouthAtFront) {
    const last = f.heightsFront[f.heightsFront.length - 1]!;
    const mouth = rect(f.wI, last);
    holes.push({ ...mouth, cx: f.wO / 2, cy: f.hO - t - last / 2 });
    cutouts.push(mouth);
  }
  const septaArea = f.septaSlant.reduce((a, l) => a + 2 * f.wI * l, 0);
  return { title: 'Folded horn', geometry: g, panels, cutouts, holes, fold: f, liningM2: ceilTenth(2 * (f.wI * f.hI + f.wI * f.dI + f.hI * f.dI) - f.wI * f.hI + septaArea) };
}

/** The Cookbook's interior height : width : depth ratios (p. 113): Thiele's 2.6 : 1.6 : 1, then 2 : 1.44 : 1 and 1.59 : 1.26 : 1. */
export const BOOK_PROPORTIONS: readonly { label: string; rw: number; rh: number; rd: number }[] = [
  { label: '2.6 : 1.6 : 1 (Thiele)', rw: 1.6, rh: 2.6, rd: 1 },
  { label: '2 : 1.44 : 1', rw: 1.44, rh: 2, rd: 1 },
  { label: '1.59 : 1.26 : 1', rw: 1.26, rh: 1.59, rd: 1 },
];

/** Equal interior dimensions share one standing wave: the Cookbook's ratios exist to avoid that. Returns the warning, or null. */
export function proportionWarning(name: string, g: { wI: number; hI: number; dI: number }): string | null {
  const dims = [g.wI, g.hI, g.dI];
  const pairs: [number, number, string][] = [[0, 1, 'width and height'], [0, 2, 'width and depth'], [1, 2, 'height and depth']];
  for (const [a, b, label] of pairs) {
    if (Math.abs(dims[a]! - dims[b]!) <= 0.05 * Math.max(dims[a]!, dims[b]!)) return `${name}: the ${label} are within 5 % of each other, so they share a standing wave. The Cookbook (p. 113) suggests height : width : depth of 2.6 : 1.6 : 1, 2 : 1.44 : 1 or 1.59 : 1.26 : 1; fibre fill matters more than the shape, but avoid equal sides.`;
  }
  return null;
}

/** Axial standing-wave frequencies of the interior, Hz (c / 2L): standard room-mode physics, not from the Cookbook. */
export const axialModesHz = (g: { wI: number; hI: number; dI: number }): { w: number; h: number; d: number } => ({ w: P.C / (2 * g.wI), h: P.C / (2 * g.hI), d: P.C / (2 * g.dI) });

function bandBuild(b: Band, name: string, shop: Project['shop'], u: Units): BandBuild {
  const d = b.design;
  const t = shop.thicknessMm / 1000;
  const driver = driverOf(d);
  const lay = d.layout;
  const warnings: string[] = [];
  // several drivers can share a cabinet only for sealed and ported boxes; each keeps its own design volume of air
  const shared = d.type === 'sealed' || d.type === 'ported';
  const n = shared ? b.perBox : 1;
  if (!shared && b.perBox > 1) warnings.push(`${name}: ${b.perBox} drivers per box is for sealed and ported boxes; this ${d.type} box is built with one driver per cabinet.`);
  const driverHole: Cutout = { kind: 'driver', diameterM: 2 * Math.sqrt(driver.sd / Math.PI) };
  // push-pull side by side: the second half of the drivers is mounted the other way round
  const side = lay.pushPull && lay.pushPullStyle === 'side' && n >= 2;
  const nOut = side ? (lay.mount === 'out' ? Math.ceil(n / 2) : Math.floor(n / 2)) : lay.mount === 'out' ? n : 0;
  const dDisp = (n - nOut) * P.driverDisplacementMount(driver.sd, false) + nOut * P.driverDisplacementMount(driver.sd, true);
  const cabinets: Cabinet[] = [];
  let horn: HornRows | null = null;
  const ports: PortBuild[] = [];
  const extraDrivers: { name: string; qty: number }[] = [];
  let stuffing = 0;

  const portFor = (chamberL: number): PortBuild | null => {
    const lengthM = portLengthOf(d, chamberL);
    if (!(lengthM > 0)) {
      warnings.push(`${name}: the port does not fit (its length comes out negative), so the cut list has no port tube. Fix it on the box page.`);
      return null;
    }
    return portBuilt(d, lengthM);
  };
  const portsFor = (chamberL: number): PortBuild[] => {
    const one = portFor(chamberL);
    return one ? Array.from({ length: d.type === 'ported' ? n : 1 }, () => one) : [];
  };

  if (d.type === 'sealed') {
    cabinets.push(cabinet('Box', (n * d.volumeL) / 1000, dDisp, b, t, false, Array.from({ length: n }, () => driverHole)));
  } else if (d.type === 'ported') {
    ports.push(...portsFor(d.volumeL));
    const disp = dDisp + ports.reduce((a, x) => a + portDispOf(x, t), 0);
    cabinets.push(cabinet('Box', (n * d.volumeL) / 1000, disp, b, t, false, [...Array.from({ length: n }, () => driverHole), ...ports.map(portCut)]));
  } else if (d.type === 'passive') {
    const pr = prOf(d);
    const prHole: Cutout = { kind: 'driver', diameterM: 2 * Math.sqrt(pr.radiator.sdp / Math.PI) };
    const disp = dDisp + P.driverDisplacementMount(pr.radiator.sdp, false);
    cabinets.push(cabinet('Passive-radiator box', d.volumeL / 1000, disp, b, t, false, [driverHole, prHole]));
    extraDrivers.push({ name: `Passive radiator, ${fmtCm(prHole.diameterM * 100)} cm cone`, qty: 1 });
    warnings.push(pr.addedKg >= 0 ? `${name}: add ${Math.round(pr.addedKg * 1000)} g to the passive radiator (clay, lead or a metal weight stuck to the centre) to tune the box to ${Math.round(d.tuneHz)} Hz; check the tuning by measuring the impedance dip and adjust.` : `${name}: the passive radiator alone is heavier than ${Math.round(d.tuneHz)} Hz needs (it tunes to ${Math.round(pr.fbHz)} Hz). Use a lighter or more compliant radiator.`);
    warnings.push(`${name}: the radiator can sit on the baffle beside the driver or on another wall; the Cookbook finds its position and mutual coupling negligible. It needs room to travel about twice the driver's excursion.`);
  } else if (d.type === 'tline') {
    const geo = tlGeometryOf(d);
    const exitD = 2 * Math.sqrt(geo.exitM2 / Math.PI);
    const vol = tlLineVolumeM3(geo) + geo.chamberM3;
    cabinets.push(cabinet('Transmission-line box', vol, dDisp, b, t, true, [driverHole, { kind: 'port', diameterM: exitD }]));
    const lineArea = (geo.startM2 + geo.exitM2) / 2;
    warnings.push(`${name}: the line is built as one box with a septum. The path from the driver to the exit must be ${fl(geo.lengthM, u)} long with the area tapering from ${Math.round(geo.startM2 * 1e4)} to ${Math.round(geo.exitM2 * 1e4)} cm2 (mean ${Math.round(lineArea * 1e4)} cm2): place the septum and angle it so the path runs the full length, and leave the exit opening on the baffle. The cut list does not shape the taper.`);
    const kg = P.densityKgM3(d.tl.densityLb) * tlLineVolumeM3(geo) * geo.stuffedShare;
    stuffing += kg;
  } else if (d.type === 'bandpass') {
    ports.push(...portsFor(d.frontVolumeL));
    const disp = dDisp + ports.reduce((a, x) => a + portDispOf(x, t), 0);
    cabinets.push(cabinet('Band-pass box', (d.volumeL + d.frontVolumeL) / 1000, disp, b, t, true, [driverHole, ...ports.map(portCut)]));
    warnings.push(`${name}: the band-pass box is one cabinet; the divider belongs ${((d.volumeL / (d.volumeL + d.frontVolumeL)) * 100).toFixed(0)} % of the interior depth from the back, and the driver mounts on it.`);
  } else {
    const rear = d.horn.loading === 'rear';
    if (rear) {
      if (d.horn.throatChamberL >= 0.05) cabinets.push(cabinet('Chamber behind the cone', d.horn.throatChamberL / 1000, dDisp, b, t, false, [driverHole]));
    } else {
      cabinets.push(cabinet('Rear chamber', d.volumeL / 1000, dDisp, b, t, false, [driverHole]));
      if (d.horn.throatChamberL >= 0.05) cabinets.push(cabinet('Throat chamber', d.horn.throatChamberL / 1000, 0, b, t, false, []));
    }
    const view = compute(d, t).horn;
    if (view?.fold) {
      const f = view.fold;
      cabinets.push(foldedCabinet(f, flareOf(d).throatM2, t));
      if (!f.feasible) warnings.push(`${name}: ${d.horn.legs} folds cannot fit this flare at ${fl(d.horn.widthCm / 100, u)} wide: the turns alone are longer than the horn. The cut list is a stand-in; use fewer folds or a wider horn.`);
      if (!f.mouthAtFront) warnings.push(`${name}: an odd number of legs ends the horn at the back of the box, so the folded box has no mouth on the front. Use an even number of legs.`);
      if (f.dI > d.horn.depthCm / 100 - 2 * t + 1e-9) warnings.push(`${name}: ${d.horn.legs} legs need ${fl(f.dO, u)} of outside depth, more than the ${fl(d.horn.depthCm / 100, u)} asked for: the folded box is built ${fl(f.dO, u)} deep.`);
      warnings.push(`${name}: the folded horn is its own box; the driver sits in the chamber beside it and the throat chamber joins the throat opening at the top front. Bends and losses are not modelled.`);
    } else if (view) {
      horn = { sections: P.hornPanels(view.table.map((r) => ({ x: r.xCm / 100, h: r.heightCm / 100 })), d.horn.widthCm / 100, t) };
      if (d.horn.panelsCm.trim() === '') warnings.push(`${name}: no panel lengths are entered, so the horn is cut as ${view.table.length - 1} straight sections along the ideal flare. Enter panel lengths on the box page to build it as simulated.`);
    }
  }

  // drivers, the port and the layout have to fit on the baffle
  const down = lay.facing === 'down';
  const custom = n > 1 || lay.cols > 0 || lay.pushPull || down || ports.some((x) => x.shape === 'rect');
  for (const c of cabinets) {
    if (c.fold) continue; // the folded horn's openings are the flare's, not a driver and a port
    const baffle = Math.min(c.geometry.wO, c.geometry.hO);
    const holes = c.cutouts.map((x) => x.diameterM);
    if (!custom) {
      if (holes.length > 0 && Math.max(...holes) + 2 * HOLE_MARGIN > baffle) warnings.push(`${name}: the ${fl(Math.max(...holes), u)} hole does not fit the ${formatLength(c.geometry.wO * 1000, u)} x ${fl(c.geometry.hO, u)} baffle. Change the proportions or the volume.`);
      else if (holes.length === 2 && holes[0]! + holes[1]! + 3 * HOLE_MARGIN > Math.max(c.geometry.wO, c.geometry.hO)) warnings.push(`${name}: the driver and port holes do not both fit the baffle. Change the proportions.`);
    }
  }
  const main = cabinets[0];
  if (custom && main && shared || (custom && main && d.type === 'bandpass')) {
    const g = main.geometry;
    const bh = down ? g.dO : g.hO;
    const split = side ? { front: n, back: 0 } : pushPullSplit(n, lay.pushPull);
    if (lay.pushPull && n < 2) warnings.push(`${name}: push-pull needs at least two drivers in the box; this box has one.`);
    if (lay.pushPull && n % 2 === 1) warnings.push(`${name}: push-pull works in pairs; ${n} drivers leaves one unpaired ${side ? 'with the first magnet position' : 'on the front'}.`);
    const frontDrivers: Cutout[] = Array.from({ length: split.front }, (_, i) => (side ? { ...driverHole, magnetOut: (i < Math.ceil(n / 2)) === (lay.mount === 'out') } : driverHole));
    main.holes = gridHoles(frontDrivers, ports.map(portCut), lay.cols, g.wO, bh);
    if (split.back > 0) main.rearHoles = gridHoles(Array.from({ length: split.back }, () => driverHole), [], lay.cols, g.wO, bh);
    main.facing = lay.facing;
    main.magnetOut = lay.mount === 'out';
    main.clearanceM = down ? lay.clearanceCm / 100 : 0;
    fitHoles(name, main.holes, g.wO, bh, u, warnings);
    if (main.rearHoles) fitHoles(name, main.rearHoles, g.wO, bh, u, warnings);
    floorWarning(name, lay, driverHole.diameterM, u, warnings);
  } else if (main) {
    main.facing = lay.facing;
    main.magnetOut = lay.mount === 'out';
  }

  const dname = d.driverClass < P.ALL_DRIVER_CLASSES.length ? `${driver.name} driver` : 'Custom driver';
  const parts = rectPortParts(ports, t);
  for (const c of cabinets) {
    if (c.fold || c.wedge) continue;
    const pw = proportionWarning(name, c.geometry);
    if (pw) warnings.push(pw);
  }
  return { name, summary: summary(d), count: b.count / n, driver: dname, drivers: [{ name: dname, qty: n }, ...extraDrivers], cabinets, horn, port: ports[0] ?? null, ports, warnings, ...(parts.length ? { parts } : {}), ...(stuffing > 0 ? { stuffingKg: stuffing } : {}) };
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
    disp += spec.count * P.driverDisplacementMount(driver.sd, d.layout.mount === 'out');
    // an open-baffle driver has no chamber, and a tweeter has its sealed back built in: neither adds air or a partition
    if (s.open || spec.role === 'tweeter') return;
    air += d.volumeL / 1000;
    if (d.type === 'bandpass' || d.type === 'horn') warnings.push(`${slotLabel(arr, k)}: a ${d.type} slot is built as a sealed chamber here; the cut list has no ${d.type === 'horn' ? 'horn' : 'divider'}. Use sealed or ported.`);
    if (d.type === 'ported') {
      for (let i = 0; i < spec.count; i++) {
        const lengthM = portLengthOf(d, d.volumeL / spec.count);
        if (!(lengthM > 0)) {
          warnings.push(`${slotLabel(arr, k)}: the port does not fit (its length comes out negative), so the cut list has no port tube. Fix the tuning, diameter or volume.`);
          break;
        }
        const built = portBuilt(d, lengthM);
        ports.push(built);
        disp += portDispOf(built, t);
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

  // the holes: drivers in layout order from the top, then the ports. One column (the default) stacks them; more columns lay the
  // same order out row by row. A baffle facing down is the bottom panel, so its height is the depth.
  const lay0 = sp.slots[0]!.design.layout;
  const down = lay0.facing === 'down';
  const baffleH = down ? g.dO : g.hO;
  const stack: Cutout[] = [...arr.layout.map((k) => ({ kind: 'driver' as const, diameterM: diameters[k]! })), ...ports.map(portCut)];
  let holes: Hole[];
  if (lay0.cols > 1) {
    holes = gridHoles(stack.filter((h) => h.kind === 'driver'), stack.filter((h) => h.kind === 'port'), lay0.cols, g.wO, baffleH);
    fitHoles(name, holes, g.wO, baffleH, u, warnings);
  } else {
    const total = stack.reduce((a, h) => a + h.diameterM, 0) + HOLE_GAP * Math.max(stack.length - 1, 0);
    let y = Math.max(HOLE_MARGIN, (baffleH - total) / 3);
    const top = y;
    holes = stack.map((h) => {
      const cy = y + h.diameterM / 2;
      y += h.diameterM + HOLE_GAP;
      return { ...h, cx: g.wO / 2, cy };
    });
    const widest = Math.max(...stack.map((h) => h.diameterM));
    if (widest + 2 * HOLE_MARGIN > g.wO) warnings.push(`${name}: the ${fl(widest, u)} hole does not fit the ${formatLength(g.wO * 1000, u)} wide baffle. Make the baffle wider or choose a smaller driver.`);
    if (top + total + HOLE_MARGIN > baffleH + 1e-9) warnings.push(`${name}: the drivers and ports do not all fit the ${fl(baffleH, u)} high baffle. Make it taller.`);
  }
  floorWarning(name, lay0, Math.max(...stack.map((h) => h.diameterM)), u, warnings);
  const parts = rectPortParts(ports, t);
  const cab: Cabinet = { title: 'Cabinet', geometry: g, panels, cutouts: stack, holes, shelves, facing: down ? 'down' : 'front', clearanceM: down ? lay0.clearanceCm / 100 : 0, magnetOut: sp.slots.some((s) => s.design.layout.mount === 'out'), liningM2: ceilTenth(2 * (g.wI * g.hI + g.wI * g.dI + g.hI * g.dI) - g.wI * g.hI) };
  const sums = arr.slots.map((spec, k) => `${slotLabel(arr, k)}: ${driverOf(sp.slots[k]!.design).name}`);
  return { name, summary: `${arr.label}. ${sums.join(', ')}`, count: sp.quantity, driver: drivers[0]!.name, drivers, cabinets: [cab], horn: null, port: ports[0] ?? null, ports, warnings, ...(parts.length ? { parts } : {}) };
}

const sizeOf = (c: Cutout): { w: number; h: number } => (c.shape === 'rect' ? { w: c.wM!, h: c.hM! } : { w: c.diameterM, h: c.diameterM });

/**
 * Drivers on the baffle, `cols` to a row (0: all in one row), rows centred; the ports in the driver row after them when there is
 * one row and it fits the width, otherwise in a row under them. Positions in metres from the top-left of the baffle.
 * With one column count of 0 and round holes this is the car box's original row layout, unchanged.
 */
export function gridHoles(drivers: Cutout[], ports: Cutout[], cols: number, wO: number, hO: number): Hole[] {
  const perRow = cols > 0 ? cols : Math.max(drivers.length, 1);
  const rowWidth = (row: Cutout[]): number => row.reduce((a, b) => a + sizeOf(b).w, 0) + HOLE_GAP * Math.max(row.length - 1, 0);
  const rowHeight = (row: Cutout[]): number => (row.length ? Math.max(...row.map((b) => sizeOf(b).h)) : 0);
  const driverRows: Cutout[][] = [];
  for (let i = 0; i < drivers.length; i += perRow) driverRows.push(drivers.slice(i, i + perRow));
  const oneRow = driverRows.length === 1 && ports.length > 0 && rowWidth([...drivers, ...ports]) + 2 * HOLE_MARGIN <= wO;
  const rows: Cutout[][] = oneRow ? [[...drivers, ...ports]] : [...driverRows, ...(ports.length ? [ports] : [])];
  const total = rows.reduce((a, r) => a + rowHeight(r), 0) + HOLE_GAP * Math.max(rows.length - 1, 0);
  let y = Math.max(HOLE_MARGIN, (hO - total) / 2);
  const out: Hole[] = [];
  for (const row of rows) {
    let x = Math.max(HOLE_MARGIN, (wO - rowWidth(row)) / 2);
    const h = rowHeight(row);
    for (const item of row) {
      const sz = sizeOf(item);
      out.push({ ...item, cx: x + sz.w / 2, cy: y + h / 2 });
      x += sz.w + HOLE_GAP;
    }
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
      perBox: 1,
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
  const lay = d.layout;
  const side = lay.pushPull && lay.pushPullStyle === 'side' && c.count >= 2;
  const nOut = side ? (lay.mount === 'out' ? Math.ceil(c.count / 2) : Math.floor(c.count / 2)) : lay.mount === 'out' ? c.count : 0;
  let disp = (c.count - nOut) * P.driverDisplacementMount(driver.sd, false) + nOut * P.driverDisplacementMount(driver.sd, true);
  if (d.type === 'ported') {
    for (let i = 0; i < c.count; i++) {
      const lengthM = portLengthOf(d, d.volumeL / c.count);
      if (!(lengthM > 0)) {
        warnings.push(`${name}: the port does not fit (its length comes out negative), so the cut list has no port tube. Fix the tuning, diameter or volume.`);
        break;
      }
      const built = portBuilt(d, lengthM);
      ports.push(built);
      disp += portDispOf(built, t);
    }
  }
  const vNet = d.volumeL / 1000;
  const o = c.build;
  const wedge = c.shape === 'wedge';
  const driverDia = coneDiameterM(driver.sd);
  const split = side ? { front: c.count, back: 0 } : pushPullSplit(c.count, lay.pushPull);
  if (lay.pushPull && c.count < 2) warnings.push(`${name}: push-pull needs at least two subs; this install has one.`);
  if (lay.pushPull && c.count % 2 === 1) warnings.push(`${name}: push-pull works in pairs; ${c.count} subs leaves one unpaired on the front.`);
  const down = lay.facing === 'down' && !wedge;
  if (lay.facing === 'down' && wedge) warnings.push(`${name}: a wedge box cannot fire down; it is built firing front.`);
  const frontDrivers0: Cutout[] = Array.from({ length: split.front }, (_, i) => ({ kind: 'driver', diameterM: driverDia, ...(side ? { magnetOut: (i < Math.ceil(c.count / 2)) === (lay.mount === 'out') } : {}) }));
  const rearDrivers0: Cutout[] = Array.from({ length: split.back }, () => ({ kind: 'driver', diameterM: driverDia }));
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
  if (down) baffleH = g.dO;
  const holes = gridHoles(frontDrivers0, ports.map(portCut), lay.cols, g.wO, baffleH);
  const rearHoles = rearDrivers0.length ? gridHoles(rearDrivers0, [], lay.cols, g.wO, baffleH) : undefined;
  const cutouts: Cutout[] = holes.map((h) => ({ kind: h.kind, diameterM: h.diameterM, shape: h.shape, wM: h.wM, hM: h.hM }));
  // the holes must stay inside the baffle with a margin: the placement starts at the margin when a row is wider than the baffle
  const ext = holes.map((h) => ({ ...sizeOf(h), cx: h.cx, cy: h.cy }));
  const left = Math.min(...ext.map((h) => h.cx - h.w / 2));
  const right = Math.max(...ext.map((h) => h.cx + h.w / 2));
  const topEdge = Math.min(...ext.map((h) => h.cy - h.h / 2));
  const bottomEdge = Math.max(...ext.map((h) => h.cy + h.h / 2));
  if (left < HOLE_MARGIN - 1e-9 || right > g.wO - HOLE_MARGIN + 1e-9) warnings.push(`${name}: the holes in a row do not fit the ${formatLength(g.wO * 1000, u)} wide baffle. Make the box wider or use fewer or smaller subs.`);
  if (topEdge < HOLE_MARGIN - 1e-9 || bottomEdge > baffleH - HOLE_MARGIN + 1e-9) warnings.push(`${name}: the sub${ports.length ? 's and ports' : 's'} do not fit the ${fl(baffleH, u)} high baffle. Make the box taller${wedge ? ' or less sloped' : ''}.`);
  if (rearHoles) fitHoles(name, rearHoles, g.wO, baffleH, u, warnings);
  floorWarning(name, { ...lay, facing: down ? 'down' : 'front' }, driverDia, u, warnings);
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
  const parts: NonNullable<BandBuild['parts']> = rectPortParts(ports, t);
  if (fr.enabled) {
    warnings.push(...checkFront(fr).warnings);
    const wName = P.ALL_DRIVER_CLASSES[fr.wooferClass]!.name;
    frontDrivers.push({ name: `${wName} (front, one each side)`, qty: 2 });
    if (fr.type === 'component') frontDrivers.push({ name: `${P.ALL_DRIVER_CLASSES[fr.tweeterClass]!.name} tweeter (front, one each side)`, qty: 2 });
    if (ring) parts.push({ part: ring.title, l: ring.outer.wCm / 100, w: ring.outer.hCm / 100, qty: 2, note: `${fmtCm(ring.thicknessCm)} cm thick; cut ${ring.outer.kind === 'round' ? 'a round' : 'an oval'} ring: the size listed is the outside's bounding rectangle, the cut-out is ${ring.inner.kind === 'round' ? `${fmtCm(ring.inner.wCm)} cm round` : `${fmtCm(ring.inner.wCm)} x ${fmtCm(ring.inner.hCm)} cm oval`}` });
  }
  const cab: Cabinet = { title: wedge ? 'Wedge box' : 'Box', geometry: g, panels, cutouts, holes, ...(rearHoles ? { rearHoles } : {}), facing: down ? 'down' : 'front', magnetOut: lay.mount === 'out', clearanceM: down ? lay.clearanceCm / 100 : 0, wedge: cabWedge, outside, liningM2: lining };
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
      if (port.shape === 'rect') continue;
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
  const stuffKg = bands.reduce((a, b) => a + b.count * (b.stuffingKg ?? 0), 0);
  if (stuffKg > 0) bom.push({ item: 'Line stuffing (loose fibre)', qty: Math.round(stuffKg * 100) / 100, unit: 'kg', note: 'Cookbook Table 4.1 density; none in the last 20 % of the line' });
  // Cookbook ch. 5 (p. 115): an airtight gasket under each driver flange, plus a silicone bead
  const holeRim = bands.reduce((a, b) => a + b.count * b.cabinets.reduce((s, c) => s + c.cutouts.filter((x) => x.kind === 'driver').reduce((q, x) => q + Math.PI * x.diameterM, 0), 0), 0);
  if (holeRim > 0) bom.push({ item: 'Driver gasket (foam or rubber strip)', qty: Math.ceil(holeRim * 1.1 * 10 - 1e-9) / 10, unit: 'm', note: 'one turn under every driver flange; a 6 mm silicone bead on the flange also seals and damps' });
  const wallArea = bands.reduce((a, b) => a + b.count * b.cabinets.reduce((s, c) => s + 2 * (c.geometry.wO * c.geometry.hO + c.geometry.wO * c.geometry.dO + c.geometry.hO * c.geometry.dO), 0), 0);
  if (p.shop.thicknessMm < 15 && wallArea > 0) bom.push({ item: 'Wall damping sheet (roofing felt or bitumen)', qty: Math.ceil(wallArea * 0.6 * 10 - 1e-9) / 10, unit: 'm2', note: 'Cookbook p. 114: thin walls need heavy damping; 4 to 6 layers of felt over 50 to 75 % of the walls and the baffle, or a constrained layer' });

  if (p.shop.thicknessMm < 12) warnings.push(`The ${p.shop.thicknessMm} mm wall is thinner than the Cookbook's lightest approach (1/2 in, 12 mm, marine plywood with heavy damping): large panels will ring. Use thicker sheet, brace each panel and damp the walls.`);
  const rooms = bands.filter((b) => b.cabinets.some((c) => !c.fold && !c.wedge));
  const modes = rooms.slice(0, 1).flatMap((b) => {
    const g = b.cabinets.find((c) => !c.fold && !c.wedge)!.geometry;
    const m = axialModesHz(g);
    return [`Axial standing waves of the first box (${b.name}) at ${Math.round(m.w)}, ${Math.round(m.h)} and ${Math.round(m.d)} Hz (width, height, depth; c / 2L, standard physics). Fibre fill damps them; the Cookbook finds shape and ratio secondary once the box is filled, and vented boxes (fill under half) show them more.`];
  });
  const notes = [
    ...(p.kind === 'car' ? ['The amplifier, ring terminals and the remote lead are not in this list; the cable and fuse follow the 12 V check. A wedge is cut with plain butt joints: expect to bevel the baffle edges and the sides.'] : []),
    ...(p.kind === 'speaker' ? ['The crossover is not part of this list: the speaker is designed with an active crossover. A passive network, its parts and the wiring are yours to add.'] : []),
    'Butt joints, no rabbets or mitres: add allowance yourself if you cut them. Hole sizes are estimates: check the driver datasheet.',
    'The shelf layout is a heuristic: a good hand layout, or a nesting tool, often saves a sheet. Pieces lie long side along the sheet, so grain direction is not respected.',
    `Driver displacement is estimated at 0.15 Sd^1.5, a round port tube at its outer volume, a window brace as a ${fl(0.05, p.units)} frame: boxes are sized so the air left is the designed volume.`,
    ...modes,
    'Fill (Cookbook ch. 5): a sealed box takes full fibre fill; keep a vented box under about half full and never block the port. Brace each large panel; a single brace off centre (about 40 % of the depth) avoids halving the panel exactly, since two equal halves ring together. Crossing dowels or 3/4 x 2 in lumber braces work as well as a window frame.',
    'Baffle (Cookbook ch. 6): edge diffraction adds up to about 1.5 to 3 dB of ripple between 1 and 10 kHz on a flat baffle. Small round-overs (3/4 in) do little; an edge radius or bevel of several inches is needed to see the effect. Felt or foam on the baffle (1/4 in, around the drivers) smoothed the response in the book\'s tests. Floor-standing boxes want three spikes and weight at the base.',
    ...(p.kind === 'speaker' ? ['Driver position (Cookbook ch. 6): keep the baffle symmetrical; put the woofer at the top with the tweeter below it or at the bottom with the tweeter above it so the tilts cancel; a tweeter offset to the side smooths the response but tilts the pattern about 15 degrees; a 2.5-way trades lobing for vertical asymmetry and loses some depth of image; centre-channel woofers sit close or 5 to 8 in from the centre each.'] : []),
  ];
  return { bands, cutList, pieces, sheets: packed.sheets, waste, bom, warnings, notes };
}
