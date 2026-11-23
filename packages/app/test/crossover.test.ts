// The crossover page's model: sanitising, wiring advice, time alignment, active and passive sums, warnings, import, storage.
import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import * as X from '../src/crossover';
import { applyImport, driverFromSpec, importFromDesign } from '../src/crossoverimport';
import { FILE_VERSION, parseProjectFile, serializeProject } from '../src/projectfile';
import { DEFAULT_PROJECT, sanitizeProject } from '../src/system';

/** Two drivers that are flat and equal, so a flat sum is the alignment's doing. */
function flat(over: Partial<X.XoState> = {}, driver: Partial<X.XoDriver> = {}): X.XoState {
  const d = (role: X.Role): X.XoDriver => ({ ...X.driverFor(role), fsHz: 10, qts: 0.707, upperHz: 0, sensDb: 90, leMh: 0, reOhm: 8, nomOhm: 8, qms: 50, ...driver });
  return X.sanitizeXo({ ...X.DEFAULT_XO, ways: 2, drivers: [d('woofer'), d('tweeter'), X.driverFor('mid'), X.driverFor('sub')], xover: [2500, 3000, 3500], ...over });
}
const at = (c: X.Computed, hz: number): number => c.sumDb[c.freqs.findIndex((f) => f >= hz)]!;
const spread = (c: X.Computed, lo: number, hi: number): number => {
  const v = c.sumDb.filter((_, k) => c.freqs[k]! >= lo && c.freqs[k]! <= hi);
  return Math.max(...v) - Math.min(...v);
};

