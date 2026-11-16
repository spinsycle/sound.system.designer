// Checks against worked numbers printed in Dickason's Loudspeaker Design Cookbook (7th ed.).
import { describe, expect, it } from 'vitest';
import * as P from '../src/index';

describe('cookbook: vented box', () => {
  it('ql huge converges to lossless', () => {
    const a = P.ventedDenCoefs(30, 0.4, 1.2, 33);
    const b = P.ventedDenCoefs(30, 0.4, 1.2, 33, 1e12);
    a.forEach((v, i) => expect(b[i]!).toBeCloseTo(v, 12));
  });
  it('QL = 7 lowers the passband peak of a ripple alignment', () => {
    const lossless = P.dB(P.abs(P.ventedG(45, 30, 0.35, 2.0, 40)));
    const lossy = P.dB(P.abs(P.ventedG(45, 30, 0.35, 2.0, 40, 7)));
    expect(lossy).toBeLessThan(lossless);
  });
  it('B4 alignment at QL = 7 is alpha 1.0613, H = 1, Qts 0.4048 (Table 2.10)', () => {
    const s = P.solveVented(0.4048, 'B4', 7);
    console.log('B4 7', JSON.stringify(s));
    expect(s.alpha).toBeCloseTo(1.0613, 1);
    expect(s.h).toBeCloseTo(1, 1);
    expect(s.errDb).toBeLessThan(0.3);
  });
  it('B4 at QL = 3 and 15 (Table 2.10)', () => {
    const a = P.solveVented(0.4386, 'B4', 3);
    const b = P.solveVented(0.3937, 'B4', 15);
    console.log('B4 3', JSON.stringify(a), 'B4 15', JSON.stringify(b));
    expect(a.alpha).toBeCloseTo(0.6543, 1);
    expect(b.alpha).toBeCloseTo(1.2444, 1);
  });
});

describe('cookbook: sealed box', () => {
  it('Vb for a target Qtc is the inverse of the Qtc formula', () => {
    const vb = P.sealedVolumeForQtc(0.4, 0.06, 0.707);
    expect(P.sealedParams(30, 0.4, 0.06, vb).qtc).toBeCloseTo(0.707, 12);
  });
  it('100 % fill: effective volume x1.2, 1/Qtc + 0.2', () => {
    const f = P.sealedFilled(30, 0.4, 0.06, 0.03, 1);
    expect(f.alpha).toBeCloseTo(0.06 / (0.03 * 1.2), 12);
    expect(1 / f.qtc).toBeCloseTo(1 / (0.4 * Math.sqrt(1 + f.alpha)) + 0.2, 12);
  });
});

describe('cookbook: passive radiator', () => {
  it('response tends to 1 far above the box', () => {
    expect(P.abs(P.passiveG(5000, 30, 0.3, 3, 3, 20))).toBeCloseTo(1, 3);
  });
  it('Table 3.1 rows: Qts 0.26 alpha 4.33 -> H 1.73, f3/fs 1.98; Qts 0.25 alpha 4.58 -> H 1.727, f3/fs 2.0', () => {
    const a = P.solvePassiveTuning(0.26, 4.33, 7)!;
    expect(a.h).toBeCloseTo(1.73, 1);
    expect(a.f3OverFs / 1.98).toBeGreaterThan(0.94);
    expect(a.f3OverFs / 1.98).toBeLessThan(1.04);
    const b = P.solvePassiveTuning(0.25, 4.58, 7)!;
    expect(b.h).toBeCloseTo(1.727, 1);
    expect(b.f3OverFs / 2.0).toBeGreaterThan(0.94);
    expect(b.f3OverFs / 2.0).toBeLessThan(1.04);
  });
  it('mass for a target resonance round-trips through the resonance formula', () => {
    const pr = { sdp: 0.0215, vapM3: 0.05 };
    const m = P.prMassForResonance(pr, 25);
    expect(P.prResonance({ ...pr, massKg: m })).toBeCloseTo(25, 10);
  });
});

