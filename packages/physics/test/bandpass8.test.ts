import { describe, expect, it } from 'vitest';
import * as P from '../src/index';

const driver = P.ALL_DRIVER_CLASSES[2]!;
const r = P.deriveDriver(driver);
const vas = driver.vasM3 * 1000;
const ar = vas / 120;
const a1 = vas / 70;
const a2 = vas / 90;

describe('8th-order band-pass (beyond the shared vectors)', () => {
  it('a lossless box has no cone movement at the rear tuning, and the free-air value at DC', () => {
    expect(P.abs(P.bandpass8X(65, driver, r, ar, a1, a2, 65, 80, 45))).toBeLessThan(1e-12);
    expect(P.abs(P.bandpass8X(1e-4, driver, r, ar, a1, a2, 65, 80, 45))).toBeCloseTo((r.bl * r.cms) / driver.re, 9);
  });

  it('leakage loss fills the rear-tuning null and lowers the peak', () => {
    expect(P.abs(P.bandpass8X(65, driver, r, ar, a1, a2, 65, 80, 45, 7, 7, 7))).toBeGreaterThan(1e-6);
    const peak = (ql?: number): number => Math.max(...Array.from({ length: 200 }, (_, i) => P.abs(P.bandpass8G(20 * 1.025 ** i, driver.fs, r.qts, ar, a1, a2, 65, 80, 45, ql, ql, ql))));
    expect(peak(7)).toBeLessThan(peak(undefined));
  });

  it('is finite at every one of its three tunings (the ladder is cleared of denominators)', () => {
    for (const f of [65, 80, 45]) {
      const g = P.bandpass8G(f, driver.fs, r.qts, ar, a1, a2, 65, 80, 45);
      expect(Number.isFinite(g.re) && Number.isFinite(g.im)).toBe(true);
      const x = P.bandpass8X(f, driver, r, ar, a1, a2, 65, 80, 45);
      expect(Number.isFinite(x.re) && Number.isFinite(x.im)).toBe(true);
    }
  });
});

