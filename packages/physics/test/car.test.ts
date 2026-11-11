import { describe, expect, it } from 'vitest';
import * as P from '../src/index';

describe('car audio (v0.12)', () => {
  it('the cabin shelf: full gain at DC, flat above, half the dB gain at the corner, for every type', () => {
    for (const c of P.CABIN_TYPES) {
      const db = (f: number): number => P.dB(P.abs(P.cabinGain(f, c.id)));
      expect(db(1e-3), c.id).toBeCloseTo(c.gainDb, 6);
      expect(db(c.cornerHz), c.id).toBeCloseTo(c.gainDb / 2, 9);
      expect(Math.abs(db(1e5)), c.id).toBeLessThan(1e-6);
    }
  });
  it('the cabin table is exactly the spec table', () => {
    expect(P.CABIN_TYPES.map((c) => [c.id, c.gainDb, c.cornerHz])).toEqual([
      ['open', 0, 60],
      ['coupe', 12, 70],
      ['sedan', 10, 60],
      ['suv', 8, 50],
      ['truck', 9, 65],
      ['van', 6, 40],
    ]);
  });
  it('the cabin types are ordered the way a cabin behaves: smaller cabin, more gain, higher corner', () => {
    const by = (id: P.CabinId): P.CabinType => P.cabinOf(id);
    expect(by('coupe').gainDb).toBeGreaterThan(by('sedan').gainDb);
    expect(by('sedan').gainDb).toBeGreaterThan(by('suv').gainDb);
    expect(by('suv').gainDb).toBeGreaterThan(by('van').gainDb);
    expect(by('coupe').cornerHz).toBeGreaterThan(by('suv').cornerHz);
    expect(by('suv').cornerHz).toBeGreaterThan(by('van').cornerHz);
    expect(by('open').gainDb).toBe(0);
    expect(P.cabinOf('nope' as P.CabinId).id).toBe('open');
    expect(new Set(P.CABIN_TYPES.map((c) => c.id)).size).toBe(P.CABIN_TYPES.length);
  });
  it('a shelf of 0 dB does nothing; the gain is monotonic in frequency; a higher Q makes a sharper step', () => {
    for (const f of [10, 60, 300]) expect(P.abs(P.cabinShelf(f, 0, 60))).toBeCloseTo(1, 12);
    let last = Infinity;
    for (const f of [10, 20, 40, 60, 100, 200, 500]) {
      const g = P.abs(P.cabinGain(f, 'sedan'));
      expect(g).toBeLessThanOrEqual(last + 1e-12);
      last = g;
    }
    const sharp = P.dB(P.abs(P.cabinShelf(60, 10, 60, 2)));
    expect(sharp).toBeCloseTo(5, 9); // half the gain at the corner whatever the Q
    expect(P.dB(P.abs(P.cabinShelf(50, 10, 60, 2)))).not.toBeCloseTo(P.dB(P.abs(P.cabinShelf(50, 10, 60))), 3);
  });

  it('dual voice coils: series is as loud as one coil at the same voltage, parallel is 6 dB louder', () => {
    expect(P.dvcDriver(2, 2)).toEqual({ loadFactor: 2, levelFactor: 1 });
    expect(P.dvcDriver(2, 1)).toEqual({ loadFactor: 0.5, levelFactor: 2 });
    expect(P.dvcDriver(1, 1)).toEqual({ loadFactor: 1, levelFactor: 1 });
    expect(P.carWiring(1, 1, 2, 1).levelGainDb).toBeCloseTo(6.0206, 4);
  });
  it('single-coil car wiring is the system wiring, and four dual-4-ohm subs all in parallel are 0.5 ohm', () => {
    for (const [n, s] of [[1, 1], [2, 1], [2, 2], [4, 2], [6, 3]] as const) {
      expect(P.carWiring(n, s, 1, 1).loadFactor).toBeCloseTo(P.wiring(n, s).loadFactor, 12);
      expect(P.carWiring(n, s, 1, 1).levelGainDb).toBeCloseTo(P.wiring(n, s).levelGainDb, 12);
    }
    expect(P.carWiring(4, 1, 2, 1).loadFactor * 4).toBeCloseTo(0.5, 12);
  });
  it('the amp power into a wiring is the same whichever way the same load is made: 2 ohm from one dual-4 in parallel or two single-4 in parallel', () => {
    expect(P.carWiring(1, 1, 2, 1).loadFactor * 4).toBeCloseTo(P.wiring(2, 1).loadFactor * 4, 12);
  });

  it('bridging doubles the swing (four times the power into the same load) and doubles the lowest load', () => {
    expect(P.bridgedVolts(500, 4)).toBeCloseTo(2 * Math.sqrt(500 * 4), 12);
    expect(P.bridgedVolts(500, 4) ** 2 / 4).toBeCloseTo(2000, 9);
    expect(P.bridgedMinLoad(2)).toBe(4);
  });

  it('amp current follows power over efficiency and volts; music is a fraction of it', () => {
    expect(P.ampCurrent(1000, 0.85, 13.8)).toBeCloseTo(85.2515, 3);
    expect(P.musicCurrent(1000, 0.85, 13.8, 0.125) * 8).toBeCloseTo(P.ampCurrent(1000, 0.85, 13.8), 9);
    expect(P.ampCurrent(1000, 0.6, 13.8)).toBeGreaterThan(P.ampCurrent(1000, 0.85, 13.8)); // class AB draws more
  });
  it('the AWG table matches the published cross-sections and gets thinner with the number', () => {
    expect(P.awgAreaMm2(0)).toBeCloseTo(53.5, 0);
    expect(P.awgAreaMm2(4)).toBeCloseTo(21.15, 1);
    expect(P.awgAreaMm2(8)).toBeCloseTo(8.37, 1);
    expect(P.awgAreaMm2(10)).toBeCloseTo(5.26, 1);
    for (let a = 1; a <= 20; a++) expect(P.awgAreaMm2(a)).toBeLessThan(P.awgAreaMm2(a - 1));
  });
  it('wire: resistance is per metre of gauge, rises with temperature, and the drop counts the ground return', () => {
    expect(P.wireResistance(4, 10)).toBeCloseTo(2 * P.wireResistance(4, 5), 12);
    expect(P.wireResistance(4, 5, 40)).toBeCloseTo(P.wireResistance(4, 5) * (1 + 0.00393 * 20), 12);
    expect(P.wireDropVolts(100, 4, 5)).toBeCloseTo(100 * 2 * P.wireResistance(4, 5), 12);
  });
  it('fuses: the next standard value over 1.25 x the current, and 100 A steps past 400', () => {
    expect(P.fuseAmps(4)).toBe(5);
    expect(P.fuseAmps(4.0001)).toBe(7.5); // 1.25 x 4 = 5 exactly: a 5 A fuse carries it
    expect(P.fuseAmps(12)).toBe(15);
    expect(P.fuseAmps(80)).toBe(100);
    expect(P.fuseAmps(320)).toBe(400);
    expect(P.fuseAmps(321)).toBe(500);
    expect(P.fuseAmps(700)).toBe(900);
  });
  it('the thinnest cable: thicker for more current and length, none when nothing carries it', () => {
    const i = P.ampCurrent(1000, 0.85, 13.8);
    expect(P.minAwg(i, 3, 13.8, 0.03)).toBeGreaterThan(P.minAwg(i, 5, 13.8, 0.03));
    expect(P.minAwg(i, 5, 13.8, 0.03)).toBeGreaterThan(P.minAwg(i, 7, 13.8, 0.03));
    expect(P.minAwg(i, 5, 13.8, 0.06)).toBeGreaterThan(P.minAwg(i, 5, 13.8, 0.03)); // a looser drop allows a thinner cable
    // a drop budget exactly equal to a gauge's drop accepts that gauge
    expect(P.minAwg(i, 5, 1, P.wireDropVolts(i, 4, 5))).toBe(4);
    expect(P.minAwg(1e5, 5, 13.8, 0.03)).toBe(-1);
    expect(P.minAwg(0.1, 1, 13.8, 0.03)).toBe(20);
  });
});
