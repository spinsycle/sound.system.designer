// C3 pass condition: the front speakers are sanitised, fit-checked, crossed over and summed with the sub as the spec chain says; the
// adapter ring is the size the opening and the driver ask for, and the build lists it.
import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import * as B from '../src/buildlist';
import * as F from '../src/carfront';
import * as C from '../src/carsub';
import { ringSvg } from '../src/export';
import * as M from '../src/model';
import * as S from '../src/system';

const cls = (name: string): number => P.ALL_DRIVER_CLASSES.findIndex((d) => d.name === name);
const front = (e: (f: F.CarFront) => void = () => {}): F.CarFront => {
  const f = structuredClone({ ...F.DEFAULT_FRONT, enabled: true });
  e(f);
  return F.sanitizeFront(f);
};
const car = (e: (f: F.CarFront) => void = () => {}, more: (c: C.CarSub) => void = () => {}): C.CarSub => {
  const c = structuredClone(C.DEFAULT_CAR);
  c.front = front(e);
  more(c);
  return C.sanitizeCar(c);
};
const project = (c: C.CarSub): S.Project => S.sanitizeProject({ ...S.DEFAULT_PROJECT, kind: 'car', car: c });
const dbOf = (z: P.Cx): number => P.dB(P.abs(z));

describe('sanitise', () => {
  it('the default is off; garbage becomes the default; type decides which classes are allowed', () => {
    expect(F.sanitizeFront(null)).toEqual(F.DEFAULT_FRONT);
    expect(F.DEFAULT_FRONT.enabled).toBe(false);
    expect(C.DEFAULT_CAR.front).toEqual(F.DEFAULT_FRONT);
    const comp = F.sanitizeFront({ type: 'component', wooferClass: cls('6.5 in coax') });
    expect(P.ALL_DRIVER_CLASSES[comp.wooferClass]!.name).toBe('6.5 in door'); // a coax is not a component woofer
    const coax = F.sanitizeFront({ type: 'coaxial', wooferClass: cls('6.5 in door') });
    expect(P.ALL_DRIVER_CLASSES[coax.wooferClass]!.name).toBe('6.5 in coax');
    expect(F.sanitizeFront({ type: 'coaxial', wooferClass: cls('6x9 coax') }).wooferClass).toBe(cls('6x9 coax'));
    expect(F.sanitizeFront({ wooferClass: cls('5.25 in door') }).wooferClass).toBe(cls('5.25 in door'));
    expect(F.sanitizeFront({ tweeterClass: cls('0.75 in dome') }).tweeterClass).toBe(cls('0.75 in dome'));
    expect(F.sanitizeFront({ tweeterClass: cls('12 in') }).tweeterClass).toBe(F.DEFAULT_FRONT.tweeterClass);
    expect(F.sanitizeFront({ mount: 'kick' }).mount).toBe('kick');
    expect(F.sanitizeFront({ mount: 'roof' }).mount).toBe('door');
    expect(F.sanitizeFront({ enabled: 1 }).enabled).toBe(false);
  });
  it('numbers are clamped; a mount that is not stored starts with its own air and depth', () => {
    const f = F.sanitizeFront({ airL: 1e6, depthCm: 0, openingCm: 1, ringCm: 99, xoverSubHz: 1, xoverTweeterHz: 1e9, trimDb: -99, tweeterTrimDb: 99 });
    expect(f).toMatchObject({ airL: 60, depthCm: 2, openingCm: 8, ringCm: 5, xoverSubHz: 50, xoverTweeterHz: 8000, trimDb: -30, tweeterTrimDb: 6 });
    expect(F.sanitizeFront({ mount: 'dash' })).toMatchObject({ airL: F.MOUNT_DEFAULTS.dash.airL, depthCm: F.MOUNT_DEFAULTS.dash.depthCm });
    expect(F.sanitizeFront({ mount: 'kick', airL: 3 }).airL).toBe(3);
  });
  it('applyFront: a new mount restarts the air and depth, a new type restarts the class, other changes keep everything', () => {
    const f = front();
    const kick = F.applyFront(f, { mount: 'kick' });
    expect([kick.airL, kick.depthCm]).toEqual([F.MOUNT_DEFAULTS.kick.airL, F.MOUNT_DEFAULTS.kick.depthCm]);
    const coax = F.applyFront(f, { type: 'coaxial' });
    expect(P.ALL_DRIVER_CLASSES[coax.wooferClass]!.name).toBe('6.5 in coax');
    expect(F.applyFront(coax, { type: 'component' }).wooferClass).toBe(cls('6.5 in door'));
    const same = F.applyFront({ ...f, airL: 33 }, { mount: 'door' });
    expect(same.airL).toBe(33);
    expect(F.applyFront(f, { trimDb: 3 })).toEqual({ ...f, trimDb: 3 });
    // naming the type it already has keeps the class the user picked
    const picked = front((x) => { x.type = 'coaxial'; x.wooferClass = cls('5.25 in coax'); });
    expect(F.applyFront(picked, { type: 'coaxial' }).wooferClass).toBe(cls('5.25 in coax'));
    // a different driver restarts the opening at its cut-out plus 1 cm
    expect(F.applyFront(f, { wooferClass: cls('6x9 door') }).openingCm).toBeCloseTo(22.6, 12);
    expect(F.applyFront(f, { wooferClass: cls('5.25 in door') }).openingCm).toBeCloseTo(12.8, 12);
    expect(F.applyFront(f, { type: 'coaxial' }).openingCm).toBeCloseTo(15.2, 12);
    expect(F.applyFront({ ...f, openingCm: 20 }, { trimDb: 1 }).openingCm).toBe(20);
  });
  it('the project carries the fronts and old projects open with them off', () => {
    const { car: _c, ...old } = S.DEFAULT_PROJECT;
    void _c;
    expect(S.sanitizeProject(old).car.front.enabled).toBe(false);
    const p = project(car());
    expect(p.car.front.enabled).toBe(true);
    expect(C.sanitizeCar({ front: { enabled: true, type: 'coaxial' } }).front.type).toBe('coaxial');
  });
});