describe('sanitizeXo', () => {
  it('junk becomes the defaults; numbers clamp; the way count and order are valid', () => {
    expect(X.sanitizeXo(undefined)).toEqual(X.DEFAULT_XO);
    expect(X.sanitizeXo('x')).toEqual(X.DEFAULT_XO);
    const s = X.sanitizeXo({ ways: 9, order: 99, xover: [1, 99999, 'a'], mode: 'nope', alignment: 'x', series: 'E12', drivers: [{ sensDb: 500, role: 'pa', leMh: -4 }] });
    expect(s.ways).toBe(4);
    expect(s.order).toBe(8);
    expect(s.xover).toEqual([20, 16000, X.DEFAULT_XO.xover[2]]);
    expect(s.mode).toBe('active');
    expect(s.alignment).toBe('linkwitz-riley');
    expect(s.series).toBe('E24');
    expect(s.drivers[0]!.sensDb).toBe(130);
    expect(s.drivers[0]!.role).toBe('woofer');
    expect(s.drivers[0]!.leMh).toBe(0);
    expect(X.sanitizeXo({ ways: 1 }).ways).toBe(2);
    expect(X.sanitizeXo({ ways: 3.5 }).ways).toBe(X.DEFAULT_XO.ways);
  });

  it('a Linkwitz-Riley order is made even; other alignments keep theirs', () => {
    expect(X.sanitizeXo({ alignment: 'linkwitz-riley', order: 3 }).order).toBe(4);
    expect(X.sanitizeXo({ alignment: 'linkwitz-riley', order: 5 }).order).toBe(6);
    expect(X.sanitizeXo({ alignment: 'butterworth', order: 3 }).order).toBe(3);
  });

  it('keeps good curves and drops bad ones', () => {
    const good = { name: 'm', freqHz: [100, 200, 400, 800, 1600], mag: [5, 6, 7, 6, 5], phaseDeg: [0, 5, 10, 15, 20] };
    const s = X.sanitizeXo({ drivers: [{ zma: good, frd: { ...good, mag: [-3, 0, 3, 0, -3] } }, { zma: { ...good, mag: [5, 0, 7, 6, 5] } }, { frd: { ...good, freqHz: [100, 100, 400, 800, 1600] } }, { zma: { freqHz: [1, 2], mag: [1, 2] } }] });
    expect(s.drivers[0]!.zma).toEqual(good);
    expect(s.drivers[0]!.frd!.mag).toEqual([-3, 0, 3, 0, -3]);
    expect(s.drivers[1]!.zma).toBeNull(); // an impedance of 0 is not a measurement
    expect(s.drivers[2]!.frd).toBeNull(); // repeated frequency
    expect(s.drivers[3]!.zma).toBeNull(); // too few points
    expect(X.sanitizeXo({ drivers: [{ zma: { ...good, phaseDeg: [1, 2] } }] }).drivers[0]!.zma!.phaseDeg).toBeNull();
  });

  it('keeps tuned values only when they are well formed', () => {
    expect(X.sanitizeXo({ tuned: { sig: 'a', values: [[1e-3, 2e-6]] } }).tuned).toEqual({ sig: 'a', values: [[1e-3, 2e-6]] });
    expect(X.sanitizeXo({ tuned: { sig: 'a', values: [[1e-3, -1]] } }).tuned).toBeNull();
    expect(X.sanitizeXo({ tuned: { sig: 3, values: [] } }).tuned).toBeNull();
    expect(X.sanitizeXo({ tuned: { sig: 'a', values: [[1], [1], [1], [1], [1]] } }).tuned).toBeNull();
  });

  it('a stored curve is thinned to the limit and still valid', () => {
    const n = 3000;
    const freqHz = Array.from({ length: n }, (_, i) => 20 * 1000 ** (i / (n - 1)));
    const c = X.storeCurve('big', { kind: 'frd', freqHz, mag: freqHz.map((f) => Math.log10(f)), phaseDeg: freqHz.map(() => 10) });
    expect(c.freqHz.length).toBeLessThanOrEqual(X.MAX_STORED_POINTS);
    expect(c.freqHz.length).toBeGreaterThan(400);
    expect(c.freqHz[0]).toBeCloseTo(20, 9);
    expect(c.freqHz[c.freqHz.length - 1]).toBeCloseTo(20000, 6);
    expect(X.sanitizeCurve(c)).not.toBeNull();
    const small = X.storeCurve('s', { kind: 'zma', freqHz: [10, 20, 40, 80, 160], mag: [1, 2, 3, 4, 5], phaseDeg: null });
    expect(small.freqHz).toEqual([10, 20, 40, 80, 160]);
    expect(small.phaseDeg).toBeNull();
  });

  it('starting points: roles, count, crossover points and the sub split', () => {
    const three = X.startingPoint(X.DEFAULT_XO, 3);
    expect(three.ways).toBe(3);
    expect(three.drivers.slice(0, 3).map((d) => d.role)).toEqual(['woofer', 'mid', 'tweeter']);
    expect(three.xover.slice(0, 2)).toEqual([400, 3000]);
    const four = X.startingPoint(X.DEFAULT_XO, 4);
    expect(four.drivers.map((d) => d.role)).toEqual(['sub', 'woofer', 'mid', 'tweeter']);
    expect(four.xover).toEqual([100, 500, 3000]);
    const sub = X.startingPoint(X.DEFAULT_XO, 2, true);
    expect(sub.ways).toBe(2);
    expect(sub.drivers.slice(0, 2).map((d) => d.role)).toEqual(['sub', 'woofer']);
    expect(sub.xover[0]).toBe(80);
  });
});

