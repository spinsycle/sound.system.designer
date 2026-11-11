// A3 pass condition: the system sums correctly. The app's system model is asserted against the shared system_spl
// vectors and against the library's plugin-parity systemResponse, and its warnings are made to fire.
import * as P from '@soundsystemdesigner/physics';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as M from '../src/model';
import * as S from '../src/system';

interface Vector {
  id: string;
  inputs: Record<string, number>;
  outputs: Record<string, number>;
}
const file = JSON.parse(readFileSync(new URL('../../physics/test/test-vectors.json', import.meta.url), 'utf8')) as { vectors: Vector[] };
const vec = (id: string): Vector => file.vectors.find((x) => x.id === id)!;

const ref = vec('driver_derived');
const custom = { fsHz: ref.inputs.fs!, qts: ref.outputs.qts!, qms: ref.inputs.qms!, vasL: ref.inputs.vas_m3! * 1000, sdCm2: ref.inputs.sd_m2! * 1e4, reOhm: ref.inputs.re!, xmaxMm: 10, powerW: 100 };
const sealed = (volumeL: number): M.Design => ({ ...M.DEFAULT_DESIGN, driverClass: M.CUSTOM_CLASS, custom, type: 'sealed', volumeL });
const band = (design: M.Design, more: Partial<S.Band> = {}): S.Band => ({ design, count: 1, series: 1, ampPowerW: 500, ampLoadOhm: 4, ampMinLoadOhm: 2, build: { rw: 1, rh: 1.5, rd: 1, brace: 'none' }, trimDb: 0, delayMs: 0, invert: false, solo: false, mute: false, ...more });
const project = (bands: S.Band[], more: Partial<S.Project> = {}): S.Project =>
  S.sanitizeProject({ ...S.DEFAULT_PROJECT, nBands: bands.length, bands: [...bands, ...S.DEFAULT_PROJECT.bands.slice(bands.length)], ...more });
const db = (c: P.Cx): number => P.splDb(P.abs(c));

describe('system level', () => {
  const v0 = vec('system_spl_120hz').inputs;
  const two = project(
    [band(sealed(v0.sub_vb_l!), { count: v0.sub_n!, series: v0.sub_series! }), band(sealed(v0.top_vb_l!), { trimDb: v0.top_trim_db!, invert: true, delayMs: v0.top_delay_ms! })],
    { xover: [v0.xover!, 800, 3500] },
  );

  it('equals the shared two-band vectors: sum, sub and top', () => {
    expect(v0.volts).toBe(S.REF_VOLTS);
    const sys = S.systemEvaluator(two);
    for (const id of ['system_spl_40hz', 'system_spl_120hz', 'system_spl_200hz', 'system_spl_800hz']) {
      const v = vec(id);
      expect(db(sys.total(v.inputs.f!))).toBeCloseTo(v.outputs.spl_db!, 7);
      expect(db(sys.bands[0]!.played(v.inputs.f!))).toBeCloseTo(v.outputs.sub_spl_db!, 7);
      expect(db(sys.bands[1]!.played(v.inputs.f!))).toBeCloseTo(v.outputs.top_spl_db!, 7);
    }
  });

  it('with bands levelled by sensitivity, the shape is the library systemResponse (the plugin-parity function)', () => {
    // 18 in ported sub and 12 in sealed top, trimmed so both reference pressures are equal: what the plugin sums
    const sub = M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: 3, type: 'ported', volumeL: 150, tuneHz: 40 });
    const top = M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: 1, type: 'sealed', volumeL: 60 });
    const pSub = P.referencePressure(M.driverOf(sub), S.REF_VOLTS);
    const pTop = P.referencePressure(M.driverOf(top), S.REF_VOLTS);
    const trimTop = 20 * Math.log10(pSub / pTop);
    const sys = S.systemEvaluator(project([band(sub, { delayMs: 1.5 }), band(top, { trimDb: trimTop })], { xover: [100, 800, 3500] }));
    const box = (d: M.Design): P.BoxParams => ({ driver: M.driverOf(d), type: d.type as P.BoxType, volumeL: d.volumeL, tuneHz: d.tuneHz, frontVolumeL: d.frontVolumeL, hornThroatCm2: 600, hornMouthCm2: 4000, hornLengthM: 1 });
    const lib: P.SystemParams = { bands: 2, xover: [100, 800, 3500], align: true, band: [{ box: box(sub), solo: false, mute: false, trimDb: 0, delayMs: 1.5 }, { box: box(top), solo: false, mute: false, trimDb: 0, delayMs: 0 }] };
    for (const f of [30, 70, 100, 140, 400, 2000]) {
      const want = P.scale(P.systemResponse(lib, f), pSub);
      const got = sys.total(f);
      expect(Math.hypot(got.re - want.re, got.im - want.im)).toBeLessThan(1e-9 * P.abs(want));
    }
  });

  it('driver groups: two in parallel are 6 dB louder, two in series are not; four series-parallel are 6 dB louder', () => {
    const at = (count: number, series: number): number => db(S.systemEvaluator(project([band(sealed(100), { count, series })])).total(200));
    expect(at(2, 1) - at(1, 1)).toBeCloseTo(6.0206, 3);
    expect(at(2, 2) - at(1, 1)).toBeCloseTo(0, 9);
    expect(at(4, 2) - at(1, 1)).toBeCloseTo(6.0206, 3);
  });

  it('trim, polarity, mute, solo and distance', () => {
    const one = (more: Partial<S.Band>, proj: Partial<S.Project> = {}): P.Cx => S.systemEvaluator(project([band(sealed(100), more)], proj)).total(200);
    expect(db(one({ trimDb: -6 })) - db(one({}))).toBeCloseTo(-6, 9);
    expect(one({ invert: true }).re).toBeCloseTo(-one({}).re, 12);
    expect(P.abs(one({ mute: true }))).toBe(0);
    // 10 m outdoors: the distance law's 20 dB plus air absorption over 9 m
    expect(db(one({}, { distanceM: 10 })) - db(one({}))).toBeCloseTo(-20 - 9 * P.airAbsorptionDbPerM(200), 6);
    const sys = S.systemEvaluator(project([band(sealed(100), { solo: true }), band(sealed(20))], { xover: [120, 800, 3500] }));
    expect(sys.bands.map((b) => b.audible)).toEqual([true, false]);
    expect(db(sys.total(60))).toBeCloseTo(db(sys.bands[0]!.played(60)), 9);
    expect(S.computeSystem(project([band(sealed(100), { solo: true }), band(sealed(20))])).notes.some((n) => n.includes('soloed'))).toBe(true);
  });
});

