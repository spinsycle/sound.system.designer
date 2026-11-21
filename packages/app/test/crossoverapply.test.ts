// Crossover shapes on the PA, home speaker and car pages (default unchanged), and applying the Crossover page to a design.
import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import * as X from '../src/crossover';
import { applyOptions, applyToDesign } from '../src/crossoverapply';
import { computeCarSystem } from '../src/carsub';
import { arrangementOf, computeLoudspeaker, loudspeakerEvaluator } from '../src/loudspeaker';
import { parseProjectFile, serializeProject } from '../src/projectfile';
import { DEFAULT_PROJECT, type Project, computeSystem, sanitizeProject, systemEvaluator } from '../src/system';

const BW2: X.XoShape = { alignment: 'butterworth', order: 2, rippleDb: 0.5 };
const BS4: X.XoShape = { alignment: 'bessel', order: 4, rippleDb: 0.5 };
const pa = (shape: X.XoShape = X.DEFAULT_SHAPE, n = 2): Project => sanitizeProject({ ...DEFAULT_PROJECT, nBands: n, xover: [200, 1500, 5000], xoShape: shape });
const withXo = (p: Project, patch: Partial<X.XoState>): Project => sanitizeProject({ ...p, kind: 'crossover', xo: { ...p.xo, ...patch } });

describe('shape helpers', () => {
  it('the default shape is Linkwitz-Riley 4 and goes through the original network, bit for bit', () => {
    expect(X.DEFAULT_SHAPE).toMatchObject({ alignment: 'linkwitz-riley', order: 4 });
    expect(X.isDefaultShape(X.DEFAULT_SHAPE)).toBe(true);
    expect(X.isDefaultShape({ ...X.DEFAULT_SHAPE, rippleDb: 2 })).toBe(true); // the ripple belongs to Chebyshev only
    expect(X.isDefaultShape(BW2)).toBe(false);
    expect(X.isDefaultShape({ alignment: 'linkwitz-riley', order: 2, rippleDb: 0.5 })).toBe(false);
    for (const f of [30, 200, 1500, 9000]) {
      expect(X.shapeBands(X.DEFAULT_SHAPE, f, [200, 1500])).toEqual(P.crossoverBands(f, [200, 1500]));
      expect(X.shapeLow(X.DEFAULT_SHAPE, f, 700)).toEqual(P.lr4Lp(f, 700));
    }
  });

  it('other shapes go through the filter bank', () => {
    const f = P.xoFilter({ alignment: 'butterworth', order: 2 });
    for (const hz of [30, 200, 1500, 9000]) {
      const got = X.shapeBands(BW2, hz, [200, 1500]);
      const want = P.xoBands(hz, [200, 1500], f);
      got.forEach((g, k) => expect(Math.hypot(g.re - want[k]!.re, g.im - want[k]!.im)).toBeLessThan(1e-12));
      expect(X.shapeLow(BW2, hz, 700).re).toBeCloseTo(f.lp(hz, 700).re, 12);
    }
  });

  it('a filter is built once per shape and keyed by what matters', () => {
    expect(X.shapeFilter(BS4)).toBe(X.shapeFilter({ ...BS4 }));
    expect(X.shapeFilter({ alignment: 'bessel', order: 4, rippleDb: 3 })).toBe(X.shapeFilter(BS4)); // ripple is ignored off Chebyshev
    expect(X.shapeFilter({ alignment: 'chebyshev', order: 3, rippleDb: 1 })).not.toBe(X.shapeFilter({ alignment: 'chebyshev', order: 3, rippleDb: 2 }));
  });

  it('sanitising: junk is the default, Linkwitz-Riley orders are even, ripple is clamped', () => {
    expect(X.sanitizeShape(undefined)).toEqual(X.DEFAULT_SHAPE);
    expect(X.sanitizeShape({ alignment: 'zz', order: 'x', rippleDb: 'y' })).toEqual(X.DEFAULT_SHAPE);
    expect(X.sanitizeShape({ alignment: 'linkwitz-riley', order: 3 }).order).toBe(4);
    expect(X.sanitizeShape({ alignment: 'bessel', order: 3 }).order).toBe(3);
    expect(X.sanitizeShape({ alignment: 'butterworth', order: 99 }).order).toBe(8);
    expect(X.sanitizeShape({ alignment: 'chebyshev', order: 4, rippleDb: 99 }).rippleDb).toBe(3);
    expect(X.sanitizeShape({ alignment: 'butterworth', order: 2.5 }).order).toBe(4);
  });

  it('labels and notes', () => {
    expect(X.shapeLabel(X.DEFAULT_SHAPE)).toBe('Linkwitz-Riley 4');
    expect(X.shapeLabel({ alignment: 'chebyshev', order: 3, rippleDb: 1 })).toBe('Chebyshev 3 (1 dB ripple)');
    expect(X.shapeNotes(X.DEFAULT_SHAPE, ['a', 'b'])).toEqual([]);
    const bw2 = X.shapeNotes(BW2, ['Low', 'High']);
    expect(bw2[0]).toMatch(/High wired reversed/);
    expect(bw2[1]).toMatch(/does not sum flat/);
    const three = X.shapeNotes(BW2, ['Sub', 'Mid', 'High']);
    expect(three[0]).toMatch(/Mid wired reversed/);
    expect(three[0]).not.toMatch(/High/);
    expect(X.shapeNotes({ alignment: 'linkwitz-riley', order: 2, rippleDb: 0.5 }, ['Low', 'High'])).toHaveLength(1); // reversed, but it sums flat
    expect(X.shapeNotes({ alignment: 'butterworth', order: 3, rippleDb: 0.5 }, ['Low', 'High'])).toEqual([]); // flat and in phase
  });
});