describe('storage', () => {
  it('the project keeps the crossover and the kind; an old project gets the default', () => {
    const p = sanitizeProject({ ...DEFAULT_PROJECT, kind: 'crossover', xo: { ...X.DEFAULT_XO, mode: 'passive', ways: 3 } });
    expect(p.kind).toBe('crossover');
    expect(p.xo.mode).toBe('passive');
    expect(p.xo.ways).toBe(3);
    const old = { ...DEFAULT_PROJECT } as Record<string, unknown>;
    delete old.xo;
    expect(sanitizeProject(old).xo).toEqual(X.DEFAULT_XO);
    expect(sanitizeProject({ ...DEFAULT_PROJECT, kind: 'weird' }).kind).toBe('system');
  });

  it('files: version 3 round-trips the crossover; a version 2 file opens unchanged; a newer one is refused', () => {
    expect(FILE_VERSION).toBe(4);
    const p = sanitizeProject({ ...DEFAULT_PROJECT, kind: 'crossover', xo: { ...X.DEFAULT_XO, alignment: 'bessel', order: 3, ways: 3 } });
    const back = parseProjectFile(serializeProject(p));
    expect(back.ok).toBe(true);
    expect(back.project!.xo).toEqual(p.xo);
    const v2 = JSON.stringify({ kind: 'sound-system-designer-project', version: 2, project: { ...DEFAULT_PROJECT, xo: undefined } });
    const o = parseProjectFile(v2);
    expect(o.ok).toBe(true);
    expect(o.project!.xo).toEqual(X.DEFAULT_XO);
    expect(parseProjectFile(JSON.stringify({ kind: 'sound-system-designer-project', version: 5, project: {} })).ok).toBe(false);
  });
});

describe('driver models', () => {
  it('the response model has the stated level between its corners, a high-pass below and a roll-off above', () => {
    const d: X.XoDriver = { ...X.driverFor('mid'), sensDb: 91, fsHz: 100, qts: 0.7, upperHz: 8000 };
    const r = X.driverResponse(d);
    expect(P.dB(P.abs(r(1000)))).toBeCloseTo(91 - 0.07, 0);
    expect(P.dB(P.abs(r(10)))).toBeLessThan(91 - 35);
    expect(P.dB(P.abs(r(8000)))).toBeCloseTo(91 - 3.01, 1);
    expect(P.dB(P.abs(r(20000)))).toBeLessThan(91 - 8);
    expect(P.dB(P.abs(X.driverResponse({ ...d, upperHz: 0 })(20000)))).toBeCloseTo(91, 1);
  });

  it('an imported response replaces the model, as dB SPL', () => {
    const frd = X.storeCurve('r', { kind: 'frd', freqHz: [100, 200, 400, 800, 1600], mag: [80, 85, 90, 95, 100], phaseDeg: null });
    const r = X.driverResponse({ ...X.driverFor('woofer'), frd });
    expect(P.dB(P.abs(r(400)))).toBeCloseTo(90, 9);
    expect(P.dB(P.abs(r(283)))).toBeCloseTo(87.5, 0);
  });

  it('the load: Re plus s Le plus a resonance peak at Fs; an imported impedance replaces it', () => {
    const d: X.XoDriver = { ...X.driverFor('woofer'), reOhm: 6, leMh: 1, fsHz: 40, qts: 0.4, qms: 4, nomOhm: 8 };
    const z = X.driverLoad(d);
    expect(z(20000).re).toBeCloseTo(6, 1);
    expect(z(20000).im).toBeCloseTo(2 * Math.PI * 20000 * 0.001, 0);
    expect(z(40).re).toBeCloseTo(6 + 6 * (4 / ((0.4 * 4) / (4 - 0.4))), 6); // the peak at resonance: Re + Re Qms/Qes
    expect(z(5).re).toBeLessThan(z(40).re);
    const zma = X.storeCurve('z', { kind: 'zma', freqHz: [100, 200, 400, 800, 1600], mag: [5, 6, 7, 8, 9], phaseDeg: null });
    expect(X.driverLoad({ ...d, zma })(400).re).toBeCloseTo(7, 9);
  });
});