describe('the pinned defaults', () => {
  it('the mounts, the flange and the tweeter box are the numbers of this stage', () => {
    expect(F.MOUNT_DEFAULTS).toEqual({
      door: { label: 'Door', airL: 20, depthCm: 9 },
      kick: { label: 'Kick panel pod', airL: 8, depthCm: 10 },
      dash: { label: 'Dash', airL: 5, depthCm: 8 },
    });
    expect(F.RING_FLANGE_CM).toBe(1.5);
    expect(F.tweeterDesign(front()).volumeL).toBe(0.5);
    expect(F.wooferDesign(front((x) => (x.airL = 12))).volumeL).toBe(12);
    expect(F.DEFAULT_FRONT).toMatchObject({ xoverSubHz: 100, xoverTweeterHz: 2400, ringCm: 1, openingCm: 15.2, airL: 20, depthCm: 9 });
  });
});

describe('the classes', () => {
  it('every front class has an info entry; coax classes say so; depths and cut-outs grow with the size', () => {
    for (const n of [...F.FRONT_COMPONENT_CLASSES, ...F.FRONT_COAX_CLASSES]) expect(F.FRONT_INFO[n], n).toBeDefined();
    expect(Object.keys(F.FRONT_INFO).every((n) => cls(n) >= 0)).toBe(true);
    expect(F.FRONT_COAX_CLASSES.every((n) => F.FRONT_INFO[n]!.coax)).toBe(true);
    expect(F.FRONT_COMPONENT_CLASSES.every((n) => !F.FRONT_INFO[n]!.coax)).toBe(true);
    expect(F.FRONT_INFO['5.25 in door']!.cutout.wCm).toBeLessThan(F.FRONT_INFO['6.5 in door']!.cutout.wCm);
    expect(F.FRONT_INFO['6x9 door']!.cutout.kind).toBe('oval');
    expect(F.FRONT_INFO['6.5 in door']!.cutout.kind).toBe('round');
    expect(F.MOUNT_DEFAULTS.door.depthCm).toBeGreaterThanOrEqual(7 + 1); // the default 6.5 in with a 1 cm ring fits
    expect(F.FRONT_INFO['6.5 in coax']!.depthCm).toBeGreaterThan(F.FRONT_INFO['6.5 in door']!.depthCm);
    expect(F.infoOf(cls('12 in'))).toBeNull();
  });
  it('a tweeter-less woofer class is a believable door driver: a corner above 60 Hz in a leaky 20 L door, Qts under 1', () => {
    for (const n of F.FRONT_COMPONENT_CLASSES) {
      const d = P.ALL_DRIVER_CLASSES[cls(n)]!;
      expect(P.deriveDriver(d).qts, n).toBeLessThan(1);
      expect(P.sealedParams(d.fs, P.deriveDriver(d).qts, d.vasM3, 0.02).fc, n).toBeGreaterThan(55);
    }
  });
});

