import { describe, expect, it } from 'vitest';
import * as P from '../src/index';

// Deterministic noise so a failure is reproducible.
function rng(seed: number) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
}

/** Curve of a DriverSpec as the probe would deliver it: log sweep, complex Z, relative gaussian noise. */
function sweep(d: P.DriverSpec, opts: { leMH?: number; noise?: number; seed?: number; n?: number; massKg?: number } = {}) {
  const { leMH = 0, noise = 0, seed = 1, n = 120, massKg = 0 } = opts;
  const dd = P.deriveDriver(d);
  const mms = dd.mms + massKg;
  const fs = 1 / (2 * Math.PI * Math.sqrt(mms * dd.cms));
  const qms = (2 * Math.PI * fs * mms) / dd.rms;
  const qes = (2 * Math.PI * fs * mms * d.re) / (dd.bl * dd.bl);
  const g = rng(seed);
  const pts: P.ImpedancePoint[] = [];
  const f0 = Math.max(15, d.fs / 6);
  const f1 = Math.min(20000, d.fs * 6);
  for (let i = 0; i < n; i++) {
    const f = f0 * Math.pow(f1 / f0, i / (n - 1));
    const z = P.freeAirImpedance([d.re, fs, qms, qes, leMH], f);
    pts.push({ f, re: z.re * (1 + noise * g()), im: z.im * (1 + noise * g()) + noise * Math.abs(z.re) * g() });
  }
  return { pts, fs, qms, qes };
}

const near = (got: number, want: number, rel: number) => Math.abs(got - want) <= rel * Math.abs(want);

describe('freeAirImpedance matches the Designer model', () => {
  it('equals Re / (1 - Bl s x) with the free-air cone displacement, Le = 0', () => {
    const d = P.ALL_DRIVER_CLASSES[1]!; // 12 in
    const dd = P.deriveDriver(d);
    for (const f of [10, 38, 80, 500]) {
      // free air: x = Bl / (Re (Zm)), Zm = Rms + j w Mms + 1/(j w Cms)
      const w = 2 * Math.PI * f;
      const zm = P.add(P.cx(dd.rms), P.cx(0, w * dd.mms - 1 / (w * dd.cms)));
      const x = P.div(P.cx(dd.bl / d.re), P.mul(P.jw(f), P.add(zm, P.cx((dd.bl * dd.bl) / d.re))));
      const want = P.impedanceFromDisplacement(f, x, dd.bl, d.re);
      const got = P.freeAirImpedance([d.re, d.fs, d.qms, d.qes, 0], f);
      expect(got.re).toBeCloseTo(want.re, 6);
      expect(got.im).toBeCloseTo(want.im, 6);
    }
  });
});

describe('fitFreeAir self-recovery', () => {
  it('recovers every generic class from a clean curve to 0.1 %', () => {
    for (const d of P.ALL_DRIVER_CLASSES) {
      const fit = P.fitFreeAir(sweep(d).pts);
      expect(near(fit.re, d.re, 1e-3), `${d.name} Re ${fit.re}`).toBe(true);
      expect(near(fit.fs, d.fs, 1e-3), `${d.name} fs ${fit.fs}`).toBe(true);
      expect(near(fit.qms, d.qms, 1e-3), `${d.name} Qms ${fit.qms}`).toBe(true);
      expect(near(fit.qes, d.qes, 1e-3), `${d.name} Qes ${fit.qes}`).toBe(true);
      expect(fit.leMH, d.name).toBeLessThan(1e-3);
    }
  });

  it('with 1 % noise every class stays within 3 % on Re/Fs and 15 % on Q', () => {
    for (const d of P.ALL_DRIVER_CLASSES) {
      const fit = P.fitFreeAir(sweep(d, { noise: 0.01, seed: 7 }).pts);
      expect(near(fit.re, d.re, 0.03), `${d.name} Re ${fit.re}`).toBe(true);
      expect(near(fit.fs, d.fs, 0.03), `${d.name} fs ${fit.fs}`).toBe(true);
      expect(near(fit.qms, d.qms, 0.15), `${d.name} Qms ${fit.qms}`).toBe(true);
      expect(near(fit.qes, d.qes, 0.15), `${d.name} Qes ${fit.qes}`).toBe(true);
    }
  });

  it('a real coil inductance is fitted, and does not bias the other numbers', () => {
    const d = P.ALL_DRIVER_CLASSES[1]!;
    const fit = P.fitFreeAir(sweep(d, { leMH: 1.2 }).pts);
    expect(near(fit.leMH, 1.2, 0.01)).toBe(true);
    expect(near(fit.fs, d.fs, 1e-3)).toBe(true);
    expect(near(fit.qes, d.qes, 1e-3)).toBe(true);
  });

  it('the reported 95 % bands cover the truth about 95 % of the time', () => {
    const d = P.ALL_DRIVER_CLASSES[2]!; // 15 in
    const dd = P.deriveDriver(d);
    const trials = 150;
    const hit = { re: 0, fs: 0, qms: 0, qes: 0, qts: 0 };
    for (let s = 1; s <= trials; s++) {
      const fit = P.fitFreeAir(sweep(d, { noise: 0.01, seed: s * 31 }).pts);
      if (near(fit.re, d.re, fit.bands.re)) hit.re++;
      if (near(fit.fs, d.fs, fit.bands.fs)) hit.fs++;
      if (near(fit.qms, d.qms, fit.bands.qms)) hit.qms++;
      if (near(fit.qes, d.qes, fit.bands.qes)) hit.qes++;
      if (near(fit.qts, dd.qts, fit.bands.qts)) hit.qts++;
    }
    for (const [k, v] of Object.entries(hit)) {
      expect(v / trials, k).toBeGreaterThan(0.88);
      expect(v / trials, k).toBeLessThan(0.995);
    }
  });

  it('more noise gives wider bands', () => {
    const d = P.ALL_DRIVER_CLASSES[0]!;
    const a = P.fitFreeAir(sweep(d, { noise: 0.005, seed: 3 }).pts);
    const b = P.fitFreeAir(sweep(d, { noise: 0.02, seed: 3 }).pts);
    expect(b.bands.qes).toBeGreaterThan(a.bands.qes * 2);
    expect(b.bands.fs).toBeGreaterThan(a.bands.fs * 2);
  });

  it('rejects too few points', () => {
    expect(() => P.fitFreeAir(sweep(P.ALL_DRIVER_CLASSES[0]!, { n: 8 }).pts)).toThrow();
  });
});