describe('active crossover', () => {
  it('Linkwitz-Riley 4 with equal flat drivers sums flat and wired as advised; reversed gives a null', () => {
    const c = X.computeCrossover(flat());
    expect(spread(c, 150, 15000)).toBeLessThan(0.05);
    expect(at(c, 1000)).toBeCloseTo(90, 1);
    expect(Math.max(...c.filterSumDb.map(Math.abs))).toBeLessThan(1e-9); // Linkwitz-Riley wired as advised: an all-pass sum
    expect(Math.min(...X.computeCrossover(flat({ alignment: 'butterworth', order: 2 })).filterSumDb)).toBeCloseTo(0, 0);
    expect(c.polarity).toEqual([1, 1]);
    expect(c.active).toHaveLength(1);
    expect(c.passive).toBeNull();
    expect(c.zAmp).toBeNull();
    const rev = flat({}, {});
    rev.drivers[1] = { ...rev.drivers[1]!, wiring: 'reversed' };
    const bad = X.computeCrossover(rev);
    expect(at(bad, 2500)).toBeLessThan(at(c, 2500) - 20);
    expect(bad.warnings.some((w) => /wired reversed/.test(w))).toBe(true);
  });

  it('advice follows the alignment: Butterworth 2 and Linkwitz-Riley 2 want the upper driver reversed, Linkwitz-Riley 4 does not', () => {
    expect(X.computeCrossover(flat()).advice[0]!.invertUpper).toBe(false);
    expect(X.computeCrossover(flat({ alignment: 'butterworth', order: 2 })).advice[0]!.invertUpper).toBe(true);
    expect(X.computeCrossover(flat({ alignment: 'linkwitz-riley', order: 2 })).advice[0]!.invertUpper).toBe(true);
    const bw2 = X.computeCrossover(flat({ alignment: 'butterworth', order: 2 }));
    expect(bw2.polarity).toEqual([1, -1]);
    expect(bw2.warnings.some((w) => /wired/.test(w))).toBe(false); // auto follows the advice
    const lr2 = X.computeCrossover(flat({ alignment: 'linkwitz-riley', order: 2 }));
    expect(spread(lr2, 150, 15000)).toBeLessThan(0.05);
    expect(X.wantedPolarities(flat({ alignment: 'linkwitz-riley', order: 2, ways: 3 }))).toEqual([1, -1, 1]);
  });

  it('three and four ways sum flat with Linkwitz-Riley 4 and list every split', () => {
    const three = X.startingPoint(flat(), 3);
    three.drivers.forEach((d, i) => {
      three.drivers[i] = { ...d, fsHz: 10, qts: 0.707, upperHz: 0, sensDb: 90 };
    });
    const c = X.computeCrossover(three);
    expect(spread(c, 100, 15000)).toBeLessThan(0.05);
    expect(c.active).toHaveLength(2);
    expect(c.ways).toHaveLength(3);
    expect(c.advice).toHaveLength(2);
    const four = X.startingPoint(three, 4);
    four.drivers.forEach((d, i) => {
      four.drivers[i] = { ...d, fsHz: 10, qts: 0.707, upperHz: 0, sensDb: 90 };
    });
    expect(X.computeCrossover(four).active).toHaveLength(3);
    expect(spread(X.computeCrossover(four), 150, 15000)).toBeLessThan(0.05);
  });

  it('the circuit parts follow the choices: topology, capacitor, series; snapping shows an error', () => {
    const exact = X.computeCrossover(flat({ series: 'none' })).active![0]!;
    expect(exact.snapped).toBe(false);
    expect(exact.lpError.maxDb).toBeLessThan(1e-9);
    const snapped = X.computeCrossover(flat({ series: 'E24' })).active![0]!;
    expect(snapped.snapped).toBe(true);
    expect(snapped.lpError.maxDb).toBeGreaterThan(0);
    expect(snapped.lpError.maxDb).toBeLessThan(2);
    const mfb = X.computeCrossover(flat({ topology: 'mfb', series: 'none' })).active![0]!;
    expect(mfb.lp.topology).toBe('mfb');
    const big = X.computeCrossover(flat({ capNf: 100, series: 'none' })).active![0]!;
    expect(big.lp.sections[0]!.res.r1! / exact.lp.sections[0]!.res.r1!).toBeCloseTo(0.1, 9);
    expect(exact.fcHz).toBe(2500);
    expect(exact.lp.sections[0]!.caps.c1).toBeCloseTo(10e-9, 15); // the base capacitor is in nanofarads
    expect(exact.hp.band).toBe('hp');
  });

  it('level down takes a gain off the driver; a set-back needs the delay, and the delay fixes it', () => {
    const base = X.computeCrossover(flat());
    const padded = flat();
    padded.drivers[1] = { ...padded.drivers[1]!, padDb: 6 };
    expect(at(X.computeCrossover(padded), 10000)).toBeCloseTo(at(base, 10000) - 6, 1);
    const back = flat();
    back.drivers[1] = { ...back.drivers[1]!, setBackMm: 100 };
    const off = X.computeCrossover(back);
    const on = X.computeCrossover({ ...back, alignDelay: true });
    expect(on.delayMs[0]!).toBeCloseTo(100 / 343, 3);
    expect(on.delayMs[1]!).toBe(0);
    expect(spread(on, 150, 15000)).toBeLessThan(0.05);
    expect(spread(off, 150, 15000)).toBeGreaterThan(1);
    expect(off.notes.some((n) => /Delay the nearer drivers/.test(n))).toBe(true);
    expect(off.rmsFlatDb).toBeGreaterThan(on.rmsFlatDb);
  });
});

