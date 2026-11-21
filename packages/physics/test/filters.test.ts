// Crossover filter checks that are not shared vectors: agreement with the existing LR4 network, closed forms, domain errors.
import { describe, expect, it } from 'vitest';
import * as P from '../src/index';

const db = (h: P.Cx): number => P.dB(P.abs(h));
const freqs = [31.5, 100, 250, 500, 800, 1000, 1500, 3000, 7000, 16000];

describe('crossover filters', () => {
  it('Linkwitz-Riley 4 equals the existing lr4 network and band cascade', () => {
    const f = P.xoFilter({ alignment: 'linkwitz-riley', order: 4 });
    for (const hz of freqs) {
      const a = f.lp(hz, 1000);
      const b = P.lr4Lp(hz, 1000);
      const c = f.hp(hz, 1000);
      const d = P.lr4Hp(hz, 1000);
      expect(Math.hypot(a.re - b.re, a.im - b.im)).toBeLessThan(1e-12);
      expect(Math.hypot(c.re - d.re, c.im - d.im)).toBeLessThan(1e-12);
    }
    const xs = [400, 2500, 9000];
    for (const hz of freqs) {
      const got = P.xoBands(hz, xs, f);
      const want = P.crossoverBands(hz, xs);
      got.forEach((g, k) => expect(Math.hypot(g.re - want[k]!.re, g.im - want[k]!.im)).toBeLessThan(1e-12));
    }
  });

  it('Butterworth 2 has Q = 1/sqrt(2) and rolls off at 12 dB per octave', () => {
    const f = P.xoFilter({ alignment: 'butterworth', order: 2 });
    expect(db(f.lp(1000, 1000))).toBeCloseTo(-3.0103, 4);
    expect(db(f.lp(8000, 1000)) - db(f.lp(16000, 1000))).toBeCloseTo(12.04, 1);
    const f6 = P.xoFilter({ alignment: 'butterworth', order: 6 });
    expect(db(f6.lp(8000, 1000)) - db(f6.lp(16000, 1000))).toBeCloseTo(36.12, 0);
  });

  it('the high-pass is the low-pass mirrored about fc', () => {
    for (const a of P.ALIGNMENTS) {
      const f = P.xoFilter({ alignment: a, order: 4, rippleDb: 1 });
      for (const hz of [250, 700, 1000, 1600]) {
        const l = f.lp(hz, 1000);
        const h = f.hp(1000 * 1000 / hz, 1000);
        expect(Math.hypot(l.re - h.re, l.im + h.im)).toBeLessThan(1e-12); // HP(w) = conj(LP(1/w))
      }
    }
  });

  it('a Chebyshev section stays inside its ripple below fc and is 3 dB down at fc', () => {
    for (const ripple of [0.1, 0.5, 1, 3]) {
      const f = P.xoFilter({ alignment: 'chebyshev', order: 5, rippleDb: ripple });
      const eps = Math.sqrt(10 ** (ripple / 10) - 1);
      const edge = 1000 / Math.cosh(Math.acosh(1 / eps) / 5); // the ripple band ends where the response is `ripple` down
      let lo = Infinity;
      for (let hz = 10; hz < edge; hz += 5) lo = Math.min(lo, db(f.lp(hz, 1000)));
      expect(lo).toBeGreaterThan(-ripple - 1e-6);
      expect(db(f.lp(edge, 1000))).toBeCloseTo(-ripple, 6);
      expect(db(f.lp(1000, 1000))).toBeCloseTo(-3.0103, 4);
    }
  });

  it('a Bessel low-pass has a flatter group delay than a Butterworth of the same order below fc', () => {
    const spread = (a: P.Alignment): number => {
      const f = P.xoFilter({ alignment: a, order: 4 });
      const g = [10, 300, 600, 900].map((hz) => P.groupDelayS((x) => f.lp(x, 1000), hz));
      return (Math.max(...g) - Math.min(...g)) / g[0]!;
    };
    expect(spread('bessel')).toBeLessThan(0.1);
    expect(spread('butterworth')).toBeGreaterThan(3 * spread('bessel'));
  });

  it('polarity: Butterworth and Linkwitz-Riley invert exactly when order or half-order is 2 mod 4', () => {
    for (let n = 1; n <= 8; ++n) expect(P.xoFilter({ alignment: 'butterworth', order: n }).polarity).toBe(n % 4 === 2 ? -1 : 1);
    for (const n of [2, 4, 6, 8]) expect(P.xoFilter({ alignment: 'linkwitz-riley', order: n }).polarity).toBe(n % 4 === 2 ? -1 : 1);
  });

  it('an inverted-polarity pair sums flat for every all-pass-sum alignment, and a wrong polarity does not', () => {
    for (const [a, n] of [['linkwitz-riley', 2], ['linkwitz-riley', 6], ['butterworth', 5]] as const) {
      const f = P.xoFilter({ alignment: a, order: n });
      expect(f.allPassSum).toBe(true);
      for (const hz of freqs) {
        const s = P.add(f.lp(hz, 1000), f.polarity < 0 ? P.scale(f.hp(hz, 1000), -1) : f.hp(hz, 1000));
        expect(Math.abs(db(s))).toBeLessThan(1e-9);
      }
    }
    const f = P.xoFilter({ alignment: 'linkwitz-riley', order: 2 });
    expect(db(P.add(f.lp(1000, 1000), f.hp(1000, 1000)))).toBeLessThan(-100); // in phase: a null at fc
  });

  it('N-way sums of all-pass alignments have unit magnitude, others flag no compensation', () => {
    expect(P.xoFilter({ alignment: 'bessel', order: 4 }).allPassSum).toBe(false);
    expect(P.xoFilter({ alignment: 'chebyshev', order: 3 }).allPassSum).toBe(false);
    expect(P.xoFilter({ alignment: 'butterworth', order: 4 }).allPassSum).toBe(false);
    const f = P.xoFilter({ alignment: 'butterworth', order: 3 });
    for (const hz of freqs) {
      const tot = P.xoBands(hz, [300, 1200, 5000], f).reduce((a, b) => P.add(a, b), P.cx(0));
      expect(Math.abs(db(tot))).toBeLessThan(1e-9);
    }
  });

  it('all-pass sections have unit magnitude and the stated phase; a delay is -2 pi f tau', () => {
    for (const hz of freqs) {
      expect(Math.abs(db(P.allPass1(hz, 700)))).toBeLessThan(1e-12);
      expect(Math.abs(db(P.allPass2(hz, 700, 2.5)))).toBeLessThan(1e-12);
      expect(P.abs(P.delayResponse(hz, 0.0007))).toBeCloseTo(1, 12);
    }
    const q = P.allPass1(700, 700);
    expect(Math.atan2(q.im, q.re)).toBeCloseTo(-Math.PI / 2, 12);
    const q2 = P.allPass2(700, 700, 3);
    expect(Math.abs(Math.atan2(q2.im, q2.re))).toBeCloseTo(Math.PI, 6);
    expect(P.delayForOffsetS(0.343)).toBeCloseTo(0.001, 12);
    const d = P.delayResponse(250, 0.001);
    expect(d.re).toBeCloseTo(0, 12);
    expect(d.im).toBeCloseTo(-1, 12);
  });

  it('rejects invalid orders and ripple', () => {
    expect(P.isValidOrder('butterworth', 8)).toBe(true);
    expect(P.isValidOrder('butterworth', 9)).toBe(false);
    expect(P.isValidOrder('butterworth', 0)).toBe(false);
    expect(P.isValidOrder('butterworth', 2.5)).toBe(false);
    expect(P.isValidOrder('linkwitz-riley', 3)).toBe(false);
    expect(P.isValidOrder('linkwitz-riley', 8)).toBe(true);
    expect(() => P.xoFilter({ alignment: 'linkwitz-riley', order: 3 })).toThrow(RangeError);
    expect(() => P.xoFilter({ alignment: 'bessel', order: 9 })).toThrow(RangeError);
    expect(() => P.xoFilter({ alignment: 'chebyshev', order: 4, rippleDb: 3.5 })).toThrow(RangeError);
    expect(() => P.xoFilter({ alignment: 'chebyshev', order: 4, rippleDb: 0 })).toThrow(RangeError);
    expect(P.xoFilter({ alignment: 'chebyshev', order: 4, rippleDb: P.RIPPLE_MIN_DB }).lp(1000, 1000)).toBeDefined();
    expect(P.xoFilter({ alignment: 'chebyshev', order: 4, rippleDb: P.RIPPLE_MAX_DB }).lp(1000, 1000)).toBeDefined();
    expect(db(P.xoFilter({ alignment: 'chebyshev', order: 4 }).lp(1e-9, 1000))).toBeCloseTo(-0.5, 9); // default ripple 0.5 dB // default ripple 0.5 dB
  });
});
