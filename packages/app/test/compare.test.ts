// 1.12: candidates in other box types, the plain figures of a design, the score, and the ranking of drivers for a box.
import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import * as X from '../src/compare';
import { type DriverEntry, buildEntry, genericEntries } from '../src/drivers/entry';
import * as M from '../src/model';

const base = (over: Partial<M.Design> = {}): M.Design => M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: 1, type: 'sealed', volumeL: 60, ...over });
const mk = (over: Record<string, unknown>, id: string): DriverEntry => {
  const r = buildEntry({ fs: 38, re: 3.4, qes: 0.5, qms: 5, vasM3: 0.06, sd: 0.048, xmax: 0.008, pe: 400, kind: 'woofer', model: id, ...over } as never, id, '2026-11-23');
  if (!r.ok) throw new Error(r.errors.join());
  return r.entry;
};
const metrics = (d: M.Design) => X.metricsOf(M.compute(d), d);

describe('candidateFor, same air', () => {
  it('changes only the type (and a box loss of 7 where the type needs one)', () => {
    const b = base({ qL: 0, volumeL: 80 });
    for (const k of X.COMPARE_KINDS) {
      const c = X.candidateFor(b, k, 'same-air');
      expect(c.kind).toBe(k);
      expect(c.design.type).toBe(k);
      expect(c.design.volumeL).toBe(80);
      expect(c.note).toBe('');
    }
    expect(X.candidateFor(b, 'sealed', 'same-air').design.qL).toBe(0);
    expect(X.candidateFor(b, 'ported', 'same-air').design.qL).toBe(7);
    expect(X.candidateFor(base({ qL: 12 }), 'ported', 'same-air').design.qL).toBe(12);
  });
  it('a line and a TQWT are sized from the driver', () => {
    const b = base();
    const drv = M.driverOf(b);
    expect(X.candidateFor(b, 'tline', 'same-air').design.tl).toEqual(M.tlSettingsFor(drv, b.tl.kind, b.tl.table, b.tl.stuffing));
    expect(X.candidateFor(b, 'tqwt', 'same-air').design.tl).toEqual(M.tqwtSettingsFor(drv, b.tl.stuffing));
  });
});

// the first call of each solver takes about a second; later ones come from the cache
describe('candidateFor, alignment', { timeout: 30000 }, () => {
  const b = base({ qL: 0 });
  const drv = M.driverOf(b);
  const qts = P.deriveDriver(drv).qts;
  it('a sealed box for Qtc 0.707', () => {
    const c = X.candidateFor(b, 'sealed', 'alignment');
    expect(c.note).toBe('');
    expect(P.sealedParams(drv.fs, qts, drv.vasM3, c.design.volumeL / 1000).qtc).toBeCloseTo(0.707, 2);
  });
  it('a driver already above Qts 0.707 keeps its air, and says why', () => {
    const hi = base({ driverClass: M.CUSTOM_CLASS, custom: { ...M.DEFAULT_DESIGN.custom, qts: 0.9, qms: 5 }, volumeL: 33 });
    const c = X.candidateFor(hi, 'sealed', 'alignment');
    expect(c.design.volumeL).toBe(33);
    expect(c.note).toContain('already above 0.707');
  });
  it('a ported box on the QB3 alignment at QL 7, with a port that fits', () => {
    const c = X.candidateFor(b, 'ported', 'alignment');
    const s = P.solveVented(qts, 'QB3', 7);
    expect(c.design.qL).toBe(7);
    expect(c.design.volumeL).toBeCloseTo((drv.vasM3 * 1000) / s.alpha, 1);
    expect(c.design.tuneHz).toBeCloseTo(s.h * drv.fs, 1);
    expect(M.portLengthOf(c.design, c.design.volumeL)).toBeGreaterThan(0);
    expect(M.compute(c.design).warnings.join(' ')).not.toMatch(/cannot tune/);
  });
  it('a passive radiator, 4th, 6th and 8th-order band-pass boxes get designed numbers and no NaN', () => {
    for (const k of ['passive', 'bandpass', 'bandpass6', 'bandpass8'] as const) {
      const c = X.candidateFor(b, k, 'alignment');
      expect(c.design.qL).toBe(7);
      expect(c.design.volumeL).toBeGreaterThan(0);
      const m = metrics(c.design);
      expect(Number.isFinite(m.peakDb) && Number.isFinite(m.excursionMm) && Number.isFinite(m.groupDelayPeakMs)).toBe(true);
    }
    const t = (v: number): number => Number(v.toPrecision(4));
    const a8 = P.bandpass8Design(drv, b.bp6.loHz, b.bp6.hiHz, 7, b.bp8.layout);
    const c8 = X.candidateFor(b, 'bandpass8', 'alignment').design;
    expect([c8.volumeL, c8.frontVolumeL, c8.tuneHz]).toEqual([t(a8.rearL), t(a8.outerL), t(a8.outerHz)]);
    const a6 = P.bandpass6Design(drv, b.bp6.loHz, b.bp6.hiHz, 7);
    const c6 = X.candidateFor(b, 'bandpass6', 'alignment').design;
    expect([c6.volumeL, c6.frontVolumeL, c6.tuneHz]).toEqual([t(a6.rearL), t(a6.frontL), t(a6.frontHz)]);
    const bp = X.candidateFor(b, 'bandpass', 'alignment').design;
    const d = P.bandpassDesign(drv, qts, 0.7, Math.max(qts * 2.18, qts * 1.2));
    expect([bp.volumeL, bp.frontVolumeL, bp.tuneHz].map((v) => Number(v.toPrecision(3)))).toEqual([d.vrM3 * 1000, d.vfM3 * 1000, d.fbHz].map((v) => Number(v.toPrecision(3))));
  });
  it('the passive radiator solver having no answer is a note, not a throw', () => {
    const hi = base({ driverClass: M.CUSTOM_CLASS, custom: { ...M.DEFAULT_DESIGN.custom, qts: 2.9, qms: 40 } });
    expect(() => X.candidateFor(hi, 'passive', 'alignment')).not.toThrow();
  });
  it('the box losses of the base are kept when it already has some', () => {
    expect(X.candidateFor(base({ qL: 12 }), 'ported', 'alignment').design.qL).toBe(12);
    expect(X.candidateFor(base({ qL: 12 }), 'bandpass', 'alignment').design.qL).toBe(12);
  });
});