describe('fit and crossover checks', () => {
  it('the system does not report the front warnings while they are off', () => {
    const c = car();
    const off = C.sanitizeCar({ ...c, front: { ...c.front, enabled: false, depthCm: 2 } });
    expect(F.checkFront(off.front).warnings.length).toBeGreaterThan(0);
    expect(C.computeCarSystem(off).warnings).toEqual([]);
    expect(C.computeCarSystem({ ...off, front: { ...off.front, enabled: true } }).warnings.length).toBeGreaterThan(0);
  });
  it('the default front has no warnings', () => {
    expect(F.checkFront(front()).warnings).toEqual([]);
    expect(C.computeCarSystem(car()).warnings).toEqual([]);
  });
  it('the depth the driver and the ring need is compared with what the place has', () => {
    const f = front((x) => { x.depthCm = 7; x.ringCm = 1; });
    const v = F.checkFront(f);
    expect(v.needDepthCm).toBeCloseTo(8, 12); // 7 cm driver + 1 cm ring
    expect(v.warnings.some((w) => w.includes('behind the baffle') && w.includes('the door'))).toBe(true);
    expect(F.checkFront(front((x) => { x.depthCm = 8; x.ringCm = 1; })).warnings.some((w) => w.includes('behind the baffle'))).toBe(false); // exactly enough
    expect(F.checkFront(front((x) => { x.depthCm = 7; x.ringCm = 0; })).warnings.some((w) => w.includes('behind the baffle'))).toBe(false);
    expect(F.checkFront(front((x) => { x.depthCm = 5; x.mount = 'kick'; x.depthCm = 5; })).warnings.some((w) => w.includes('the kick panel pod'))).toBe(true);
    expect(F.checkFront(front((x) => { x.mount = 'dash'; x.depthCm = 3; })).warnings.some((w) => w.includes('the dash'))).toBe(true);
  });
  it('an opening between the cut-out and the cut-out plus half a centimetre still warns (the ring would sit on the edge)', () => {
    const cut = F.FRONT_INFO['6.5 in door']!.cutout.wCm;
    expect(F.checkFront(front((x) => (x.openingCm = cut + 0.2))).warnings.some((w) => w.includes('smaller than'))).toBe(true);
  });
  it('an opening smaller than the cut-out warns, one just big enough does not', () => {
    const cut = F.FRONT_INFO['6.5 in door']!.cutout.wCm; // 14.2
    expect(F.checkFront(front((x) => (x.openingCm = cut - 1))).warnings.some((w) => w.includes('smaller than'))).toBe(true);
    expect(F.checkFront(front((x) => (x.openingCm = cut + 0.5))).warnings.some((w) => w.includes('smaller than'))).toBe(false);
  });
  it('the sub crossover under the woofer\'s own corner warns; the corner follows the air', () => {
    const tight = F.checkFront(front((x) => { x.airL = 3; x.xoverSubHz = 80; }));
    expect(tight.fcHz).toBeGreaterThan(80);
    expect(tight.warnings.some((w) => w.includes('still rolling off'))).toBe(true);
    const big = F.checkFront(front((x) => (x.airL = 60)));
    expect(big.fcHz).toBeLessThan(F.checkFront(front((x) => (x.airL = 5))).fcHz);
    const d = P.ALL_DRIVER_CLASSES[cls('6.5 in door')]!;
    expect(F.checkFront(front()).fcHz).toBeCloseTo(P.sealedParams(d.fs, P.deriveDriver(d).qts, d.vasM3, 0.02).fc, 9);
  });
  it('the tweeter: crossed under twice its resonance, and a woofer beaming at the crossover, each warn; a coaxial has neither', () => {
    expect(F.checkFront(front((x) => { x.tweeterClass = cls('1.25 in dome'); x.xoverTweeterHz = 1200; })).warnings.some((w) => w.includes('twice'))).toBe(true);
    expect(F.checkFront(front((x) => { x.xoverTweeterHz = 8000; })).warnings.some((w) => w.includes('narrow its beam'))).toBe(true);
    expect(F.checkFront(front((x) => { x.type = 'coaxial'; x.wooferClass = cls('6.5 in coax'); x.xoverTweeterHz = 1000; })).warnings).toEqual([]);
  });
});

