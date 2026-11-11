// C1 pass condition: the car install's response is the spec chain (box response, wiring, cabin gain), its limits follow the amp and
// the wiring, and its enclosure holds the designed air, fits or says it does not.
import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import * as B from '../src/buildlist';
import * as C from '../src/carsub';
import { layout3d } from '../src/layout3d';
import * as M from '../src/model';
import * as S from '../src/system';

const cls = (name: string): number => P.ALL_DRIVER_CLASSES.findIndex((d) => d.name === name);
const car = (edit: (c: C.CarSub) => void = () => {}): C.CarSub => {
  const c = structuredClone(C.DEFAULT_CAR);
  edit(c);
  return C.sanitizeCar(c);
};
const project = (c: C.CarSub, more: Partial<S.Project> = {}): S.Project => S.sanitizeProject({ ...S.DEFAULT_PROJECT, kind: 'car', car: c, ...more });
const dbOf = (z: P.Cx): number => P.dB(P.abs(z));

describe('sanitise', () => {
  it('garbage becomes the default; numbers are clamped; wiring is made consistent', () => {
    expect(C.sanitizeCar(null)).toEqual(C.DEFAULT_CAR);
    const s = C.sanitizeCar({ count: 99, series: 3, coils: 7, coilSeries: 2, ampPowerW: 1e9, ampLoadOhm: 3, ampMinLoadOhm: 9, subsonicHz: 0, taper: 5, shape: 'x', cabin: 'x', bridged: 'y' });
    expect(s.count).toBe(4);
    expect(s.series).toBe(1); // 3 does not divide 4
    expect(s.coils).toBe(2);
    expect(s.coilSeries).toBe(2);
    expect(s.ampPowerW).toBe(20000);
    expect(s.ampLoadOhm).toBe(C.DEFAULT_CAR.ampLoadOhm);
    expect(s.ampMinLoadOhm).toBe(C.DEFAULT_CAR.ampMinLoadOhm);
    expect(s.subsonicHz).toBe(10);
    expect(s.taper).toBe(1);
    expect(s.shape).toBe('box');
    expect(s.cabin).toBe(C.DEFAULT_CAR.cabin);
    expect(s.bridged).toBe(false);
    expect(C.sanitizeCar({ count: 4, series: 2 }).series).toBe(2);
    expect(C.sanitizeCar({ coils: 1, coilSeries: 2 }).coilSeries).toBe(1); // a single coil has nothing to put in series
    expect(C.sanitizeCar({ shape: 'wedge', bridged: true, coils: 1 })).toMatchObject({ shape: 'wedge', bridged: true, coils: 1 });
    expect(C.sanitizeCar({ ampLoadOhm: 0.5, ampMinLoadOhm: 0.5 })).toMatchObject({ ampLoadOhm: 0.5, ampMinLoadOhm: 0.5 });
  });
  it('a space preset sets its size; only Custom keeps typed sizes', () => {
    expect(C.sanitizeCar({ space: { id: 'under-seat', wCm: 5, hCm: 5, dCm: 5 } }).space).toEqual({ id: 'under-seat', wCm: 60, hCm: 14, dCm: 30 });
    expect(C.sanitizeCar({ space: { id: 'custom', wCm: 70, hCm: 20, dCm: 33 } }).space).toEqual({ id: 'custom', wCm: 70, hCm: 20, dCm: 33 });
    expect(C.sanitizeCar({ space: { id: 'custom', wCm: 1e6 } }).space.wCm).toBe(300);
    expect(C.sanitizeCar({ space: { id: 'nope' } }).space.id).toBe('none');
  });
  it('the project carries the install and old projects open with the default', () => {
    expect(S.sanitizeProject({}).car).toEqual(C.DEFAULT_CAR);
    expect(S.sanitizeProject({ kind: 'car' }).kind).toBe('car');
    const { car: _c, ...old } = S.DEFAULT_PROJECT;
    void _c;
    expect(S.sanitizeProject(old).car).toEqual(C.DEFAULT_CAR);
  });
});