describe('median', () => {
  it('odd, even and empty', () => {
    expect(X.median([3, 1, 2])).toBe(2);
    expect(X.median([4, 1, 3, 2])).toBe(2.5);
    expect(X.median([7])).toBe(7);
    expect(X.median([])).toBe(0);
  });
});

describe('metricsOf', () => {
  it('a sealed box: F3 is the sealed F3, flat at Qtc 0.707, a hump above it', () => {
    const drv = M.driverOf(base());
    const qts = P.deriveDriver(drv).qts;
    const flat = X.candidateFor(base({ qL: 0 }), 'sealed', 'alignment').design;
    const mf = metrics(flat);
    const s = P.sealedParams(drv.fs, qts, drv.vasM3, flat.volumeL / 1000);
    expect(mf.f3Hz!).toBeGreaterThan(P.sealedF3(s.fc, s.qtc) * 0.95);
    expect(mf.f3Hz!).toBeLessThan(P.sealedF3(s.fc, s.qtc) * 1.05);
    expect(mf.rippleDb).toBeLessThan(0.6);
    expect(mf.hiHz).toBeNull();
    const small = metrics(base({ volumeL: 6 }));
    expect(small.rippleDb).toBeGreaterThan(mf.rippleDb + 1);
    expect(small.f3Hz!).toBeGreaterThan(mf.f3Hz!);
  });
  it('the ripple is the peak above the middle of the passband, from 1.5 times F3 to the high edge (or 4 times F3)', () => {
    for (const d of [base({ volumeL: 8 }), base({ volumeL: 60 })]) {
      const c = M.compute(d);
      const m = X.metricsOf(c, d);
      const hi = m.hiHz ?? m.f3Hz! * 4;
      const win = c.curves.responseDb.filter((_, i) => c.freqs[i]! >= m.f3Hz! * 1.5 && c.freqs[i]! <= hi);
      expect(win.length).toBeGreaterThan(3);
      expect(m.rippleDb).toBeCloseTo(m.peakDb - X.median(win), 9);
      expect(m.rippleDb).toBeGreaterThanOrEqual(0);
    }
  });
  it('a response that never falls 3 dB inside the plot has no F3', () => {
    // the high-frequency plot starts above this box's roll-off
    const m = metrics(base({ volumeL: 60, plotRange: 'high' }));
    expect(m.f3Hz).toBeNull();
    expect(metrics(base({ volumeL: 60 })).f3Hz).not.toBeNull();
  });
  it('the lowest impedance of a sealed box is about the voice-coil resistance', () => {
    const d = base();
    expect(metrics(d).impedanceMinOhm).toBeCloseTo(M.driverOf(d).re, 1);
  });
  it('a band-pass box has a high edge too; the cone figures follow the chosen power', () => {
    const bp = X.candidateFor(base(), 'bandpass', 'alignment').design;
    const m = metrics(bp);
    expect(m.f3Hz).not.toBeNull();
    expect(m.hiHz).not.toBeNull();
    expect(m.hiHz!).toBeGreaterThan(m.f3Hz!);
    const lo = metrics(base({ powerW: 10 }));
    const hi = metrics(base({ powerW: 400 }));
    expect(hi.excursionMm).toBeGreaterThan(lo.excursionMm * 5);
    expect(hi.excursionRatio).toBeCloseTo(hi.excursionMm / hi.xmaxMm, 12);
    expect(hi.xmaxMm).toBeCloseTo(M.driverOf(base()).xmax * 1000, 9);
  });
  it('counts warnings, reports the air and the lowest impedance', () => {
    const noFit = base({ driverClass: M.CUSTOM_CLASS, custom: { ...M.DEFAULT_DESIGN.custom, qts: 1, qms: 0.5 }, volumeL: 5 }); // Qms below Qts is a warning
    const m = metrics(noFit);
    expect(m.warnings).toBe(M.compute(noFit).warnings.length);
    expect(m.warnings).toBeGreaterThan(0);
    expect(m.volumeL).toBe(5);
    expect(m.impedanceMinOhm).toBeGreaterThan(0);
    expect(metrics(base()).warnings).toBe(M.compute(base()).warnings.length);
  });
});