describe('passive crossover', () => {
  const passive = (over: Partial<X.XoState> = {}, driver: Partial<X.XoDriver> = {}): X.XoState => flat({ mode: 'passive', ...over }, driver);

  it('resistive-like drivers on a Linkwitz-Riley 4 pair sum flat; the amplifier impedance and the parts are reported', () => {
    const c = X.computeCrossover(passive({ dcr: false }));
    expect(c.passive).toHaveLength(2);
    expect(c.passive![0]!.kind).toBe('low-pass 2500 Hz');
    expect(c.passive![1]!.kind).toBe('high-pass 2500 Hz');
    expect(c.passive![0]!.parts.map((p) => p.name)).toEqual(['L1', 'C2', 'L3', 'C4']);
    expect(spread(c, 150, 15000)).toBeLessThan(0.2);
    expect(c.zAmp).toHaveLength(200);
    expect(Math.min(...c.zAmp!)).toBeGreaterThan(2);
    expect(c.passive![0]!.stress.length).toBe(4);
    expect(c.passiveError).toBeNull();
  });

  it('a middle way is the high-pass at the lower crossover then the low-pass at the upper', () => {
    const three = X.startingPoint(passive(), 3);
    const c = X.computeCrossover({ ...three, alignment: 'butterworth', order: 2, dcr: false });
    const want = P.designPassiveBand({ alignment: 'butterworth', order: 2 }, 400, 3000, three.drivers[1]!.nomOhm);
    expect(P.networkValues(c.passive![1]!.network).map((x) => x.value)).toEqual(P.networkValues(want).map((x) => x.value));
  });

  it('a set-back delays the sound in a passive design too (by set-back over the speed of sound)', () => {
    const back = passive({ dcr: false });
    back.drivers[1] = { ...back.drivers[1]!, setBackMm: 100 };
    const c = X.computeCrossover(back);
    const flatC = X.computeCrossover(passive({ dcr: false }));
    expect(spread(c, 150, 15000)).toBeGreaterThan(spread(flatC, 150, 15000) + 1);
    expect(spread(c, 150, 15000)).toBeLessThan(30);
    expect(X.passiveWays(back).ways[1]!.delayS).toBeCloseTo(0.1 / 343, 9);
  });

  it('stress is worked at the amplifier voltage into the lowest nominal impedance', () => {
    const mix = passive({ dcr: false, ampPowerW: 100 });
    mix.drivers[0] = { ...mix.drivers[0]!, nomOhm: 4 };
    const c = X.computeCrossover(mix);
    const d = X.passiveDesigned(mix);
    const want = P.worstStress(d.ways[0]!.network, P.STRESS_FREQS, d.ways[0]!.load, Math.sqrt(100 * 4)); // 100 W into the lowest nominal, 4 ohm
    c.passive![0]!.stress.forEach((s, k) => {
      expect(s.vRms).toBeCloseTo(want[k]!.vRms, 9);
      expect(s.iRms).toBeCloseTo(want[k]!.iRms, 9);
    });
  });

  it('a middle way is a band-pass between its two crossovers', () => {
    const three = X.startingPoint(passive(), 3);
    three.drivers.forEach((d, i) => {
      three.drivers[i] = { ...d, fsHz: 10, qts: 0.707, upperHz: 0, sensDb: 90, leMh: 0 };
    });
    const c = X.computeCrossover({ ...three, alignment: 'butterworth', order: 2 });
    expect(c.passive!.map((w) => w.kind)).toEqual(['low-pass 400 Hz', 'band-pass 400 to 3000 Hz', 'high-pass 3000 Hz']);
  });

  it('what a lossless ladder cannot do is explained, not drawn', () => {
    const cheb = X.computeCrossover(passive({ alignment: 'chebyshev', order: 4 }));
    expect(cheb.passive).toBeNull();
    expect(cheb.passiveError).toMatch(/even-order Chebyshev/);
    expect(cheb.warnings[0]).toMatch(/even-order Chebyshev/);
    const high = X.computeCrossover(passive({ order: 6, alignment: 'butterworth' }));
    expect(high.passiveError).toMatch(/up to order 4/);
    expect(X.computeCrossover(passive({ alignment: 'chebyshev', order: 3 })).passiveError).toBeNull();
  });

  it('a Zobel and a pad change the design; a real driver (inductance) moves the sum off flat', () => {
    const plain = X.computeCrossover(passive({ dcr: false }, { leMh: 0.9 }));
    const zob = X.computeCrossover(passive({ dcr: false, zobel: true }, { leMh: 0.9 }));
    expect(zob.passive![0]!.network.some((b) => b.name === 'Zobel')).toBe(true);
    expect(plain.passive![0]!.network.some((b) => b.name === 'Zobel')).toBe(false);
    expect(zob.rmsFlatDb).toBeLessThan(plain.rmsFlatDb);
    const padded = passive({ dcr: false });
    padded.drivers[1] = { ...padded.drivers[1]!, padDb: 3 };
    const p = X.computeCrossover(padded);
    expect(p.passive![1]!.network.map((b) => b.name).slice(-2)).toEqual(['Rs', 'Rp']);
    expect(P.networkValues(p.passive![1]!.network).length).toBe(4);
    // the pad is in the network: it takes about 3 dB off the way, not 6
    const unpadded = X.computeCrossover(passive({ dcr: false }));
    expect(at(p, 10000) - at(unpadded, 10000)).toBeLessThan(-2.5);
    expect(at(p, 10000) - at(unpadded, 10000)).toBeGreaterThan(-3.5);
  });

  it('the amplifier floor warns, and a very high voltage warns about the capacitor', () => {
    const low = X.computeCrossover(passive({ ampMinLoadOhm: 16 }));
    expect(low.warnings.some((w) => /amplifier sees as little as/.test(w))).toBe(true);
    const hot = X.computeCrossover(passive({ ampPowerW: 20000 }, { nomOhm: 64 }));
    expect(hot.warnings.some((w) => /above any standard film capacitor rating/.test(w))).toBe(true);
    expect(X.computeCrossover(passive()).warnings.some((w) => /standard film/.test(w))).toBe(false);
  });

  it('a passive network cannot delay: a note, and the electrical delay is not applied', () => {
    const back = passive();
    back.drivers[1] = { ...back.drivers[1]!, setBackMm: 80 };
    const c = X.computeCrossover({ ...back, alignDelay: true });
    expect(c.notes.some((n) => /cannot delay/.test(n))).toBe(true);
    expect(c.delayMs).toEqual([0, 0]);
  });

  it('optimising stores values that are used while nothing else changes, then are ignored', () => {
    const start = passive({ series: 'none', dcr: true }, { leMh: 0.9 });
    start.drivers[0] = { ...start.drivers[0]!, leMh: 1.5, sensDb: 88, upperHz: 3500 };
    const before = X.computeCrossover(start);
    const res = X.optimisePassive(start);
    if ('error' in res) throw new Error(res.error);
    expect(res.state.tuned).not.toBeNull();
    expect(res.after).toBeLessThanOrEqual(res.before);
    expect(res.before).toBeCloseTo(P.cost(X.passiveWays(start).ways, { freqs: P.logGrid(625, 10000, 61), zMinOhm: start.ampMinLoadOhm }), 9);
    const after = X.computeCrossover(res.state);
    expect(after.notes.some((n) => /optimised/.test(n))).toBe(true);
    expect(after.rmsFlatDb).toBeLessThanOrEqual(before.rmsFlatDb + 0.05);
    expect(after.passive![0]!.parts[0]!.value).not.toBe(before.passive![0]!.parts[0]!.value);
    const changed = X.computeCrossover({ ...res.state, xover: [3000, 3000, 3500] });
    expect(changed.notes.some((n) => /optimised/.test(n))).toBe(false);
    expect(X.passiveDesigned(res.state).tunedUsed).toBe(true);
    expect(X.passiveDesigned({ ...res.state, zobel: true }).tunedUsed).toBe(false);
  });

  it('optimising with a series puts the moved parts on standard values', () => {
    const start = passive({ series: 'E24', dcr: false }, { leMh: 0.9 });
    const res = X.optimisePassive(start);
    if ('error' in res) throw new Error(res.error);
    for (const w of X.passiveDesigned(res.state).ways) for (const v of P.networkValues(w.network)) expect(P.snapToSeries(v.value, 'E24')).toBeCloseTo(v.value, 14 - Math.floor(Math.log10(Math.abs(v.value))));
    expect('error' in X.optimisePassive(passive({ alignment: 'chebyshev', order: 4 }))).toBe(true);
  });

  it('a driver the networks cannot reach is warned about: crossover vs the tweeter corner and the woofer roll-off', () => {
    const s = passive();
    s.drivers[1] = { ...s.drivers[1]!, fsHz: 2000 };
    s.drivers[0] = { ...s.drivers[0]!, upperHz: 1000 };
    const w = X.computeCrossover(s).warnings.join(' | ');
    expect(w).toMatch(/too close to the 2500 Hz crossover/);
    expect(w).toMatch(/rolls off above 1000 Hz, below its 2500 Hz crossover/);
  });
});

