// Properties the shared vectors and the plugin parity file do not reach: the limiter gain, and the ideal
// (no sample rate) paths that only this library has.
import { describe, expect, it } from 'vitest';
import * as P from '../src/index';

const box: P.BoxParams = {
  driver: P.DRIVER_CLASSES[3]!,
  type: 'ported',
  volumeL: 150,
  tuneHz: 40,
  frontVolumeL: 100,
  hornThroatCm2: 600,
  hornMouthCm2: 4000,
  hornLengthM: 1,
};
const band = (over: Partial<P.BandSettings> = {}): P.BandSettings => ({ box, solo: false, mute: false, trimDb: 0, delayMs: 0, ...over });

describe('closed forms', () => {
  it('limiter gain: 1 at rest, tanh(1) at Xmax, never above 1, continuous at the series switch', () => {
    expect(P.limiterGain(0, 0.01)).toBe(1);
    expect(P.limiterGain(0.01, 0.01)).toBeCloseTo(Math.tanh(1), 14);
    expect(P.limiterGain(-0.03, 0.01)).toBeCloseTo(Math.tanh(3) / 3, 14);
    for (const x of [1e-7, 1e-4, 0.005, 0.02, 1]) expect(P.limiterGain(x, 0.01)).toBeLessThanOrEqual(1);
    expect(Math.abs(P.limiterGain(0.99999e-6, 0.01) - P.limiterGain(1.00001e-6, 0.01))).toBeLessThan(1e-12);
  });

  it('band-pass with an infinite rear chamber has the ported denominator', () => {
    expect(P.bandpassDenCoefs(30, 0.38, 0, 1.3, 40)).toEqual(P.ventedDenCoefs(30, 0.38, 1.3, 40));
  });

  it('crossover points without a sample rate have no upper cap', () => {
    expect(P.effectiveCrossovers([100, 15000, 25000], 4)).toEqual([100, 15000, 25000]);
    expect(P.effectiveCrossovers([100, 15000, 25000], 2)).toEqual([100]);
  });

  it('one band: no crossover, so the ideal and sampled system responses are the box response', () => {
    const p: P.SystemParams = { bands: 1, xover: [100, 800, 3500], align: false, band: [band()] };
    expect(P.systemResponse(p, 55)).toEqual(P.boxResponse(box, 55));
    expect(P.systemResponse(p, 55, 48000)).toEqual(P.boxResponse(box, 55));
  });

  it('ideal delay is not rounded to samples', () => {
    const p: P.SystemParams = { bands: 1, xover: [], align: true, band: [band({ delayMs: 1.2345 })] };
    const want = P.mul(P.boxResponse(box, 70), P.cx(Math.cos(-2 * Math.PI * 70 * 1.2345e-3), Math.sin(-2 * Math.PI * 70 * 1.2345e-3)));
    const got = P.systemResponse(p, 70);
    expect(Math.hypot(got.re - want.re, got.im - want.im)).toBeLessThan(1e-14);
  });

  it('ideal room: exact ISO air loss and the distance law; the reference position is transparent', () => {
    const room: P.RoomParams = { distanceM: 11, held: false, boundary: 0, boundaryDistM: 0.5, indoor: false, rt60: 1.2, volumeM3: 2000 };
    const wantDb = -20 * Math.log10(11) - 10 * P.airAbsorptionDbPerM(8000);
    expect(P.dB(P.abs(P.roomDirectResponse(room, 8000)))).toBeCloseTo(wantDb, 10);
    expect(P.roomDirectResponse({ ...room, distanceM: 1 }, 8000)).toEqual(P.cx(1, 0));
  });

  it('box impedance: Re at the port tuning (lossless), and the sealed peak Re + Bl^2/Rms at the box resonance', () => {
    const z = P.boxImpedance(box, box.tuneHz);
    expect(P.abs(z)).toBeCloseTo(box.driver.re, 9);
    const d = box.driver;
    const r = P.deriveDriver(d);
    const sealed: P.BoxParams = { ...box, type: 'sealed' };
    const fc = P.sealedParams(d.fs, r.qts, d.vasM3, sealed.volumeL / 1000).fc;
    expect(P.abs(P.boxImpedance(sealed, fc))).toBeCloseTo(d.re + (r.bl * r.bl) / r.rms, 8);
  });

  it('boundary shelf: full gain at DC, none at high frequency', () => {
    for (const n of [1, 2, 3]) {
      expect(P.dB(P.abs(P.boundaryShelf(0.01, n, 0.5)))).toBeCloseTo(P.boundaryGainDb(n), 3);
      expect(P.dB(P.abs(P.boundaryShelf(2e6, n, 0.5)))).toBeCloseTo(0, 3);
    }
  });
});
