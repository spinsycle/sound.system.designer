// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The design a user edits and everything derived from it. Pure functions, no UI: the page only draws what
// compute() returns, and the tests assert the same path against the shared physics vectors.
import * as P from '@soundsystemdesigner/physics';

export type BoxKind = 'sealed' | 'ported' | 'bandpass' | 'horn' | 'passive' | 'tline';
export const BOX_KINDS: readonly { id: BoxKind; label: string }[] = [
  { id: 'sealed', label: 'Sealed' },
  { id: 'ported', label: 'Ported' },
  { id: 'passive', label: 'Passive radiator' },
  { id: 'bandpass', label: 'Band-pass' },
  { id: 'tline', label: 'Transmission line' },
  { id: 'horn', label: 'Horn' },
];
/** The box kinds the Ollama brief may choose: the original four (the new Cookbook types are designed by hand). */
export const BRIEF_KINDS: readonly BoxKind[] = ['sealed', 'ported', 'bandpass', 'horn'];

export const FLARES: readonly { id: P.FlareKind; label: string }[] = [
  { id: 'exponential', label: 'Exponential' },
  { id: 'hyperbolic', label: 'Hyperbolic' },
  { id: 'tractrix', label: 'Tractrix' },
  { id: 'conical', label: 'Conical' },
];

/** The voltage a driver at 0 dB trim receives; every level in the app is for this input. */
export const REF_VOLTS = 2.83;

/**
 * The stored value of the Custom driver. A fixed number, not "the end of the list", so adding classes never moves it
 * (project files and browser storage before version 2 stored it as 8; `migrate.ts` converts those).
 */
export const CUSTOM_CLASS = 100;
/** The "1 in HF" compression-driver stand-in (one of the plugin's eight). */
export const HF_CLASS = 7;

export interface HornDesign {
  /**
   * Front-loaded: the cone fires into the horn and has a sealed chamber behind it. Rear-loaded (scoop): the cone's
   * front radiates directly and its rear drives the horn through the chamber behind it.
   */
  loading: 'front' | 'rear';
  flare: P.FlareKind;
  cutoffHz: number;
  /** Hyperbolic family parameter (1 = exponential, 0 = catenoidal). */
  t: number;
  throatCm2: number;
  mouthCm2: number;
  /** Conical only: the other flares derive their length from the cutoff. */
  lengthM: number;
  /** Chamber between cone and throat. */
  throatChamberL: number;
  /** Inside width of a rectangular horn, for the panel table's heights. */
  widthCm: number;
  /** Straight panel lengths along the centreline, cm, separated by commas or spaces. Empty: the ideal curve. */
  panelsCm: string;
  /**
   * Fold the horn into a box (spec v0.14): `legs` stacked legs with U-turns, the box `depthCm` deep outside and `widthCm` wide
   * inside; the height follows from the flare. The straight panels are ignored while it is on.
   */
  fold: boolean;
  legs: number;
  depthCm: number;
  /** 'tapered' is the scoop: legs that widen along their length, with sloped septa. */
  foldStyle: P.FoldStyle;
}

/**
 * Passive radiator (Cookbook ch. 3). Zero means "the same as the driver": the book's standard case is a radiator that is a
 * copy of the driver's cone (same area, same compliance, same own mass), tuned by adding mass.
 */
export interface PassiveDesign {
  sdpCm2: number;
  /** Air volume equivalent to the radiator's suspension compliance. */
  vapL: number;
  /** The radiator's own moving mass, before any added mass. */
  massG: number;
  /** One-way excursion the radiator's suspension allows. */
  xmaxMm: number;
}

/** Transmission line (Cookbook ch. 4): a stuffed, tapered line behind the driver, sized from the book's tables. */
export interface TlDesign {
  kind: P.TlKind;
  table: P.TlTable;
  stuffing: P.Stuffing;
  lengthCm: number;
  /** Area at the driver end and at the exit. */
  startCm2: number;
  exitCm2: number;
  /** Coupling chamber between the cone and the line (kind 'chamber'). */
  chamberL: number;
  /** Driver distance from the closed end, percent of the line (kind 'offset'). */
  offsetPct: number;
  /** Stuffing density, lb/ft3 (the book's unit). */
  densityLb: number;
  /** Share of the line length stuffed, from the closed end. */
  stuffedPct: number;
}

/** The line the book's tables give for a driver, as editable settings. */
export function tlSettingsFor(driver: P.DriverSpec, kind: P.TlKind, table: P.TlTable, stuffing: P.Stuffing): TlDesign {
  const des = P.tlDesign(driver, kind, table);
  const r = (v: number): number => Number(v.toPrecision(4));
  return {
    kind,
    table,
    stuffing,
    lengthCm: r(des.lengthM * 100),
    startCm2: r(des.startM2 * 1e4),
    exitCm2: r(des.exitM2 * 1e4),
    chamberL: r(des.chamberM3 * 1000),
    offsetPct: Math.round(des.offset * 100),
    densityLb: r(P.stuffingDensityLb(stuffing, des.lengthM)),
    stuffedPct: 80,
  };
}

export type PlotRange = 'low' | 'high';
export const PLOT_RANGES: Record<PlotRange, { label: string; min: number; max: number }> = {
  low: { label: '10 Hz to 2 kHz', min: 10, max: 2000 },
  high: { label: '100 Hz to 20 kHz', min: 100, max: 20000 },
};

export type PortShape = 'round' | 'rect';
/** Rectangular port: horizontal has its long side along the baffle's width, vertical along its height. */
export type PortOrient = 'horizontal' | 'vertical';
export type MountKind = 'in' | 'out';

/**
 * How the drivers of one cabinet sit (spec v0.13). The count of drivers comes from elsewhere (the band, the slot, the
 * car sub); this says how they are placed. With push-pull the count is split over two facing walls, wired in opposite polarity.
 */
export interface DriverLayout {
  /** Columns on the baffle; rows follow from the count. 0 is automatic: a row for a car box, a stack for a speaker, the plain layout for a PA box. */
  cols: number;
  /** 'in': motor inside the box. 'out': cone inside, motor sticking out through the baffle. */
  mount: MountKind;
  pushPull: boolean;
  /**
   * 'walls': the pairs sit on opposite walls. 'side': every driver is on the front baffle, side by side, the first half with the
   * chosen magnet position and the second half mounted the other way (one magnet inside, one outside), in opposite polarity.
   */
  pushPullStyle: 'walls' | 'side';
  /** Baffle on the front, or on the bottom with the drivers firing at the floor. */
  facing: 'front' | 'down';
  /** Gap between the cabinet bottom and the floor when it faces down, cm. */
  clearanceCm: number;
}
export const DEFAULT_LAYOUT: DriverLayout = { cols: 0, mount: 'in', pushPull: false, pushPullStyle: 'walls', facing: 'front', clearanceCm: 10 };
export const LAYOUT_RANGES = {
  cols: { label: 'Columns', unit: '', min: 0, max: 8, linear: true },
  clearanceCm: { label: 'Floor clearance', unit: 'cm', min: 0, max: 100, linear: true },
} as const;

