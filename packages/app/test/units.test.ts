// Inch units: shop-style fractions, typed lengths, and the defaults that swap when the unit does.
import { describe, expect, it } from 'vitest';
import * as B from '../src/build';
import * as U from '../src/units';

describe('formatting', () => {
  it('millimetres are whole numbers', () => {
    expect(U.formatLength(397.4, 'mm')).toBe('397');
    expect(U.formatLength(397.6, 'mm')).toBe('398');
    expect(U.formatLength(0, 'mm')).toBe('0');
  });

  it('inches are to the nearest 1/16, reduced, with the whole part first', () => {
    expect(U.formatLength(19.05, 'in')).toBe('3/4');
    expect(U.formatLength(12.7, 'in')).toBe('1/2');
    expect(U.formatLength(15.875, 'in')).toBe('5/8');
    expect(U.formatLength(25.4, 'in')).toBe('1');
    expect(U.formatLength(1219.2, 'in')).toBe('48');
    expect(U.formatLength(2438.4, 'in')).toBe('96');
    expect(U.formatLength(397, 'in')).toBe('15 5/8');
    expect(U.formatLength(3.175, 'in')).toBe('1/8');
    expect(U.formatLength(1.6, 'in')).toBe('1/16');
    expect(U.formatLength(0.5, 'in')).toBe('0');
    expect(U.formatLength(44.45, 'in')).toBe('1 3/4');
  });

  it('a value that rounds up to the next whole inch carries', () => {
    expect(U.formatLength(25.3, 'in')).toBe('1');
    expect(U.formatLength(50.7, 'in')).toBe('2');
  });

  it('decimals for files and spreadsheets', () => {
    expect(U.formatDecimal(18.04, 'mm')).toBe('18');
    expect(U.formatDecimal(18.06, 'mm')).toBe('18.1');
    expect(U.formatDecimal(19.05, 'in')).toBe('0.75');
    expect(U.formatDecimal(397, 'in')).toBe('15.63');
    expect(U.formatDecimal(2438.4, 'in')).toBe('96');
    expect(U.formatDecimal(400, 'in')).toBe('15.748');
  });

  it('conversions are the standard 25.4 mm to the inch, both ways', () => {
    expect(U.MM_PER_IN).toBe(25.4);
    expect(U.fromMm(25.4, 'in')).toBeCloseTo(1, 12);
    expect(U.fromMm(25.4, 'mm')).toBe(25.4);
    expect(U.toMm(2, 'in')).toBeCloseTo(50.8, 12);
    expect(U.toMm(2, 'mm')).toBe(2);
    expect(U.unitName('in')).toBe('in');
  });
});

describe('typed lengths', () => {
  const mm = (t: string, u: U.Units): number | null => U.parseLength(t, u);

  it('decimals and whole numbers in the chosen unit', () => {
    expect(mm('0.75', 'in')).toBeCloseTo(19.05, 9);
    expect(mm('.5', 'in')).toBeCloseTo(12.7, 9);
    expect(mm('5.', 'in')).toBeCloseTo(127, 9);
    expect(mm('18', 'mm')).toBe(18);
    expect(mm('  18.5  ', 'mm')).toBe(18.5);
    expect(mm('3', 'in')).toBeCloseTo(76.2, 9);
  });

  it('fractions and mixed numbers', () => {
    expect(mm('3/4', 'in')).toBeCloseTo(19.05, 9);
    expect(mm('1 1/2', 'in')).toBeCloseTo(38.1, 9);
    expect(mm('15 5/8', 'in')).toBeCloseTo(396.875, 9);
    expect(mm('1/2', 'mm')).toBe(0.5);
  });

  it('a unit typed after the number wins over the chosen one', () => {
    expect(mm('19 mm', 'in')).toBe(19);
    expect(mm('3/4 in', 'mm')).toBeCloseTo(19.05, 9);
    expect(mm('3/4"', 'mm')).toBeCloseTo(19.05, 9);
    expect(mm('2in', 'mm')).toBeCloseTo(50.8, 9);
    expect(mm('12 MM', 'in')).toBe(12);
  });

  it('anything else is not a length', () => {
    for (const t of ['', '   ', 'abc', '1/0', '1 1/0', '-3', '3/4/5', '1e3', '1,5', 'mm', '1..2', '1 2', '1/ 2'])
      expect(mm(t, 'in'), `"${t}"`).toBeNull();
  });

  it('what is shown can be typed back, within 1/32 in', () => {
    for (const v of [12.7, 15.875, 19.05, 397, 1219.2, 2438.4, 44.45, 3.175]) {
      const back = U.parseLength(U.formatLength(v, 'in'), 'in')!;
      expect(Math.abs(back - v)).toBeLessThanOrEqual(25.4 / 32);
    }
  });
});

describe('defaults swap with the unit', () => {
  it('a fresh project becomes 3/4 in and 48 x 96 in, and back', () => {
    const inch = U.swapShopDefaults(B.DEFAULT_SHOP, 'in');
    expect(inch).toEqual(U.DEFAULT_SHOP_IN);
    expect([U.formatLength(inch.thicknessMm, 'in'), U.formatLength(inch.sheetWmm, 'in'), U.formatLength(inch.sheetLmm, 'in'), U.formatLength(inch.kerfMm, 'in')]).toEqual(['3/4', '48', '96', '1/8']);
    expect(U.swapShopDefaults(inch, 'mm')).toEqual(B.DEFAULT_SHOP);
    expect(U.DEFAULT_SHOP_MM).toEqual(B.DEFAULT_SHOP);
    expect(U.DEFAULT_SHOP_IN).toEqual({ thicknessMm: 19.05, sheetLmm: 2438.4, sheetWmm: 1219.2, kerfMm: 3.175 });
  });

  it('a value the user changed is left alone, the rest swap', () => {
    const custom = { ...B.DEFAULT_SHOP, thicknessMm: 12, kerfMm: 2 };
    const inch = U.swapShopDefaults(custom, 'in');
    expect(inch.thicknessMm).toBe(12);
    expect(inch.kerfMm).toBe(2);
    expect(inch.sheetLmm).toBe(U.DEFAULT_SHOP_IN.sheetLmm);
    expect(inch.sheetWmm).toBe(U.DEFAULT_SHOP_IN.sheetWmm);
    const back = U.swapShopDefaults({ ...U.DEFAULT_SHOP_IN, sheetLmm: 2500 }, 'mm');
    expect(back.sheetLmm).toBe(2500);
    expect(back.thicknessMm).toBe(18);
  });

  it('stays the same when already in that unit', () => {
    expect(U.swapShopDefaults(B.DEFAULT_SHOP, 'mm')).toEqual(B.DEFAULT_SHOP);
    expect(U.swapShopDefaults(U.DEFAULT_SHOP_IN, 'in')).toEqual(U.DEFAULT_SHOP_IN);
  });

  it('the inch wall stock is common thicknesses and fits the clamp ranges', () => {
    expect(U.MATERIALS_IN.map((m) => U.formatLength(m.thicknessMm, 'in'))).toEqual(['1/2', '5/8', '3/4', '1']);
    for (const m of U.MATERIALS_IN) {
      expect(m.thicknessMm).toBeGreaterThanOrEqual(B.SHOP_RANGES.thicknessMm.min);
      expect(m.thicknessMm).toBeLessThanOrEqual(B.SHOP_RANGES.thicknessMm.max);
    }
    expect(U.MATERIALS_IN.map((m) => m.thicknessMm)).toEqual([12.7, 15.875, 19.05, 25.4]);
    expect(U.UNITS.map((x) => x.id)).toEqual(['mm', 'in']);
  });
});
