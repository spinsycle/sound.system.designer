// A1 pass condition: what the page plots for the spec's reference box equals the shared vectors. evaluateAt is the
// function compute() maps over the plot frequencies, so this asserts the path the page draws.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as M from '../src/model';

interface Vector {
  id: string;
  inputs: Record<string, number>;
  outputs: Record<string, number>;
}
const file = JSON.parse(readFileSync(new URL('../../physics/test/test-vectors.json', import.meta.url), 'utf8')) as { vectors: Vector[] };
const vec = (id: string): Vector => {
  const v = file.vectors.find((x) => x.id === id);
  if (!v) throw new Error(`missing vector ${id}`);
  return v;
};

// The spec's reference driver as a user would enter it (Qts and Qms, litres, cm2). Its Qms is inside the entry range.
const ref = vec('driver_derived');
const custom = { fsHz: ref.inputs.fs!, qts: ref.outputs.qts!, qms: ref.inputs.qms!, vasL: ref.inputs.vas_m3! * 1000, sdCm2: ref.inputs.sd_m2! * 1e4, reOhm: ref.inputs.re!, xmaxMm: 10, powerW: 100 };
// 1 V peak: excursion in mm is then the vectors' metres per volt x 1000
const onePeakVolt = 0.5 / ref.inputs.re!;
const base: M.Design = { ...M.DEFAULT_DESIGN, driverClass: M.CUSTOM_CLASS, custom, powerW: onePeakVolt };
const near = (got: number, want: number): void => expect(Math.abs(got - want)).toBeLessThanOrEqual(1e-7 * Math.max(Math.abs(want), 1e-6));

describe('plotted values at the reference box equal the shared vectors', () => {
  it('sealed 100 L', () => {
    const d: M.Design = { ...base, type: 'sealed', volumeL: 100 };
    const fc = vec('sealed_x_at_fc').inputs.f!;
    near(M.evaluateAt(d, fc).excursionMm, vec('sealed_x_at_fc').outputs.x_per_v! * 1000);
    near(M.evaluateAt(d, fc).impedanceOhm, vec('imp_sealed_at_fc').outputs.z_ohm!);
    near(M.evaluateAt(d, 25).impedanceOhm, vec('imp_sealed_25hz').outputs.z_ohm!);
    near(M.evaluateAt(d, 25).phaseDeg, vec('imp_sealed_25hz').outputs.phase_deg!);
    const c = M.compute(d);
    expect(c.readouts.find((r) => r.label === 'Box resonance fc')!.value).toBe(`${fc.toFixed(1)} Hz`);
    // group delay of the second-order high-pass at its corner is 2 Q / wc (closed form), plotted in ms
    const qtc = ref.outputs.qts! * Math.sqrt(1 + 200 / 100);
    near(M.evaluateAt(d, fc).groupDelayMs, ((2 * qtc) / (2 * Math.PI * fc)) * 1000);
    expect(c.readouts.find((r) => r.label === 'Qtc')!.value).toBe(qtc.toFixed(3));
  });

  it('ported B4 box', () => {
    const v = vec('vented_b4_mag_15hz').inputs;
    const d: M.Design = { ...base, type: 'ported', volumeL: v.vb_l!, tuneHz: v.fb! };
    for (const id of ['vented_b4_mag_15hz', 'vented_b4_mag_30hz', 'vented_b4_mag_60hz']) near(M.evaluateAt(d, vec(id).inputs.f!).responseDb, vec(id).outputs.db!);
    near(M.evaluateAt(d, 20).impedanceOhm, vec('imp_vented_20hz').outputs.z_ohm!);
    near(M.evaluateAt(d, 45).phaseDeg, vec('imp_vented_45hz').outputs.phase_deg!);
    expect(M.evaluateAt(d, v.fb!).excursionMm).toBeLessThan(1e-9);
    expect(M.compute(d).readouts.find((r) => r.label === 'F3')!.value).toBe(`${vec('vented_b4_f3').outputs.f3!.toFixed(1)} Hz`);
  });

  it('band-pass, rear 100 L, front 200 L, 40 Hz', () => {
    const d: M.Design = { ...base, type: 'bandpass', volumeL: 100, frontVolumeL: 200, tuneHz: 40 };
    for (const id of ['bp_mag_20hz', 'bp_mag_40hz', 'bp_mag_100hz']) near(M.evaluateAt(d, vec(id).inputs.f!).responseDb, vec(id).outputs.db!);
    near(M.evaluateAt(d, 70).impedanceOhm, vec('imp_bp_70hz').outputs.z_ohm!);
    near(M.evaluateAt(d, 25).phaseDeg, vec('imp_bp_25hz').outputs.phase_deg!);
  });
});