describe('scoreOf', () => {
  const ok = { f3Hz: 40, hiHz: null, peakDb: 0, rippleDb: 0.5, excursionMm: 5, xmaxMm: 8, excursionRatio: 0.625, groupDelayPeakMs: 10, impedanceMinOhm: 3, warnings: 0, volumeL: 60 };
  it('full marks at the target with a flat response, headroom and no warnings', () => {
    expect(X.scoreOf(ok, 40)).toEqual({ score: 100, low: 1, flat: 1, headroom: 1 });
    expect(X.scoreOf({ ...ok, f3Hz: 20 }, 40).low).toBe(1);
    expect(X.scoreOf({ ...ok, f3Hz: null }, 40).low).toBe(1);
  });
  it('the low end falls off to nothing at twice the target', () => {
    expect(X.scoreOf({ ...ok, f3Hz: 60 }, 40).low).toBeCloseTo(0.5, 12);
    expect(X.scoreOf({ ...ok, f3Hz: 80 }, 40).low).toBe(0);
    expect(X.scoreOf({ ...ok, f3Hz: 200 }, 40).low).toBe(0);
    expect(X.scoreOf({ ...ok, f3Hz: 60 }, 40).score).toBe(80);
  });
  it('flatness: full to 1 dB, none at 6 dB', () => {
    expect(X.scoreOf({ ...ok, rippleDb: 1 }, 40).flat).toBe(1);
    expect(X.scoreOf({ ...ok, rippleDb: 3.5 }, 40).flat).toBeCloseTo(0.5, 12);
    expect(X.scoreOf({ ...ok, rippleDb: 6 }, 40).flat).toBe(0);
    expect(X.scoreOf({ ...ok, rippleDb: 9 }, 40).flat).toBe(0);
    expect(X.scoreOf({ ...ok, rippleDb: 6 }, 40).score).toBe(70);
  });
  it('headroom: full within Xmax, none at twice Xmax', () => {
    expect(X.scoreOf({ ...ok, excursionRatio: 1 }, 40).headroom).toBe(1);
    expect(X.scoreOf({ ...ok, excursionRatio: 1.5 }, 40).headroom).toBeCloseTo(0.5, 12);
    expect(X.scoreOf({ ...ok, excursionRatio: 2 }, 40).headroom).toBe(0);
    expect(X.scoreOf({ ...ok, excursionRatio: 3 }, 40).headroom).toBe(0);
    expect(X.scoreOf({ ...ok, excursionRatio: 2 }, 40).score).toBe(70);
  });
  it('ten points off per warning, at most thirty, never below zero', () => {
    expect(X.scoreOf({ ...ok, warnings: 1 }, 40).score).toBe(90);
    expect(X.scoreOf({ ...ok, warnings: 3 }, 40).score).toBe(70);
    expect(X.scoreOf({ ...ok, warnings: 9 }, 40).score).toBe(70);
    expect(X.scoreOf({ ...ok, f3Hz: 100, rippleDb: 9, excursionRatio: 3, warnings: 9 }, 40).score).toBe(0);
  });
});

