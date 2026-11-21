import { describe, expect, it } from 'vitest';
import * as P from '../src/index';

const driver = P.ALL_DRIVER_CLASSES[2]!;
const r = P.deriveDriver(driver);
const ar = driver.vasM3 / 0.12;
const af = driver.vasM3 / 0.08;

describe('6th-order band-pass (beyond the shared vectors)', () => {
  it('with the rear port closed it is the 4th-order band-pass, with the same front-chamber loss', () => {
    for (const f of [15, 30, 55, 90, 300]) {
      const a = P.bandpass6G(f, driver.fs, r.qts, ar, af, 1e-4, 45, 12, 12);
      const b = P.bandpassG(f, driver.fs, r.qts, ar, af, 45, 12);
      expect(P.abs({ re: a.re - b.re, im: a.im - b.im })).toBeLessThan(1e-7 * Math.max(1, P.abs(b)));
    }
  });

  it('equal tunings and equal losses cancel the two ports exactly', () => {
    for (const f of [20, 45, 80]) expect(P.abs(P.bandpass6G(f, driver.fs, r.qts, ar, ar, 50, 50, 7, 7))).toBeLessThan(1e-9);
  });

  it('a lossless box has no cone movement at either tuning, and the free-air value at DC', () => {
    for (const f of [40, 65]) expect(P.abs(P.bandpass6X(f, driver, r, ar, af, 65, 40))).toBeLessThan(1e-12);
    expect(P.abs(P.bandpass6X(1e-4, driver, r, ar, af, 65, 40))).toBeCloseTo((r.bl * r.cms) / driver.re, 9);
  });

  it('leakage loss fills the displacement nulls and lowers the peak', () => {
    expect(P.abs(P.bandpass6X(40, driver, r, ar, af, 65, 40, 7, 7))).toBeGreaterThan(1e-6);
    const peak = (ql?: number): number => Math.max(...Array.from({ length: 200 }, (_, i) => P.abs(P.bandpass6G(20 * 1.025 ** i, driver.fs, r.qts, ar, af, 65, 40, ql, ql))));
    expect(peak(7)).toBeLessThan(peak(undefined));
  });
});

describe('6th-order design helper', () => {
  const score = (a: P.Bp6Alignment): number => a.meanDb - 2.5 * a.rippleDb;
  for (const [lo, hi] of [[40, 80], [30, 60], [50, 120]] as const) {
    it(`finds a flat passband from ${lo} to ${hi} Hz within the box ranges`, () => {
      const a = P.bandpass6Design(driver, lo, hi, 7);
      expect(a.rippleDb).toBeLessThan(3);
      expect(Number.isFinite(a.meanDb)).toBe(true);
      for (const v of [a.rearL, a.frontL]) {
        expect(v).toBeGreaterThanOrEqual(P.BP6_LIMITS.volMin);
        expect(v).toBeLessThanOrEqual(P.BP6_LIMITS.volMax);
      }
      for (const f of [a.rearHz, a.frontHz]) {
        expect(f).toBeGreaterThanOrEqual(P.BP6_LIMITS.tuneMin);
        expect(f).toBeLessThanOrEqual(P.BP6_LIMITS.tuneMax);
      }
      // better than a neutral guess (chambers at Vas, both ports at the band edges)
      const db = Array.from({ length: 25 }, (_, i) => P.dB(P.abs(P.bandpass6G(lo * (hi / lo) ** (i / 24), driver.fs, r.qts, 1, 1, lo, hi, 7, 7))));
      const naive = { meanDb: db.reduce((x, y) => x + y, 0) / 25, rippleDb: Math.max(...db) - Math.min(...db) } as P.Bp6Alignment;
      expect(score(a)).toBeGreaterThan(score(naive));
    });
  }

  it('holds the skirts an octave outside the passband close to 12 dB under its mean', () => {
    for (const name of ['8 in', '12 in', '15 in']) {
      const d = P.ALL_DRIVER_CLASSES.find((x) => x.name === name)!;
      const rr = P.deriveDriver(d);
      for (const [lo, hi] of [[20, 40], [40, 80], [80, 160], [30, 120]] as const) {
        const a = P.bandpass6Design(d, lo, hi, 7);
        const vas = d.vasM3 * 1000;
        const at = (f: number): number => P.dB(P.abs(P.bandpass6G(f, d.fs, rr.qts, vas / a.rearL, vas / a.frontL, a.rearHz, a.frontHz, 7, 7)));
        // at most 1.5 dB short of the 12 dB target at either skirt
        expect(at(lo / 2) - (a.meanDb - 12)).toBeLessThan(1.5);
        expect(at(hi * 2) - (a.meanDb - 12)).toBeLessThan(1.5);
      }
    }
  });

  it('the lower skirt is held down too, where it would otherwise bind (small drivers, a high passband)', () => {
    for (const name of ['4 in mid', '1.25 in dome', '5.25 in']) {
      const d = P.ALL_DRIVER_CLASSES.find((x) => x.name === name)!;
      const rr = P.deriveDriver(d);
      const a = P.bandpass6Design(d, 150, 300, 7);
      const vas = d.vasM3 * 1000;
      const at = (f: number): number => P.dB(P.abs(P.bandpass6G(f, d.fs, rr.qts, vas / a.rearL, vas / a.frontL, a.rearHz, a.frontHz, 7, 7)));
      expect(at(75) - (a.meanDb - 12)).toBeLessThan(1.5);
    }
  });

  it('never leaves the box ranges, for every driver class and several passbands', () => {
    for (const d of P.ALL_DRIVER_CLASSES) {
      for (const [lo, hi] of [[20, 40], [40, 80], [80, 160], [30, 120], [60, 70]] as const) {
        const a = P.bandpass6Design(d, lo, hi, 7);
        for (const v of [a.rearL, a.frontL]) {
          expect(v).toBeGreaterThanOrEqual(P.BP6_LIMITS.volMin);
          expect(v).toBeLessThanOrEqual(P.BP6_LIMITS.volMax);
        }
        for (const f of [a.rearHz, a.frontHz]) {
          expect(f).toBeGreaterThanOrEqual(P.BP6_LIMITS.tuneMin);
          expect(f).toBeLessThanOrEqual(P.BP6_LIMITS.tuneMax);
        }
      }
    }
  }, 30000);

  it('is deterministic', () => {
    expect(P.bandpass6Design(driver, 40, 80, 7)).toEqual(P.bandpass6Design(driver, 40, 80, 7));
  });

  it('reports the response its own numbers give', () => {
    const a = P.bandpass6Design(driver, 40, 80, 7);
    const vas = driver.vasM3 * 1000;
    const db = Array.from({ length: 25 }, (_, i) => P.dB(P.abs(P.bandpass6G(40 * 2 ** (i / 24), driver.fs, r.qts, vas / a.rearL, vas / a.frontL, a.rearHz, a.frontHz, 7, 7))));
    expect(a.meanDb).toBeCloseTo(db.reduce((x, y) => x + y, 0) / 25, 9);
    expect(a.rippleDb).toBeCloseTo(Math.max(...db) - Math.min(...db), 9);
  });
});