describe('system checks', () => {
  const same = (more: Partial<S.Band> = {}): S.Project => project([band(sealed(60)), band(sealed(60), more)], { xover: [300, 800, 3500], lowestHz: 60 });

  it('two identical bands sum flat; inverting one opens a hole at the crossover and the warning fires', () => {
    const ok = S.computeSystem(same());
    const k = ok.freqs.findIndex((f) => f >= 300);
    // LR4 legs of the same box sum to the box itself
    expect(ok.levelDb[k]!).toBeCloseTo(db(S.systemEvaluator(same()).bands[0]!.box(ok.freqs[k]!)), 6);
    const cancels = (c: S.SystemView): string[] => c.warnings.filter((w) => w.includes('cancel'));
    expect(cancels(ok)).toEqual([]);
    const bad = S.computeSystem(same({ invert: true }));
    expect(bad.levelDb[k]!).toBeLessThan(ok.levelDb[k]! - 20);
    expect(cancels(bad).length).toBe(1);
    expect(cancels(bad)[0]).toContain('Low and High cancel at the 300 Hz crossover');
    // a muted neighbour is not a cancellation
    expect(cancels(S.computeSystem(same({ invert: true, mute: true })))).toEqual([]);
  });

  it('crossover points out of order are used in order, with a note', () => {
    const c = S.computeSystem(project([band(sealed(60)), band(sealed(60)), band(sealed(60))], { xover: [500, 200, 3500] }));
    expect(c.xover).toEqual([500, 600]);
    expect(c.notes.some((n) => n.includes('Crossover 2 is used at 600 Hz, not 200 Hz'))).toBe(true);
    expect(S.computeSystem(same()).notes.some((n) => n.includes('is used at'))).toBe(false);
  });

  it('passbands and native levels', () => {
    const c = S.computeSystem(project([band(sealed(100)), band(sealed(20)), band(sealed(20))], { xover: [120, 900, 3500], lowestHz: 50 }));
    expect(c.bands.map((b) => [b.loHz, b.hiHz])).toEqual([[50, 120], [120, 900], [900, 12000]]);
    expect(c.bands.map((b) => b.name)).toEqual(['Sub', 'Mid', 'High']);
    // far above its corner the sealed box is at its reference level: 95.32 dB for 2.83 V (the sens_reference vector)
    expect(c.bands[2]!.nativeDb).toBeCloseTo(vec('sens_reference').outputs.spl_2v83_db!, 1);
    expect(c.bands[0]!.summary).toBe('Custom, 100 L sealed');
  });

  it('levelTrims brings every band down to the quietest', () => {
    const p = S.applyTemplate(S.DEFAULT_PROJECT, 3); // 4-way PA
    const trims = S.levelTrims({ ...p, bands: p.bands.map((b) => ({ ...b, trimDb: 0 })) });
    expect(Math.max(...trims)).toBe(0);
    expect(trims.every((t) => t <= 0)).toBe(true);
    const native = S.computeSystem(p).bands.map((b) => b.nativeDb);
    const levelled = native.map((v, k) => v + trims[k]!);
    expect(Math.max(...levelled) - Math.min(...levelled)).toBeLessThan(0.11);
    expect(p.bands.slice(0, 4).map((b) => b.trimDb)).toEqual(trims);
    // a band with no passband is left alone
    const none = S.levelTrims(project([band(sealed(100)), band(sealed(20))], { xover: [100, 800, 3500], lowestHz: 150 }));
    expect(none[0]).toBe(0);
  });
});