describe('PA system', () => {
  it('an explicit Linkwitz-Riley 4 gives exactly the default results', () => {
    expect(computeSystem(pa(X.DEFAULT_SHAPE)).levelDb).toEqual(computeSystem(sanitizeProject({ ...pa(), xoShape: undefined })).levelDb);
    expect(DEFAULT_PROJECT.xoShape).toEqual(X.DEFAULT_SHAPE);
  });

  it('another shape changes the legs and the sum, and the legs are that filter', () => {
    const base = computeSystem(pa());
    const bw = computeSystem(pa(BW2));
    expect(bw.levelDb).not.toEqual(base.levelDb);
    const ev = systemEvaluator(pa(BW2));
    const f = P.xoFilter({ alignment: 'butterworth', order: 2 });
    for (const hz of [60, 200, 900]) {
      const lo = ev.bands[0]!.leg(hz);
      expect(lo.re).toBeCloseTo(f.lp(hz, 200).re, 12);
      expect(lo.im).toBeCloseTo(f.lp(hz, 200).im, 12);
      const hi = ev.bands[1]!.leg(hz);
      const want = f.hp(hz, 200); // the high-pass carries the polarity the alignment wants
      expect(hi.re).toBeCloseTo(-want.re, 12);
      expect(hi.im).toBeCloseTo(-want.im, 12);
    }
  });

  it('notes name the band to wire reversed; none for Linkwitz-Riley 4', () => {
    expect(computeSystem(pa()).notes.some((n) => /wired reversed|sum flat/.test(n))).toBe(false);
    expect(computeSystem(pa(BW2)).notes.some((n) => /High wired reversed/.test(n))).toBe(true);
    expect(computeSystem(pa(BS4)).notes.some((n) => /Bessel 4 does not sum flat/.test(n))).toBe(true);
  });

  it('the shape survives the stored project and the project file; junk becomes the default', () => {
    const p = pa(BS4, 3);
    expect(sanitizeProject(JSON.parse(JSON.stringify(p))).xoShape).toEqual(BS4);
    expect(parseProjectFile(serializeProject(p)).project!.xoShape).toEqual(BS4);
    expect(sanitizeProject({ ...p, xoShape: 'zz' }).xoShape).toEqual(X.DEFAULT_SHAPE);
  });
});

