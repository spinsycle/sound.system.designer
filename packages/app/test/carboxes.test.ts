// Milestone S: the car page offers the 6th- and 8th-order band-pass and the passive radiator, built with real dividers, ports and a
// vehicle-fit check; the speaker page offers the passive radiator; the data layers the pages use agree with the PA page's.
import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import * as B from '../src/buildlist';
import * as C from '../src/carsub';
import { layout3d } from '../src/layout3d';
import * as L from '../src/loudspeaker';
import * as M from '../src/model';
import * as S from '../src/system';

const NO_SPACE = { id: 'none', wCm: 0, hCm: 0, dCm: 0 } as const;
const car = (edit: (c: C.CarSub) => void = () => {}): C.CarSub => {
  const c = structuredClone(C.DEFAULT_CAR);
  edit(c);
  return C.sanitizeCar(c);
};
const project = (c: C.CarSub): S.Project => S.sanitizeProject({ ...S.DEFAULT_PROJECT, kind: 'car', car: c });
const build = (c: C.CarSub): B.BandBuild => B.computeBuild(project(c)).bands[0]!;
const base = C.DEFAULT_CAR.design;
const withDefaults = (kind: 'bandpass6' | 'bandpass8', count = 1, layout?: P.Bp8Layout): C.CarSub =>
  car((x) => {
    x.count = count;
    x.space = { ...NO_SPACE };
    if (layout) x.design = { ...x.design, bp8: { ...x.design.bp8, layout } };
    x.design = { ...x.design, ...C.carBandpassDefaults(x.design, kind, count) };
  });

describe('passiveDefaults', () => {
  it('Vas / alpha of air for each driver, tuned for the lowest f3, QL 7 when there is none, a radiator that copies the cone', { timeout: 60000 }, () => {
    // a driver the Cookbook has a passive-radiator alignment for (Qts under about 0.5)
    const idx = P.ALL_DRIVER_CLASSES.findIndex((d) => P.solvePassiveTuning(P.deriveDriver(d).qts, P.recommendedPassiveAlpha(P.deriveDriver(d).qts), 7) !== null);
    expect(idx).toBeGreaterThanOrEqual(0);
    const dd: M.Design = { ...base, driverClass: idx, qL: 0 };
    const driver = M.driverOf(dd);
    const qts = P.deriveDriver(driver).qts;
    const alpha = P.recommendedPassiveAlpha(qts);
    const one = M.passiveDefaults(dd, 1);
    expect(one.qL).toBe(7);
    expect(one.volumeL).toBeCloseTo((driver.vasM3 * 1000) / alpha, 1);
    expect(one.tuneHz).toBeCloseTo(P.solvePassiveTuning(qts, alpha, 7)!.h * driver.fs, 1);
    expect(one.pr).toEqual({ ...base.pr, sdpCm2: 0, vapL: 0, massG: 0 });
    expect(M.passiveDefaults(dd, 3).volumeL).toBeCloseTo(3 * one.volumeL, 0);
    // an existing QL is kept
    expect(M.passiveDefaults({ ...dd, qL: 12 }).qL).toBe(12);
  });

  it('a driver with no passive-radiator alignment (Qts too high) keeps its tuning rather than inventing one', { timeout: 60000 }, () => {
    const idx = P.ALL_DRIVER_CLASSES.findIndex((d) => P.solvePassiveTuning(P.deriveDriver(d).qts, P.recommendedPassiveAlpha(P.deriveDriver(d).qts), 7) === null);
    expect(idx).toBeGreaterThanOrEqual(0);
    const dd: M.Design = { ...base, driverClass: idx, tuneHz: 33 };
    expect(M.passiveDefaults(dd).tuneHz).toBe(33);
  });
});