describe('amps, wiring and limits', () => {
  // the reference driver with the limit vectors' ratings: 600 W, and Xmax 10 mm
  const rated = (volumeL: number): M.Design => ({ ...sealed(volumeL), custom: { ...custom, powerW: vec('limit_thermal').inputs.pe!, xmaxMm: vec('limit_excursion').inputs.xmax_m! * 1000 } });
  const driver = M.driverOf(rated(100));
  const limitsOf = (more: Partial<S.Band>, proj: Partial<S.Project> = {}): S.BandLimits => S.computeSystem(project([band(rated(100), more)], { lowestHz: 30, ...proj })).bands[0]!.limits;

  it('the three limit voltages are the shared formulas', () => {
    const l = limitsOf({ count: 2, series: 2, ampPowerW: vec('limit_amp').inputs.power_w!, ampLoadOhm: vec('limit_amp').inputs.load_ohm! });
    expect(l.ampV).toBeCloseTo(vec('limit_amp').outputs.volts!, 9);
    expect(l.heatV).toBeCloseTo(vec('limit_thermal').outputs.volts!, 9);
    // a sealed box with Qtc under 0.707 moves most at the lowest frequency it is asked to play
    const worst = P.abs(P.sealedX(30, driver, P.deriveDriver(driver), 0.1));
    expect(l.excursionV).toBeCloseTo(P.excursionLimitVolts(driver.xmax, worst, 2), 9);
    expect(l.limitV).toBe(Math.min(l.ampV, l.heatV, l.excursionV));
  });

  it('each cause can be the one that stops the band', () => {
    expect(limitsOf({ ampPowerW: 20 }).cause).toBe('amp');
    expect(limitsOf({ ampPowerW: 20000, ampLoadOhm: 8 }, { lowestHz: 200 }).cause).toBe('heat');
    expect(limitsOf({ ampPowerW: 20000, ampLoadOhm: 8 }, { lowestHz: 20 }).cause).toBe('excursion');
  });

  it('a crossover under the band protects the cone', () => {
    const alone = limitsOf({}, { lowestHz: 30 }).excursionV;
    const top = S.computeSystem(project([band(rated(100)), band(rated(100))], { xover: [300, 800, 3500], lowestHz: 30 })).bands[1]!.limits.excursionV;
    expect(top).toBeGreaterThan(10 * alone);
  });

  it('load: one driver is about Re; four in parallel are a quarter of that and trip the warning', () => {
    const one = S.computeSystem(project([band(rated(100))], { lowestHz: 30 }));
    expect(one.bands[0]!.limits.minLoadOhm).toBeGreaterThanOrEqual(driver.re);
    expect(one.bands[0]!.limits.minLoadOhm).toBeLessThan(driver.re * 1.2);
    expect(one.warnings.some((w) => w.includes('the load falls'))).toBe(false);
    const four = S.computeSystem(project([band(rated(100), { count: 4, series: 1 })], { lowestHz: 30 }));
    expect(four.bands[0]!.limits.minLoadOhm).toBeCloseTo(one.bands[0]!.limits.minLoadOhm / 4, 9);
    expect(four.warnings.some((w) => w.includes("Full range: the load falls to 1.3 Ω, under the amp's 2.0 Ω minimum"))).toBe(true);
    // series-parallel brings it back
    expect(S.computeSystem(project([band(rated(100), { count: 4, series: 2 })], { lowestHz: 30 })).warnings.some((w) => w.includes('the load falls'))).toBe(false);
  });

  it('warnings: the amp can overheat the drivers, or push the cone past Xmax; a small amp does neither', () => {
    const hot = S.computeSystem(project([band(rated(100), { ampPowerW: 4000, ampLoadOhm: 4 })], { lowestHz: 200 }));
    // 4000 W into 4 ohm is 126.5 V; into this driver's 5 ohm that is 3200 W
    expect(hot.warnings.some((w) => w.includes('the amp puts 3200 W into each driver, rated 600 W'))).toBe(true);
    const far = S.computeSystem(project([band(rated(100), { ampPowerW: 4000, ampLoadOhm: 4 })], { lowestHz: 20 }));
    expect(far.warnings.some((w) => w.includes('the cone passes Xmax (10.0 mm)'))).toBe(true);
    const small = S.computeSystem(project([band(rated(100), { ampPowerW: 20 })], { lowestHz: 30 }));
    expect(small.warnings).toEqual([]);
  });

  it('max level and headroom: trim eats headroom; the system stops where its weakest audible band does', () => {
    const c = S.computeSystem(project([band(rated(100), { ampPowerW: 20 })], { lowestHz: 30 }));
    const l = c.bands[0]!.limits;
    expect(l.maxDb).toBeCloseTo(c.bands[0]!.nativeDb + 20 * Math.log10(l.limitV / S.REF_VOLTS), 9);
    expect(l.headroomDb).toBeCloseTo(20 * Math.log10(l.limitV / S.REF_VOLTS), 9);
    expect(limitsOf({ ampPowerW: 20, trimDb: 6 }).headroomDb).toBeCloseTo(l.headroomDb - 6, 9);
    expect(limitsOf({ ampPowerW: 20, trimDb: 6 }).maxDb).toBeCloseTo(l.maxDb, 9);
    const two = (more: Partial<S.Band> = {}): S.SystemLimits =>
      S.computeSystem(project([band(rated(100), { ampPowerW: 2000 }), band(rated(100), { ampPowerW: 20, ...more })], { xover: [300, 800, 3500], lowestHz: 30 })).limits;
    expect(two().limitingBand).toBe(1);
    expect(two().headroomDb).toBeCloseTo(20 * Math.log10(P.ampVolts(20, 4) / S.REF_VOLTS), 9);
    expect(two({ mute: true }).limitingBand).toBe(0);
    expect(Number.isFinite(two().referenceDb)).toBe(true);
    expect(S.computeSystem(project([band(rated(100), { mute: true })])).limits.limitingBand).toBe(-1);
  });
});