describe('home speaker', () => {
  const sp = (shape: X.XoShape, arrangement: 'two-way' | 'two-and-half' = 'two-way'): Project =>
    sanitizeProject({ ...DEFAULT_PROJECT, kind: 'speaker', speaker: { ...DEFAULT_PROJECT.speaker, arrangement, shape } });

  it('an explicit Linkwitz-Riley 4 equals the default; another shape changes the sum', () => {
    expect(computeLoudspeaker(sp(X.DEFAULT_SHAPE).speaker).levelDb).toEqual(computeLoudspeaker(DEFAULT_PROJECT.speaker).levelDb);
    expect(computeLoudspeaker(sp(BW2).speaker).levelDb).not.toEqual(computeLoudspeaker(DEFAULT_PROJECT.speaker).levelDb);
    expect(DEFAULT_PROJECT.speaker.shape).toEqual(X.DEFAULT_SHAPE);
  });

  it('a 2.5-way uses the shape for its bass-only woofer and for the split above it', () => {
    const s = sp(BW2, 'two-and-half').speaker;
    const ev = loudspeakerEvaluator(s);
    const f = P.xoFilter({ alignment: 'butterworth', order: 2 });
    expect(arrangementOf(s.arrangement).kind).toBe('assist');
    const xs = ev.xover;
    const bass = ev.slots[0]!;
    expect(bass.leg(100).re).toBeCloseTo(f.lp(100, xs[0]!).re, 12);
    const main = ev.slots[1]!.leg(1000);
    const want = P.xoBands(1000, [xs[1]!], f)[0]!;
    expect(main.re).toBeCloseTo(want.re, 12);
  });

  it('notes carry the polarity advice', () => {
    expect(computeLoudspeaker(sp(BW2).speaker).notes.some((n) => /wired reversed/.test(n))).toBe(true);
    expect(computeLoudspeaker(sp(X.DEFAULT_SHAPE).speaker).notes.some((n) => /wired reversed/.test(n))).toBe(false);
  });
});

describe('car fronts', () => {
  const car = (shape: X.XoShape, type: 'component' | 'coaxial' = 'component'): Project => {
    const f = DEFAULT_PROJECT.car.front;
    return sanitizeProject({ ...DEFAULT_PROJECT, kind: 'car', car: { ...DEFAULT_PROJECT.car, front: { ...f, enabled: true, type, shape } } });
  };

  it('an explicit Linkwitz-Riley 4 equals the default; another shape changes the system', () => {
    expect(computeCarSystem(car(X.DEFAULT_SHAPE).car).totalDb).toEqual(computeCarSystem({ ...car(X.DEFAULT_SHAPE).car, front: { ...car(X.DEFAULT_SHAPE).car.front, shape: X.DEFAULT_SHAPE } }).totalDb);
    expect(computeCarSystem(car(BW2).car).totalDb).not.toEqual(computeCarSystem(car(X.DEFAULT_SHAPE).car).totalDb);
    expect(DEFAULT_PROJECT.car.front.shape).toEqual(X.DEFAULT_SHAPE);
  });

  it('notes name the car parts; a coaxial has two ways to name', () => {
    const n = computeCarSystem(car(BW2).car).notes.join(' ');
    expect(n).toMatch(/Front woofer wired reversed/);
    expect(computeCarSystem(car(BW2, 'coaxial').car).notes.join(' ')).toMatch(/Front woofer wired reversed/);
    expect(computeCarSystem(car(BW2, 'coaxial').car).notes.join(' ')).not.toMatch(/Tweeter/);
    expect(computeCarSystem(car(X.DEFAULT_SHAPE).car).notes).toEqual([]);
    const off = DEFAULT_PROJECT.car;
    expect(computeCarSystem({ ...off, front: { ...off.front, enabled: false, shape: BW2 } }).notes).toEqual([]);
  });

  it('the shape is kept by the sanitiser', () => {
    expect(car(BS4).car.front.shape).toEqual(BS4);
    expect(sanitizeProject({ ...car(BS4), car: { ...car(BS4).car, front: { ...car(BS4).car.front, shape: 7 } } }).car.front.shape).toEqual(X.DEFAULT_SHAPE);
  });
});

