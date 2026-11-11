// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The design a user edits and everything derived from it. Pure functions, no UI: the page only draws what
// compute() returns, and the tests assert the same path against the shared physics vectors.
import * as P from '@soundsystemdesigner/physics';

export type BoxKind = 'sealed' | 'ported' | 'bandpass' | 'horn';
export const BOX_KINDS: readonly { id: BoxKind; label: string }[] = [
  { id: 'sealed', label: 'Sealed' },
  { id: 'ported', label: 'Ported' },
  { id: 'bandpass', label: 'Band-pass' },
  { id: 'horn', label: 'Horn' },
];

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
}

export type PlotRange = 'low' | 'high';
export const PLOT_RANGES: Record<PlotRange, { label: string; min: number; max: number }> = {
  low: { label: '10 Hz to 2 kHz', min: 10, max: 2000 },
  high: { label: '100 Hz to 20 kHz', min: 100, max: 20000 },
};

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

export type BoxField = 'volumeL' | 'tuneHz' | 'frontVolumeL' | 'portDiameterCm' | 'powerW';
export const BOX_RANGES: Record<BoxField, Range> = {
  volumeL: { label: 'Volume', unit: 'L', min: 0.1, max: 1000 },
  tuneHz: { label: 'Tuning', unit: 'Hz', min: 10, max: 200 },
  frontVolumeL: { label: 'Front volume', unit: 'L', min: 1, max: 1000 },
  portDiameterCm: { label: 'Port diameter', unit: 'cm', min: 2, max: 40 },
  powerW: { label: 'Amp power', unit: 'W', min: 1, max: 5000 },
};

export type HornField = 'cutoffHz' | 't' | 'throatCm2' | 'mouthCm2' | 'lengthM' | 'throatChamberL' | 'widthCm';
export const HORN_RANGES: Record<HornField, Range> = {
  cutoffHz: { label: 'Flare cutoff', unit: 'Hz', min: 15, max: 2000 },
  t: { label: 'T', unit: '', min: 0, max: 1, linear: true },
  throatCm2: { label: 'Throat area', unit: 'cm²', min: 1, max: 5000 },
  mouthCm2: { label: 'Mouth area', unit: 'cm²', min: 2, max: 60000 },
  lengthM: { label: 'Length', unit: 'm', min: 0.05, max: 6 },
  throatChamberL: { label: 'Throat chamber', unit: 'L', min: 0, max: 50, linear: true },
  widthCm: { label: 'Horn width', unit: 'cm', min: 5, max: 300 },
};

export const DEFAULT_DESIGN: Design = {
  driverClass: 3,
  custom: { ...P.CUSTOM_DRIVER_DEFAULTS },
  type: 'ported',
  volumeL: 150,
  tuneHz: 40,
  frontVolumeL: 100,
  portDiameterCm: 10,
  powerW: 100,
  plotRange: 'low',
  horn: { loading: 'front', flare: 'exponential', cutoffHz: 40, t: 0.6, throatCm2: 500, mouthCm2: 8000, lengthM: 1.5, throatChamberL: 2, widthCm: 60, panelsCm: '' },
};

/** Generic starting points. Invented values, not any product. */
export const HORN_PRESETS: readonly { label: string; patch: Partial<Design> }[] = [
  { label: 'Bass horn', patch: { driverClass: 3, volumeL: 60, plotRange: 'low', horn: { ...DEFAULT_DESIGN.horn } } },
  { label: 'Scoop', patch: { driverClass: 3, plotRange: 'low', horn: { ...DEFAULT_DESIGN.horn, loading: 'rear', throatCm2: 600, mouthCm2: 6000, throatChamberL: 40 } } },
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
  };
  for (const k of Object.keys(HORN_RANGES) as HornField[]) horn[k] = num(h[k], HORN_RANGES[k], d.horn[k]);
  const out: Design = {
    ...d,
    driverClass: typeof i.driverClass === 'number' && Number.isInteger(i.driverClass) ? classOf(i.driverClass) : d.driverClass,
    custom,
    type: BOX_KINDS.some((k) => k.id === i.type) ? (i.type as BoxKind) : d.type,
    plotRange: i.plotRange === 'high' || i.plotRange === 'low' ? i.plotRange : d.plotRange,
    horn,
  };
  for (const k of Object.keys(BOX_RANGES) as BoxField[]) out[k] = num(i[k], BOX_RANGES[k], d[k]);
  return out;
}

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