describe('designWithDriver and rankDrivers', () => {
  const generics = genericEntries();
  it('a generic becomes its class, a database driver a snapshot, an unusable one nothing; the box stays', () => {
    const b = base({ volumeL: 77, tuneHz: 33, type: 'ported' });
    const g = X.designWithDriver(b, generics[3]!)!;
    expect([g.driverClass, g.libDriver, g.volumeL, g.tuneHz, g.type]).toEqual([3, undefined, 77, 33, 'ported']);
    const e = mk({}, 'a');
    const d = X.designWithDriver(b, e)!;
    expect([d.driverClass, d.libDriver?.id, d.volumeL]).toEqual([M.CUSTOM_CLASS, 'a', 77]);
    expect(X.designWithDriver(b, mk({ pe: undefined }, 'half'))).toBeNull();
    // a generic base with a database driver on it goes back to the class
    expect(X.designWithDriver(d, generics[0]!)!.libDriver).toBeUndefined();
  });
  it('lists every usable driver, best first, and skips the unusable', () => {
    const b = base({ volumeL: 60 });
    const rows = X.rankDrivers(b, [...generics, mk({ pe: undefined }, 'half'), mk({}, 'good')], 40);
    expect(rows).toHaveLength(generics.length + 1);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1]!.score.score).toBeGreaterThanOrEqual(rows[i]!.score.score);
    expect(rows.some((r) => r.entry.id === 'half')).toBe(false);
    for (const r of rows) {
      expect(Number.isFinite(r.metrics.peakDb)).toBe(true);
      expect(r.responseDb).toHaveLength(M.compute(r.design).freqs.length);
      expect(r.design.volumeL).toBe(60);
    }
  });
  it('a driver that would be driven past Xmax or ripple more scores lower than the same driver with room to spare', () => {
    const b = base({ volumeL: 60, powerW: 300 });
    const roomy = mk({ xmax: 0.02 }, 'roomy');
    const tight = mk({ xmax: 0.002 }, 'tight');
    const rows = X.rankDrivers(b, [tight, roomy], 40);
    expect(rows[0]!.entry.id).toBe('roomy');
    expect(rows[0]!.score.headroom).toBeGreaterThan(rows[1]!.score.headroom);
    expect(rows[1]!.metrics.excursionRatio).toBeGreaterThan(rows[0]!.metrics.excursionRatio * 5);
  });
  it('the 12 in driven past its Xmax at 100 W in 60 L is counted as a warning and scores below the 15 in that is not', () => {
    const rows = X.rankDrivers(base({ volumeL: 60 }), [generics[1]!, generics[2]!], 40);
    const by = (id: string) => rows.find((r) => r.entry.id === id)!;
    expect(by('generic-1').metrics.excursionRatio).toBeGreaterThan(1);
    expect(by('generic-1').metrics.warnings).toBeGreaterThan(by('generic-2').metrics.warnings);
    expect(rows[0]!.entry.id).toBe('generic-2');
  });
  it('ties break by name', () => {
    const a = mk({}, 'a');
    const same = { ...mk({}, 'b'), name: 'A first' };
    const second = { ...a, name: 'B second' };
    const rows = X.rankDrivers(base(), [second, same], 40);
    expect(rows.map((r) => r.entry.name)).toEqual(['A first', 'B second']);
  });
  it('uses the target F3: a lower target scores a given box lower', () => {
    const e = mk({}, 'a');
    const hi = X.rankDrivers(base(), [e], 80)[0]!.score.low;
    const lo = X.rankDrivers(base(), [e], 20)[0]!.score.low;
    expect(hi).toBeGreaterThan(lo);
  });
});