describe('level warning', () => {
  it('names the louder driver and the cure, and goes away when the pad matches', () => {
    const s = flat({}, {});
    s.drivers[1] = { ...s.drivers[1]!, sensDb: 96 };
    expect(X.computeCrossover(s).warnings.join(' ')).toMatch(/is 6\.0 dB louder than/);
    s.drivers[1] = { ...s.drivers[1]!, padDb: 6 };
    expect(X.computeCrossover(s).warnings.some((w) => /louder/.test(w))).toBe(false);
    const quiet = flat({}, {});
    quiet.drivers[1] = { ...quiet.drivers[1]!, sensDb: 84 };
    expect(X.computeCrossover(quiet).warnings.join(' ')).toMatch(/quieter/);
  });

  it('an imported response silences the level guess', () => {
    const s = flat({}, {});
    s.drivers[1] = { ...s.drivers[1]!, sensDb: 99, frd: X.storeCurve('r', { kind: 'frd', freqHz: [100, 200, 400, 800, 1600], mag: [90, 90, 90, 90, 90], phaseDeg: null }) };
    const c = X.computeCrossover(s);
    expect(c.warnings.some((w) => /louder/.test(w))).toBe(false);
    expect(c.notes.some((n) => /response file/.test(n))).toBe(true);
  });
});