export interface Design {
  driverClass: number;
  custom: P.CustomDriverFields;
  type: BoxKind;
  /** Box volume; the sealed rear chamber of a band-pass box or a horn. */
  volumeL: number;
  /** Port tuning (ported) or front chamber + port resonance (band-pass). */
  tuneHz: number;
  frontVolumeL: number;
  portDiameterCm: number;
  /** Port cross-section: round uses the diameter, rectangular the width and height below (cm). */
  portShape: PortShape;
  portWidthCm: number;
  portHeightCm: number;
  portOrient: PortOrient;
  layout: DriverLayout;
  /** Box leakage Q of a ported, band-pass or passive-radiator box (Cookbook: design at 7). 0 is lossless, the plugin's model. */
  qL: number;
  /** Fibre fill of a sealed box, percent of full fill (Small and Margolis, Cookbook p. 41). 0 is none. */
  fillPct: number;
  pr: PassiveDesign;
  tl: TlDesign;
  /** Amplifier power for the excursion plot. */
  powerW: number;
  plotRange: PlotRange;
  horn: HornDesign;
}

export interface Range {
  label: string;
  unit: string;
  min: number;
  max: number;
  /** Linear slider (for ranges that start at zero); the default is logarithmic. */
  linear?: boolean;
}

/** User-entered driver ranges are the shared spec's Custom ranges. */
export const CUSTOM_RANGES: Record<keyof P.CustomDriverFields, Range> = {
  fsHz: { label: 'Fs', unit: 'Hz', min: 10, max: 300 },
  qts: { label: 'Qts', unit: '', min: 0.15, max: 1.5 },
  qms: { label: 'Qms', unit: '', min: 1, max: 20 },
  vasL: { label: 'Vas', unit: 'L', min: 1, max: 2000 },
  sdCm2: { label: 'Sd', unit: 'cm²', min: 5, max: 2500 },
  reOhm: { label: 'Re', unit: 'Ω', min: 1, max: 32 },
  xmaxMm: { label: 'Xmax', unit: 'mm', min: 0.2, max: 40 },
  powerW: { label: 'Power', unit: 'W', min: 5, max: 5000 },
};

export type BoxField = 'volumeL' | 'tuneHz' | 'frontVolumeL' | 'portDiameterCm' | 'portWidthCm' | 'portHeightCm' | 'powerW';
export type ExtraField = 'qL' | 'fillPct';
export const EXTRA_RANGES: Record<ExtraField, Range> = {
  qL: { label: 'Box losses QL (0 = lossless)', unit: '', min: 0, max: 50, linear: true },
  fillPct: { label: 'Fibre fill', unit: '%', min: 0, max: 100, linear: true },
};
export const PR_RANGES: Record<keyof PassiveDesign, Range> = {
  sdpCm2: { label: 'Radiator area (0 = same as driver)', unit: 'cm²', min: 0, max: 5000, linear: true },
  vapL: { label: 'Radiator compliance Vap (0 = same as driver)', unit: 'L', min: 0, max: 5000, linear: true },
  massG: { label: 'Radiator own mass (0 = same as driver)', unit: 'g', min: 0, max: 20000, linear: true },
  xmaxMm: { label: 'Radiator Xmax', unit: 'mm', min: 1, max: 60 },
};
export const TL_RANGES: Record<'lengthCm' | 'startCm2' | 'exitCm2' | 'chamberL' | 'offsetPct' | 'densityLb' | 'stuffedPct', Range> = {
  lengthCm: { label: 'Line length', unit: 'cm', min: 20, max: 1000 },
  startCm2: { label: 'Area at the driver', unit: 'cm²', min: 10, max: 20000 },
  exitCm2: { label: 'Exit area', unit: 'cm²', min: 5, max: 20000 },
  chamberL: { label: 'Coupling chamber', unit: 'L', min: 0, max: 1000, linear: true },
  offsetPct: { label: 'Driver offset from the closed end', unit: '% of line', min: 0, max: 50, linear: true },
  densityLb: { label: 'Stuffing density', unit: 'lb/ft³', min: 0, max: 5, linear: true },
  stuffedPct: { label: 'Stuffed length', unit: '% of line', min: 0, max: 100, linear: true },
};
export const STUFFINGS: readonly { id: P.Stuffing; label: string }[] = [
  { id: 'acousta', label: 'Acousta-Stuf' },
  { id: 'polyester', label: 'Polyester fibre' },
  { id: 'fiberglass', label: 'Fibreglass' },
  { id: 'microfibre', label: 'Microfibre' },
];

export const BOX_RANGES: Record<BoxField, Range> = {
  volumeL: { label: 'Volume', unit: 'L', min: 0.1, max: 1000 },
  tuneHz: { label: 'Tuning', unit: 'Hz', min: 10, max: 200 },
  frontVolumeL: { label: 'Front volume', unit: 'L', min: 1, max: 1000 },
  portDiameterCm: { label: 'Port diameter', unit: 'cm', min: 2, max: 40 },
  portWidthCm: { label: 'Port width', unit: 'cm', min: 2, max: 80 },
  portHeightCm: { label: 'Port height', unit: 'cm', min: 1, max: 40 },
  powerW: { label: 'Amp power', unit: 'W', min: 1, max: 5000 },
};

export type HornField = 'cutoffHz' | 't' | 'throatCm2' | 'mouthCm2' | 'lengthM' | 'throatChamberL' | 'widthCm' | 'legs' | 'depthCm';
export const HORN_RANGES: Record<HornField, Range> = {
  cutoffHz: { label: 'Flare cutoff', unit: 'Hz', min: 15, max: 2000 },
  t: { label: 'T', unit: '', min: 0, max: 1, linear: true },
  throatCm2: { label: 'Throat area', unit: 'cm²', min: 1, max: 5000 },
  mouthCm2: { label: 'Mouth area', unit: 'cm²', min: 2, max: 60000 },
  lengthM: { label: 'Length', unit: 'm', min: 0.05, max: 6 },
  throatChamberL: { label: 'Throat chamber', unit: 'L', min: 0, max: 50, linear: true },
  widthCm: { label: 'Horn width', unit: 'cm', min: 5, max: 300 },
  legs: { label: 'Folds (legs)', unit: '', min: 2, max: 8, linear: true },
  depthCm: { label: 'Box depth (outside)', unit: 'cm', min: 20, max: 1000 },
};

/** Wall thickness the fold geometry assumes when none is given (m): 18 mm, the app's default sheet. */
export const DEFAULT_WALL_M = 0.018;