describe('the response is the spec chain', () => {
  it('equals the box response x wiring gain x the cabin shelf, from the reference pressure', () => {
    const c = car((x) => {
      x.count = 2;
      x.coils = 2;
      x.coilSeries = 1;
    });
    const ev = C.carEvaluator(c);
    const driver = M.driverOf(c.design);
    const each = { ...c.design, volumeL: c.design.volumeL / 2, frontVolumeL: c.design.frontVolumeL / 2 };
    const w = P.carWiring(2, 1, 2, 1);
    for (const f of [20, 40, 80, 160]) {
      const want = P.scale(P.mul(M.rawEvaluator(each)(f).g, P.cabinGain(f, c.cabin)), P.referencePressure(driver, M.REF_VOLTS) * 10 ** (w.levelGainDb / 20));
      expect(dbOf(ev.inCar(f))).toBeCloseTo(dbOf(want), 9);
    }
  });
  it('the cabin adds its gain at the bottom and nothing at the top, and "open" changes nothing', () => {
    const v = C.computeCarSub(car());
    expect(v.cabinDb[0]!).toBeGreaterThan(7);
    expect(Math.abs(v.cabinDb[v.cabinDb.length - 1]!)).toBeLessThan(0.5);
    v.levelDb.forEach((l, i) => expect(l - v.freeDb[i]!).toBeCloseTo(v.cabinDb[i]!, 9));
    const open = C.computeCarSub(car((x) => (x.cabin = 'open')));
    open.levelDb.forEach((l, i) => expect(l).toBeCloseTo(open.freeDb[i]!, 9));
  });
  it('dual coils in parallel are 6 dB louder than in series; two subs 6 dB louder than one at the same voltage', () => {
    const lvl = (e: (x: C.CarSub) => void): number => C.computeCarSub(car((x) => { x.cabin = 'open'; e(x); })).averageDb;
    expect(lvl((x) => { x.coilSeries = 1; }) - lvl((x) => { x.coilSeries = 2; })).toBeCloseTo(6.02, 1);
    // two subs share the same total air, so each gets half: compare with the air doubled to keep each one's box
    const one = lvl((x) => { x.count = 1; x.design.volumeL = 40; });
    const two = lvl((x) => { x.count = 2; x.design.volumeL = 80; });
    expect(two - one).toBeCloseTo(6.02, 1);
  });
  it('the box response is shared by the subs: each sub sees its share of the air', () => {
    const a = C.carEvaluator(car((x) => { x.count = 2; x.design.volumeL = 80; }));
    const b = C.carEvaluator(car((x) => { x.count = 1; x.design.volumeL = 40; }));
    for (const f of [20, 40, 100]) expect(dbOf(a.inCar(f)) - dbOf(b.inCar(f))).toBeCloseTo(P.carWiring(2, 1, 2, 1).levelGainDb - P.carWiring(1, 1, 2, 1).levelGainDb, 9);
  });
});

describe('the default install', () => {
  it('is clean: no warnings in the model or the build, and a believable level', () => {
    const v = C.computeCarSub(C.DEFAULT_CAR);
    expect(v.warnings).toEqual([]);
    expect(B.computeBuild(project(C.DEFAULT_CAR)).warnings).toEqual([]);
    expect(v.averageDb).toBeGreaterThan(90);
    expect(v.averageDb).toBeLessThan(130);
    expect(v.levelDb.every(Number.isFinite)).toBe(true);
    expect(v.limits.cause).toBe('amp');
  });
});

describe('limits and the load', () => {
  it('the load follows the coils and the subs: a dual-3.6 in parallel is 1.8 ohm; four in parallel 0.45', () => {
    expect(C.computeCarSub(car()).loadOhm).toBeCloseTo(1.8, 12);
    expect(C.computeCarSub(car((x) => (x.coilSeries = 2))).loadOhm).toBeCloseTo(7.2, 12);
    expect(C.computeCarSub(car((x) => (x.count = 4))).loadOhm).toBeCloseTo(0.45, 12);
    expect(C.computeCarSub(car((x) => { x.coils = 1; x.count = 2; x.series = 2; })).loadOhm).toBeCloseTo(7.2, 12); // two single coils in series
  });
  it('a load under the amp\'s minimum warns; bridging doubles both the swing and the minimum', () => {
    const low = C.computeCarSub(car((x) => { x.count = 4; x.ampMinLoadOhm = 1; }));
    expect(low.warnings.some((w) => w.includes('under the amp'))).toBe(true);
    const ok = C.computeCarSub(car((x) => (x.ampMinLoadOhm = 1)));
    expect(ok.warnings.some((w) => w.includes('under the amp'))).toBe(false);
    const br = C.computeCarSub(car((x) => { x.bridged = true; x.ampPowerW = 500; x.ampLoadOhm = 4; x.ampMinLoadOhm = 2; }));
    expect(br.limits.ampV).toBeCloseTo(P.bridgedVolts(500, 4), 9);
    expect(br.limits.amplifierMinLoadOhm).toBe(4);
    const single = C.computeCarSub(car((x) => { x.bridged = false; x.ampPowerW = 500; x.ampLoadOhm = 4; x.ampMinLoadOhm = 2; }));
    expect(single.limits.ampV).toBeCloseTo(P.ampVolts(500, 4), 9);
    expect(single.limits.amplifierMinLoadOhm).toBe(2);
  });
  it('the limit is the lowest of the amp, the driver\'s heat and its cone; the cause names it', () => {
    const v = C.computeCarSub(car());
    expect(v.limits.limitV).toBe(Math.min(v.limits.ampV, v.limits.heatV, v.limits.excursionV));
    const weak = C.computeCarSub(car((x) => (x.ampPowerW = 50)));
    expect(weak.limits.cause).toBe('amp');
    const huge = C.computeCarSub(car((x) => { x.ampPowerW = 20000; x.ampLoadOhm = 4; x.subsonicHz = 10; }));
    expect(['heat', 'excursion']).toContain(huge.limits.cause);
    expect(huge.warnings.some((w) => w.includes('rated') || w.includes('Xmax'))).toBe(true);
    expect(v.limits.headroomDb).toBeCloseTo(20 * Math.log10(v.limits.limitV / M.REF_VOLTS), 9);
    expect(v.limits.maxDb).toBeCloseTo(v.averageDb + v.limits.headroomDb, 9);
  });
  it('the heat limit uses the dual coil load; the excursion limit the dual level factor', () => {
    const d = M.driverOf(C.DEFAULT_CAR.design);
    expect(C.computeCarSub(car()).limits.heatV).toBeCloseTo(P.thermalLimitVolts(d.pe, d.re * 0.5, 1), 9);
    expect(C.computeCarSub(car((x) => (x.coilSeries = 2))).limits.heatV).toBeCloseTo(P.thermalLimitVolts(d.pe, d.re * 2, 1), 9);
    expect(C.computeCarSub(car((x) => { x.count = 4; x.series = 2; })).limits.heatV).toBeCloseTo(P.thermalLimitVolts(d.pe, d.re * 0.5, 2), 9);
  });
  it('the cone limit halves when the coils go in parallel (twice the force per volt) and doubles with a series string of two subs', () => {
    const par = C.computeCarSub(car((x) => (x.coilSeries = 1))).limits.excursionV;
    const ser = C.computeCarSub(car((x) => (x.coilSeries = 2))).limits.excursionV;
    expect(ser / par).toBeCloseTo(2, 9);
    const four = (series: number): number => C.computeCarSub(car((x) => { x.count = 4; x.series = series; })).limits.excursionV;
    expect(four(2) / four(1)).toBeCloseTo(2, 9);
  });
  it('the headroom is for the limit, not the amp: a huge amp is cone or heat limited and the headroom says so', () => {
    const v = C.computeCarSub(car((x) => { x.ampPowerW = 20000; x.ampLoadOhm = 4; }));
    expect(v.limits.cause).not.toBe('amp');
    expect(v.limits.headroomDb).toBeCloseTo(20 * Math.log10(v.limits.limitV / M.REF_VOLTS), 9);
    expect(v.limits.headroomDb).toBeLessThan(20 * Math.log10(v.limits.ampV / M.REF_VOLTS) - 1);
  });
  it('the average level is the mean in-car level from 25 to 120 Hz', () => {
    const v = C.computeCarSub(C.DEFAULT_CAR);
    const xs = v.levelDb.filter((_, i) => v.freqs[i]! >= 25 && v.freqs[i]! <= 120);
    expect(v.averageDb).toBeCloseTo(xs.reduce((a, b) => a + b, 0) / xs.length, 12);
    expect(xs.length).toBeGreaterThan(40);
  });
  it('a lower subsonic filter lets the cone go further, so it stops sooner', () => {
    expect(C.computeCarSub(car((x) => (x.subsonicHz = 15))).limits.excursionV).toBeLessThan(C.computeCarSub(car((x) => (x.subsonicHz = 40))).limits.excursionV);
  });
  it('the amp makes its rated power into its rated load, and more into a lighter one (it is a voltage source)', () => {
    const rated = C.computeCarSub(car((x) => { x.ampPowerW = 1000; x.ampLoadOhm = 2; x.coils = 2; x.coilSeries = 2; })); // 2 x 3.6 = 7.2 ohm: lighter than 2 ohm? no, heavier
    expect(rated.limits.ampIntoLoadW).toBeCloseTo((1000 * 2) / 7.2, 9);
    const light = C.computeCarSub(car((x) => { x.ampPowerW = 1000; x.ampLoadOhm = 2; x.coils = 2; x.coilSeries = 1; })); // 1.8 ohm
    expect(light.limits.ampIntoLoadW).toBeCloseTo((1000 * 2) / 1.8, 9);
  });
});

