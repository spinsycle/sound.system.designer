// Closed-form checks for the Cookbook additions: each number below is worked by hand from the book's formula.
import { describe, expect, it } from 'vitest';
import * as P from '../src/index';

const drv: P.DriverSpec = { name: 'x', fs: 30, qes: 0.5, qms: 4, vasM3: 0.1, sd: 0.05, re: 6, xmax: 0.01, pe: 200 };
const r = P.deriveDriver(drv);
const tau = (f: number): number => 1 / (2 * Math.PI * f);

describe('box losses: the coefficients are Small\'s with 1/QL', () => {
  it('vented D(s)', () => {
    const [fs, qts, a, fb, ql] = [30, 0.4, 1.2, 33, 7] as const;
    const ts = tau(fs);
    const tb = tau(fb);
    const c = P.ventedDenCoefs(fs, qts, a, fb, ql);
    expect(c[0]).toBeCloseTo(tb * tb * ts * ts, 18);
    expect(c[1]).toBeCloseTo((tb * tb * ts) / qts + (tb * ts * ts) / ql, 18);
    expect(c[2]).toBeCloseTo((a + 1) * tb * tb + (tb * ts) / (ql * qts) + ts * ts, 14);
    expect(c[3]).toBeCloseTo(ts / qts + tb / ql, 14);
    expect(c[4]).toBe(1);
  });
  it('band-pass D(s)', () => {
    const [fs, qts, ar, af, fb, ql] = [30, 0.4, 0.7, 1.1, 60, 7] as const;
    const ts = tau(fs);
    const tb = tau(fb);
    const c = P.bandpassDenCoefs(fs, qts, ar, af, fb, ql);
    expect(c[0]).toBeCloseTo(tb * tb * ts * ts, 18);
    expect(c[1]).toBeCloseTo((tb * tb * ts) / qts + (tb * ts * ts) / ql, 18);
    expect(c[2]).toBeCloseTo(ts * ts + tb * tb * (1 + ar + af) + (tb * ts) / (ql * qts), 14);
    expect(c[3]).toBeCloseTo(ts / qts + ((1 + ar) * tb) / ql, 14);
    expect(c[4]).toBeCloseTo(1 + ar, 14);
  });
  it('the cone does not stop at the tuning when the box leaks: |X(fb)| = Bl Ts^2 / (Re Mms QL |D|)', () => {
    const [alpha, fb, ql] = [1.2, 33, 7] as const;
    const x = P.abs(P.ventedX(fb, drv, r, alpha, fb, ql));
    const den = P.abs(P.poly(P.ventedDenCoefs(drv.fs, r.qts, alpha, fb, ql), P.jw(fb)));
    expect(x).toBeCloseTo(((r.bl / (drv.re * r.mms)) * tau(drv.fs) ** 2 * (1 / ql)) / den, 14);
    const xb = P.abs(P.bandpassX(fb, drv, r, 0.7, 1.1, fb, ql));
    const denb = P.abs(P.poly(P.bandpassDenCoefs(drv.fs, r.qts, 0.7, 1.1, fb, ql), P.jw(fb)));
    expect(xb).toBeCloseTo(((r.bl * r.cms) / drv.re / ql / (2 * Math.PI * fb)) * (2 * Math.PI * fb) / denb * (1 / 1), 12);
  });
});

describe('reference efficiency and output (Cookbook pp. 37-38, 75-76)', () => {
  it('eta0 = 9.64e-10 fs^3 Vas / Qes^3 with Vas in litres', () => {
    expect(P.referenceEfficiency(drv)).toBeCloseTo(0.0208224, 7);
    expect(P.referenceSpl(0.01)).toBeCloseTo(92, 10);
  });
  it('Kp: 0.39 at Qtc 0.707, 3.0 for a vented box', () => {
    expect(P.closedKp(0.707)).toBeCloseTo(0.39, 12);
    expect(P.closedKp(0.3)).toBe(0.06);
    expect(P.closedKp(2)).toBe(0.71);
    expect(P.closedKp(0.75)).toBeCloseTo(0.39 + ((0.57 - 0.39) * 0.043) / 0.093, 12);
    expect(P.VENTED_KP).toBe(3);
  });
  it('Par = Kp f3^4 Vd^2, SPL = 112 + 10 log Par, Per = Par / eta0', () => {
    const par = P.maxAcousticPower(40, 1e-4, 3);
    expect(par).toBeCloseTo(0.0768, 12);
    expect(P.powerSpl(par)).toBeCloseTo(112 + 10 * Math.log10(0.0768), 12);
    expect(P.electricalPowerFor(par, 0.02)).toBeCloseTo(3.84, 12);
    expect(P.displacementVolume(drv)).toBeCloseTo(0.0005, 12);
  });
});