export const DEFAULT_DESIGN: Design = {
  driverClass: 3,
  custom: { ...P.CUSTOM_DRIVER_DEFAULTS },
  type: 'ported',
  volumeL: 150,
  tuneHz: 40,
  frontVolumeL: 100,
  portDiameterCm: 10,
  portShape: 'round',
  portWidthCm: 20,
  portHeightCm: 4,
  portOrient: 'horizontal',
  layout: DEFAULT_LAYOUT,
  qL: 7,
  fillPct: 0,
  pr: { sdpCm2: 0, vapL: 0, massG: 0, xmaxMm: 12 },
  tl: tlSettingsFor(P.ALL_DRIVER_CLASSES[3]!, 'taper', 'extended', 'acousta'),
  powerW: 100,
  plotRange: 'low',
  horn: { loading: 'front', flare: 'exponential', cutoffHz: 40, t: 0.6, throatCm2: 500, mouthCm2: 8000, lengthM: 1.5, throatChamberL: 2, widthCm: 60, panelsCm: '', fold: false, legs: 4, depthCm: 100, foldStyle: 'stepped' },
};

/** Generic starting points. Invented values, not any product. */
export const HORN_PRESETS: readonly { label: string; patch: Partial<Design> }[] = [
  { label: 'Bass horn', patch: { driverClass: 3, volumeL: 60, plotRange: 'low', horn: { ...DEFAULT_DESIGN.horn } } },
  { label: 'Scoop', patch: { driverClass: 3, plotRange: 'low', horn: { ...DEFAULT_DESIGN.horn, loading: 'rear', throatCm2: 600, mouthCm2: 6000, throatChamberL: 40, fold: true, foldStyle: 'tapered', legs: 2, widthCm: 90, depthCm: 96 } } },
  {
    label: 'Mid horn',
    patch: { driverClass: 5, volumeL: 6, plotRange: 'low', horn: { ...DEFAULT_DESIGN.horn, flare: 'hyperbolic', cutoffHz: 200, t: 0.7, throatCm2: 120, mouthCm2: 1500, throatChamberL: 0.3, widthCm: 30 } },
  },
  {
    label: 'HF horn',
    patch: { driverClass: 7, volumeL: 0.1, plotRange: 'high', horn: { ...DEFAULT_DESIGN.horn, flare: 'tractrix', cutoffHz: 600, throatCm2: 5, mouthCm2: 260, throatChamberL: 0, widthCm: 15 } },
  },
];