describe('driverFromSpec', () => {
  it('nominal impedance is the nearest standard to 1.2 Re; inductance is in mH', () => {
    expect(driverFromSpec({ ...P.DRIVER_CLASSES[1]!, re: 6.5 }, 'woofer', 'w').nomOhm).toBe(8);
    expect(driverFromSpec({ ...P.DRIVER_CLASSES[1]!, re: 3.4 }, 'woofer', 'w').nomOhm).toBe(4);
    expect(driverFromSpec({ ...P.DRIVER_CLASSES[1]!, re: 2.6 }, 'woofer', 'w').nomOhm).toBe(3);
    const d = driverFromSpec(P.DRIVER_CLASSES[1]!, 'woofer', 'w', 30);
    expect(d.leMh).toBeCloseTo(0.979, 2);
    expect(d.setBackMm).toBe(30);
    expect(d.upperHz).toBe(X.ROLE_DEFAULTS.woofer.upperHz);
    expect(d.name).toBe('w');
    expect(d.fsHz).toBe(38);
  });

  it('the home speaker import carries the set-back of each slot, in mm', () => {
    const sp = { ...DEFAULT_PROJECT.speaker, slots: DEFAULT_PROJECT.speaker.slots.map((s, k) => (k === 1 ? { ...s, backCm: 3 } : s)) };
    const imp = importFromDesign({ ...DEFAULT_PROJECT, speaker: sp }, 'speaker');
    if (!imp.ok) throw new Error(imp.reason);
    expect(imp.drivers[1]!.setBackMm).toBe(30);
  });
});