describe('the system: sub and fronts through a Linkwitz-Riley network, with the cabin gain', () => {
  it('equals the legs times each part\'s pressure, summed, times the cabin shelf', () => {
    const c = car((f) => { f.trimDb = -4; f.tweeterTrimDb = -2; });
    const sys = C.computeCarSystem(c);
    const fp = F.frontPressures(c.front);
    const sub = C.carEvaluator(c);
    expect(sys.xover).toEqual([100, 2400]);
    sys.freqs.forEach((fr, i) => {
      if (i % 40 !== 0) return;
      const legs = P.crossoverBands(fr, [100, 2400]);
      const parts = [
        P.mul(legs[0]!, sub.free(fr)),
        P.scale(P.mul(legs[1]!, fp.woofer(fr)), 10 ** (-4 / 20)),
        P.scale(P.mul(legs[2]!, fp.tweeter!(fr)), 10 ** (-6 / 20)),
      ];
      const sum = P.systemPressure(fr, parts.map((pressure) => ({ pressure, delayS: 0 })));
      expect(sys.totalDb[i]!).toBeCloseTo(P.splDb(P.abs(P.mul(sum, P.cabinGain(fr, c.cabin)))), 9);
    });
  });
  it('a coaxial has one crossover and no tweeter curve; its woofer leg runs to the top', () => {
    const sys = C.computeCarSystem(car((f) => { f.type = 'coaxial'; f.wooferClass = cls('6.5 in coax'); }));
    expect(sys.xover).toEqual([100]);
    expect(sys.tweeterDb).toBeNull();
    const top = sys.wooferDb[sys.wooferDb.length - 1]!;
    expect(top).toBeGreaterThan(sys.wooferDb[sys.freqs.findIndex((f) => f >= 1000)]! - 3);
  });
  it('the sub leg is the sub rolled off above its crossover; the fronts leg below it', () => {
    const sys = C.computeCarSystem(car());
    const at = (arr: number[], f: number): number => arr[sys.freqs.findIndex((x) => x >= f)]!;
    expect(at(sys.subDb, 30) - at(sys.subDb, 1000)).toBeGreaterThan(40);
    expect(at(sys.wooferDb, 1000) - at(sys.wooferDb, 30)).toBeGreaterThan(20);
  });
  it('the front trim moves the front parts and not the sub', () => {
    const a = C.computeCarSystem(car((f) => (f.trimDb = 0)));
    const b = C.computeCarSystem(car((f) => (f.trimDb = -6)));
    const i = a.freqs.findIndex((x) => x >= 1000);
    expect(a.wooferDb[i]! - b.wooferDb[i]!).toBeCloseTo(6.02, 1);
    expect(a.subDb[i]).toBe(b.subDb[i]);
    const j = a.freqs.findIndex((x) => x >= 8000);
    expect(a.tweeterDb![j]! - b.tweeterDb![j]!).toBeCloseTo(6.02, 1);
  });
  it('the cabin gain is in the total: the open cabin is lower at the bottom', () => {
    const lo = (cabin: P.CabinId): number => C.computeCarSystem(car(() => {}, (x) => (x.cabin = cabin))).totalDb[0]!;
    expect(lo('coupe') - lo('open')).toBeGreaterThan(5);
  });
  it('the system has no hole at the sub crossover bigger than 6 dB when the fronts are levelled to the sub', () => {
    const c = C.levelFront(car());
    const sys = C.computeCarSystem(c);
    const i = sys.freqs.findIndex((x) => x >= 100);
    const legs = Math.max(sys.subDb[i]!, sys.wooferDb[i]!);
    expect(legs + 6 - sys.totalDb[i]!).toBeLessThan(6);
  });
});