function directRaw(d: Design): (f: number) => Raw {
  const box: P.BoxParams = { driver: driverOf(d), type: d.type === 'horn' ? 'sealed' : d.type, volumeL: d.volumeL, tuneHz: d.tuneHz, frontVolumeL: d.frontVolumeL, hornThroatCm2: 600, hornMouthCm2: 4000, hornLengthM: 1 };
  return (f) => ({ g: P.boxResponse(box, f), x: P.boxDisplacement(box, f), z: P.boxImpedance(box, f) });
}

/** The horn as it is simulated: the builder's panels when given, else the ideal flare in IDEAL_SEGMENTS pieces. */
function hornGeometry(d: Design): { flare: P.Flare; lengthM: number; ideal: P.Joint[]; built: P.Joint[] | null } {
  const flare = flareOf(d);
  const lengthM = P.flareLength(flare);
  const xs = panelJointsCm(d.horn.panelsCm, lengthM * 100);
  return { flare, lengthM, ideal: P.hornJoints(flare, IDEAL_SEGMENTS), built: xs && P.hornJointsAt(flare, xs.map((x) => x / 100)) };
}

/**
 * The design as a function of frequency: response g (relative to the driver's direct-radiator passband), cone
 * displacement per volt x, and impedance z. A horn is simulated as built when panels are given. The geometry is
 * worked out once, so call this once and reuse the function across frequencies.
 */
export function rawEvaluator(d: Design): (f: number) => Raw {
  if (d.type !== 'horn') return directRaw(d);
  const g = hornGeometry(d);
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

export function compute(d: Design): Computed {
  const driver = driverOf(d);
  const derived = P.deriveDriver(driver);
  const freqs = plotFreqs(d.plotRange);
  const readouts: Readout[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  const markers: Computed['markers'] = [];
  const overlays: Computed['overlays'] = {};
  const vb = d.volumeL / 1000;
  let curves: Record<keyof Point, number[]>;
  let horn: HornView | null = null;

  const port = (chamberL: number): void => {
    const lengthCm = P.portLengthM(chamberL / 1000, d.tuneHz, d.portDiameterCm / 100) * 100;
    readouts.push({ label: `Port length (${fmt(d.portDiameterCm)} cm round)`, value: lengthCm > 0 ? `${fmt(lengthCm)} cm` : 'does not fit' });
    if (lengthCm <= 0)
      warnings.push(`A ${fmt(d.portDiameterCm)} cm port cannot tune ${fmt(chamberL)} L to ${fmt(d.tuneHz)} Hz: the length comes out negative. Use a narrower port, a smaller chamber or a lower tuning.`);
    markers.push({ f: d.tuneHz, label: 'fb' });
  };

  if (d.type === 'horn') {
    const g = hornGeometry(d);
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
    horn = { lengthM: g.lengthM, ideal: g.ideal, built: g.built, table: stations.map((j) => ({ xCm: j.x * 100, areaCm2: j.area * 1e4, heightCm: (j.area * 1e4) / d.horn.widthCm })) };

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
    if (g.built) {
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
      const f3 = P.ventedF3(driver.fs, derived.qts, driver.vasM3 / vb, d.tuneHz);
      readouts.push({ label: 'F3', value: f3 > 0 ? `${fmt(f3)} Hz` : 'none below 4 Fs' });
      port(d.volumeL);
    } else {
      const pb = passband(freqs, curves.responseDb);
      readouts.push({ label: 'Peak', value: `${pb.peakDb >= 0 ? '+' : ''}${fmt(pb.peakDb)} dB at ${fmt(pb.peakHz)} Hz` }, { label: 'Passband (-3 dB from peak)', value: `${fmt(pb.loHz)} to ${fmt(pb.hiHz)} Hz` });
      port(d.frontVolumeL);
    }
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

  return { driver, derived, freqs, curves, overlays, readouts, warnings, notes, markers: markers.filter((m) => m.f >= freqs[0]! && m.f <= freqs[freqs.length - 1]!), horn };
}