describe('project', () => {
  it('sanitizeProject: defaults for junk, four bands always, clamps', () => {
    expect(S.sanitizeProject(null)).toEqual(S.DEFAULT_PROJECT);
    const p = S.sanitizeProject({ nBands: 9, selected: 7, view: 'elsewhere', xover: [5, 'x'], distanceM: 1e6, bands: [{ trimDb: 99, count: 6, series: 4, invert: 'yes' }, { count: 6, series: 3, design: { type: 'sealed' } }] });
    expect([p.nBands, p.selected, p.view, p.xover, p.distanceM, p.bands.length]).toEqual([4, 3, 'system', [20, 800, 3500], 200, 4]);
    expect([p.bands[0]!.trimDb, p.bands[0]!.count, p.bands[0]!.series, p.bands[0]!.invert]).toEqual([12, 6, 1, false]);
    expect([p.bands[1]!.count, p.bands[1]!.series, p.bands[1]!.design.type]).toEqual([6, 3, 'sealed']);
    expect(p.bands[0]!.design).toEqual(S.DEFAULT_PROJECT.bands[0]!.design);
    expect(S.sanitizeProject(p)).toEqual(p);
  });

  it('every template loads: valid, levelled, finite, and no crossover point moved', () => {
    S.TEMPLATES.forEach((t, i) => {
      const p = S.applyTemplate({ ...S.DEFAULT_PROJECT, distanceM: 5 }, i);
      expect(p.nBands, t.label).toBe(t.bands.length);
      expect(p.distanceM).toBe(5);
      expect(S.sanitizeProject(p)).toEqual(p);
      const c = S.computeSystem(p);
      expect(c.levelDb.every(Number.isFinite), t.label).toBe(true);
      expect(c.bands.every((b) => Number.isFinite(b.nativeDb)), t.label).toBe(true);
      expect(c.notes.some((n) => n.includes('is used at')), t.label).toBe(false);
      expect(Math.max(...p.bands.slice(0, p.nBands).map((b) => b.trimDb))).toBe(0);
    });
  });

  it('templates use the plugin factory presets: the dancehall stack', () => {
    const p = S.applyTemplate(S.DEFAULT_PROJECT, S.TEMPLATES.findIndex((t) => t.label.includes('dancehall')));
    // the plugin preset crosses at 450 Hz; the horn simulation shows an 8 dB hole there (mid horn cutoff 739 Hz), so the app crosses above the cutoff
    expect(p.xover).toEqual([100, 900, 3000]);
    expect(S.computeSystem(p).warnings.filter((w) => w.includes('cancel'))).toEqual([]);
    const [bass, mid] = p.bands;
    expect([bass!.design.driverClass, bass!.design.type, bass!.design.horn.loading, bass!.design.horn.throatCm2, bass!.design.horn.mouthCm2, bass!.design.horn.throatChamberL]).toEqual([3, 'horn', 'rear', 600, 4000, 40]);
    // the plugin gives throat, mouth and length; the flare that has them is 1 m long
    expect(S.computeSystem(p).bands[0]!.summary).toBe('18 in, scoop, 52 Hz exponential');
    expect([mid!.design.driverClass, mid!.design.horn.loading, mid!.design.volumeL]).toEqual([1, 'front', 20]);
    expect(M.compute(bass!.design).horn!.lengthM).toBeCloseTo(1.0, 9);
  });
});