describe('levelling the fronts to the sub', () => {
  it('sets the trim so the front woofer\'s average (200 Hz to 2 kHz) equals the sub\'s (25 to 120 Hz), to 0.1 dB', () => {
    const c = car();
    const lev = C.levelFront(c);
    const fp = F.frontPressures(lev.front);
    const xs = C.CAR_FREQS_WIDE.filter((f) => f >= 200 && f <= 2000).map((f) => P.splDb(P.abs(fp.woofer(f))));
    const front = xs.reduce((a, b) => a + b, 0) / xs.length + lev.front.trimDb;
    expect(Math.abs(front - C.computeCarSub(c).averageDb)).toBeLessThan(0.06);
    expect(Number.isFinite(lev.front.trimDb)).toBe(true);
    expect(lev.front.trimDb).not.toBe(c.front.trimDb); // it moved
    expect(C.levelFront(lev).front.trimDb).toBe(lev.front.trimDb); // pressing it twice changes nothing
    // a component set's tweeter is levelled to the woofer too
    const tw = F.frontPressures(lev.front).tweeter!;
    const hi = C.CAR_FREQS_WIDE.filter((f) => f >= 4000 && f <= 12000).map((f) => P.splDb(P.abs(tw(f))));
    const twAvg = hi.reduce((a, b) => a + b, 0) / hi.length + lev.front.trimDb + lev.front.tweeterTrimDb;
    expect(Math.abs(twAvg - C.computeCarSub(c).averageDb)).toBeLessThan(0.11);
    expect(lev.front.tweeterTrimDb).toBeLessThan(0); // the dome is louder than the woofer
    expect(C.levelFront(lev).front.tweeterTrimDb).toBe(lev.front.tweeterTrimDb);
    // a coaxial has no tweeter trim to set
    const cx = C.levelFront(car((f) => { f.type = 'coaxial'; f.wooferClass = cls('6.5 in coax'); f.tweeterTrimDb = 3; }));
    expect(cx.front.tweeterTrimDb).toBe(0);
    expect(lev.front.enabled).toBe(true);
  });
});

describe('the adapter ring', () => {
  it('is the opening plus a flange each side, round for a round cut-out; the cut-out is the driver\'s', () => {
    const r = F.ringOf(front((x) => (x.openingCm = 15.2)))!;
    expect(r.outer).toEqual({ kind: 'round', wCm: 15.2 + 2 * F.RING_FLANGE_CM, hCm: 15.2 + 2 * F.RING_FLANGE_CM });
    expect(r.inner).toEqual(F.FRONT_INFO['6.5 in door']!.cutout);
    expect(r.thicknessCm).toBe(1);
    expect(r.title).toBe('6.5 in door adapter ring');
    expect(r.screws).toBe(4);
  });
  it('an opening smaller than the cut-out grows the ring to the cut-out plus 1 cm first', () => {
    const r = F.ringOf(front((x) => (x.openingCm = 8)))!;
    expect(r.outer.wCm).toBeCloseTo(14.2 + 1 + 2 * F.RING_FLANGE_CM, 12);
  });
  it('a 6x9 ring is an oval whose height follows the cut-out\'s shape', () => {
    const r = F.ringOf(front((x) => { x.wooferClass = cls('6x9 door'); x.openingCm = 24; }))!;
    expect(r.outer.kind).toBe('oval');
    expect(r.outer.wCm).toBeCloseTo(24 + 2 * F.RING_FLANGE_CM, 12);
    expect(r.outer.hCm).toBeCloseTo(24 * (14 / 21.6) + 2 * F.RING_FLANGE_CM, 12);
    expect(r.outer.hCm).toBeLessThan(r.outer.wCm);
  });
  it('a small opening gives an oval ring at least the cut-out height plus 1 cm plus the flanges', () => {
    const r = F.ringOf(front((x) => { x.wooferClass = cls('6x9 door'); x.openingCm = 8; }))!;
    expect(r.outer.hCm).toBeCloseTo(14 + 1 + 2 * F.RING_FLANGE_CM, 12);
    expect(r.outer.wCm).toBeCloseTo(21.6 + 1 + 2 * F.RING_FLANGE_CM, 12);
  });
  it('four screw holes sit halfway between the cut-out and the edge, 90 degrees apart', () => {
    const r = F.ringOf(front())!;
    const s = F.ringScrews(r);
    expect(s).toHaveLength(4);
    for (const q of s) expect(Math.hypot(q.x, q.y)).toBeCloseTo((r.outer.wCm + r.inner.wCm) / 4, 12);
    expect(s[0]!.x).toBeGreaterThan(0);
    expect(s[0]!.y).toBeGreaterThan(0);
    expect(s[1]!.x).toBeLessThan(0);
    expect(s[2]!.y).toBeLessThan(0);
    const oval = F.ringOf(front((x) => { x.wooferClass = cls('6x9 door'); }))!;
    const os = F.ringScrews(oval);
    expect(Math.abs(os[0]!.x)).toBeGreaterThan(Math.abs(os[0]!.y));
    expect(os[0]!.x).toBeCloseTo(((oval.outer.wCm + oval.inner.wCm) / 4) * Math.cos(Math.PI / 4), 12);
    expect(os[0]!.y).toBeCloseTo(((oval.outer.hCm + oval.inner.hCm) / 4) * Math.sin(Math.PI / 4), 12);
  });
  it('an unknown front class has no ring', () => {
    expect(F.ringOf({ ...front(), wooferClass: cls('12 in') })).toBeNull();
  });
  it('the SVG has the outside, the cut-out and four screws; an oval uses ellipses', () => {
    const svg = ringSvg(F.ringOf(front())!);
    expect((svg.match(/<circle/g) ?? []).length).toBe(6);
    expect(svg).toContain('6.5 in door adapter ring');
    const ov = ringSvg(F.ringOf(front((x) => (x.wooferClass = cls('6x9 door'))))!);
    expect((ov.match(/<ellipse/g) ?? []).length).toBe(2);
    expect((ov.match(/<circle/g) ?? []).length).toBe(4);
    const ring = F.ringOf(front((x) => (x.wooferClass = cls('6x9 door'))))!;
    expect(ov).toContain(`viewBox="0 0 ${Math.round(ring.outer.wCm * 10)} ${Math.round(ring.outer.hCm * 10)}"`);
    expect(ring.outer.hCm).not.toBeCloseTo(ring.outer.wCm, 1);
  });
});