describe('carBandpassDefaults', () => {
  it('a 6th-order start for one sub is the helper result for the car passband (30 to 60 Hz), with ports that fit', () => {
    const d = { ...base, ...C.carBandpassDefaults(base, 'bandpass6', 1) } as M.Design;
    const a = P.bandpass6Design(M.driverOf(base), C.CAR_BANDPASS_PASSBAND.loHz, C.CAR_BANDPASS_PASSBAND.hiHz, 7);
    expect(d.type).toBe('bandpass6');
    expect(d.volumeL).toBeCloseTo(a.rearL, 1);
    expect(d.frontVolumeL).toBeCloseTo(a.frontL, 1);
    expect(d.tuneHz).toBeCloseTo(a.frontHz, 1);
    expect(d.bp6.rearTuneHz).toBeCloseTo(a.rearHz, 1);
    expect(M.portLengthOf(d, d.frontVolumeL)).toBeGreaterThan(0);
    expect(M.bp6RearPortLengthM(d)).toBeGreaterThan(0);
  });

  it('the install total is the one-sub box times the count; the 8th order keeps its layout and all three ports fit', () => {
    const one = C.carBandpassDefaults(base, 'bandpass6', 1);
    const three = C.carBandpassDefaults(base, 'bandpass6', 3);
    expect(Math.abs(three.volumeL! - 3 * one.volumeL!) / (3 * one.volumeL!)).toBeLessThan(0.002);
    expect(Math.abs(three.frontVolumeL! - 3 * one.frontVolumeL!) / (3 * one.frontVolumeL!)).toBeLessThan(0.002);
    expect(three.tuneHz).toBe(one.tuneHz);
    const e1 = C.carBandpassDefaults(base, 'bandpass8', 1);
    const e3 = C.carBandpassDefaults(base, 'bandpass8', 3);
    expect(Math.abs(e3.volumeL! - 3 * e1.volumeL!) / (3 * e1.volumeL!)).toBeLessThan(0.002);
    expect(Math.abs(e3.frontVolumeL! - 3 * e1.frontVolumeL!) / (3 * e1.frontVolumeL!)).toBeLessThan(0.002);
    expect(Math.abs(e3.bp8!.innerVolumeL - 3 * e1.bp8!.innerVolumeL) / (3 * e1.bp8!.innerVolumeL)).toBeLessThan(0.002);
    for (const layout of ['vented', 'chain', 'sealed'] as const) {
      const d = { ...base, bp8: { ...base.bp8, layout } };
      const p = { ...d, ...C.carBandpassDefaults(d, 'bandpass8', 2) } as M.Design;
      expect(p.bp8.layout).toBe(layout);
      expect(M.portLengthOf(p, p.frontVolumeL / 2)).toBeGreaterThan(0);
      expect(M.bp8InnerPortLengthM({ ...p, bp8: { ...p.bp8, innerVolumeL: p.bp8.innerVolumeL / 2 } })).toBeGreaterThan(0);
      if (layout !== 'sealed') expect(M.bp8RearPortLengthM({ ...p, volumeL: p.volumeL / 2 })).toBeGreaterThan(0);
    }
  });
});

describe('the car evaluator shares every volume among the subs', () => {
  it('count 2 with doubled air (rear, front and the 8th order\'s inner chamber) is count 1 per sub', () => {
    const one = car((x) => (x.design = { ...x.design, ...C.carBandpassDefaults(x.design, 'bandpass8', 1) }));
    const two = car((x) => {
      x.count = 2;
      x.design = { ...one.design, volumeL: one.design.volumeL * 2, frontVolumeL: one.design.frontVolumeL * 2, bp8: { ...one.design.bp8, innerVolumeL: one.design.bp8.innerVolumeL * 2 } };
    });
    for (const f of [30, 50, 80, 150]) {
      const a = C.carEvaluator(one).raw(f).g;
      const b = C.carEvaluator(two).raw(f).g;
      expect(P.abs({ re: a.re - b.re, im: a.im - b.im })).toBeLessThan(1e-9 * Math.max(1, P.abs(a)));
    }
  });
});