describe('import from the open design', () => {
  it('the PA system gives one driver per band with the band crossovers', () => {
    const pa = { ...DEFAULT_PROJECT, kind: 'system' as const, nBands: 3 };
    const imp = importFromDesign(pa, 'system');
    if (!imp.ok) throw new Error(imp.reason);
    expect(imp.drivers.length).toBe(3);
    expect(imp.xover).toEqual(pa.xover.slice(0, 2));
    for (const d of imp.drivers) {
      expect(d.sensDb).toBeGreaterThan(70);
      expect(d.reOhm).toBeGreaterThan(0);
      expect(d.leMh).toBeGreaterThan(0);
    }
    const s = applyImport(X.DEFAULT_XO, imp);
    expect(s.ways).toBe(3);
    expect(s.drivers[0]!.name).toBe(imp.drivers[0]!.name);
    expect(s.tuned).toBeNull();
    expect(importFromDesign({ ...DEFAULT_PROJECT, nBands: 1 }, 'system').ok).toBe(false);
  });

  it('the home speaker gives its slots, set-back and crossover', () => {
    const imp = importFromDesign(DEFAULT_PROJECT, 'speaker');
    if (!imp.ok) throw new Error(imp.reason);
    expect(imp.label).toMatch(/home speaker/);
    expect(imp.drivers.length).toBeGreaterThanOrEqual(2);
    expect(imp.xover.length).toBe(imp.drivers.length - 1);
    expect(imp.drivers[imp.drivers.length - 1]!.role).toBe('tweeter');
    const s = applyImport(X.DEFAULT_XO, imp);
    expect(X.computeCrossover(s).ways.length).toBe(imp.drivers.length);
  });

  it('the car gives its component fronts or says why not', () => {
    const car = DEFAULT_PROJECT;
    const off = importFromDesign({ ...car, car: { ...car.car, front: { ...car.car.front, enabled: false } } }, 'car');
    expect(off.ok).toBe(false);
    const coax = importFromDesign({ ...car, car: { ...car.car, front: { ...car.car.front, enabled: true, type: 'coaxial' } } }, 'car');
    expect(coax.ok).toBe(false);
    const comp = importFromDesign({ ...car, car: { ...car.car, front: { ...car.car.front, enabled: true, type: 'component' } } }, 'car');
    if (!comp.ok) throw new Error(comp.reason);
    expect(comp.drivers.map((d) => d.role)).toEqual(['woofer', 'tweeter']);
    expect(comp.xover).toEqual([car.car.front.xoverTweeterHz]);
  });
});
