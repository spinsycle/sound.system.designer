import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import * as M from '../src/model';

const TYPES: M.BoxKind[] = ['sealed', 'ported', 'bandpass', 'passive', 'tline', 'horn'];
const find = (c: M.Computed, label: string): string | undefined => c.extras.find((e) => e.label.startsWith(label))?.value;
const num = (s: string | undefined): number => Number.parseFloat(s ?? 'NaN');

describe('single-box level readouts (U1)', () => {
  for (const type of TYPES) {
    it(`${type}: passband level, level at the design power, highest level and power at the limit`, () => {
      const d = M.sanitize({ ...M.DEFAULT_DESIGN, type, driverClass: 2, powerW: 100 });
      const c = M.compute(d);
      const sens = num(find(c, 'Level in the passband'));
      const atP = num(find(c, 'Level at '));
      const top = num(find(c, 'Highest steady level'));
      const pw = num(find(c, 'Power at that limit'));
      expect(Number.isFinite(sens)).toBe(true);
      // 100 W into the driver's Re against 2.83 V: 10 log10(P Re / 2.83^2), to the rounding of two one-decimal readouts
      expect(atP - sens).toBeCloseTo(10 * Math.log10((100 * c.driver.re) / M.REF_VOLTS ** 2), 0);
      // never above the thermal rating
      expect(pw).toBeLessThanOrEqual(c.driver.pe + 0.5);
      expect(top).toBeGreaterThan(sens - 0.05);
      expect(find(c, 'Highest steady level')).toMatch(/limited by (driver heat|cone travel)/);
    });
  }

  it('a driver with a tiny Xmax is limited by the cone, not heat', () => {
    const d = M.sanitize({ ...M.DEFAULT_DESIGN, type: 'sealed', driverClass: M.CUSTOM_CLASS, custom: { ...M.DEFAULT_DESIGN.custom, xmaxMm: 0.2, powerW: 2000 } });
    expect(find(M.compute(d), 'Highest steady level')).toContain('cone travel');
  });

  it('sealed passband level sits at the driver reference level, and the thermal limit is rms volts from rating and Re', () => {
    const c = M.compute(M.sanitize({ ...M.DEFAULT_DESIGN, type: 'sealed', driverClass: 2 }));
    const ref = P.splDb(P.referencePressure(c.driver, M.REF_VOLTS));
    expect(Math.abs(num(find(c, 'Level in the passband')) - ref)).toBeLessThan(3);
    // heat-limited level is the reference level plus 20 log10(sqrt(Pe Re) / 2.83)
    const hot = M.compute(M.sanitize({ ...M.DEFAULT_DESIGN, type: 'sealed', driverClass: M.CUSTOM_CLASS, custom: { ...M.DEFAULT_DESIGN.custom, xmaxMm: 40, powerW: 50 } }));
    const sens = num(find(hot, 'Level in the passband'));
    // values over 100 print with no decimals, so allow a whole dB
    expect(Math.abs(num(find(hot, 'Highest steady level')) - (sens + 20 * Math.log10(Math.sqrt(hot.driver.pe * hot.driver.re) / M.REF_VOLTS)))).toBeLessThan(1);
    expect(find(hot, 'Highest steady level')).toContain('driver heat');
    // heat-limited: the limit voltage into Re is exactly the rated power
    expect(Math.abs(num(find(hot, 'Power at that limit')) - hot.driver.pe)).toBeLessThan(0.6);
  });

  it('band-pass and transmission line carry efficiency (no Par/Per: the Cookbook has no rule) and the line areas', () => {
    const bp = M.compute(M.sanitize({ ...M.DEFAULT_DESIGN, type: 'bandpass', driverClass: 2 }));
    expect(find(bp, 'Reference efficiency')).toBeDefined();
    expect(find(bp, 'Displacement-limited output')).toBeUndefined();
    expect(find(bp, 'Input that reaches it')).toBeUndefined();
    const tl = M.compute(M.sanitize({ ...M.DEFAULT_DESIGN, type: 'tline', driverClass: 2 }));
    expect(find(tl, 'Line exit area')).toMatch(/cm²/);
    expect(find(tl, 'Line start area')).toMatch(/cm²/);
  });
});