describe('8th-order design helper', () => {
  for (const [lo, hi] of [[40, 80], [30, 60], [80, 160]] as const) {
    it(`finds a flat passband from ${lo} to ${hi} Hz within the box ranges`, () => {
      const a = P.bandpass8Design(driver, lo, hi, 7);
      expect(a.rippleDb).toBeLessThan(3);
      expect(Number.isFinite(a.meanDb)).toBe(true);
      for (const v of [a.rearL, a.innerL, a.outerL]) {
        expect(v).toBeGreaterThanOrEqual(P.BP6_LIMITS.volMin);
        expect(v).toBeLessThanOrEqual(P.BP6_LIMITS.volMax);
      }
      for (const f of [a.rearHz, a.innerHz, a.outerHz]) {
        expect(f).toBeGreaterThanOrEqual(P.BP6_LIMITS.tuneMin);
        expect(f).toBeLessThanOrEqual(P.BP6_LIMITS.tuneMax);
      }
    });
  }

  it('holds the skirts an octave outside the passband close to 12 dB under its mean', () => {
    for (const name of ['8 in', '12 in', '15 in']) {
      const d = P.ALL_DRIVER_CLASSES.find((x) => x.name === name)!;
      const rr = P.deriveDriver(d);
      const v = d.vasM3 * 1000;
      for (const [lo, hi] of [[40, 80], [80, 160]] as const) {
        const a = P.bandpass8Design(d, lo, hi, 7);
        const at = (f: number): number => P.dB(P.abs(P.bandpass8G(f, d.fs, rr.qts, v / a.rearL, v / a.innerL, v / a.outerL, a.rearHz, a.innerHz, a.outerHz, 7, 7, 7)));
        expect(at(lo / 2) - (a.meanDb - 12)).toBeLessThan(1.5);
        expect(at(hi * 2) - (a.meanDb - 12)).toBeLessThan(1.5);
      }
    }
  });

  it('the lower skirt is held down too, where it would otherwise bind (small drivers, a high passband)', () => {
    for (const name of ['8 in', '6.5 in', '3 in']) {
      const d = P.ALL_DRIVER_CLASSES.find((x) => x.name === name)!;
      const rr = P.deriveDriver(d);
      const v = d.vasM3 * 1000;
      const a = P.bandpass8Design(d, 150, 300, 7);
      const g = P.dB(P.abs(P.bandpass8G(75, d.fs, rr.qts, v / a.rearL, v / a.innerL, v / a.outerL, a.rearHz, a.innerHz, a.outerHz, 7, 7, 7)));
      expect(g - (a.meanDb - 12)).toBeLessThan(2.5);
    }
  });

  it('never leaves the box ranges, for every driver class and several passbands', { timeout: 120000 }, () => {
    for (const d of P.ALL_DRIVER_CLASSES) {
      for (const [lo, hi] of [[20, 40], [40, 80], [100, 250], [60, 70]] as const) {
        const a = P.bandpass8Design(d, lo, hi, 7);
        for (const v of [a.rearL, a.innerL, a.outerL]) {
          expect(v).toBeGreaterThanOrEqual(P.BP6_LIMITS.volMin);
          expect(v).toBeLessThanOrEqual(P.BP6_LIMITS.volMax);
        }
        for (const f of [a.rearHz, a.innerHz, a.outerHz]) {
          expect(f).toBeGreaterThanOrEqual(P.BP6_LIMITS.tuneMin);
          expect(f).toBeLessThanOrEqual(P.BP6_LIMITS.tuneMax);
        }
      }
    }
  });

  it('searches from more than the best seed: a wide passband on a 12 in is flat to a dB or so (the best seed alone ends 3.7 dB rippled)', () => {
    const d = P.ALL_DRIVER_CLASSES.find((x) => x.name === '12 in')!;
    expect(P.bandpass8Design(d, 30, 120, 7, 'vented').rippleDb).toBeLessThan(2);
  });

  it('no peak stands outside the asked passband: the loudest point of the whole response is within 30 % of the band (every layout, an 18 in on 40 to 80 Hz)', () => {
    const d = P.ALL_DRIVER_CLASSES[3]!;
    const rr = P.deriveDriver(d);
    const v = d.vasM3 * 1000;
    for (const layout of ['vented', 'sealed', 'chain'] as const) {
      const a = P.bandpass8Design(d, 40, 80, 7, layout);
      let peak = -Infinity;
      let peakHz = 0;
      for (let i = 0; i < 400; i++) {
        const f = 10 * 200 ** (i / 399);
        const g = P.dB(P.abs(P.bandpass8G(f, d.fs, rr.qts, v / a.rearL, v / a.innerL, v / a.outerL, a.rearHz, a.innerHz, a.outerHz, 7, 7, 7, layout)));
        if (g > peak) {
          peak = g;
          peakHz = f;
        }
      }
      expect(peakHz).toBeGreaterThan(40 / 1.3);
      expect(peakHz).toBeLessThan(80 * 1.3);
    }
  });

  it('is deterministic, and reports the response its own numbers give', () => {
    const a = P.bandpass8Design(driver, 40, 80, 7);
    expect(P.bandpass8Design(driver, 40, 80, 7)).toEqual(a);
    const db = Array.from({ length: 25 }, (_, i) => P.dB(P.abs(P.bandpass8G(40 * 2 ** (i / 24), driver.fs, r.qts, vas / a.rearL, vas / a.innerL, vas / a.outerL, a.rearHz, a.innerHz, a.outerHz, 7, 7, 7))));
    expect(a.meanDb).toBeCloseTo(db.reduce((x, y) => x + y, 0) / 25, 9);
    expect(a.rippleDb).toBeCloseTo(Math.max(...db) - Math.min(...db), 9);
  });
});

describe('more than one divider in the box solver', () => {
  const base = (d: boolean | number) => P.solveBox(0.1, 0.005, 1.6, 2.6, 1, 0.018, 'none', d);
  it('a number counts dividers, a boolean is zero or one, and every divider takes its panel volume', () => {
    expect(base(true)).toEqual(base(1));
    expect(base(false)).toEqual(base(0));
    const g0 = base(0);
    const g2 = base(2);
    // two more panels of interior area w h and thickness t come out of the air
    expect(g2.netM3).toBeCloseTo(0.1, 9);
    expect(g0.netM3).toBeCloseTo(0.1, 9);
    expect(g2.wI * g2.hI * g2.dI).toBeGreaterThan(g0.wI * g0.hI * g0.dI);
    const panels = P.boxPanels(g2, 0.018, 2);
    expect(panels.find((p) => p.name === 'Divider')!.qty).toBe(2);
    expect(P.boxPanels(g2, 0.018, 0).some((p) => p.name === 'Divider')).toBe(false);
    expect(P.boxPanels(g2, 0.018, true).find((p) => p.name === 'Divider')!.qty).toBe(1);
  });
});