describe('amps: details the first pass left uncovered', () => {
  const rated: M.Design = { ...sealed(100), custom: { ...custom, powerW: 600, xmaxMm: 10 } };
  const one = (more: Partial<S.Band>, proj: Partial<S.Project> = {}): S.SystemView => S.computeSystem(project([band(rated, more)], { lowestHz: 30, ...proj }));

  it('the power warning counts the series string: two in series share the voltage', () => {
    const w = one({ count: 2, series: 2, ampPowerW: 4000, ampLoadOhm: 4 }, { lowestHz: 200 }).warnings;
    expect(w.some((x) => x.includes('puts 800 W into each driver'))).toBe(true);
  });

  it('the Xmax warning gives watts on the amp rating', () => {
    const v = one({ ampPowerW: 4000, ampLoadOhm: 4 }, { lowestHz: 20 });
    const watts = (v.bands[0]!.limits.excursionV ** 2 / 4).toFixed(0);
    expect(v.warnings.some((x) => x.includes(`${watts} W on the amp's rating`))).toBe(true);
  });

  it('the reference level averages from the lowest frequency played up', () => {
    expect(one({}, { lowestHz: 200 }).limits.referenceDb).not.toBeCloseTo(one({}, { lowestHz: 30 }).limits.referenceDb, 1);
  });

  it('stored amp values: only the offered loads, minimum load clamped', () => {
    const b = (x: object) => S.sanitizeProject({ bands: [x] }).bands[0]!;
    expect(b({ ampLoadOhm: 3 }).ampLoadOhm).toBe(4);
    expect(b({ ampLoadOhm: 8 }).ampLoadOhm).toBe(8);
    expect(b({ ampMinLoadOhm: 99 }).ampMinLoadOhm).toBe(16);
    expect(b({ ampMinLoadOhm: 4 }).ampMinLoadOhm).toBe(4);
  });
});

describe('templates carry amps sized to their drivers', () => {
  it('every template band gets an amp equal to its driver rating, so none starts with a power warning', () => {
    S.TEMPLATES.forEach((t, i) => {
      const v = S.computeSystem(S.applyTemplate(S.DEFAULT_PROJECT, i));
      v.bands.forEach((b) => expect(b.limits.ampV).toBeLessThanOrEqual(b.limits.heatV));
      expect(v.warnings.filter((w) => w.includes('into each driver'))).toEqual([]);
    });
  });
});