describe('the car build of the band-pass family', () => {
  it('6th order: one cabinet, a divider, two baffle ports; the rear port is round at its own size', () => {
    const b = build(withDefaults('bandpass6'));
    expect(b.cabinets).toHaveLength(1);
    expect(b.cabinets[0]!.panels.some((p) => p.name === 'Divider')).toBe(true);
    expect(b.ports).toHaveLength(2);
    expect(b.warnings.some((w) => w.includes('6th-order box is one cabinet'))).toBe(true);
  });

  it('8th order: two dividers; vented has two baffle ports and a tube inside, chain one and two, sealed one and one', () => {
    const v = build(withDefaults('bandpass8', 1, 'vented'));
    const ch = build(withDefaults('bandpass8', 1, 'chain'));
    const se = build(withDefaults('bandpass8', 1, 'sealed'));
    for (const b of [v, ch, se]) expect(b.cabinets[0]!.panels.find((p) => p.name === 'Divider')!.qty).toBe(2);
    expect([v.ports.length, ch.ports.length, se.ports.length]).toEqual([2, 1, 1]);
    expect([v.innerPorts!.length, ch.innerPorts!.length, se.innerPorts!.length]).toEqual([1, 2, 1]);
  });

  it('each sub gets its own box with its share of the air', () => {
    const c = withDefaults('bandpass6', 2);
    const b = build(c);
    const one = build(withDefaults('bandpass6', 1));
    expect(b.count).toBe(2);
    // the same per-sub box as one sub alone
    // (the start volumes are rounded to four figures, so equal to about that)
    expect(b.cabinets[0]!.geometry.wI).toBeCloseTo(one.cabinets[0]!.geometry.wI, 3);
    expect(b.cabinets[0]!.geometry.dI).toBeCloseTo(one.cabinets[0]!.geometry.dI, 3);
  });

  it('a wedge is built rectangular, with a warning that names the passive radiator too', () => {
    const b = build(car((x) => { x.shape = 'wedge'; x.space = { ...NO_SPACE }; x.design = { ...x.design, ...C.carBandpassDefaults(x.design, 'bandpass6', 1) }; }));
    expect(b.warnings.some((w) => w.includes('built rectangular') && w.includes('passive-radiator'))).toBe(true);
    expect(b.cabinets[0]!.wedge).toBeUndefined();
  });

  it('is checked against the vehicle space, the boxes side by side', () => {
    const roomy = build(car((x) => { x.design = { ...x.design, ...C.carBandpassDefaults(x.design, 'bandpass6', 1) }; x.space = { id: 'custom', wCm: 400, hCm: 400, dCm: 400 }; }));
    expect(roomy.fit!.fits).toBe(true);
    expect(roomy.warnings.some((w) => w.includes('the space is'))).toBe(false);
    const tight = build(car((x) => { x.count = 2; x.design = { ...x.design, ...C.carBandpassDefaults(x.design, 'bandpass6', 2) }; x.space = { id: 'custom', wCm: 50, hCm: 30, dCm: 30 }; }));
    expect(tight.fit!.fits).toBe(false);
    expect(tight.warnings.some((w) => w.includes('the 2 boxes side by side') && w.includes('the space is'))).toBe(true);
    const g = tight.cabinets[0]!.geometry;
    expect(tight.fit!.outside[0]).toBeCloseTo(2 * g.wO, 9);
    expect(tight.fit!.outside[1]).toBeCloseTo(g.hO, 9);
    expect(tight.fit!.space).toEqual([0.5, 0.3, 0.3]);
  });

  it('carries the front speakers the sealed and ported builds carry: their drivers, the adapter rings and their checks', () => {
    const c = car((x) => {
      x.space = { ...NO_SPACE };
      x.design = { ...x.design, ...C.carBandpassDefaults(x.design, 'bandpass6', 1) };
      x.front = { ...x.front, enabled: true };
    });
    const b = build(c);
    expect(b.drivers.some((d) => d.name.includes('(front, one each side)'))).toBe(true);
    expect(b.rings!.length).toBe(1);
    expect(b.parts!.some((p) => p.part === b.rings![0]!.title)).toBe(true);
    const off = build(withDefaults('bandpass6'));
    expect(off.rings ?? []).toHaveLength(0);
    // and the front speakers' own checks (not enough depth behind the baffle)
    const shallow = build(car((x) => {
      x.space = { ...NO_SPACE };
      x.design = { ...x.design, ...C.carBandpassDefaults(x.design, 'bandpass6', 1) };
      x.front = { ...x.front, enabled: true, depthCm: 2, ringCm: 5 };
    }));
    expect(shallow.warnings.some((w) => w.includes('behind the baffle'))).toBe(true);
    expect(off.warnings.some((w) => w.includes('behind the baffle'))).toBe(false);
  });
});