describe('8th-order layouts (beyond the shared vectors)', () => {
  const LAYOUTS: P.Bp8Layout[] = ['vented', 'sealed', 'chain'];

  it('the default layout is the vented one', () => {
    for (const f of [30, 60, 120]) {
      expect(P.bandpass8G(f, driver.fs, r.qts, ar, a1, a2, 65, 80, 45)).toEqual(P.bandpass8G(f, driver.fs, r.qts, ar, a1, a2, 65, 80, 45, undefined, undefined, undefined, 'vented'));
      expect(P.bandpass8X(f, driver, r, ar, a1, a2, 65, 80, 45)).toEqual(P.bandpass8X(f, driver, r, ar, a1, a2, 65, 80, 45, undefined, undefined, undefined, 'vented'));
    }
  });

  it('every layout is finite at each of its tunings, lossless and with loss', () => {
    for (const layout of LAYOUTS) {
      for (const ql of [undefined, 7] as const) {
        for (const f of [65, 80, 45, 1e-4]) {
          const g = P.bandpass8G(f, driver.fs, r.qts, ar, a1, a2, 65, 80, 45, ql, ql, ql, layout);
          const x = P.bandpass8X(f, driver, r, ar, a1, a2, 65, 80, 45, ql, ql, ql, layout);
          expect(Number.isFinite(g.re) && Number.isFinite(g.im) && Number.isFinite(x.re) && Number.isFinite(x.im)).toBe(true);
        }
      }
    }
  });

  it('the three layouts are three different boxes', () => {
    const db = (layout: P.Bp8Layout, f: number): number => P.dB(P.abs(P.bandpass8G(f, driver.fs, r.qts, ar, a1, a2, 65, 80, 45, 7, 7, 7, layout)));
    for (const f of [30, 60, 100]) {
      expect(Math.abs(db('vented', f) - db('sealed', f))).toBeGreaterThan(0.5);
      expect(Math.abs(db('chain', f) - db('sealed', f))).toBeGreaterThan(0.3);
      expect(Math.abs(db('vented', f) - db('chain', f))).toBeGreaterThan(0.3);
    }
  });

  it('a sealed rear ignores the rear tuning (and the rear tuning of its helper result is not used)', () => {
    for (const f of [30, 60, 100]) {
      expect(P.bandpass8G(f, driver.fs, r.qts, ar, a1, a2, 30, 80, 45, 7, 7, 7, 'sealed')).toEqual(P.bandpass8G(f, driver.fs, r.qts, ar, a1, a2, 120, 80, 45, 7, 7, 7, 'sealed'));
      expect(P.bandpass8X(f, driver, r, ar, a1, a2, 30, 80, 45, 7, 7, 7, 'sealed')).toEqual(P.bandpass8X(f, driver, r, ar, a1, a2, 120, 80, 45, 7, 7, 7, 'sealed'));
    }
  });

  it('a sealed rear is stiffer than an open one at DC: the sealed rear box displacement, and the other layouts move as in free air', () => {
    const dc = (layout: P.Bp8Layout): number => P.abs(P.bandpass8X(1e-4, driver, r, ar, a1, a2, 65, 80, 45, undefined, undefined, undefined, layout));
    const freeAir = (r.bl * r.cms) / driver.re;
    expect(dc('vented')).toBeCloseTo(freeAir, 9);
    expect(dc('chain')).toBeCloseTo(freeAir, 9);
    expect(dc('sealed')).toBeCloseTo(freeAir / (1 + ar), 9);
  });

  it('rear port into the front chamber keeps the cone moving at the rear tuning (no displacement null, unlike the vented layout)', () => {
    expect(P.abs(P.bandpass8X(65, driver, r, ar, a1, a2, 65, 80, 45, undefined, undefined, undefined, 'chain'))).toBeGreaterThan(1e-6);
    expect(P.abs(P.bandpass8X(65, driver, r, ar, a1, a2, 65, 80, 45, undefined, undefined, undefined, 'vented'))).toBeLessThan(1e-12);
  });

  for (const layout of ['sealed', 'chain'] as const) {
    it(`${layout}: the design helper finds a flat passband within the box ranges, deterministically`, () => {
      const a = P.bandpass8Design(driver, 40, 80, 7, layout);
      expect(a.rippleDb).toBeLessThan(3);
      expect(P.bandpass8Design(driver, 40, 80, 7, layout)).toEqual(a);
      for (const v of [a.rearL, a.innerL, a.outerL]) {
        expect(v).toBeGreaterThanOrEqual(P.BP6_LIMITS.volMin);
        expect(v).toBeLessThanOrEqual(P.BP6_LIMITS.volMax);
      }
      const db = Array.from({ length: 25 }, (_, i) => P.dB(P.abs(P.bandpass8G(40 * 2 ** (i / 24), driver.fs, r.qts, vas / a.rearL, vas / a.innerL, vas / a.outerL, a.rearHz, a.innerHz, a.outerHz, 7, 7, 7, layout))));
      expect(a.meanDb).toBeCloseTo(db.reduce((x, y) => x + y, 0) / 25, 9);
    });
  }
});

describe('port joining two chambers', () => {
  it('is the room-port length less the extra flanged-end correction: 0.85 d against 0.732 d', () => {
    for (const [v, f, d] of [[0.1, 40, 0.1], [0.05, 70, 0.07], [0.3, 30, 0.2]] as const) {
      expect(P.portLengthM(v, f, d) - P.portLengthInternalM(v, f, d)).toBeCloseTo((0.85 - 0.732) * d, 12);
    }
  });
});