describe('cookbook: sealed-rear band-pass (Table 1.28, 8 in: fs 32, Qts 0.328, Qbp 0.7142, fL 43, fH 115)', () => {
  const vas = 0.0657;
  const d: P.DriverSpec = { name: 'x', fs: 32, qes: 1 / (1 / 0.328 - 1 / 4), qms: 4, vasM3: vas, sd: 0.0215, re: 6, xmax: 0.005, pe: 100 };
  it('S = 0.7 design is flat and lands on the book band edges', () => {
    const b = P.bandpassDesign(d, 0.328, 0.7, 0.7142);
    expect(b.fbHz).toBeCloseTo((0.7142 * 32) / 0.328, 10);
    const e = P.bandpassEdges(32, 0.328, vas / b.vrM3, vas / b.vfM3, b.fbHz);
    expect(e.fl).toBeGreaterThan(41);
    expect(e.fl).toBeLessThan(45);
    expect(e.fh).toBeGreaterThan(108);
    expect(e.fh).toBeLessThan(120);
    expect(Math.abs(e.peakDb)).toBeLessThan(0.3);
  });
});

describe('cookbook: transmission line', () => {
  const qts = 0.41;
  const qms = 4;
  const b200: P.DriverSpec = { name: 'B200', fs: 25, qes: 1 / (1 / qts - 1 / qms), qms, vasM3: 0.131, sd: 0.0215, re: 6, xmax: 0.005, pe: 100 };
  const f3Of = (d: P.DriverSpec, geo: P.TlGeometry): number => {
    for (let f = d.fs * 0.3; f < d.fs * 8; f *= 1.02) if (P.dB(P.abs(P.tlSystem(d, geo, f).g)) > -3) return f;
    return -1;
  };
  it('worked example p. 102: Extended taper gives L about 84 in, Vp about 218 L, f3 about 32.5 Hz', () => {
    const des = P.tlDesign(b200, 'taper', 'extended');
    expect(des.lengthM / 0.0254).toBeGreaterThan(82);
    expect(des.lengthM / 0.0254).toBeLessThan(87);
    expect(des.volumeM3 * 1000).toBeCloseTo(218.3, 0);
    expect(des.f3Hz).toBeCloseTo(32.5, 5);
    expect(P.stuffingDensityLb('acousta', des.lengthM)).toBeGreaterThan(0.55);
    expect(P.stuffingDensityLb('acousta', des.lengthM)).toBeLessThan(0.7);
    expect(f3Of(b200, P.tlGeometryFromDesign(des, 'acousta')) / 32.5).toBeGreaterThan(0.9);
    expect(f3Of(b200, P.tlGeometryFromDesign(des, 'acousta')) / 32.5).toBeLessThan(1.1);
  });
  it('line resonance is c / 4L (Table 4.1: 48 in gives 71 Hz)', () => {
    expect(343 / (4 * 48 * 0.0254)).toBeGreaterThan(69);
    expect(343 / (4 * 48 * 0.0254)).toBeLessThan(73);
  });
  it('every table type and alignment simulates to the table f3 within 20 %', () => {
    for (const [fs, q, vas, sd] of [[25, 0.41, 0.131, 0.0215], [32, 0.3, 0.06, 0.048], [20, 0.5, 0.2, 0.085]] as const) {
      const d: P.DriverSpec = { name: 'x', fs, qes: 1 / (1 / q - 1 / 5), qms: 5, vasM3: vas, sd, re: 6, xmax: 0.005, pe: 100 };
      for (const kind of ['taper', 'chamber', 'offset'] as const) {
        for (const table of ['standard', 'extended'] as const) {
          const des = P.tlDesign(d, kind, table);
          const ratio = f3Of(d, P.tlGeometryFromDesign(des, 'acousta')) / des.f3Hz;
          expect(ratio, `${fs} ${kind} ${table}`).toBeGreaterThan(0.8);
          expect(ratio, `${fs} ${kind} ${table}`).toBeLessThan(1.2);
        }
      }
    }
  });
  it('more stuffing means a smoother but later-rolling-off response', () => {
    const geo = P.tlGeometryFromDesign(P.tlDesign(b200, 'taper', 'extended'), 'acousta');
    const light = { ...geo, densityLb: geo.densityLb * 0.3 };
    const heavy = { ...geo, densityLb: geo.densityLb * 2 };
    expect(f3Of(b200, heavy)).toBeGreaterThan(f3Of(b200, light));
  });
});