describe('the car build of the passive radiator', () => {
  const pc = (count = 1): C.CarSub => car((x) => { x.count = count; x.space = { ...NO_SPACE }; x.design = { ...x.design, ...M.passiveDefaults(x.design, count), type: 'passive' }; });

  it('a hole for each radiator on the baffle, the radiators in the parts, the mass to add in the warnings, no ports', () => {
    for (const n of [1, 2]) {
      const b = build(pc(n));
      expect(b.ports).toHaveLength(0);
      const driverHoles = b.cabinets[0]!.cutouts.filter((x) => x.kind === 'driver');
      expect(driverHoles).toHaveLength(2 * n);
      expect(b.drivers.find((d) => d.name.startsWith('Passive radiator'))!.qty).toBe(n);
      expect(b.warnings.some((w) => w.includes('passive radiator') && w.includes('to tune the box'))).toBe(true);
    }
  });

  it('the mass to add is for each radiator in its own share of the air', () => {
    const c = pc(2);
    const expected = Math.round(M.prOf({ ...c.design, volumeL: c.design.volumeL / 2 }).addedKg * 1000);
    const wrong = Math.round(M.prOf(c.design).addedKg * 1000);
    expect(expected).not.toBe(wrong);
    const w = build(c).warnings.find((x) => x.includes('to each passive radiator'))!;
    expect(Number(/add (-?\d+) g/.exec(w)![1])).toBe(expected);
  });

  it('the radiators take room: the box is larger than the same air with no radiator', () => {
    const withPr = build(pc(1)).cabinets[0]!.geometry;
    const air = car((x) => { x.space = { ...NO_SPACE }; x.design = { ...x.design, ...M.passiveDefaults(x.design, 1), type: 'sealed' }; });
    const sealed = build(air).cabinets[0]!.geometry;
    expect(withPr.wI * withPr.hI * withPr.dI).toBeGreaterThan(sealed.wI * sealed.hI * sealed.dI);
  });

  it('a wedge still builds with the radiators on the sloping baffle', () => {
    const b = build(car((x) => { x.shape = 'wedge'; x.taper = 0.5; x.space = { ...NO_SPACE }; x.design = { ...x.design, ...M.passiveDefaults(x.design, 1), type: 'passive' }; }));
    expect(b.cabinets[0]!.wedge).toBeDefined();
    expect(b.cabinets[0]!.cutouts.filter((x) => x.kind === 'driver')).toHaveLength(2);
  });
});

describe('a TQWT, a transmission line or a horn in a car is built as a sealed box, with a warning', () => {
  it('each says so', () => {
    for (const [type, word] of [['horn', 'a horn'], ['tline', 'a transmission line'], ['tqwt', 'a TQWT']] as const) {
      const b = build(car((x) => (x.design = { ...x.design, type })));
      expect(b.warnings.some((w) => w.includes(`${word} is built as a sealed box`))).toBe(true);
    }
  });
});

describe('3D on the car page', () => {
  it('draws the dividers of a band-pass install: one for the 6th order, two for the 8th', () => {
    for (const [kind, n] of [['bandpass6', 1], ['bandpass8', 2]] as const) {
      const p = project(withDefaults(kind));
      const lay = layout3d(B.computeBuild(p), p);
      expect(lay.boxes.filter((x) => x.kind === 'divider')).toHaveLength(n);
    }
  });
});

