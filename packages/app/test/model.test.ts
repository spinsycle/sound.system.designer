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

describe('horn designer', () => {
  // the shared front-loaded horn vectors: reference driver, rear 100 L, throat chamber 5 L, exponential horn, 100 segments
  const v0 = vec('hornsim_front_60hz').inputs;
  const horn: M.Design = {
    ...base,
    type: 'horn',
    volumeL: v0.vr_m3! * 1000,
    horn: { ...M.DEFAULT_DESIGN.horn, flare: 'exponential', cutoffHz: v0.fc!, throatCm2: v0.st_m2! * 1e4, mouthCm2: v0.sm_m2! * 1e4, throatChamberL: v0.vtc_m3! * 1000 },
  };

  it('plotted values equal the shared horn vectors', () => {
    expect(v0.n).toBe(M.IDEAL_SEGMENTS);
    for (const id of ['hornsim_front_30hz', 'hornsim_front_60hz', 'hornsim_front_150hz', 'hornsim_front_600hz']) {
      const v = vec(id);
      const p = M.evaluateAt(horn, v.inputs.f!);
      near(p.responseDb, 20 * Math.log10(Math.hypot(v.outputs.g_re!, v.outputs.g_im!)));
      near(p.excursionMm, v.outputs.x_per_v! * 1000);
      near(p.impedanceOhm, v.outputs.z_ohm!);
    }
  });

  it('rear-loaded (scoop): plotted values equal the shared vectors; no plugin-bin overlay; a note on what is left out', () => {
    const r0 = vec('hornsim_rear_40hz').inputs;
    // a rear volume that would wreck the numbers if the scoop read it: it has no sealed chamber
    const scoop: M.Design = {
      ...base,
      type: 'horn',
      volumeL: 0.1,
      horn: { ...M.DEFAULT_DESIGN.horn, loading: 'rear', flare: 'exponential', cutoffHz: r0.fc!, throatCm2: r0.st_m2! * 1e4, mouthCm2: r0.sm_m2! * 1e4, throatChamberL: r0.vtc_m3! * 1000 },
    };
    for (const id of ['hornsim_rear_20hz', 'hornsim_rear_40hz', 'hornsim_rear_80hz', 'hornsim_rear_200hz']) {
      const v = vec(id);
      const p = M.evaluateAt(scoop, v.inputs.f!);
      near(p.responseDb, 20 * Math.log10(Math.hypot(v.outputs.g_re!, v.outputs.g_im!)));
      near(p.excursionMm, v.outputs.x_per_v! * 1000);
      near(p.impedanceOhm, v.outputs.z_ohm!);
    }
    const c = M.compute(scoop);
    expect(c.overlays.responseDb).toBeUndefined();
    expect(c.notes.some((n) => n.includes('Rear-loaded'))).toBe(true);
    expect(M.compute(horn).notes.some((n) => n.includes('Rear-loaded'))).toBe(false);
    expect(M.sanitize({ horn: { loading: 'rear' } }).horn.loading).toBe('rear');
    expect(M.sanitize({ horn: { loading: 'sideways' } }).horn.loading).toBe('front');
  });

  it('readouts: length, mouth size against the cutoff, volume, compression ratio', () => {
    const c = M.compute(horn);
    const get = (label: string): string => c.readouts.find((r) => r.label === label)!.value;
    expect(get('Length')).toBe('1.00 m');
    // full-size mouth for 51.78 Hz is pi (c / (2 pi fc))^2 = 3.4916 m2; 0.4 m2 is 11 % of it
    expect(get('Mouth, of full size for the cutoff')).toBe('11 %');
    expect(get('Compression ratio (Sd : throat)')).toBe('1.42 : 1');
    // exponential horn volume in closed form: (Sm - St) / m
    const m = Math.log(0.4 / 0.06) / 1.0;
    expect(Number(get('Horn air volume').replace(' L', ''))).toBeCloseTo(((0.4 - 0.06) / m) * 1000, 0);
    expect(c.warnings.some((w) => w.includes('The mouth is 11 %'))).toBe(true);
    expect(c.markers).toEqual([{ f: v0.fc, label: 'fc' }]);
    expect(c.overlays.responseDb!.map((o) => o.label)).toEqual(['plugin bin']);
    // the plugin-bin overlay is the lumped model's own vector at 100 Hz, found by interpolating the plotted curve
    const k = c.freqs.findIndex((f) => f >= 100);
    const bin = c.overlays.responseDb![0]!.values;
    const at100 = bin[k - 1]! + ((bin[k]! - bin[k - 1]!) * Math.log(100 / c.freqs[k - 1]!)) / Math.log(c.freqs[k]! / c.freqs[k - 1]!);
    expect(at100).toBeCloseTo(vec('horn_mag_100hz').outputs.db!, 2);
  });

  it('a full-size mouth raises no mouth warning; a tractrix is held to its full mouth', () => {
    const full = M.compute({ ...horn, horn: { ...horn.horn, cutoffHz: 100, mouthCm2: 9500 } });
    expect(full.warnings.some((w) => w.includes('The mouth is'))).toBe(false);
    const tr = M.compute({ ...horn, plotRange: 'high', horn: { ...horn.horn, flare: 'tractrix', cutoffHz: 600, throatCm2: 5, mouthCm2: 5000 } });
    expect(tr.readouts.find((r) => r.label === 'Mouth area')!.value).toBe('260 cm²');
    expect(tr.notes.some((n) => n.includes('cannot be larger'))).toBe(true);
    // geometry limits: a tractrix throat is held to half its full mouth; any mouth is at least 5 % larger than the throat
    const fat = M.compute({ ...horn, plotRange: 'high', horn: { ...horn.horn, flare: 'tractrix', cutoffHz: 600, throatCm2: 400, mouthCm2: 5000 } });
    expect(fat.readouts.find((r) => r.label === 'Compression ratio (Sd : throat)')!.value).toBe(`${(850 / 130.03).toFixed(2)} : 1`);
    expect(fat.notes.some((n) => n.includes('The throat is held to 130 cm²'))).toBe(true);
    expect(tr.notes.some((n) => n.includes('The throat is held'))).toBe(false);
    const pinched = M.compute({ ...horn, horn: { ...horn.horn, throatCm2: 500, mouthCm2: 100 } });
    expect(pinched.readouts.find((r) => r.label === 'Mouth area')!.value).toBe('525 cm²');
    expect(tr.horn!.lengthM).toBeCloseTo(0.0910 * Math.log((0.0910 + Math.sqrt(0.0910 ** 2 - 0.01262 ** 2)) / 0.01262) - Math.sqrt(0.0910 ** 2 - 0.01262 ** 2), 2);
  });

  it('panels: joints, the as-built simulation, the ideal overlay and the length warning', () => {
    expect(M.panelJointsCm('', 100)).toBeNull();
    expect(M.panelJointsCm('30, 30 40', 100)).toEqual([0, 30, 60, 100]);
    expect(M.panelJointsCm('30,30,30', 100)).toEqual([0, 30, 60, 90, 100]);
    expect(M.panelJointsCm('60 60', 100)).toEqual([0, 60, 100]);
    expect(M.panelJointsCm('50 49.5 5', 100)).toEqual([0, 50, 100]); // 99.5 is within 1 % of the mouth: no sliver panel
    expect(M.panelJointsCm('50 48', 100)).toEqual([0, 50, 98, 100]);
    const built = M.compute({ ...horn, horn: { ...horn.horn, panelsCm: '25 25 25 25', widthCm: 50 } });
    expect(built.horn!.table.map((r) => Math.round(r.xCm))).toEqual([0, 25, 50, 75, 100]);
    expect(built.horn!.table[2]!.areaCm2).toBeCloseTo(vec('flare_exp_area').outputs.area_m2! * 1e4, 6);
    expect(built.horn!.table[2]!.heightCm).toBeCloseTo((vec('flare_exp_area').outputs.area_m2! * 1e4) / 50, 6);
    expect(built.overlays.excursionMm!.map((o) => o.label)).toEqual(['ideal flare']);
    expect(built.overlays.responseDb!.map((o) => o.label)).toEqual(['ideal flare', 'plugin bin']);
    // four straight panels are not the curve: the simulated response differs from the ideal one somewhere, but not wildly
    const diff = built.curves.responseDb.map((v, k) => Math.abs(v - built.overlays.responseDb![0]!.values[k]!));
    expect(Math.max(...diff)).toBeGreaterThan(0.05);
    expect(built.warnings.some((w) => w.includes('panel lengths'))).toBe(false);
    expect(M.compute({ ...horn, horn: { ...horn.horn, panelsCm: '25 25' } }).warnings.some((w) => w.includes('add up to 50.0 cm') && w.includes('stretched'))).toBe(true);
    expect(M.compute({ ...horn, horn: { ...horn.horn, panelsCm: '80 80' } }).warnings.some((w) => w.includes('cut short'))).toBe(true);
    // without panels the table shows the ideal flare at eight equal stations
    expect(M.compute(horn).horn!.table.length).toBe(9);
  });

  it('plot range and the model-limit note', () => {
    expect(M.plotFreqs('low')[0]).toBe(10);
    expect(M.plotFreqs('high').at(-1)).toBeCloseTo(20000, 6);
    // ka = 1 for a 0.4 m2 mouth: c / (2 pi sqrt(0.4 / pi)) = 153 Hz
    expect(M.compute(horn).notes.some((n) => n.includes('above about 153 Hz'))).toBe(true);
    expect(M.compute({ ...M.DEFAULT_DESIGN, type: 'horn', driverClass: 7 }).notes.some((n) => n.includes('stand-in'))).toBe(true);
    expect(M.compute(horn).notes.some((n) => n.includes('stand-in'))).toBe(false);
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
    expect(M.sanitize({ type: 'bogus', driverClass: 99, volumeL: 'x', plotRange: 'mid', horn: { flare: 'spiral', t: 7, panelsCm: 5 } })).toEqual({
      ...M.DEFAULT_DESIGN,
      driverClass: M.CUSTOM_CLASS,
      horn: { ...M.DEFAULT_DESIGN.horn, t: 1 },
    });
    for (const p of M.HORN_PRESETS) expect(M.sanitize({ ...M.DEFAULT_DESIGN, ...p.patch })).toEqual({ ...M.DEFAULT_DESIGN, ...p.patch });
    const s = M.sanitize({ type: 'sealed', volumeL: 1e9, tuneHz: -5, custom: { qts: 9, fsHz: 44 } });
    expect([s.type, s.volumeL, s.tuneHz, s.custom.qts, s.custom.fsHz, s.custom.qms]).toEqual(['sealed', 1000, 10, 1.5, 44, 5]);
  });
});