describe('vent rules (Cookbook p. 69-72)', () => {
  it('the book example: 10 in woofer at 33.5 Hz needs 3.57 in, Small\'s bound 2.45 in', () => {
    expect(P.minVentDiameterM(1.16e-4, 33.5) * 39.37).toBeCloseTo(3.574, 2);
    expect(P.minVentDiameterConservativeM(1.16e-4, 33.5) * 39.37).toBeCloseTo(2.454, 2);
  });
  it('area ratio and combined vents', () => {
    expect(P.ventAreaRatio(0.04, 0.01)).toBe(4);
    expect(P.combinedVentDiameter(3, 4)).toBe(5);
    expect(P.portAirSpeed(30, 0.05, 0.01, 0.01)).toBeCloseTo(2 * Math.PI * 30 * 0.05 * 0.01 / 0.01, 12);
  });
});

describe('alignments and design helpers', () => {
  it('B4 follows its own prototype, not the third-order one (3 dB at f3, 24 dB per octave)', () => {
    const s = P.solveVented(0.4048, 'B4', 7);
    const g = (x: number): number => P.dB(P.abs(P.ventedG(x * s.f3OverFs, 1, 0.4048, s.alpha, s.h, 7)));
    expect(g(0.5)).toBeLessThan(-22);
    expect(g(0.5)).toBeGreaterThan(-27);
  });
  it('the recommended passive-radiator box and its tuning', () => {
    expect(P.recommendedPassiveAlpha(0.26)).toBeCloseTo(1.13 / 0.26, 12);
    expect(P.recommendedPassiveAlpha(0.05)).toBe(10);
    expect(P.recommendedPassiveAlpha(5)).toBe(1.5);
    const t = P.solvePassiveTuning(0.26, 4.33, 7)!;
    expect(t.peakDb).toBeLessThanOrEqual(0.5);
    expect(t.peakDb).toBeGreaterThan(-0.5);
    // a rippled box is not offered a passband: Qts 0.5 has none within 0.5 dB, and Qts 0.4 stays under it
    expect(P.solvePassiveTuning(0.5, 2.2, 7)).toBeNull();
    expect(P.solvePassiveTuning(0.4, 2.8, 7)!.peakDb).toBeLessThanOrEqual(0.5);
  });
  it('band-pass design: the three equations', () => {
    const b = P.bandpassDesign(drv, 0.3, 0.7, 0.65);
    expect(b.vfM3).toBeCloseTo((2 * 0.7 * 0.3) ** 2 * 0.1, 14);
    expect(b.vrM3).toBeCloseTo(0.1 / ((0.65 / 0.3) ** 2 - 1), 14);
    expect(b.fbHz).toBeCloseTo((0.65 * 30) / 0.3, 12);
  });
});

describe('passive radiator internals', () => {
  const pr = { sdp: 0.05, vapM3: 0.1, massKg: 0.3 };
  it('compliance Vap / (rho c^2 Sdp^2) and the resonance it gives', () => {
    expect(P.prCompliance(pr)).toBeCloseTo(0.1 / (1.18 * 343 * 343 * 0.05 * 0.05), 14);
    expect(P.prResonance(pr)).toBeCloseTo(1 / (2 * Math.PI * Math.sqrt(0.3 * P.prCompliance(pr))), 12);
    expect(P.prBoxTuning(20, 3)).toBeCloseTo(40, 12);
    const m = P.prMassForResonance(pr, 22);
    expect(1 / ((2 * Math.PI * 22) ** 2 * m)).toBeCloseTo(P.prCompliance(pr), 14);
  });
  it('with a leak the cone is free at DC: X(0) = Bl Cms / Re', () => {
    const x = P.passiveX(1e-4, drv, r, 3, 3, 15, 7);
    expect(P.abs(x)).toBeCloseTo((r.bl * r.cms) / drv.re, 8);
  });
  it('the radiator moves with the flow share delta / (1 + delta - (f/fp)^2) and scales as Sd / Sdp', () => {
    const alpha = 2.5;
    const vb = drv.vasM3 / alpha;
    const rad = { sdp: 0.04, vapM3: 0.05, massKg: 0.5 };
    const delta = rad.vapM3 / vb;
    const fp = P.prResonance(rad);
    const f = 17;
    const share = delta / (1 + delta - (f / fp) ** 2);
    const want = P.abs(P.passiveX(f, drv, r, alpha, delta, fp)) * Math.abs(share) * (drv.sd / rad.sdp);
    expect(P.abs(P.passiveXp(f, drv, r, rad, alpha))).toBeCloseTo(want, 12);
    // a bigger radiator with the same compliance volume and resonance moves less, in proportion
    const big = { sdp: 0.08, vapM3: 0.05, massKg: P.prMassForResonance({ sdp: 0.08, vapM3: 0.05 }, fp) };
    expect(P.abs(P.passiveXp(f, drv, r, big, alpha))).toBeCloseTo(want / 2, 12);
  });
});

