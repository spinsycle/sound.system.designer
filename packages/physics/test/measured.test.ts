// Parser, validation, interpolation and inductance checks that are not shared vectors.
import { describe, expect, it } from 'vitest';
import * as P from '../src/index';

const rows = (n: number, f: (i: number) => string): string => Array.from({ length: n }, (_, i) => f(i)).join('\n');
const base = rows(6, (i) => `${100 * 2 ** i}\t${4 + i}\t${10 * i}`);

function ok(text: string, kind: P.CurveKind = 'zma'): P.MeasuredCurve {
  const r = P.parseCurve(text, kind);
  if (!r.ok) throw new Error(r.error);
  return r.curve;
}
const err = (text: string, kind: P.CurveKind = 'zma'): string => {
  const r = P.parseCurve(text, kind);
  return r.ok ? '' : r.error;
};

describe('parseCurve', () => {
  it('reads tabs, spaces, commas, semicolons, headers, comments, CRLF and a BOM', () => {
    const text = '﻿Frequency (Hz)\tZ (ohm)\tPhase\r\n* comment\r\n# another\r\n; and another\r\n// and this\r\n% and this\r\n20, 3.5, 0\r\n40;4;5\r\n80 5 10\r\n\r\n160\t6\t15\r\n320   7   20\r\n';
    const c = ok(text);
    expect(c.freqHz).toEqual([20, 40, 80, 160, 320]);
    expect(c.mag).toEqual([3.5, 4, 5, 6, 7]);
    expect(c.phaseDeg).toEqual([0, 5, 10, 15, 20]);
  });

  it('comment lines are skipped between data rows too, with each marker', () => {
    for (const mark of ['*', '#', ';', '//', '%']) expect(ok(`100 5
${mark} note
200 5
300 5
400 5
500 5`).freqHz.length).toBe(5);
  });

  it('accepts two columns (no phase), scientific notation, signs and leading dots', () => {
    const c = ok('1e1 +.5\n20 1.5e0\n30 2\n40 3\n50 4', 'zma');
    expect(c.phaseDeg).toBeNull();
    expect(c.freqHz[0]).toBe(10);
    expect(c.mag[0]).toBe(0.5);
  });

  it('sorts unsorted rows and unwraps the phase', () => {
    const c = ok('400 6 -10\n100 5 170\n200 4 -170\n800 8 10\n1600 9 20');
    expect(c.freqHz).toEqual([100, 200, 400, 800, 1600]);
    expect(c.phaseDeg).toEqual([170, 190, 350, 370, 380]);
  });

  it('frd takes negative dB', () => {
    const c = ok('100 -3.5\n200 -3\n400 0\n800 1\n1600 -20', 'frd');
    expect(c.mag[0]).toBe(-3.5);
  });

  it('names the problem', () => {
    expect(err('100 5\n200 5\n300 5\n400 5')).toMatch(/only 4 data rows/);
    expect(err(base + '\nhello world')).toMatch(/line 7 is not numbers/);
    expect(err(base + '\n100000')).toMatch(/line 7 has 1 columns; expected 2 or 3/);
    expect(err(base + '\n3000 4 5 6')).toMatch(/line 7 has 4 columns; expected 2 or 3/);
    expect(err(base + '\n3000 4')).toMatch(/line 7 has 2 columns but the first row had 3/);
    expect(err('100 5\n200 5\n200 6\n300 5\n400 5\n500 5')).toMatch(/200 Hz appears twice/);
    expect(err('0.5 5\n200 5\n300 5\n400 5\n500 5')).toMatch(/frequency 0.5 Hz is outside/);
    expect(err('100 5\n200 5\n300 5\n400 5\n300000 5')).toMatch(/frequency 300000 Hz is outside/);
    expect(err('100 0\n200 5\n300 5\n400 5\n500 5')).toMatch(/impedance 0 ohm at 100 Hz/);
    expect(err('100 20000\n200 5\n300 5\n400 5\n500 5')).toMatch(/impedance 20000 ohm/);
    expect(err('100 -1\n200 5\n300 5\n400 5\n500 5')).toMatch(/impedance -1 ohm/);
    expect(err('100 500\n200 5\n300 5\n400 5\n500 5', 'frd')).toMatch(/level 500 dB/);
    expect(err('100 5 9000\n200 5 0\n300 5 0\n400 5 0\n500 5 0')).toMatch(/phase 9000 degrees/);
    expect(err('100 1e999\n200 5\n300 5\n400 5\n500 5')).toMatch(/line 1 has a number that is not finite/);
    expect(err(rows(5, (i) => `${100 * (i + 1)}`))).toMatch(/line 1 has 1 columns; expected 2 or 3/);
    expect(err(rows(5, (i) => `${100 * (i + 1)} 1 2 3`))).toMatch(/line 1 has 4 columns; expected 2 or 3/);
    expect(err('')).toMatch(/only 0 data rows/);
    expect(err('NaN 5\n200 5\n300 5\n400 5\n500 5')).toMatch(/only 4 data rows/);
  });

  it('refuses oversize input', () => {
    expect(err(' '.repeat(P.MAX_CURVE_BYTES + 1))).toMatch(/larger than 2 MB/);
    expect(err(' '.repeat(P.MAX_CURVE_BYTES))).not.toMatch(/larger than/);
    expect(err('\n'.repeat(P.MAX_CURVE_LINES - 1))).not.toMatch(/more than/);
    expect(err('\n'.repeat(P.MAX_CURVE_LINES + 1))).toMatch(/more than 20000 lines/);
    const many = rows(P.MAX_CURVE_POINTS + 1, (i) => `${20 + i * 3} 5`);
    expect(err(many)).toMatch(/more than 5000 points/);
    expect(ok(rows(P.MAX_CURVE_POINTS, (i) => `${20 + i * 3} 5`)).freqHz.length).toBe(5000);
    expect(ok(rows(P.MIN_CURVE_POINTS, (i) => `${20 + i * 3} 5`)).freqHz.length).toBe(5);
  });

  it('frequency limits are inclusive', () => {
    expect(ok('1 5\n2 5\n3 5\n4 5\n200000 5').freqHz[4]).toBe(200000);
    expect(ok('100 10000\n200 5\n300 5\n400 5\n500 5').mag[0]).toBe(10000);
    expect(ok('100 200\n200 -200\n300 5\n400 5\n500 5', 'frd').mag[1]).toBe(-200);
    expect(ok('100 5 3600\n200 5 3600\n300 5 3600\n400 5 3600\n500 5 3600').phaseDeg![0]).toBe(3600);
  });
});