const num = (v: unknown, r: Range, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? P.clamp(v, r.min, r.max) : fallback;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** Any stored or typed value to a valid Design: unknown fields dropped, numbers clamped to their ranges. */
export function sanitize(input: unknown): Design {
  const i = obj(input);
  const c = obj(i.custom);
  const h = obj(i.horn);
  const d = DEFAULT_DESIGN;
  const custom = { ...d.custom };
  for (const k of Object.keys(CUSTOM_RANGES) as (keyof P.CustomDriverFields)[]) custom[k] = num(c[k], CUSTOM_RANGES[k], d.custom[k]);
  const horn: HornDesign = {
    ...d.horn,
    flare: FLARES.some((f) => f.id === h.flare) ? (h.flare as P.FlareKind) : d.horn.flare,
    loading: h.loading === 'rear' ? 'rear' : 'front',
    panelsCm: typeof h.panelsCm === 'string' ? h.panelsCm.slice(0, 200) : d.horn.panelsCm,
    fold: h.fold === true,
    foldStyle: h.foldStyle === 'tapered' ? 'tapered' : 'stepped',
  };
  for (const k of Object.keys(HORN_RANGES) as HornField[]) horn[k] = num(h[k], HORN_RANGES[k], d.horn[k]);
  horn.legs = Math.round(horn.legs);
  const out: Design = {
    ...d,
    driverClass: typeof i.driverClass === 'number' && Number.isInteger(i.driverClass) ? classOf(i.driverClass) : d.driverClass,
    custom,
    type: BOX_KINDS.some((k) => k.id === i.type) ? (i.type as BoxKind) : d.type,
    plotRange: i.plotRange === 'high' || i.plotRange === 'low' ? i.plotRange : d.plotRange,
    portShape: i.portShape === 'rect' ? 'rect' : 'round',
    portOrient: i.portOrient === 'vertical' ? 'vertical' : 'horizontal',
    layout: sanitizeLayout(i.layout),
    horn,
  };
  for (const k of Object.keys(BOX_RANGES) as BoxField[]) out[k] = num(i[k], BOX_RANGES[k], d[k]);
  // a stored design with no box-loss field was made before 1.8.0 and stays lossless; a new design starts at the Cookbook's QL = 7
  for (const k of Object.keys(EXTRA_RANGES) as ExtraField[]) out[k] = num(i[k], EXTRA_RANGES[k], k === 'qL' && Object.keys(i).length > 0 && !('qL' in i) ? 0 : d[k]);
  const pr = obj(i.pr);
  out.pr = { ...d.pr };
  for (const k of Object.keys(PR_RANGES) as (keyof PassiveDesign)[]) out.pr[k] = num(pr[k], PR_RANGES[k], d.pr[k]);
  const tl = obj(i.tl);
  const tlOut: TlDesign = {
    ...d.tl,
    kind: tl.kind === 'chamber' || tl.kind === 'offset' ? tl.kind : 'taper',
    table: tl.table === 'standard' ? 'standard' : 'extended',
    stuffing: STUFFINGS.some((s) => s.id === tl.stuffing) ? (tl.stuffing as P.Stuffing) : d.tl.stuffing,
  };
  for (const k of Object.keys(TL_RANGES) as (keyof typeof TL_RANGES)[]) tlOut[k] = num(tl[k], TL_RANGES[k], d.tl[k]);
  out.tl = tlOut;
  return out;
}

/** Any stored or typed value to a valid layout; a missing one is the default (one column, motor in, front). */
export function sanitizeLayout(input: unknown): DriverLayout {
  const l = obj(input);
  const d = DEFAULT_LAYOUT;
  return {
    cols: typeof l.cols === 'number' && Number.isFinite(l.cols) ? Math.round(P.clamp(l.cols, LAYOUT_RANGES.cols.min, LAYOUT_RANGES.cols.max)) : d.cols,
    mount: l.mount === 'out' ? 'out' : 'in',
    pushPull: l.pushPull === true,
    pushPullStyle: l.pushPullStyle === 'side' ? 'side' : 'walls',
    facing: l.facing === 'down' ? 'down' : 'front',
    clearanceCm: num(l.clearanceCm, LAYOUT_RANGES.clearanceCm, d.clearanceCm),
  };
}

/** Port cross-section area, m2, from the chosen shape. */
export const portAreaM2 = (d: Design): number => (d.portShape === 'rect' ? (d.portWidthCm / 100) * (d.portHeightCm / 100) : Math.PI * (d.portDiameterCm / 200) ** 2);
/** Diameter of the round port with the same area, m (the end correction and the hole-fit checks use it). */
export const portEquivDiameterM = (d: Design): number => Math.sqrt((4 * portAreaM2(d)) / Math.PI);
/** Inside width and height of the port opening on the baffle, m: a round port is a square of its diameter for sizing. */
export function portOpeningM(d: Design): { wM: number; hM: number } {
  if (d.portShape === 'round') return { wM: d.portDiameterCm / 100, hM: d.portDiameterCm / 100 };
  const a = d.portWidthCm / 100;
  const b = d.portHeightCm / 100;
  return d.portOrient === 'horizontal' ? { wM: Math.max(a, b), hM: Math.min(a, b) } : { wM: Math.min(a, b), hM: Math.max(a, b) };
}
/** Port length for the design's port in a chamber of `chamberL` litres, m. Round ports use the round form exactly. */
export const portLengthOf = (d: Design, chamberL: number): number =>
  d.portShape === 'rect' ? P.portLengthFromAreaM(chamberL / 1000, d.tuneHz, portAreaM2(d)) : P.portLengthM(chamberL / 1000, d.tuneHz, d.portDiameterCm / 100);
/** Port size as text, cm. */
export const portLabel = (d: Design): string => (d.portShape === 'rect' ? `${fmt(d.portWidthCm)} x ${fmt(d.portHeightCm)} cm ${d.portOrient}` : `${fmt(d.portDiameterCm)} cm round`);

/** A stored class number made valid: below 0 is the first class, past the list is Custom. */
const classOf = (n: number): number => (n < 0 ? 0 : n < P.ALL_DRIVER_CLASSES.length ? n : CUSTOM_CLASS);

export const driverOf = (d: Design): P.DriverSpec =>
  d.driverClass < P.ALL_DRIVER_CLASSES.length ? P.ALL_DRIVER_CLASSES[d.driverClass]! : P.customDriver(d.custom);

/**
 * The flare a horn design describes, with the limits geometry imposes: the mouth is larger than the throat, and a
 * tractrix mouth cannot exceed the full mouth its cutoff defines (nor its throat come near it).
 */
export function flareOf(d: Design): P.Flare {
  const h = d.horn;
  let throat = h.throatCm2 * 1e-4;
  let mouth = h.mouthCm2 * 1e-4;
  if (h.flare === 'tractrix') {
    const full = P.tractrixFullMouth(h.cutoffHz);
    throat = Math.min(throat, 0.5 * full);
    mouth = Math.min(mouth, full);
  }
  return { kind: h.flare, throatM2: throat, mouthM2: Math.max(mouth, throat * 1.05), cutoffHz: h.cutoffHz, t: h.t, lengthM: h.lengthM };
}

/**
 * Joint positions (cm from the throat) for a list of panel lengths; null when none are given. The last joint is always
 * the mouth: a joint that would land within 1 % of the length of it is dropped, so rounding never leaves a sliver panel.
 */
export function panelJointsCm(text: string, lengthCm: number): number[] | null {
  const panels = text
    .split(/[,;\s]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  if (panels.length === 0) return null;
  const xs = [0];
  let at = 0;
  for (const p of panels) {
    at += p;
    if (at >= 0.99 * lengthCm) break;
    xs.push(at);
  }
  xs.push(lengthCm);
  return xs;
}

/** Segments used to simulate an ideal (curved) flare. The shared horn vectors use the same count. */
export const IDEAL_SEGMENTS = 100;

export interface Point {
  responseDb: number;
  /** Peak cone excursion at the design's amp power. */
  excursionMm: number;
  impedanceOhm: number;
  phaseDeg: number;
  groupDelayMs: number;
}

export interface Raw {
  g: P.Cx;
  x: P.Cx;
  z: P.Cx;
}

function toPoint(raw: (f: number) => Raw, d: Design, f: number): Point {
  const r = raw(f);
  return {
    responseDb: P.dB(P.abs(r.g)),
    excursionMm: P.abs(r.x) * P.peakVoltsForPower(d.powerW, driverOf(d).re) * 1000,
    impedanceOhm: P.abs(r.z),
    phaseDeg: P.phaseDeg(r.z),
    groupDelayMs: P.groupDelayS((x) => raw(x).g, f) * 1000,
  };
}

function hornRaw(d: Design, joints: readonly P.Joint[]): (f: number) => Raw {
  const sys: P.HornSystem = { driver: driverOf(d), joints, throatChamberM3: d.horn.throatChamberL / 1000, rearVolumeM3: d.volumeL / 1000, rearLoaded: d.horn.loading === 'rear' };
  return (f) => P.hornSystem(sys, f);
}

/** The passive radiator a design describes: the driver's own cone unless the fields say otherwise, tuned to the box tuning with added mass. */
export interface PrBuilt {
  radiator: P.PassiveRadiator;
  /** Radiator mass with no added mass, kg. */
  ownKg: number;
  /** Mass to add so the box tunes to `tuneHz`, kg; negative when the radiator is already too heavy. */
  addedKg: number;
  alpha: number;
  delta: number;
  /** The radiator's own resonance at the mass used, Hz, and the box tuning it makes. */
  fpHz: number;
  fbHz: number;
}
export function prOf(d: Design): PrBuilt {
  const driver = driverOf(d);
  const derived = P.deriveDriver(driver);
  const vb = Math.max(d.volumeL, 0.01) / 1000;
  const sdp = d.pr.sdpCm2 > 0 ? d.pr.sdpCm2 * 1e-4 : driver.sd;
  const vap = d.pr.vapL > 0 ? d.pr.vapL / 1000 : driver.vasM3;
  const own = d.pr.massG > 0 ? d.pr.massG / 1000 : derived.mms;
  const delta = vap / vb;
  const fpWanted = Math.max(d.tuneHz, 1) / Math.sqrt(1 + delta);
  const needed = P.prMassForResonance({ sdp, vapM3: vap }, fpWanted);
  const used = Math.max(needed, own);
  const radiator = { sdp, vapM3: vap, massKg: used };
  const fp = P.prResonance(radiator);
  return { radiator, ownKg: own, addedKg: needed - own, alpha: driver.vasM3 / vb, delta, fpHz: fp, fbHz: P.prBoxTuning(fp, delta) };
}

function passiveRaw(d: Design): (f: number) => Raw {
  const driver = driverOf(d);
  const r = P.deriveDriver(driver);
  const pr = prOf(d);
  const ql = d.qL > 0 ? d.qL : undefined;
  return (f) => {
    const x = P.passiveX(f, driver, r, pr.alpha, pr.delta, pr.fpHz, ql);
    return { g: P.passiveG(f, driver.fs, r.qts, pr.alpha, pr.delta, pr.fpHz, ql), x, z: P.impedanceFromDisplacement(f, x, r.bl, driver.re) };
  };
}

/** The line a design describes, in the physics library's units. */
export function tlGeometryOf(d: Design): P.TlGeometry {
  const t = d.tl;
  return {
    lengthM: t.lengthCm / 100,
    startM2: t.startCm2 * 1e-4,
    exitM2: t.exitCm2 * 1e-4,
    chamberM3: t.chamberL / 1000,
    offset: t.kind === 'offset' ? t.offsetPct / 100 : 0,
    stuffing: t.stuffing,
    densityLb: t.densityLb,
    stuffedShare: t.stuffedPct / 100,
  };
}

function tlRaw(d: Design): (f: number) => Raw {
  const driver = driverOf(d);
  const geo = tlGeometryOf(d);
  return (f) => P.tlSystem(driver, geo, f);
}

/** Sealed box with fibre fill: the same response with the effective volume and the added loss of the Cookbook's fill rule. */
function sealedFilledRaw(d: Design): (f: number) => Raw {
  const driver = driverOf(d);
  const r = P.deriveDriver(driver);
  const vb = Math.max(d.volumeL, 0.01) / 1000;
  const fill = d.fillPct / 100;
  const s = P.sealedFilled(driver.fs, r.qts, driver.vasM3, vb, fill);
  const vEff = vb * P.fillEffect(fill).volumeGain;
  return (f) => {
    const x = P.sealedX(f, driver, r, vEff);
    return { g: P.sealedHP(f, s.fc, s.qtc), x, z: P.impedanceFromDisplacement(f, x, r.bl, driver.re) };
  };
}

function directRaw(d: Design): (f: number) => Raw {
  if (d.type === 'passive') return passiveRaw(d);
  if (d.type === 'tline') return tlRaw(d);
  if (d.type === 'sealed' && d.fillPct > 0) return sealedFilledRaw(d);
  const box: P.BoxParams = { driver: driverOf(d), type: d.type === 'horn' ? 'sealed' : (d.type as P.BoxType), volumeL: d.volumeL, tuneHz: d.tuneHz, frontVolumeL: d.frontVolumeL, hornThroatCm2: 600, hornMouthCm2: 4000, hornLengthM: 1, ...(d.qL > 0 ? { qL: d.qL } : {}) };
  return (f) => ({ g: P.boxResponse(box, f), x: P.boxDisplacement(box, f), z: P.boxImpedance(box, f) });
}

/** The horn as it is simulated: the builder's panels when given, else the ideal flare in IDEAL_SEGMENTS pieces. */
export function hornGeometry(d: Design, wallM = DEFAULT_WALL_M): { flare: P.Flare; lengthM: number; ideal: P.Joint[]; built: P.Joint[] | null; fold: P.FoldLayout | null } {
  const flare = flareOf(d);
  const lengthM = P.flareLength(flare);
  if (d.horn.fold) {
    // folded: the legs and turns are the built horn (a staircase of the ideal flare)
    const fold = P.foldHorn(flare, d.horn.widthCm / 100, d.horn.legs, d.horn.depthCm / 100, wallM, d.horn.foldStyle);
    return { flare, lengthM, ideal: P.hornJoints(flare, IDEAL_SEGMENTS), built: fold.joints, fold };
  }
  const xs = panelJointsCm(d.horn.panelsCm, lengthM * 100);
  return { flare, lengthM, ideal: P.hornJoints(flare, IDEAL_SEGMENTS), built: xs && P.hornJointsAt(flare, xs.map((x) => x / 100)), fold: null };
}

/**
 * The design as a function of frequency: response g (relative to the driver's direct-radiator passband), cone
 * displacement per volt x, and impedance z. A horn is simulated as built when panels are given. The geometry is
 * worked out once, so call this once and reuse the function across frequencies.
 */
export function rawEvaluator(d: Design, wallM = DEFAULT_WALL_M): (f: number) => Raw {
  if (d.type !== 'horn') return directRaw(d);
  const g = hornGeometry(d, wallM);
  return hornRaw(d, g.built ?? g.ideal);
}

/** Everything the plots show at one frequency. compute() maps this over the plot frequencies. */
export const evaluateAt = (d: Design, f: number): Point => toPoint(rawEvaluator(d), d, f);

const N_POINTS = 280;
export function plotFreqs(range: PlotRange): number[] {
  const { min, max } = PLOT_RANGES[range];
  return Array.from({ length: N_POINTS }, (_, k) => min * (max / min) ** (k / (N_POINTS - 1)));
}

export interface Readout {
  label: string;
  value: string;
}

export interface Overlay {
  label: string;
  values: number[];
}

export interface HornView {
  lengthM: number;
  ideal: P.Joint[];
  built: P.Joint[] | null;
  /** The folded layout when the horn is folded. */
  fold: P.FoldLayout | null;
  /** Settings that make the fold work, when the current ones do not (null: they work, or none exist). */
  suggest: P.FoldSuggestion | null;
  /** When no fold exists at this width: the largest mouth area (cm2) that does fold, or null if none does. */
  maxMouthCm2: number | null;
  /** The recommended fold once the mouth is set to `maxMouthCm2`. */
  suggestAtMax: P.FoldSuggestion | null;
  /** Stations for the builder: distance from the throat, area, and the height of a rectangular horn of the given width. */
  table: { xCm: number; areaCm2: number; heightCm: number }[];
}

export interface Computed {
  driver: P.DriverSpec;
  derived: P.DriverDerived;
  freqs: readonly number[];
  curves: Record<keyof Point, number[]>;
  overlays: Partial<Record<keyof Point, Overlay[]>>;
  readouts: Readout[];
  extras: Readout[];
  warnings: string[];
  notes: string[];
  /** Frequencies worth a marker on the plots (box resonance, tuning, flare cutoff). */
  markers: { f: number; label: string }[];
  horn: HornView | null;
}

const fmt = (v: number, digits = 1): string => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(digits));
const KEYS: (keyof Point)[] = ['responseDb', 'excursionMm', 'impedanceOhm', 'phaseDeg', 'groupDelayMs'];
const curvesOf = (points: Point[]): Record<keyof Point, number[]> =>
  Object.fromEntries(KEYS.map((k) => [k, points.map((p) => p[k])])) as Record<keyof Point, number[]>;

/** Peak of a sampled curve and the band around it that stays within 3 dB of the peak (log-interpolated edges). */
export function passband(freqs: readonly number[], db: readonly number[]): { peakDb: number; peakHz: number; loHz: number; hiHz: number } {
  let k = 0;
  for (let i = 1; i < db.length; ++i) if (db[i]! > db[k]!) k = i;
  const edge = (step: -1 | 1): number => {
    const target = db[k]! - 3;
    for (let i = k; i + step >= 0 && i + step < db.length; i += step) {
      const a = db[i]!;
      const b = db[i + step]!;
      if (b < target) return freqs[i]! * (freqs[i + step]! / freqs[i]!) ** ((a - target) / (a - b));
    }
    return step < 0 ? freqs[0]! : freqs[freqs.length - 1]!;
  };
  return { peakDb: db[k]!, peakHz: freqs[k]!, loHz: edge(-1), hiHz: edge(1) };
}

/** -3 dB point of a high-pass plot curve measured from 0 dB (the direct-radiator passband), Hz; -1 if it never gets there. */
function f3Of(freqs: readonly number[], db: readonly number[]): number {
  for (let i = 0; i < db.length; ++i) {
    if (db[i]! >= -3) {
      if (i === 0) return freqs[0]!;
      const a = db[i - 1]!;
      const b = db[i]!;
      return freqs[i - 1]! * (freqs[i]! / freqs[i - 1]!) ** ((-3 - a) / (b - a));
    }
  }
  return -1;
}

/** Air volume of the line itself (not the chamber): an exponential taper from start to exit area, m3. */
export function tlLineVolumeM3(g: P.TlGeometry): number {
  const r = g.startM2 / g.exitM2;
  return Math.abs(r - 1) < 1e-9 ? g.startM2 * g.lengthM : (g.lengthM * (g.startM2 - g.exitM2)) / Math.log(r);
}

export function compute(d: Design, wallM = DEFAULT_WALL_M): Computed {
  const driver = driverOf(d);
  const derived = P.deriveDriver(driver);
  const freqs = plotFreqs(d.plotRange);
  const readouts: Readout[] = [];
  /** Cookbook design checks shown after the main readouts (kept apart so the brief's metrics stay as they were). */
  const extras: Readout[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  const markers: Computed['markers'] = [];
  const overlays: Computed['overlays'] = {};
  const vb = d.volumeL / 1000;
  let curves: Record<keyof Point, number[]>;
  let horn: HornView | null = null;

  const port = (chamberL: number): void => {
    const lengthCm = portLengthOf(d, chamberL) * 100;
    readouts.push({ label: `Port length (${portLabel(d)})`, value: lengthCm > 0 ? `${fmt(lengthCm)} cm` : 'does not fit' });
    if (lengthCm <= 0)
      warnings.push(`A ${portLabel(d)} port cannot tune ${fmt(chamberL)} L to ${fmt(d.tuneHz)} Hz: the length comes out negative. Use a narrower port, a smaller chamber or a lower tuning.`);
    markers.push({ f: d.tuneHz, label: 'fb' });
    // Cookbook p. 69-71: smallest vent from the displacement volume, and the cone-to-vent area ratio
    const vd = P.displacementVolume(driver);
    const dMin = P.minVentDiameterM(vd, d.tuneHz);
    const dNow = portEquivDiameterM(d);
    extras.push({ label: 'Smallest vent (Cookbook)', value: `${fmt(dMin * 100)} cm (Small's stricter bound ${fmt(P.minVentDiameterConservativeM(vd, d.tuneHz) * 100)} cm)` });
    if (dNow < dMin) warnings.push(`The vent is ${fmt(dNow * 100)} cm across; the Cookbook's minimum for this driver and tuning is ${fmt(dMin * 100)} cm. Expect port noise and compression.`);
    const ratio = P.ventAreaRatio(driver.sd, portAreaM2(d));
    if (ratio > 9) warnings.push(`The cone is ${fmt(ratio)} times the vent's area. The Cookbook allows 9:1 at most and wants 4:1 or better for a clean vent.`);
    else if (ratio > 4) notes.push(`Cone to vent area is ${fmt(ratio)}:1; the Cookbook calls 4:1 or better reasonably linear.`);
  };

  if (d.type === 'horn') {
    const g = hornGeometry(d, wallM);
    const sim = (joints: readonly P.Joint[]): Record<keyof Point, number[]> => {
      const raw = hornRaw(d, joints);
      return curvesOf(freqs.map((f) => toPoint(raw, d, f)));
    };
    curves = sim(g.built ?? g.ideal);
    if (g.built) {
      const ideal = sim(g.ideal);
      for (const k of KEYS) overlays[k] = [{ label: 'ideal flare', values: ideal[k] }];
    }
    const rear = d.horn.loading === 'rear';
    if (rear) {
      notes.push('Rear-loaded: the cone and the mouth are added as if they sat in the same place. The distance between them in a real cabinet is not modelled.');
    } else {
      // the plugin's lumped horn bin (a front-loaded model) for the same driver and geometry: no mouth reflections, same power normalisation
      const bin = P.hornModel(driver, derived, vb, g.flare.throatM2, g.flare.mouthM2, g.lengthM);
      overlays.responseDb = [...(overlays.responseDb ?? []), { label: 'plugin bin', values: freqs.map((f) => P.dB(P.abs(P.hornG(f, bin)))) }];
    }

    const stations = g.built ?? P.hornJoints(g.flare, 8);
    horn = { lengthM: g.lengthM, ideal: g.ideal, built: g.built, fold: g.fold, suggest: null, maxMouthCm2: null, suggestAtMax: null, table: stations.map((j) => ({ xCm: j.x * 100, areaCm2: j.area * 1e4, heightCm: (j.area * 1e4) / d.horn.widthCm })) };

    const conical = g.flare.kind === 'conical';
    readouts.push({ label: 'Length', value: `${g.lengthM.toFixed(2)} m` });
    if (!conical) {
      const full = P.hornMinMouthArea(g.flare.cutoffHz);
      const pct = (100 * g.flare.mouthM2) / full;
      readouts.push({ label: 'Mouth, of full size for the cutoff', value: `${fmt(pct, 0)} %` });
      if (pct < 99.5) warnings.push(`The mouth is ${fmt(pct, 0)} % of the size its ${fmt(g.flare.cutoffHz)} Hz cutoff needs (circumference equal to the wavelength, ${fmt(full * 1e4, 0)} cm²): expect ripple above the cutoff.`);
      markers.push({ f: g.flare.cutoffHz, label: 'fc' });
    }
    readouts.push({ label: 'Mouth area', value: `${fmt(g.flare.mouthM2 * 1e4, 0)} cm²` }, { label: 'Horn air volume', value: `${fmt(P.hornVolume(g.built ?? g.ideal) * 1000)} L` }, { label: 'Compression ratio (Sd : throat)', value: `${(driver.sd / g.flare.throatM2).toFixed(2)} : 1` });

    if (g.flare.mouthM2 < d.horn.mouthCm2 * 1e-4 - 1e-9 && g.flare.kind === 'tractrix') notes.push(`A tractrix mouth cannot be larger than its cutoff's full mouth, so ${fmt(g.flare.mouthM2 * 1e4, 0)} cm² is used.`);
    if (g.flare.throatM2 < d.horn.throatCm2 * 1e-4 - 1e-9) notes.push(`The throat is held to ${fmt(g.flare.throatM2 * 1e4, 0)} cm², half the tractrix's full mouth.`);
    if (g.fold) {
      const f = g.fold;
      const fm = (v: number): string => fmt(v * 100, 0);
      readouts.push({ label: `Folded box (${d.horn.legs} legs), outside`, value: `${fm(f.wO)} x ${fm(f.hO)} x ${fm(f.dO)} cm` }, { label: 'Depth the folds need (outside)', value: `${fm(f.minDepthI + 2 * wallM)} cm` });
      if (f.dI > d.horn.depthCm / 100 - 2 * wallM + 1e-9) warnings.push(`${d.horn.legs} legs need ${fm(f.minDepthI + 2 * wallM)} cm of outside depth and ${fmt(d.horn.depthCm, 0)} cm was asked for: the box is built ${fm(f.minDepthI + 2 * wallM)} cm deep. Use more folds, a wider horn or more depth.`);
      else if (f.dI > f.minDepthI * 1.25) warnings.push(`The box is ${fm(f.dO)} cm deep but ${d.horn.legs} legs need only ${fm(f.minDepthI + 2 * wallM)} cm: fewer legs or less depth would do.`);
      if (!f.feasible) warnings.push(`${d.horn.legs} folds cannot fit this flare at ${fmt(d.horn.widthCm, 0)} cm wide: the turns alone are longer than the horn (the last leg would be ${fm(f.heights[f.heights.length - 1]!)} cm tall). Use fewer folds, a wider horn, a smaller mouth area or a lower mouth area limit.`);
      if (!f.mouthAtFront) warnings.push('An odd number of legs ends the horn at the back of the box. Use an even number so the mouth is on the front.');
      const fine = f.feasible && f.mouthAtFront && f.dI <= d.horn.depthCm / 100 - 2 * wallM + 1e-9 && f.dI <= f.minDepthI * 1.25;
      if (!fine) {
        const sug = P.suggestFold(g.flare, d.horn.widthCm / 100, wallM, d.horn.foldStyle);
        if (sug) {
          horn!.suggest = sug;
          warnings.push(`Recommended fold for this flare: ${sug.legs} legs, ${fmt(sug.widthM * 100, 0)} cm wide, ${fmt(sug.depthOutM * 100, 0)} cm deep (outside). The button under the fold settings applies it.`);
        } else {
          const mm = P.maxFoldableMouthM2(g.flare, d.horn.widthCm / 100, wallM, d.horn.foldStyle);
          horn!.maxMouthCm2 = mm === null ? null : Math.floor(mm * 1e4);
          if (mm !== null) horn!.suggestAtMax = P.suggestFold({ ...g.flare, mouthM2: horn!.maxMouthCm2! * 1e-4 }, d.horn.widthCm / 100, wallM, d.horn.foldStyle);
          warnings.push(mm === null ? `No fold of this flare fits a box up to ${P.FOLD_MAX_DEPTH_M} m deep and ${P.FOLD_MAX_WIDTH_M} m wide, even with the smallest mouth at ${fmt(d.horn.widthCm, 0)} cm wide. Make the horn wider or the throat smaller.` : `No fold of a ${fmt(g.flare.mouthM2 * 1e4, 0)} cm² mouth fits a box up to ${P.FOLD_MAX_DEPTH_M} m deep and ${P.FOLD_MAX_WIDTH_M} m wide. A mouth of up to ${fmt(Math.floor(mm * 1e4), 0)} cm² folds; the button under the fold settings sets it.`);
        }
      }
      notes.push(f.style === 'tapered' ? 'Folded, tapered (scoop): the horn is simulated as legs that widen along their length, with the flare height at each end, and the turns. Bend reflections and losses are not modelled.' : 'Folded: the horn is simulated as the legs and turns, with the flare height at the middle of each leg, so the response includes that staircase. Bend reflections and losses are not modelled.');
    }
    if (g.built && !g.fold) {
      const given = d.horn.panelsCm.split(/[,;\s]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0).reduce((a, b) => a + b, 0);
      if (Math.abs(given - g.lengthM * 100) > 0.01 * g.lengthM * 100) warnings.push(`The panel lengths add up to ${fmt(given)} cm but the flare is ${fmt(g.lengthM * 100)} cm long: the last panel was ${given > g.lengthM * 100 ? 'cut short' : 'stretched'} to end at the mouth.`);
    }
    const trustHz = P.C / (2 * Math.PI * Math.sqrt(g.flare.mouthM2 / Math.PI));
    notes.push(`One-dimensional lossless model: no bends, half-space radiation. The response is radiated power, with no directivity: a real horn is louder than this on its axis above about ${fmt(trustHz, 0)} Hz (where this mouth starts to beam), and the plane-wave model is least sure up there.`);
    if (d.driverClass === HF_CLASS) notes.push('Compression drivers rarely publish Thiele-Small values. The "1 in HF" class is a stand-in, so read this response as a sketch.');
  } else {
    const raw = directRaw(d);
    curves = curvesOf(freqs.map((f) => toPoint(raw, d, f)));
    if (d.type === 'sealed') {
      const s = P.sealedParams(driver.fs, derived.qts, driver.vasM3, vb);
      readouts.push({ label: 'Box resonance fc', value: `${fmt(s.fc)} Hz` }, { label: 'Qtc', value: s.qtc.toFixed(3) }, { label: 'F3', value: `${fmt(P.sealedF3(s.fc, s.qtc))} Hz` });
      markers.push({ f: s.fc, label: 'fc' });
    } else if (d.type === 'ported') {
      const f3 = P.ventedF3(driver.fs, derived.qts, driver.vasM3 / vb, d.tuneHz, d.qL > 0 ? d.qL : undefined);
      readouts.push({ label: 'F3', value: f3 > 0 ? `${fmt(f3)} Hz` : 'none below 4 Fs' });
      port(d.volumeL);
      if (d.qL === 0) notes.push('Lossless box (QL = infinity). The Cookbook designs ported boxes at QL = 7; set the box losses to see a realistic response.');
    } else if (d.type === 'passive') {
      const pr = prOf(d);
      const ql = d.qL > 0 ? d.qL : undefined;
      const xp = freqs.map((f) => P.abs(P.passiveXp(f, driver, derived, pr.radiator, pr.alpha, ql)) * P.peakVoltsForPower(d.powerW, driver.re) * 1000);
      const f3 = f3Of(freqs, curves.responseDb);
      readouts.push(
        { label: 'F3', value: f3 > 0 ? `${fmt(f3)} Hz` : 'none in the plot' },
        { label: 'Box compliance ratio (Vas / Vb)', value: pr.alpha.toFixed(2) },
        { label: 'Radiator compliance ratio delta (Vap / Vb)', value: pr.delta.toFixed(2) },
        { label: 'Box tuning fB', value: `${fmt(pr.fbHz)} Hz` },
        { label: 'Radiator resonance fp', value: `${fmt(pr.fpHz)} Hz` },
        { label: 'Mass to add to the radiator', value: pr.addedKg >= 0 ? `${fmt(pr.addedKg * 1000, 0)} g` : 'none: already heavier than the tuning needs' },
        { label: `Radiator excursion at ${fmt(d.powerW)} W (peak)`, value: `${fmt(Math.max(...xp))} mm` },
      );
      markers.push({ f: pr.fbHz, label: 'fB' });
      if (pr.addedKg < 0) warnings.push(`The radiator alone is heavier than ${fmt(d.tuneHz)} Hz needs: it tunes the box to ${fmt(pr.fbHz)} Hz. Use a lighter or more compliant radiator, or tune higher.`);
      if (Math.max(...xp) > d.pr.xmaxMm) warnings.push(`At ${fmt(d.powerW)} W the radiator moves ${fmt(Math.max(...xp))} mm, past its ${fmt(d.pr.xmaxMm)} mm Xmax. The Cookbook's radiator travels more than twice the driver: use a larger or more compliant radiator or less power.`);
      if (derived.qts > 0.5) warnings.push(`Qts ${derived.qts.toFixed(2)} is above 0.5: the Cookbook finds no usable passive-radiator alignment there (flat QB3 holds to about 0.35, ripple to 0.44).`);
      if (d.qL === 0) notes.push('Lossless box. The Cookbook designs passive radiators at QL = 7.');
      notes.push("The Cookbook prints no transfer function for the passive radiator (\"same as vented\"); this is the circuit worked out, and it reproduces the book's Table 3.1 rows (Qts 0.26: alpha 4.33, fB/fs 1.73, f3/fs 1.98) to a few percent.");
    } else if (d.type === 'tline') {
      const geo = tlGeometryOf(d);
      const fp = P.C / (4 * geo.lengthM);
      const f3 = f3Of(freqs, curves.responseDb);
      const lineV = tlLineVolumeM3(geo);
      readouts.push(
        { label: 'F3', value: f3 > 0 ? `${fmt(f3)} Hz` : 'none in the plot' },
        { label: 'Line resonance fp = c / 4L', value: `${fmt(fp)} Hz` },
        { label: 'Line air volume (with the chamber)', value: `${fmt((lineV + geo.chamberM3) * 1000)} L` },
        { label: 'Stuffing', value: `${fmt(P.densityKgM3(d.tl.densityLb) * lineV * geo.stuffedShare, 2)} kg (${fmt(d.tl.densityLb, 2)} lb/ft³ over ${fmt(d.tl.stuffedPct, 0)} % of the line)` },
        { label: 'Book density for +-1 dB ripple', value: `${fmt(P.stuffingDensityLb(d.tl.stuffing, geo.lengthM), 2)} lb/ft³` },
      );
      markers.push({ f: fp, label: 'fp' });
      if (geo.exitM2 > geo.startM2) warnings.push('The exit is larger than the start: the Cookbook tapers the line toward the exit (1:3 to 1:4).');
      if (geo.startM2 < driver.sd * 0.75) warnings.push(`The line is narrower at the driver than the cone (${fmt(geo.startM2 * 1e4, 0)} against ${fmt(driver.sd * 1e4, 0)} cm²): it chokes the rear of the cone.`);
      if (d.tl.stuffedPct > 85) warnings.push('The book leaves about the last 20 % of the line unstuffed, or lighter near the driver.');
      if (d.tl.densityLb < 0.7 * P.stuffingDensityLb(d.tl.stuffing, geo.lengthM)) warnings.push("Less stuffing than the Cookbook's table for this length: expect ripple and a peak near the line resonance.");
      notes.push("Simulated line: a stuffed, tapered tube (Delany-Bazley fibre) driven from the cone's rear. The Cookbook gives rules and tables, not a model; this reproduces its tables' f3 within about 15 % and is a guide, not a prediction. Exit directivity and bends are not modelled; the cut list builds the line as one box with a septum.");
    } else {
      const pb = passband(freqs, curves.responseDb);
      readouts.push({ label: 'Peak', value: `${pb.peakDb >= 0 ? '+' : ''}${fmt(pb.peakDb)} dB at ${fmt(pb.peakHz)} Hz` }, { label: 'Passband (-3 dB from peak)', value: `${fmt(pb.loHz)} to ${fmt(pb.hiHz)} Hz` });
      port(d.frontVolumeL);
    }
  }

  if (d.type === 'sealed' || d.type === 'ported' || d.type === 'passive') {
    // Cookbook pp. 37-38, 75-76: reference efficiency, displacement-limited output and the input that reaches it
    const eta0 = P.referenceEfficiency(driver);
    extras.push({ label: 'Reference efficiency', value: `${fmt(eta0 * 100, 2)} % (about ${fmt(P.referenceSpl(eta0))} dB at 1 W, 1 m)` });
    const f3 = f3Of(freqs, curves.responseDb);
    if (f3 > 0 && d.type !== 'passive') {
      const kp = d.type === 'sealed' ? P.closedKp(P.sealedParams(driver.fs, derived.qts, driver.vasM3, vb).qtc) : P.VENTED_KP;
      const par = P.maxAcousticPower(f3, P.displacementVolume(driver), kp);
      const per = P.electricalPowerFor(par, eta0);
      extras.push({ label: 'Displacement-limited output (Par)', value: `${fmt(par, 2)} W acoustic, ${fmt(P.powerSpl(par))} dB at 1 m` }, { label: 'Input that reaches it (Per)', value: `${fmt(per, 0)} W against ${fmt(driver.pe, 0)} W rated` });
      if (per > driver.pe * 1.5) notes.push('The thermal rating comes first: the driver cannot be driven as far as its displacement limit.');
    }
    const ebp = driver.fs / driver.qes;
    notes.push(`EBP (Fs / Qes) is ${fmt(ebp, 0)}: the Cookbook suggests about 50 or less for a sealed box and about 100 or more for a vented one.`);
  }

  const xmaxMm = driver.xmax * 1000;
  let over = -1;
  curves.excursionMm.forEach((x, k) => {
    if (x > xmaxMm) over = k;
  });
  if (over >= 0) warnings.push(`At ${fmt(d.powerW)} W the cone exceeds Xmax (${fmt(xmaxMm)} mm) at some frequencies below ${fmt(freqs[Math.min(over + 1, freqs.length - 1)]!)} Hz.`);
  if (d.powerW > driver.pe) warnings.push(`${fmt(d.powerW)} W is above the driver's rated power (${fmt(driver.pe)} W).`);
  if (d.driverClass === CUSTOM_CLASS && d.custom.qms < d.custom.qts * 1.05)
    warnings.push(`Qms must be above Qts: it is treated as ${(d.custom.qts * 1.05).toFixed(2)} so Qes stays positive.`);

  return { driver, derived, freqs, curves, overlays, readouts, extras, warnings, notes, markers: markers.filter((m) => m.f >= freqs[0]! && m.f <= freqs[freqs.length - 1]!), horn };
}