describe('the speaker page: the passive radiator', () => {
  const speaker = (edit: (s: L.Loudspeaker) => void): L.Loudspeaker => {
    const s = L.defaultSpeaker('two-way');
    edit(s);
    return L.sanitizeLoudspeaker(s);
  };
  const sp = (s: L.Loudspeaker): B.BandBuild => B.computeBuild(S.sanitizeProject({ ...S.DEFAULT_PROJECT, kind: 'speaker', speaker: s })).bands[0]!;
  const passive = (s: L.Loudspeaker): void => {
    s.slots[0]!.design = { ...s.slots[0]!.design, ...M.passiveDefaults(s.slots[0]!.design, 1), type: 'passive' };
  };

  it('a hole for the radiator under the driver, the radiator among the drivers, the mass to add in the warnings, no port', () => {
    const b = sp(speaker(passive));
    expect(b.ports).toHaveLength(0);
    expect(b.cabinets[0]!.cutouts.filter((x) => x.kind === 'driver')).toHaveLength(3); // woofer, tweeter, radiator
    expect(b.drivers.find((d) => d.name.startsWith('Passive radiator'))!.qty).toBe(1);
    expect(b.warnings.some((w) => w.includes('passive radiator') && w.includes('to tune the box'))).toBe(true);
  });

  it('it is not reported as an unsupported slot type, and its radiator takes room', () => {
    expect(sp(speaker(passive)).warnings.some((w) => w.includes('built as a sealed chamber'))).toBe(false);
    const withPr = sp(speaker(passive)).cabinets[0]!.geometry;
    const sealed = sp(speaker((s) => (s.slots[0]!.design = { ...s.slots[0]!.design, ...M.passiveDefaults(s.slots[0]!.design, 1), type: 'sealed' }))).cabinets[0]!.geometry;
    expect(withPr.netM3).toBeLessThan(withPr.wI * withPr.hI * withPr.dI);
    expect(withPr.dI).toBeGreaterThanOrEqual(sealed.dI);
  });

  it('a radiator for each driver of a multi-driver slot', () => {
    const s = L.defaultSpeaker('mtm');
    const woofer = s.slots.findIndex((x, k) => L.arrangementOf(s.arrangement).slots[k]!.count > 1);
    expect(woofer).toBeGreaterThanOrEqual(0);
    const count = L.arrangementOf(s.arrangement).slots[woofer]!.count;
    s.slots[woofer]!.design = { ...s.slots[woofer]!.design, ...M.passiveDefaults(s.slots[woofer]!.design, count), type: 'passive' };
    const b = sp(L.sanitizeLoudspeaker(s));
    expect(b.drivers.find((d) => d.name.startsWith('Passive radiator'))!.qty).toBe(count);
  });

  it('the mass to add is for each radiator in its own share of the slot air', () => {
    const s = L.defaultSpeaker('mtm');
    const k = s.slots.findIndex((_, i) => L.arrangementOf(s.arrangement).slots[i]!.count > 1);
    const count = L.arrangementOf(s.arrangement).slots[k]!.count;
    s.slots[k]!.design = { ...s.slots[k]!.design, ...M.passiveDefaults(s.slots[k]!.design, count), type: 'passive' };
    const d = s.slots[k]!.design;
    const expected = Math.round(M.prOf({ ...d, volumeL: d.volumeL / count }).addedKg * 1000);
    expect(expected).not.toBe(Math.round(M.prOf(d).addedKg * 1000));
    const w = sp(L.sanitizeLoudspeaker(s)).warnings.find((x) => x.includes('to each passive radiator'))!;
    expect(Number(/add (-?\d+) g/.exec(w)![1])).toBe(expected);
  });

  it('a TQWT or a transmission line slot is built sealed with a warning, as the band-pass family is', () => {
    for (const type of ['tqwt', 'tline'] as const) {
      const b = sp(speaker((s) => (s.slots[0]!.design = { ...s.slots[0]!.design, type })));
      expect(b.warnings.some((w) => w.includes('built as a sealed chamber'))).toBe(true);
    }
  });

  it('the speaker evaluator already follows the slot type: a passive slot differs from a sealed one', () => {
    const a = L.computeLoudspeaker(speaker(passive));
    const b = L.computeLoudspeaker(speaker((s) => (s.slots[0]!.design = { ...s.slots[0]!.design, ...M.passiveDefaults(s.slots[0]!.design, 1), type: 'sealed' })));
    expect(a.levelDb.every(Number.isFinite)).toBe(true);
    expect(a.levelDb.some((v, i) => Math.abs(v - b.levelDb[i]!) > 0.3)).toBe(true);
  });
});