describe('design model', () => {
  it('excursion scales with the square root of power', () => {
    const d: M.Design = { ...base, type: 'sealed', volumeL: 100, powerW: 50 };
    near(M.evaluateAt({ ...d, powerW: 200 }, 40).excursionMm, 2 * M.evaluateAt(d, 40).excursionMm);
  });

  it('port length: the shared vector, the right chamber, and a warning when it does not fit', () => {
    const v = vec('port_length');
    const ported: M.Design = { ...base, type: 'ported', volumeL: v.inputs.vb_m3! * 1000, tuneHz: v.inputs.fb!, portDiameterCm: v.inputs.d_m! * 100 };
    const label = 'Port length (10.0 cm round)';
    expect(M.compute(ported).readouts.find((r) => r.label === label)!.value).toBe(`${(v.outputs.length_m! * 100).toFixed(1)} cm`);
    // band-pass: the port tunes the FRONT chamber, so the same front volume gives the same length whatever the rear
    const bp: M.Design = { ...ported, type: 'bandpass', volumeL: 33, frontVolumeL: v.inputs.vb_m3! * 1000 };
    expect(M.compute(bp).readouts.find((r) => r.label === label)!.value).toBe(`${(v.outputs.length_m! * 100).toFixed(1)} cm`);
    const wide = M.compute({ ...ported, volumeL: 500, tuneHz: 60, portDiameterCm: 5 });
    expect(wide.readouts.at(-1)!.value).toBe('does not fit');
    expect(wide.warnings.some((w) => w.includes('cannot tune'))).toBe(true);
    expect(M.compute(ported).warnings.some((w) => w.includes('cannot tune'))).toBe(false);
  });

  it('warnings: Xmax, rated power, Qms below Qts', () => {
    const quiet = M.compute({ ...M.DEFAULT_DESIGN, type: 'sealed', powerW: 1 });
    expect(quiet.warnings).toEqual([]);
    const loud = M.compute({ ...M.DEFAULT_DESIGN, type: 'sealed', powerW: 2000 });
    expect(loud.warnings.some((w) => w.includes('exceeds Xmax (12.0 mm)'))).toBe(true);
    expect(loud.warnings.some((w) => w.includes('above the driver\'s rated power (900 W)'))).toBe(true);
    const badQ = M.compute({ ...base, custom: { ...custom, qts: 1.2, qms: 1.0 } });
    expect(badQ.warnings.some((w) => w.includes('treated as 1.26'))).toBe(true);
  });

  it('passband of a sampled curve', () => {
    const freqs = [10, 20, 40, 80, 160];
    const pb = M.passband(freqs, [-12, -6, 0, -6, -12]);
    expect(pb.peakHz).toBe(40);
    expect(pb.loHz).toBeCloseTo(40 / Math.SQRT2, 9);
    expect(pb.hiHz).toBeCloseTo(40 * Math.SQRT2, 9);
  });

  it('sanitize: defaults for junk, clamps for out-of-range, keeps valid values', () => {
    expect(M.sanitize(null)).toEqual(M.DEFAULT_DESIGN);
    expect(M.sanitize({ type: 'horn', driverClass: 99, volumeL: 'x' })).toEqual({ ...M.DEFAULT_DESIGN, driverClass: M.CUSTOM_CLASS });
    const s = M.sanitize({ type: 'sealed', volumeL: 1e9, tuneHz: -5, custom: { qts: 9, fsHz: 44 } });
    expect([s.type, s.volumeL, s.tuneHz, s.custom.qts, s.custom.fsHz, s.custom.qms]).toEqual(['sealed', 1000, 10, 1.5, 44, 5]);
  });
});