describe('apply to design', () => {
  const xo = (patch: Partial<X.XoState>): Project => withXo(DEFAULT_PROJECT, patch);

  it('PA system: the shape and the first crossover points go in; the others stay; the input is untouched', () => {
    const p = withXo({ ...pa(X.DEFAULT_SHAPE, 3), xover: [100, 800, 3500] }, { ways: 3, alignment: 'bessel', order: 4, xover: [250, 2000, 3000] });
    const before = JSON.stringify(p);
    const r = applyToDesign(p, 'system');
    if (!r.ok) throw new Error(r.reason);
    expect(r.project.xoShape).toMatchObject({ alignment: 'bessel', order: 4 });
    expect(r.project.xover.slice(0, 2)).toEqual([250, 2000]);
    expect(r.project.xover[2]).toBe(3500);
    expect(r.project.kind).toBe('crossover');
    expect(r.project.nBands).toBe(3);
    expect(r.message).toMatch(/Applied to the PA system: Bessel 4 at 250 Hz and 2000 Hz/);
    expect(JSON.stringify(p)).toBe(before);
  });

  it('PA system: the band count must match, and says what to do', () => {
    const r = applyToDesign(withXo(pa(X.DEFAULT_SHAPE, 2), { ways: 3 }), 'system');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/PA system has 2 bands; this crossover has 3 ways/);
    const one = applyToDesign(withXo(DEFAULT_PROJECT, { ways: 2 }), 'system');
    if (!one.ok) expect(one.reason).toMatch(/has 1 band;/);
  });

  it('home speaker: ways must match the arrangement; the points and shape land on the speaker', () => {
    const p = withXo(DEFAULT_PROJECT, { ways: 2, alignment: 'butterworth', order: 3, xover: [3200, 3000, 3500] });
    const r = applyToDesign(p, 'speaker');
    if (!r.ok) throw new Error(r.reason);
    expect(r.project.speaker.shape).toMatchObject({ alignment: 'butterworth', order: 3 });
    expect(r.project.speaker.xover[0]).toBe(3200);
    expect(r.project.speaker.xover[1]).toBe(DEFAULT_PROJECT.speaker.xover[1]);
    const bad = applyToDesign(withXo(DEFAULT_PROJECT, { ways: 3 }), 'speaker');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toMatch(/2-way with 2 drivers; this crossover has 3 ways/);
    const three = applyToDesign(withXo({ ...DEFAULT_PROJECT, speaker: { ...DEFAULT_PROJECT.speaker, arrangement: 'three-way' } }, { ways: 3, xover: [450, 3100, 3500] }), 'speaker');
    if (!three.ok) throw new Error(three.reason);
    expect(three.project.speaker.xover.slice(0, 2)).toEqual([450, 3100]);
  });

  it('home speaker: a request the page limits is said so, with what landed', () => {
    const r = applyToDesign(withXo(DEFAULT_PROJECT, { ways: 2, xover: [20, 3000, 3500] }), 'speaker');
    if (!r.ok) throw new Error(r.reason);
    const landed = r.project.speaker.xover[0]!;
    expect(landed).toBeGreaterThan(20);
    expect(r.message).toMatch(/limited the request of 20 Hz/);
    expect(r.message).toContain(`${Math.round(landed)} Hz`);
  });

  it('car: needs the fronts on; a component takes the tweeter split, a sub split takes the sub point, three ways take both', () => {
    const on = (type: 'component' | 'coaxial' = 'component'): Project => sanitizeProject({ ...DEFAULT_PROJECT, car: { ...DEFAULT_PROJECT.car, front: { ...DEFAULT_PROJECT.car.front, enabled: true, type } } });
    const off = applyToDesign(withXo(DEFAULT_PROJECT, { ways: 2 }), 'car');
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.reason).toMatch(/no front speakers turned on/);
    const tw = applyToDesign(withXo(on(), { ways: 2, xover: [2700, 3000, 3500], alignment: 'bessel', order: 3 }), 'car');
    if (!tw.ok) throw new Error(tw.reason);
    expect(tw.project.car.front.xoverTweeterHz).toBe(2700);
    expect(tw.project.car.front.xoverSubHz).toBe(DEFAULT_PROJECT.car.front.xoverSubHz);
    expect(tw.project.car.front.shape).toMatchObject({ alignment: 'bessel', order: 3 });
    const sub = applyToDesign(withXo(on(), { ways: 2, drivers: [X.driverFor('sub'), X.driverFor('woofer'), X.driverFor('mid'), X.driverFor('sub')], xover: [90, 3000, 3500] }), 'car');
    if (!sub.ok) throw new Error(sub.reason);
    expect(sub.project.car.front.xoverSubHz).toBe(90);
    expect(sub.project.car.front.xoverTweeterHz).toBe(DEFAULT_PROJECT.car.front.xoverTweeterHz);
    const all = applyToDesign(withXo(on(), { ways: 3, xover: [110, 2600, 3500] }), 'car');
    if (!all.ok) throw new Error(all.reason);
    expect([all.project.car.front.xoverSubHz, all.project.car.front.xoverTweeterHz]).toEqual([110, 2600]);
    expect(all.message).toMatch(/110 Hz and 2600 Hz/);
  });

  it('car: a coaxial takes only the sub point; four ways do not fit', () => {
    const coax = sanitizeProject({ ...DEFAULT_PROJECT, car: { ...DEFAULT_PROJECT.car, front: { ...DEFAULT_PROJECT.car.front, enabled: true, type: 'coaxial' } } });
    expect(applyToDesign(withXo(coax, { ways: 2 }), 'car').ok).toBe(false);
    expect(applyToDesign(withXo(coax, { ways: 3 }), 'car').ok).toBe(false);
    const sub = applyToDesign(withXo(coax, { ways: 2, drivers: [X.driverFor('sub'), X.driverFor('woofer'), X.driverFor('mid'), X.driverFor('sub')], xover: [85, 3000, 3500] }), 'car');
    if (!sub.ok) throw new Error(sub.reason);
    expect(sub.project.car.front.xoverSubHz).toBe(85);
    const four = applyToDesign(withXo(sanitizeProject({ ...DEFAULT_PROJECT, car: { ...DEFAULT_PROJECT.car, front: { ...DEFAULT_PROJECT.car.front, enabled: true } } }), { ways: 4 }), 'car');
    expect(four.ok).toBe(false);
    if (!four.ok) expect(four.reason).toMatch(/three ways/);
  });

  it('the three options list what can be applied now, with reasons', () => {
    const opts = applyOptions(xo({ ways: 2 }));
    expect(opts.map((o) => o.target)).toEqual(['system', 'speaker', 'car']);
    expect(opts.map((o) => o.label)).toEqual(['Apply to the PA system', 'Apply to the home speaker', 'Apply to the car fronts']);
    expect(opts.map((o) => o.ok)).toEqual([false, true, false]);
    expect(opts[0]!.hint).toMatch(/Set the PA system to 2 bands first/);
    expect(opts[1]!.hint).toBe('');
  });

  it('what is applied is what the page then computes with: the PA sum follows the applied shape', () => {
    const p = withXo(pa(X.DEFAULT_SHAPE, 2), { ways: 2, alignment: 'butterworth', order: 2, xover: [700, 3000, 3500] });
    const r = applyToDesign(p, 'system');
    if (!r.ok) throw new Error(r.reason);
    expect(computeSystem({ ...r.project, kind: 'system' }).levelDb).toEqual(computeSystem({ ...pa(BW2, 2), xover: [700, 1500, 5000] }).levelDb);
  });
});