describe('curveValue', () => {
  it('returns the table values at the points and holds the ends', () => {
    const c = ok(rows(40, (i) => `${50 * 1.15 ** i}\t${3 + (i % 7)}\t${(i * 25) % 300}`));
    c.freqHz.forEach((f, i) => {
      const z = P.curveValue(c, f);
      expect(P.abs(z)).toBeCloseTo(c.mag[i]!, 9);
      const ph = (c.phaseDeg![i]! * Math.PI) / 180;
      expect(z.re / P.abs(z)).toBeCloseTo(Math.cos(ph), 9);
      expect(z.im / P.abs(z)).toBeCloseTo(Math.sin(ph), 9);
    });
    expect(P.abs(P.curveValue(c, 1))).toBeCloseTo(c.mag[0]!, 9);
    expect(P.abs(P.curveValue(c, 1e6))).toBeCloseTo(c.mag[39]!, 9);
  });

  it('a response curve is linear gain: 0 dB is 1, -6.02 dB is one half', () => {
    const c = ok('100 0\n200 -6.020599913279624\n400 0\n800 0\n1600 0', 'frd');
    expect(P.curveValue(c, 100).re).toBeCloseTo(1, 12);
    expect(P.curveValue(c, 200).re).toBeCloseTo(0.5, 12);
  });
});

describe('voice-coil inductance', () => {
  const box: P.BoxParams = { type: 'sealed', driver: P.DRIVER_CLASSES[1]!, volumeL: 100 } as unknown as P.BoxParams;

  it('no le is the old impedance bit for bit; with le the coil adds s Le', () => {
    const z0 = P.boxImpedance(box, 300);
    const z1 = P.boxImpedance({ ...box, driver: { ...box.driver, le: 0 } }, 300);
    expect(z1).toEqual(z0);
    const le = 0.001;
    const zl = P.boxImpedance({ ...box, driver: { ...box.driver, le } }, 300);
    expect(zl.re).toBeCloseTo(z0.re, 12);
    expect(zl.im).toBeCloseTo(z0.im + 2 * Math.PI * 300 * le, 9); // the coil is in series
  });

  it('far above resonance the impedance is Re + s Le', () => {
    const d = { ...P.DRIVER_CLASSES[1]!, le: 0.0008 };
    const z = P.boxImpedance({ ...box, driver: d }, 20000);
    expect(z.re).toBeCloseTo(d.re, 2);
    expect(z.im).toBeCloseTo(2 * Math.PI * 20000 * 0.0008, 1);
  });

  it('customDriver carries Le only when given, clamped to 0 to 100 mH', () => {
    expect('le' in P.customDriver(P.CUSTOM_DRIVER_DEFAULTS)).toBe(false);
    expect(P.customDriver(P.CUSTOM_DRIVER_DEFAULTS, 0.8).le).toBeCloseTo(0.0008, 12);
    expect(P.customDriver(P.CUSTOM_DRIVER_DEFAULTS, 500).le).toBeCloseTo(0.1, 12);
    expect(P.customDriver(P.CUSTOM_DRIVER_DEFAULTS, -1).le).toBe(0);
    expect(P.customDriver(P.CUSTOM_DRIVER_DEFAULTS, 0).le).toBe(0);
  });

  it('the estimate fills le without touching the rest, and scales with Re and cone size', () => {
    const d = P.DRIVER_CLASSES[0]!;
    const w = P.withEstimatedLe(d);
    expect(w).toEqual({ ...d, le: P.estimateLeH(d) });
    expect(P.estimateLeH({ re: 8, sd: 0.05 })).toBeCloseTo(2 * P.estimateLeH({ re: 4, sd: 0.05 }), 12);
    expect(P.estimateLeH({ re: 4, sd: 0.1 })).toBeGreaterThan(P.estimateLeH({ re: 4, sd: 0.05 }));
    expect(P.estimateLeH({ re: 4, sd: 0 })).toBeCloseTo(4e-5, 12);
  });
});