describe('mount depth', () => {
  it('the car classes need depth; PA and custom classes need none assumed', () => {
    expect(C.mountDepthCm('12 in car sub')).toBe(14);
    expect(C.mountDepthCm('12 in shallow sub')).toBe(9);
    expect(C.mountDepthCm('18 in')).toBe(0);
    expect(Object.keys(C.MOUNT_DEPTH_CM).every((k) => cls(k) >= 0)).toBe(true);
    expect(C.mountDepthCm('10 in shallow sub')).toBeLessThan(C.mountDepthCm('10 in car sub'));
  });
});

describe('the enclosure', () => {
  const build = (c: C.CarSub, more: Partial<S.Project> = {}): B.BandBuild => B.computeBuild(project(c, more)).bands[0]!;
  const T = 0.018;

  it('a rectangular box holds the designed air once the drivers and ports are taken out', () => {
    const c = car((x) => { x.count = 2; x.design.volumeL = 60; x.space = { id: 'none', wCm: 0, hCm: 0, dCm: 0 }; });
    const g = build(c).cabinets[0]!.geometry;
    const disp = 2 * P.driverDisplacement(M.driverOf(c.design).sd);
    expect(g.wI * g.hI * g.dI - disp).toBeCloseTo(0.06, 9);
    expect(build(c).drivers).toEqual([{ name: '12 in car sub driver', qty: 2 }]);
    expect(build(c).count).toBe(1);
  });
  it('a ported box gets one port per sub, each for its share of the air, and the tubes are taken out of the air', () => {
    const c = car((x) => {
      x.count = 2;
      x.design = { ...x.design, type: 'ported', volumeL: 80, tuneHz: 36, portDiameterCm: 7 };
      x.space = { id: 'none', wCm: 0, hCm: 0, dCm: 0 };
    });
    const b = build(c);
    const len = P.portLengthM(0.04, 36, 0.07);
    expect(b.ports).toHaveLength(2);
    for (const p of b.ports) expect(p.lengthM).toBeCloseTo(len, 12);
    const g = b.cabinets[0]!.geometry;
    const disp = 2 * P.driverDisplacement(M.driverOf(c.design).sd) + 2 * P.portDisplacement(0.07, len);
    expect(g.wI * g.hI * g.dI - disp).toBeCloseTo(0.08, 9);
    expect(B.holePositions(b.cabinets[0]!).map((h) => h.kind)).toEqual(['driver', 'driver', 'port', 'port']);
  });
  it('drivers sit in a row across the baffle; the ports join the row when it fits and go in a row under when it does not', () => {
    const base = (x: C.CarSub): void => {
      x.count = 2;
      x.design = { ...x.design, driverClass: cls('8 in car sub'), type: 'ported', volumeL: 80, tuneHz: 40, portDiameterCm: 7 };
      x.space = { id: 'none', wCm: 0, hCm: 0, dCm: 0 };
    };
    // a box about 0.48 m wide: the two 8 in drivers fit a row, the ports as well do not
    const narrow = build(car((x) => { base(x); x.build = { ...x.build, rw: 1, rh: 1, rd: 1 }; })).cabinets[0]!;
    const [a, b, p1, p2] = B.holePositions(narrow);
    expect(narrow.geometry.wO).toBeGreaterThan(0.404);
    expect(narrow.geometry.wO).toBeLessThan(0.604);
    expect(a!.cy).toBeCloseTo(b!.cy, 12);
    expect(a!.cx).toBeLessThan(b!.cx);
    expect(b!.cx - b!.r - (a!.cx + a!.r)).toBeCloseTo(B.HOLE_GAP, 12);
    expect((a!.cx - a!.r + (b!.cx + b!.r)) / 2).toBeCloseTo(narrow.geometry.wO / 2, 12); // centred
    expect(p1!.cy).toBeGreaterThan(a!.cy);
    expect(p1!.cy).toBeCloseTo(p2!.cy, 12);
    expect(p1!.cx).toBeLessThan(p2!.cx);
    expect(p2!.cy - a!.cy).toBeCloseTo(a!.r + B.HOLE_GAP + p2!.r, 12); // the second row starts a gap under the first
    // a wide box: one row, drivers then ports, all on one centre line
    const wide = build(car((x) => { base(x); x.build = { ...x.build, rw: 3, rh: 1, rd: 1 }; })).cabinets[0]!;
    const hs = B.holePositions(wide);
    expect(hs.map((h) => h.kind)).toEqual(['driver', 'driver', 'port', 'port']);
    for (const h of hs) expect(h.cy).toBeCloseTo(hs[0]!.cy, 12);
    for (let i = 1; i < hs.length; i++) expect(hs[i]!.cx - hs[i]!.r - (hs[i - 1]!.cx + hs[i - 1]!.r)).toBeCloseTo(B.HOLE_GAP, 12);
    expect(hs[0]!.cy).toBeCloseTo(wide.geometry.hO / 2, 12);
  });
  it('holes that do not fit the width or the height are warned about; a box that suits the drivers is clean', () => {
    const cleanBox = car((x) => { x.design.volumeL = 40; x.space = { id: 'none', wCm: 0, hCm: 0, dCm: 0 }; });
    expect(build(cleanBox).warnings).toEqual([]);
    const narrow = build(car((x) => { x.count = 2; x.design.volumeL = 20; x.space = { id: 'none', wCm: 0, hCm: 0, dCm: 0 }; x.build = { ...x.build, rw: 1, rh: 3, rd: 3 }; }));
    expect(narrow.warnings.some((w) => w.includes('wide baffle'))).toBe(true);
    const flat = build(car((x) => { x.design.volumeL = 40; x.space = { id: 'none', wCm: 0, hCm: 0, dCm: 0 }; x.build = { ...x.build, rw: 4, rh: 0.5, rd: 3 }; }));
    expect(flat.warnings.some((w) => w.includes('high baffle'))).toBe(true);
  });
  it('a band-pass install is built the way a PA band-pass is: a box and a divider for each sub', () => {
    const c = car((x) => { x.count = 2; x.design = { ...x.design, type: 'bandpass', volumeL: 60, frontVolumeL: 40, tuneHz: 45, portDiameterCm: 6 }; x.space = { id: 'none', wCm: 0, hCm: 0, dCm: 0 }; });
    const b = build(c);
    expect(b.count).toBe(2);
    expect(b.cabinets[0]!.panels.some((p) => p.name === 'Divider')).toBe(true);
    expect(build(car((x) => { x.shape = 'wedge'; x.design = { ...x.design, type: 'bandpass', tuneHz: 45, portDiameterCm: 6, frontVolumeL: 30 }; })).warnings.some((w) => w.includes('built rectangular'))).toBe(true);
  });
  it('a horn is built as a sealed box with a warning', () => {
    expect(build(car((x) => (x.design = { ...x.design, type: 'horn' }))).warnings.some((w) => w.includes('horn is built as a sealed'))).toBe(true);
  });

  describe('wedge', () => {
    const wedge = (more: (x: C.CarSub) => void = () => {}): C.CarSub => car((x) => { x.shape = 'wedge'; x.taper = 0.5; x.space = { id: 'none', wCm: 0, hCm: 0, dCm: 0 }; x.build = { ...x.build, rw: 1, rh: 1.2, rd: 1.5 }; more(x); });
    it('holds the designed air: interior volume w h (dBottom + dTop) / 2 less the drivers', () => {
      const c = wedge((x) => (x.design.volumeL = 50));
      const cab = build(c).cabinets[0]!;
      const w = cab.wedge!;
      expect((w.wI * w.hI * (w.dBottomI + w.dTopI)) / 2 - P.driverDisplacement(M.driverOf(c.design).sd)).toBeCloseTo(0.05, 9);
      expect(w.dTopI / w.dBottomI).toBeCloseTo(0.5, 12);
      expect(w.netM3).toBeCloseTo(0.05, 9);
    });
    it('cuts a back, a sloping baffle, a bottom, a top and two sides', () => {
      const cab = build(wedge()).cabinets[0]!;
      expect(cab.panels.map((p) => [p.name, p.qty])).toEqual([['Back', 1], ['Front baffle', 1], ['Bottom', 1], ['Top', 1], ['Sides', 2]]);
      const w = cab.wedge!;
      const slant = cab.panels.find((p) => p.name === 'Front baffle')!;
      expect(slant.w).toBeCloseTo(Math.hypot(w.hO, w.dBottomI - w.dTopI), 12);
      expect(slant.w).toBeGreaterThan(w.hO);
      expect(cab.panels.find((p) => p.name === 'Top')!.w).toBeCloseTo(w.dTopI, 12);
      expect(cab.panels.find((p) => p.name === 'Bottom')!.w).toBeCloseTo(w.dBottomI, 12);
    });
    it('the baffle drawing is the sloping face, and the caption gives the box\'s outside size', () => {
      const cab = build(wedge()).cabinets[0]!;
      expect(cab.geometry.hO).toBeCloseTo(cab.wedge!.slantO, 12);
      expect(cab.outside).toEqual([cab.wedge!.wO, cab.wedge!.hO, cab.wedge!.dBottomI + 2 * T]);
      expect(B.holePositions(cab)).toHaveLength(1);
    });
    it('a taper of 1 is the plain box, down to the cut sizes', () => {
      const box = build(car((x) => { x.shape = 'box'; x.space = { id: 'none', wCm: 0, hCm: 0, dCm: 0 }; x.build = { ...x.build, rw: 1, rh: 1.2, rd: 1.5, brace: 'none' }; })).cabinets[0]!;
      const w1 = build(wedge((x) => (x.taper = 1))).cabinets[0]!.wedge!;
      expect(w1.wI).toBeCloseTo(box.geometry.wI, 12);
      expect(w1.hI).toBeCloseTo(box.geometry.hI, 12);
      expect(w1.dBottomI).toBeCloseTo(box.geometry.dI, 12);
      expect(w1.slantO).toBeCloseTo(w1.hO, 12);
    });
    it('the 3D view draws it: back, top and bottom boxes, two side prisms and the baffle prism, with the holes tilted to the slope', () => {
      const p = project(wedge((x) => { x.design = { ...x.design, type: 'ported', tuneHz: 38, portDiameterCm: 7, volumeL: 60 }; }));
      const v = B.computeBuild(p);
      const lay = layout3d(v, p);
      expect(lay.boxes).toHaveLength(3);
      expect(lay.prisms).toHaveLength(3);
      const cab = v.bands[0]!.cabinets[0]!;
      expect(lay.discs).toHaveLength(cab.cutouts.length);
      const w = cab.wedge!;
      for (const dsc of lay.discs) expect(dsc.tilt!).toBeCloseTo(-Math.atan2(w.dBottomI - w.dTopI, w.hO), 12);
      expect(lay.tubes).toHaveLength(v.bands[0]!.ports.length);
      for (const n of [...lay.boxes.flatMap((b) => [...b.size, ...b.center]), ...lay.prisms.flatMap((q) => q.points.flat()), ...lay.discs.flatMap((dsc) => dsc.center), ...lay.extent]) expect(Number.isFinite(n)).toBe(true);
      expect(lay.extent[1]).toBeCloseTo(w.hO, 12);
      // every disc lies on the baffle plane: the top of the baffle is at z = -(dBottom - dTop), the bottom at z = 0
      for (const dsc of lay.discs) {
        expect(dsc.center[2]).toBeGreaterThan(-(w.dBottomI - w.dTopI) - 1e-3);
        expect(dsc.center[2]).toBeLessThan(0.01);
        expect(dsc.center[1]).toBeGreaterThan(0);
        expect(dsc.center[1]).toBeLessThan(w.hO);
      }
    });
    it('the 3D wedge lies where the cut list puts it: sizes, the slope, the holes on it, the baffle plate behind its face', () => {
      const p = project(wedge((x) => { x.count = 2; x.design = { ...x.design, type: 'ported', tuneHz: 38, portDiameterCm: 7, volumeL: 90, driverClass: cls('8 in car sub') }; x.build = { ...x.build, rw: 3, rh: 1.2, rd: 1.5 }; }));
      const v = B.computeBuild(p);
      const w = v.bands[0]!.cabinets[0]!.wedge!;
      const lay = layout3d(v, p);
      const delta = w.dBottomI - w.dTopI;
      expect(lay.boxes.map((b) => b.size.map((n) => Math.round(n * 1e6) / 1e6))).toEqual([
        [w.wO, w.hO, T],
        [w.wO, T, w.dBottomI],
        [w.wO, T, w.dTopI],
      ].map((s) => s.map((n) => Math.round(n * 1e6) / 1e6)));
      // the two side prisms: the profile from the back to the sloping front
      const sides = lay.prisms.slice(0, 2);
      for (const s of sides) {
        const zs = s.points.map((q) => q[2]);
        expect(Math.min(...zs)).toBeCloseTo(-w.dBottomI, 12);
        expect(Math.max(...zs)).toBeCloseTo(0, 12);
        expect(s.points.some((q) => Math.abs(q[1] - w.hO) < 1e-12 && Math.abs(q[2] + delta) < 1e-12)).toBe(true); // the top front corner
        expect(s.points.some((q) => Math.abs(q[1] - w.hO) < 1e-12 && Math.abs(q[2] + w.dBottomI) < 1e-12)).toBe(true); // the top back corner
      }
      // the baffle plate: its face runs from the bottom front to the top front, its back face lies behind and below it
      const baffle = lay.prisms[2]!;
      const A = baffle.points.slice(0, 4);
      const B2 = baffle.points.slice(4);
      expect(A[2]![2]).toBeCloseTo(-delta, 12);
      expect(A[2]![1]).toBeCloseTo(w.hO, 12);
      B2.forEach((q, k) => {
        expect(q[2]).toBeLessThan(A[k]![2]);
        expect(q[1]).toBeLessThan(A[k]![1] + 1e-12);
        expect(Math.hypot(q[1] - A[k]![1], q[2] - A[k]![2])).toBeCloseTo(T, 12);
      });
      // every hole lies on the slope, and two holes are as far apart along it as on the flat baffle
      const holes = B.holePositions(v.bands[0]!.cabinets[0]!);
      const len = Math.hypot(w.hO, delta);
      lay.discs.forEach((dsc, k) => {
        const along = holes[k]!.cy; // distance down the baffle from the top
        expect(dsc.center[1]).toBeCloseTo(w.hO - (along * w.hO) / len, 2);
        expect(dsc.center[2]).toBeCloseTo(-delta + (along * delta) / len, 2);
      });
      for (let k = 1; k < holes.length; k++) {
        const d3 = Math.hypot(lay.discs[k]!.center[1] - lay.discs[k - 1]!.center[1], lay.discs[k]!.center[2] - lay.discs[k - 1]!.center[2]);
        expect(d3).toBeCloseTo(Math.abs(holes[k]!.cy - holes[k - 1]!.cy), 5);
      }
      // two subs, two ports: a tube each, at the port's radius, behind its hole
      expect(lay.tubes).toHaveLength(2);
      for (const tube of lay.tubes) expect(tube.radius).toBeCloseTo(0.035, 12);
    });
    it('a taper makes the top shallower, so a deep driver is warned about there', () => {
      const w = build(wedge((x) => { x.taper = 0.15; x.design.volumeL = 20; x.design.driverClass = cls('15 in car sub'); }));
      expect(w.warnings.some((m) => m.includes('needs about'))).toBe(true);
    });
  });

  describe('the vehicle space', () => {
    it('no limit never warns; a box that is too big for the space says so, with its size', () => {
      const big = car((x) => { x.design.volumeL = 200; x.space = { id: 'under-seat', wCm: 60, hCm: 14, dCm: 30 }; });
      const b = build(big);
      expect(b.fit!.fits).toBe(false);
      expect(b.warnings.some((w) => w.includes('does not fit') || w.includes('space is'))).toBe(true);
      const none = build(car((x) => { x.design.volumeL = 200; x.space = { id: 'none', wCm: 0, hCm: 0, dCm: 0 }; }));
      expect(none.fit!.fits).toBe(true);
      expect(none.fit!.space).toBeNull();
      expect(none.warnings.some((w) => w.includes('space is'))).toBe(false);
    });
    it('fits exactly when each outside size is within the space', () => {
      const b = build(car((x) => { x.design.volumeL = 20; x.space = { id: 'trunk-compact', wCm: 90, hCm: 45, dCm: 45 }; x.build = { ...x.build, rw: 2, rh: 1, rd: 1 }; }));
      const [w, h, d] = b.fit!.outside;
      expect(b.fit!.space).toEqual([0.9, 0.45, 0.45]);
      expect(b.fit!.fits).toBe(w <= 0.9 && h <= 0.45 && d <= 0.45);
      const tight = build(car((x) => { x.design.volumeL = 20; x.space = { id: 'custom', wCm: w * 100 - 0.1, hCm: 45, dCm: 45 }; x.build = { ...x.build, rw: 2, rh: 1, rd: 1 }; }));
      expect(tight.fit!.fits).toBe(false);
      const exact = build(car((x) => { x.design.volumeL = 20; x.space = { id: 'custom', wCm: Math.ceil(w * 100 * 100) / 100, hCm: 45, dCm: 45 }; x.build = { ...x.build, rw: 2, rh: 1, rd: 1 }; }));
      expect(exact.fit!.fits).toBe(true);
    });
    it('a box too deep for the space does not fit even when it is narrow and low enough', () => {
      const b = build(car((x) => { x.design.volumeL = 40; x.space = { id: 'custom', wCm: 300, hCm: 200, dCm: 5 }; }));
      expect(b.fit!.outside[2]).toBeGreaterThan(0.05);
      expect(b.fit!.outside[0]).toBeLessThan(3);
      expect(b.fit!.outside[1]).toBeLessThan(2);
      expect(b.fit!.fits).toBe(false);
    });
    it('the wedge\'s depth counted against the space is its bottom depth', () => {
      const b = build(car((x) => { x.shape = 'wedge'; x.taper = 0.5; x.design.volumeL = 30; x.space = { id: 'none', wCm: 0, hCm: 0, dCm: 0 }; }));
      const w = b.cabinets[0]!.wedge!;
      expect(b.fit!.outside[2]).toBeCloseTo(w.dBottomI + 2 * T, 12);
      expect(b.fit!.outside[1]).toBeCloseTo(w.hO, 12);
    });
    it('the space proportions fill the space: the largest scale a box can take is 1', () => {
      // proportions = the space's inside; the solved box is the space's inside scaled to the air, so it fits when the air is small enough
      const t = 1.8;
      const s = { id: 'trunk-compact', wCm: 90, hCm: 45, dCm: 45 };
      const w = s.wCm - 2 * t;
      const h = s.hCm - 2 * t;
      const dd = s.dCm - 2 * t;
      const m = Math.max(w, h, dd);
      const small = build(car((x) => { x.design.volumeL = 30; x.space = s; x.build = { ...x.build, rw: w / m, rh: h / m, rd: dd / m }; }));
      expect(small.fit!.fits).toBe(true);
      const large = build(car((x) => { x.design.volumeL = 250; x.space = s; x.build = { ...x.build, rw: w / m, rh: h / m, rd: dd / m }; }));
      expect(large.fit!.fits).toBe(false);
    });
  });

  it('the bill of materials counts every sub and port, one terminal per install, and the notes say what is missing', () => {
    const p = project(car((x) => { x.count = 2; x.design = { ...x.design, type: 'ported', volumeL: 80, tuneHz: 36, portDiameterCm: 7 }; x.space = { id: 'none', wCm: 0, hCm: 0, dCm: 0 }; }));
    const v = B.computeBuild(p);
    const bom = new Map(v.bom.map((b) => [b.item, b.qty]));
    expect(bom.get('12 in car sub driver')).toBe(2);
    expect(v.bom.find((b) => b.item.startsWith('Round port tube'))).toMatchObject({ qty: 2 });
    expect(v.bom.find((b) => b.item === 'Speaker terminal or connector')).toMatchObject({ qty: 1, note: 'one per install' });
    expect(v.notes[0]).toContain('The amplifier, ring terminals and the remote lead are not in this list');
  });
  it('a PA system and a home speaker are unchanged by the car install in the project', () => {
    const roots = S.applyTemplate(S.DEFAULT_PROJECT, 4);
    expect(B.computeBuild({ ...roots, car: car((x) => (x.count = 4)) }).sheets).toBe(B.computeBuild(roots).sheets);
    expect(S.computeSystem({ ...roots, car: car() }).levelDb).toEqual(S.computeSystem(roots).levelDb);
  });
});

