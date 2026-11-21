// Active crossover circuit checks that are not shared vectors: every topology, band, alignment and order against the ideal filter.
import { describe, expect, it } from 'vitest';
import * as P from '../src/index';

const freqs = [20, 63, 150, 400, 800, 1000, 1300, 2500, 6000, 16000];

function eachDesign(fn: (spec: P.FilterSpec, topology: P.Topology, band: P.Band) => void): void {
  for (const alignment of P.ALIGNMENTS)
    for (let order = 1; order <= P.MAX_ORDER; ++order) {
      if (!P.isValidOrder(alignment, order)) continue;
      for (const topology of P.TOPOLOGIES) for (const band of ['lp', 'hp'] as const) fn({ alignment, order, rippleDb: 1 }, topology, band);
    }
}

describe('active crossover circuits', () => {
  it('every topology, band, alignment and order realises the ideal filter (inverting circuits up to sign)', () => {
    let count = 0;
    eachDesign((spec, topology, band) => {
      const d = P.designActive(spec, 1000, band, topology);
      const f = P.xoFilter(spec);
      for (const hz of freqs) {
        const got = P.activeResponse(d, hz);
        const want = band === 'lp' ? f.lp(hz, 1000) : f.hp(hz, 1000);
        const sign = d.inverts ? -1 : 1;
        expect(Math.hypot(sign * got.re - want.re, sign * got.im - want.im), `${spec.alignment} ${spec.order} ${topology} ${band} at ${hz}`).toBeLessThan(1e-9);
      }
      ++count;
    });
    expect(count).toBe(28 * 4 * 2); // 8 + 4 + 8 + 8 valid filters, 4 topologies, 2 bands
  });

  it('section counts and the sections cut from the poles', () => {
    const n = (alignment: P.Alignment, order: number): number[] => P.designActive({ alignment, order }, 1000, 'lp', 'sk-equal').sections.map((s) => s.order);
    expect(n('butterworth', 3)).toEqual([1, 2]);
    expect(n('linkwitz-riley', 4)).toEqual([2, 2]);
    expect(n('linkwitz-riley', 6)).toEqual([1, 1, 2, 2]);
    expect(n('bessel', 8)).toEqual([2, 2, 2, 2]);
    expect(n('butterworth', 1)).toEqual([1]);
    const qs = P.designActive({ alignment: 'butterworth', order: 8 }, 1000, 'lp', 'sk-equal').sections.map((s) => s.q);
    expect([...qs].sort((a, b) => a - b)).toEqual(qs); // low Q first
  });

  it('textbook values: 1 kHz, 10 nF', () => {
    const r1 = P.designActive({ alignment: 'butterworth', order: 1 }, 1000, 'lp', 'sk-equal').sections[0]!;
    expect(r1.res.r).toBeCloseTo(1 / (2 * Math.PI * 1000 * 10e-9), 6); // fc = 1/(2 pi R C)
    const s = P.designActive({ alignment: 'butterworth', order: 2 }, 1000, 'lp', 'sk-equal').sections[0]!;
    expect(s.res.r1).toBeCloseTo(15915.494309, 3);
    expect(1 + s.res.rf! / s.res.rg!).toBeCloseTo(3 - Math.SQRT2, 9); // K = 3 - 1/Q, Q = 0.7071
    const u = P.designActive({ alignment: 'butterworth', order: 2 }, 1000, 'lp', 'sk-unity').sections[0]!;
    expect(u.caps.c1! / u.caps.c2!).toBeCloseTo(2, 9); // C1 = 2 C2 at Q = 0.7071
    const v = P.designActive({ alignment: 'butterworth', order: 2 }, 1000, 'lp', 'state-variable').sections[0]!;
    expect(v.res.ra! / v.res.rb!).toBeCloseTo(3 * Math.SQRT1_2 - 1, 9);
    expect(v.res.rb).toBe(10e3); // default summing resistor
  });

  it('trim restores the filter gain: Chebyshev even orders sit ripple dB down, equal-component stages need an attenuator', () => {
    const u = P.designActive({ alignment: 'chebyshev', order: 4, rippleDb: 0.5 }, 1000, 'lp', 'sk-unity');
    expect(P.dB(u.trim)).toBeCloseTo(-0.5, 9);
    const e = P.designActive({ alignment: 'butterworth', order: 2 }, 1000, 'lp', 'sk-equal');
    expect(e.trim).toBeCloseTo(1 / (3 - Math.SQRT2), 9);
    expect(P.designActive({ alignment: 'butterworth', order: 2 }, 1000, 'lp', 'mfb').trim).toBeCloseTo(1, 9);
  });

  it('inverts is the parity of the inverting stages', () => {
    const inv = (a: P.Alignment, n: number, t: P.Topology): boolean => P.designActive({ alignment: a, order: n }, 1000, 'hp', t).inverts;
    expect(inv('butterworth', 3, 'mfb')).toBe(true); // one biquad
    expect(inv('linkwitz-riley', 4, 'mfb')).toBe(false); // two biquads
    expect(inv('linkwitz-riley', 4, 'state-variable')).toBe(false);
    expect(inv('butterworth', 1, 'mfb')).toBe(false); // an RC section does not invert
    expect(inv('linkwitz-riley', 4, 'sk-equal')).toBe(false);
  });

  it('the capacitor sets the resistors: scale C by 10 and every resistor drops by 10', () => {
    const a = P.designActive({ alignment: 'bessel', order: 4 }, 800, 'lp', 'sk-unity', 10e-9);
    const b = P.designActive({ alignment: 'bessel', order: 4 }, 800, 'lp', 'sk-unity', 100e-9);
    a.sections.forEach((s, k) => expect(s.res.r1! / b.sections[k]!.res.r1!).toBeCloseTo(10, 9));
  });

  it('snapToSeries lands on a standard value, leaves one alone, and E96 is finer than E24', () => {
    for (const x of [1.0, 2.2, 4.7, 9.1, 1000, 47000]) expect(P.snapToSeries(x, 'E24')).toBeCloseTo(x, 9);
    for (const x of [1.02, 3.16, 9.76]) expect(P.snapToSeries(x, 'E96')).toBeCloseTo(x, 9);
    expect(P.snapToSeries(15915.49, 'E24')).toBeCloseTo(16000, 6);
    expect(P.snapToSeries(15915.49, 'E96')).toBeCloseTo(15800, 6);
    expect(P.snapToSeries(1.398, 'E24')).toBeCloseTo(1.5, 9); // nearer 1.5 by ratio, nearer 1.3 by difference
    expect(P.snapToSeries(9.96, 'E24')).toBeCloseTo(10, 9); // the next decade is a candidate
    expect(P.snapToSeries(0.0000047, 'E24')).toBeCloseTo(0.0000047, 12);
    let worst24 = 0;
    let worst96 = 0;
    for (let k = 0; k < 400; ++k) {
      const x = 10 ** (k / 400);
      worst24 = Math.max(worst24, Math.abs(Math.log(P.snapToSeries(x, 'E24') / x)));
      worst96 = Math.max(worst96, Math.abs(Math.log(P.snapToSeries(x, 'E96') / x)));
    }
    expect(worst24).toBeLessThan(0.075); // the widest E24 gap is 1.3 to 1.5
    expect(worst96).toBeLessThan(0.015);
  });

  it('an unsnapped design has no error; snapping to E96 errs less than to E24 and the level offset is removable', () => {
    const spec: P.FilterSpec = { alignment: 'linkwitz-riley', order: 4 };
    for (const topology of P.TOPOLOGIES) {
      const d = P.designActive(spec, 1000, 'lp', topology);
      const e0 = P.designError(d);
      expect(e0.maxDb).toBeLessThan(1e-9);
      const e24 = P.designError(P.snapDesign(d, 'E24'));
      const e96 = P.designError(P.snapDesign(d, 'E96'));
      expect(e96.maxDb).toBeLessThan(e24.maxDb + 1e-12);
      expect(e24.maxDbTrimmed).toBeLessThanOrEqual(e24.maxDb + Math.abs(e24.offsetDb) + 1e-12);
      expect(e24.maxDb).toBeLessThan(1.5);
    }
    const s = P.snapDesign(P.designActive(spec, 1000, 'hp', 'mfb'), 'E96');
    for (const sec of s.sections) for (const v of [...Object.values(sec.caps), ...Object.values(sec.res)]) expect(P.snapToSeries(v, 'E96')).toBeCloseTo(v, 6);
  });

  it('snapping puts every capacitor and resistor on the series', () => {
    for (const topology of P.TOPOLOGIES)
      for (const band of ['lp', 'hp'] as const) {
        const s = P.snapDesign(P.designActive({ alignment: 'bessel', order: 5 }, 1234, band, topology), 'E24');
        for (const sec of s.sections) for (const v of [...Object.values(sec.caps), ...Object.values(sec.res)]) expect(P.snapToSeries(v, 'E24')).toBeCloseTo(v, 9 - Math.floor(Math.log10(v)));
      }
  });

  it('a multiple-feedback high-pass has gain -C1/C2 above its corner', () => {
    const sec = P.designActive({ alignment: 'butterworth', order: 2 }, 1000, 'hp', 'mfb').sections[0]!;
    const odd: P.Section = { ...sec, caps: { c1: 20e-9, c2: 10e-9, c3: 10e-9 } };
    expect(P.sectionResponse(odd, 1e9).re).toBeCloseTo(-2, 6);
  });

  it('a state-variable summing stage with Rf above Rs has gain -Rf/Rs at the high-pass output', () => {
    const sec = P.designActive({ alignment: 'butterworth', order: 2 }, 1000, 'hp', 'state-variable').sections[0]!;
    const twice: P.Section = { ...sec, res: { ...sec.res, rf: 2 * sec.res.rf! } };
    expect(P.sectionResponse(sec, 1e9).re).toBeCloseTo(-1, 6); // the stage inverts
    expect(P.sectionResponse(twice, 1e9).re).toBeCloseTo(-2, 6);
  });

  it('snapping keeps the trim of the design', () => {
    const d = P.designActive({ alignment: 'butterworth', order: 2 }, 1000, 'lp', 'sk-equal');
    expect(P.snapDesign(d, 'E24').trim).toBe(d.trim);
  });
});