describe('the build', () => {
  it('lists two rings in the cut list with their size and thickness, draws them, and counts the front drivers', () => {
    const p = project(car());
    const v = B.computeBuild(p);
    const row = v.cutList.find((r) => r.part === '6.5 in door adapter ring')!;
    const ring = F.ringOf(p.car.front)!;
    expect(row).toMatchObject({ qty: 2, l: Math.round(ring.outer.wCm * 10), w: Math.round(ring.outer.hCm * 10) });
    expect(row.note).toContain('1 cm thick');
    expect(row.note).toContain('14.2 cm round');
    expect(v.bands[0]!.rings).toEqual([ring]);
    const bom = new Map(v.bom.map((b) => [b.item, b.qty]));
    expect(bom.get('6.5 in door (front, one each side)')).toBe(2);
    expect(bom.get('1 in dome tweeter (front, one each side)')).toBe(2);
    expect(bom.get('12 in car sub driver')).toBe(1);
    expect(v.pieces.some((x) => x.label.includes('adapter ring') && x.placement.sheet >= 0)).toBe(true);
  });
  it('a coaxial has no tweeter line and an oval ring says so; with the fronts off there is nothing', () => {
    const coax = B.computeBuild(project(car((f) => { f.type = 'coaxial'; f.wooferClass = cls('6x9 coax'); f.openingCm = 22; }))).bom.map((b) => b.item);
    expect(coax.some((i) => i.includes('tweeter'))).toBe(false);
    expect(coax).toContain('6x9 coax (front, one each side)');
    const off = B.computeBuild(project(C.sanitizeCar({}))); // default: fronts off
    expect(off.bands[0]!.rings).toEqual([]);
    expect(off.cutList.some((r) => r.part.includes('adapter ring'))).toBe(false);
    expect(off.bom.some((b) => b.item.includes('front'))).toBe(false);
    const oval = B.computeBuild(project(car((f) => { f.wooferClass = cls('6x9 door'); f.openingCm = 22; }))).cutList.find((r) => r.part === '6x9 door adapter ring')!;
    expect(oval.note).toContain('cut an oval ring');
    expect(B.computeBuild(project(car())).cutList.find((r) => r.part === '6.5 in door adapter ring')!.note).toContain('cut a round ring');
    expect(oval.note).toContain('21.6 x 14 cm oval');
  });
  it('the front checks reach the build warnings, once', () => {
    const v = B.computeBuild(project(car((f) => { f.depthCm = 5; })));
    expect(v.warnings.filter((w) => w.includes('behind the baffle'))).toHaveLength(1);
  });
  it('a PA system and a home speaker are unchanged by the fronts in the project', () => {
    const roots = S.applyTemplate(S.DEFAULT_PROJECT, 4);
    expect(B.computeBuild({ ...roots, car: car() }).sheets).toBe(B.computeBuild(roots).sheets);
    expect(M.REF_VOLTS).toBe(2.83);
  });
  it('the system level equals the sub alone when the fronts are off... except that the sub is then not rolled off', () => {
    // with the fronts off the page shows the sub's own curve (computeCarSub), not the network: the two differ above the crossover
    const c = C.sanitizeCar({});
    expect(C.computeCarSub(c).levelDb.every(Number.isFinite)).toBe(true);
    expect(dbOf(P.cabinGain(30, c.cabin))).toBeGreaterThan(5);
  });
});