describe('the 12 V check (C2)', () => {
  const el = (e: (x: C.CarSub) => void = () => {}): C.CarElectric => {
    const c = car(e);
    return C.computeCarElectric(c, C.computeCarSub(c).limits);
  };
  const build = (c: C.CarSub): B.BuildView => B.computeBuild(project(c));

  it('sanitise: class, supply, gauge, length, duty, alternator and loads are made valid', () => {
    const s = C.sanitizeCar({ ampClass: 'x', supplyV: 99, cableAwg: 3, cableM: 0, duty: 0.3, alternatorA: 1, otherLoadsA: -5 });
    expect(s).toMatchObject({ ampClass: 'd', supplyV: 15.5, cableAwg: C.DEFAULT_CAR.cableAwg, cableM: 0.5, duty: 0.125, alternatorA: 30, otherLoadsA: 0 });
    expect(C.sanitizeCar({ ampClass: 'ab', cableAwg: 0, duty: 0.25, supplyV: 12.6 })).toMatchObject({ ampClass: 'ab', cableAwg: 0, duty: 0.25, supplyV: 12.6 });
    expect(C.CABLE_AWGS).toEqual([0, 2, 4, 6, 8, 10, 12]);
    expect(C.AMP_EFFICIENCY).toEqual({ d: 0.85, ab: 0.6 });
    expect(C.MUSIC_DUTIES.map((m) => m.value)).toEqual([0.25, 0.125, 0.0625]);
    expect(C.MAX_DROP_FRAC).toBe(0.03);
  });
  it('the default install is clean: a few amps, a thick short cable, a 15 A fuse, plenty of alternator', () => {
    const e = el();
    expect(e.warnings).toEqual([]);
    expect(e.peakA).toBeGreaterThan(5);
    expect(e.peakA).toBeLessThan(20);
    expect(e.fuseA).toBe(15);
    expect(e.alternatorMarginA).toBeGreaterThan(50);
  });
  it('the current is the power the amp makes into this load over efficiency and supply volts; music is a fraction of it', () => {
    const c = car((x) => { x.ampPowerW = 1000; x.ampLoadOhm = 2; x.coilSeries = 2; x.ampMinLoadOhm = 2; }); // 7.2 ohm
    const v = C.computeCarSub(c);
    const e = C.computeCarElectric(c, v.limits);
    expect(e.powerW).toBeCloseTo((1000 * 2) / 7.2, 9);
    expect(e.peakA).toBeCloseTo(P.ampCurrent((1000 * 2) / 7.2, 0.85, 13.8), 9);
    expect(e.musicA).toBeCloseTo(e.peakA * 0.125, 9);
    expect(el((x) => (x.duty = 0.25)).musicA).toBeCloseTo(2 * el().musicA, 9);
    expect(el((x) => (x.ampClass = 'ab')).peakA).toBeCloseTo((el().peakA * 0.85) / 0.6, 9);
    expect(el((x) => (x.supplyV = 12)).peakA).toBeCloseTo((el().peakA * 13.8) / 12, 9);
  });
  it('a bridged amp at a light load makes more power than its rating, and the current follows', () => {
    const rated = el((x) => { x.bridged = false; x.ampPowerW = 500; x.ampLoadOhm = 2; });
    const bridged = el((x) => { x.bridged = true; x.ampPowerW = 500; x.ampLoadOhm = 2; x.ampMinLoadOhm = 0.5; });
    expect(bridged.powerW).toBeGreaterThan(rated.powerW * 3.9);
    expect(bridged.peakA).toBeGreaterThan(rated.peakA * 3.9);
  });
  it('the cable drop is the current through the cable and the ground return; the thinnest gauge is the one the budget allows', () => {
    const big = (x: C.CarSub): void => { x.ampPowerW = 2000; x.ampLoadOhm = 2; x.coils = 2; x.coilSeries = 1; x.ampMinLoadOhm = 1; };
    const e = el(big);
    expect(e.dropV).toBeCloseTo(P.wireDropVolts(e.peakA, 4, 5), 12);
    expect(e.dropFrac).toBeCloseTo(e.dropV / 13.8, 12);
    expect(e.minAwg).toBe(P.minAwg(e.peakA, 5, 13.8, 0.03));
    expect(el((x) => { big(x); x.cableAwg = 12; }).dropV).toBeGreaterThan(e.dropV * 4);
    expect(el((x) => { big(x); x.cableM = 10; }).dropV).toBeCloseTo(2 * e.dropV, 9);
    expect(el((x) => { big(x); x.supplyV = 12; }).dropFrac).toBeGreaterThan(0);
  });
  it('a cable that loses more than 3 % warns, names the gauge to use, and says so when none will do', () => {
    const e = el((x) => { x.ampPowerW = 1000; x.ampLoadOhm = 2; x.ampMinLoadOhm = 1; x.cableAwg = 12; });
    expect(e.minAwg).toBeGreaterThanOrEqual(0);
    expect(e.dropFrac).toBeGreaterThan(0.03);
    expect(e.warnings.some((w) => w.includes('12 AWG') && w.includes(`Use ${e.minAwg} AWG or thicker`))).toBe(true);
    const long = el((x) => { x.ampPowerW = 20000; x.ampLoadOhm = 1; x.ampMinLoadOhm = 0.5; x.cableAwg = 0; x.cableM = 15; });
    expect(long.minAwg).toBe(-1);
    expect(long.warnings.some((w) => w.includes('Even 0 AWG'))).toBe(true);
    const ok = el((x) => { x.cableAwg = 0; });
    expect(ok.warnings.some((w) => w.includes('lose'))).toBe(false);
    // exactly at the budget is fine
    const edge = el((x) => { x.ampPowerW = 600; });
    expect(edge.dropFrac).toBeLessThan(0.03);
  });
  it('when 0 AWG is just thick enough the warning says use 0 AWG, not that no gauge will do', () => {
    const e = el((x) => { x.ampPowerW = 1200; x.ampLoadOhm = 2; x.ampMinLoadOhm = 1; x.cableAwg = 12; });
    expect(e.minAwg).toBe(0);
    expect(e.warnings.some((w) => w.includes('Use 0 AWG or thicker'))).toBe(true);
    expect(e.warnings.some((w) => w.includes('Even 0 AWG'))).toBe(false);
  });
  it('the fuse is the next standard value over 1.25 x the peak current', () => {
    const e = el((x) => { x.ampPowerW = 1000; x.ampLoadOhm = 1; });
    expect(e.fuseA).toBe(P.fuseAmps(e.peakA));
    expect(e.fuseA).toBeGreaterThanOrEqual(1.25 * e.peakA);
  });
  it('the alternator margin is its rating less the loads of the car and the music current of the amp; a shortfall warns', () => {
    const e = el((x) => { x.alternatorA = 100; x.otherLoadsA = 20; });
    expect(e.alternatorMarginA).toBeCloseTo(100 - 20 - e.musicA, 12);
    const short = el((x) => { x.ampPowerW = 6000; x.ampLoadOhm = 1; x.ampMinLoadOhm = 0.5; x.alternatorA = 60; x.otherLoadsA = 50; x.duty = 0.25; });
    expect(short.alternatorMarginA).toBeLessThan(0);
    expect(short.warnings.some((w) => w.includes('alternator makes'))).toBe(true);
    expect(el().warnings.some((w) => w.includes('alternator'))).toBe(false);
    expect(el((x) => { x.alternatorA = 30; x.otherLoadsA = 0; }).alternatorMarginA).toBeGreaterThan(0);
  });
  it('the bill of materials carries the cable, the ground and the fuse sized by the check; a PA project has none', () => {
    const c = car((x) => { x.ampPowerW = 1000; x.cableAwg = 2; x.cableM = 6.5; });
    const v = build(c);
    const e = C.computeCarElectric(c, C.computeCarSub(c).limits);
    expect(v.bom.find((b) => b.item === 'Power cable, 2 AWG')).toMatchObject({ qty: 6.5, unit: 'm' });
    expect(v.bom.find((b) => b.item === 'Ground cable, 2 AWG')).toMatchObject({ qty: 6.5, unit: 'm' });
    expect(v.bom.find((b) => b.item === `Fuse and fuse holder, ${e.fuseA} A`)).toMatchObject({ qty: 1, unit: 'pcs' });
    const pa = B.computeBuild(S.applyTemplate(S.DEFAULT_PROJECT, 4));
    expect(pa.bom.some((b) => b.item.includes('cable') || b.item.includes('Fuse'))).toBe(false);
  });
});