describe('added mass', () => {
  it('recovers Mms, Cms and Bl of every class to 1 % from clean curves, no Sd needed', () => {
    for (const d of P.ALL_DRIVER_CLASSES) {
      const dd = P.deriveDriver(d);
      const dm = dd.mms * 0.5; // a mass worth half the cone: a large, easy-to-measure shift
      const base = P.fitFreeAir(sweep(d).pts);
      const loaded = P.fitFreeAir(sweep(d, { massKg: dm }).pts);
      const m = P.addedMass(base, loaded, dm);
      expect(near(m.mms, dd.mms, 0.01), `${d.name} Mms`).toBe(true);
      expect(near(m.cms, dd.cms, 0.01), `${d.name} Cms`).toBe(true);
      expect(near(m.bl, dd.bl, 0.01), `${d.name} Bl`).toBe(true);
    }
  });

  it('Vas follows from Cms once Sd is entered', () => {
    const d = P.ALL_DRIVER_CLASSES[1]!;
    const dd = P.deriveDriver(d);
    expect(near(P.vasFromCms(dd.cms, d.sd, 0.01).vasM3, d.vasM3, 1e-9)).toBe(true);
  });

  it('with noise the Mms band covers the truth in most trials; a tiny mass gives a much wider band', () => {
    const d = P.ALL_DRIVER_CLASSES[3]!;
    const dd = P.deriveDriver(d);
    let hit = 0;
    const trials = 60;
    let bandBig = 0;
    for (let s = 1; s <= trials; s++) {
      const dm = dd.mms * 0.3;
      const base = P.fitFreeAir(sweep(d, { noise: 0.005, seed: s }).pts);
      const loaded = P.fitFreeAir(sweep(d, { noise: 0.005, seed: s + 1000, massKg: dm }).pts);
      const m = P.addedMass(base, loaded, dm, 0.005);
      if (near(m.mms, dd.mms, m.bands.mms)) hit++;
      bandBig = m.bands.mms;
    }
    expect(hit / trials).toBeGreaterThan(0.85);
    const dmSmall = dd.mms * 0.02;
    const base = P.fitFreeAir(sweep(d, { noise: 0.005, seed: 5 }).pts);
    const loaded = P.fitFreeAir(sweep(d, { noise: 0.005, seed: 6, massKg: dmSmall }).pts);
    expect(P.addedMass(base, loaded, dmSmall).bands.mms).toBeGreaterThan(bandBig * 5);
  });

  it('refuses a mass that did not lower fs', () => {
    const d = P.ALL_DRIVER_CLASSES[1]!;
    const base = P.fitFreeAir(sweep(d).pts);
    expect(() => P.addedMass(base, base, 0.01)).toThrow();
  });
});
