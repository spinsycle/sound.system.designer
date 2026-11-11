import { describe, expect, it } from 'vitest';
import * as P from '../src/index';

describe('driver classes (H1)', () => {
  it('the plugin eight come first and in order; new classes only ever append', () => {
    expect(P.ALL_DRIVER_CLASSES.slice(0, P.DRIVER_CLASSES.length)).toEqual([...P.DRIVER_CLASSES]);
    expect(P.ALL_DRIVER_CLASSES.map((d) => d.name).slice(8)).toEqual(['3 in', '4 in', '5.25 in', '3 in mid', '4 in mid', '0.75 in dome', '1 in dome', '1.25 in dome', 'Planar tweeter', '8 in car sub', '10 in car sub', '12 in car sub', '15 in car sub', '10 in shallow sub', '12 in shallow sub', '5.25 in door', '6.5 in door', '6x9 door', '5.25 in coax', '6.5 in coax', '6x9 coax']);
    expect(new Set(P.ALL_DRIVER_CLASSES.map((d) => d.name)).size).toBe(P.ALL_DRIVER_CLASSES.length);
  });

  it('every class is a sane driver: positive, finite, Qts between 0.2 and 1.2, Vas and Sd in line with its size', () => {
    for (const d of P.ALL_DRIVER_CLASSES) {
      const r = P.deriveDriver(d);
      for (const v of [d.fs, d.qes, d.qms, d.vasM3, d.sd, d.re, d.xmax, d.pe, r.bl, r.mms, r.cms, r.rms]) expect(Number.isFinite(v) && v > 0, d.name).toBe(true);
      expect(r.qts, d.name).toBeGreaterThan(0.2);
      expect(r.qts, d.name).toBeLessThan(1.2);
    }
  });

  it('smaller cones have a smaller area and a higher resonance, among the woofers', () => {
    const by = (n: string): P.DriverSpec => P.ALL_DRIVER_CLASSES.find((d) => d.name === n)!;
    const order = ['3 in', '4 in', '5.25 in', '6.5 in', '8 in', '10 in'].map(by);
    for (let i = 1; i < order.length; i++) {
      expect(order[i]!.sd).toBeGreaterThan(order[i - 1]!.sd);
      expect(order[i]!.fs).toBeLessThan(order[i - 1]!.fs);
    }
  });

  it('each dome tweeter in its own small sealed chamber is a high-pass near its resonance and flat well above it', () => {
    for (const d of P.ALL_DRIVER_CLASSES.filter((c) => c.name.includes('dome'))) {
      const r = P.deriveDriver(d);
      const g = (f: number): number => P.dB(P.abs(P.sealedG(f, d.fs, r.qts, d.vasM3, d.vasM3 * 5)));
      expect(Math.abs(g(d.fs * 10)), d.name).toBeLessThan(0.5);
      expect(g(d.fs / 4), d.name).toBeLessThan(-15);
    }
  });

  it('a tweeter is a few dB more efficient than a 5.25 in woofer, not a different order of magnitude', () => {
    const eta = (d: P.DriverSpec): number => (4 * Math.PI ** 2 / P.C ** 3) * d.fs ** 3 * d.vasM3 / d.qes;
    const woofer = P.ALL_DRIVER_CLASSES.find((d) => d.name === '5.25 in')!;
    for (const d of P.ALL_DRIVER_CLASSES.filter((c) => c.name.includes('dome') || c.name.includes('Planar'))) {
      const diff = 10 * Math.log10(eta(d) / eta(woofer));
      expect(diff, d.name).toBeGreaterThan(-1);
      expect(diff, d.name).toBeLessThan(8);
    }
  });
});