describe('transmission line sizing', () => {
  it('a tapered line exits at a quarter of its start, a chamber line is a third chamber', () => {
    const t = P.tlDesign(drv, 'taper', 'standard');
    expect(t.exitM2 / t.startM2).toBeCloseTo(0.25, 12);
    expect(t.startM2 * 0.625 * t.lengthM).toBeCloseTo(t.volumeM3, 12);
    const c = P.tlDesign(drv, 'chamber', 'standard');
    expect(c.chamberM3 / c.volumeM3).toBeCloseTo(1 / 3, 12);
    expect(P.tlDesign(drv, 'offset', 'standard').offset).toBe(0.2);
  });
  it('fp = fs / (fs/fp row), length c / 4 fp, volume Vas / row; Table 4.3 Qts 0.41 row', () => {
    const q = 0.41;
    const d: P.DriverSpec = { ...drv, qes: 1 / (1 / q - 1 / drv.qms), fs: 25, vasM3: 0.131 };
    const t = P.tlDesign(d, 'taper', 'extended');
    expect(t.fpHz).toBeCloseTo(25 / 0.63, 6);
    expect(t.lengthM).toBeCloseTo(343 / (4 * (25 / 0.63)), 10);
    expect(t.volumeM3).toBeCloseTo(0.131 / 0.6, 10);
    expect(t.f3Hz).toBeCloseTo(32.5, 8);
  });
  it('stuffing density: Table 4.1 at 24, 48 and 96 in, held at the ends', () => {
    expect(P.stuffingDensityLb('acousta', 24 * 0.0254)).toBeCloseTo(1.7, 10);
    expect(P.stuffingDensityLb('acousta', 48 * 0.0254)).toBeCloseTo(1, 10);
    expect(P.stuffingDensityLb('acousta', 96 * 0.0254)).toBeCloseTo(0.5, 10);
    expect(P.stuffingDensityLb('acousta', 200 * 0.0254)).toBeCloseTo(0.5, 10);
    expect(P.stuffingDensityLb('fiberglass', 96 * 0.0254)).toBeCloseTo(0.6, 10);
    expect(P.stuffingDensityLb('polyester', 36 * 0.0254)).toBeCloseTo(1.4, 10);
  });
  it('the fibre model: heavier stuffing means higher flow resistivity, and the formula is Delany-Bazley', () => {
    expect(P.flowResistivity('acousta', 1)).toBeCloseTo(P.SIGMA_REF, 8);
    expect(P.flowResistivity('acousta', 2)).toBeCloseTo(P.SIGMA_REF * 2 ** 1.5, 6);
    const x = (1.18 * 100) / 20000;
    const db = P.delanyBazley(100, 20000);
    expect(db.k.re).toBeCloseTo(((2 * Math.PI * 100) / 343) * (1 + 0.0978 * x ** -0.7), 12);
    expect(db.k.im).toBeCloseTo(-((2 * Math.PI * 100) / 343) * 0.189 * x ** -0.595, 12);
    expect(db.z.re).toBeCloseTo(1 + 0.0571 * x ** -0.754, 12);
    expect(db.z.im).toBeCloseTo(-0.087 * x ** -0.732, 12);
  });
  it('a stuffed line behaves differently from an empty one and the stuffed share matters', () => {
    const t = P.tlDesign(drv, 'taper', 'extended');
    const g = P.tlGeometryFromDesign(t, 'acousta');
    expect(g.stuffedShare).toBe(0.8);
    const a = P.abs(P.tlSystem(drv, g, 60).g);
    const b = P.abs(P.tlSystem(drv, { ...g, stuffedShare: 0.2 }, 60).g);
    expect(Math.abs(a - b)).toBeGreaterThan(1e-3);
  });
});
