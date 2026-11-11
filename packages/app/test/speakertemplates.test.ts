// H4 pass condition: every starting point is a clean, buildable, levelled speaker; port defaults give a port that fits.
import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import * as B from '../src/buildlist';
import * as L from '../src/loudspeaker';
import * as M from '../src/model';
import * as S from '../src/system';

const asProject = (sp: L.Loudspeaker): S.Project => S.sanitizeProject({ ...S.DEFAULT_PROJECT, kind: 'speaker', speaker: sp });
const cls = (name: string): number => P.ALL_DRIVER_CLASSES.findIndex((d) => d.name === name);

describe('the starting points', () => {
  it('there are eight, with distinct names, covering desktop to floorstanding and every arrangement but WTW and TMM', () => {
    expect(L.SPEAKER_TEMPLATES).toHaveLength(8);
    expect(new Set(L.SPEAKER_TEMPLATES.map((t) => t.label)).size).toBe(8);
    expect(new Set(L.SPEAKER_TEMPLATES.map((t) => t.speaker.arrangement))).toEqual(new Set(['two-way', 'mtm', 'three-way', 'two-and-half']));
    const heights = L.SPEAKER_TEMPLATES.map((t) => t.speaker.baffleHeightCm);
    expect(Math.min(...heights)).toBeLessThan(25);
    expect(Math.max(...heights)).toBeGreaterThan(100);
  });

  L.SPEAKER_TEMPLATES.forEach((t, i) => {
    describe(t.label, () => {
      const sp = t.speaker;
      it('is a valid speaker that survives sanitising unchanged', () => {
        expect(L.sanitizeLoudspeaker(sp)).toEqual(sp);
      });
      it('has no warnings in the model and none in the build', () => {
        expect(L.computeLoudspeaker(sp).warnings).toEqual([]);
        expect(B.computeBuild(asProject(sp)).warnings).toEqual([]);
      });
      it('plays smoothly: finite everywhere, no hole in the sum at a crossover bigger than 6 dB', () => {
        const v = L.computeLoudspeaker(sp);
        expect(v.levelDb.every(Number.isFinite)).toBe(true);
        const at = (f: number): number => v.levelDb[v.freqs.findIndex((x) => x >= f)]!;
        // the first point of a 2.5-way is where the bass woofer fades out, not a crossing
        const arr = L.arrangementOf(sp.arrangement);
        const crossings = arr.kind === 'assist' ? v.xover.slice(1, 2) : v.xover.slice(0, arr.slots.length - 1);
        for (const fx of crossings) {
          const legs = Math.max(...v.slots.map((s) => s.levelDb[v.freqs.findIndex((x) => x >= fx)]!));
          expect(legs + 6 - at(fx), `${t.label} at ${fx}`).toBeLessThan(6);
        }
      });
      it('has its drivers levelled to within a tenth of a dB (unless a trim hit its limit)', () => {
        const native = L.nativeLevels({ ...sp, slots: sp.slots.map((s, k) => ({ ...s, trimDb: k < 0 ? 0 : s.trimDb })) });
        const n = L.arrangementOf(sp.arrangement).slots.length;
        const played = native.slice(0, n).map((x, k) => x + sp.slots[k]!.trimDb);
        const atLimit = sp.slots.slice(0, n).some((s) => Math.abs(s.trimDb) >= 6 - 1e-9 || s.trimDb <= -20 + 1e-9);
        if (!atLimit) for (const q of played) expect(Math.abs(q - played[0]!)).toBeLessThan(0.11);
      });
      it('every ported slot has a port that fits its chamber and is long enough to cut', () => {
        const arr = L.arrangementOf(sp.arrangement);
        arr.slots.forEach((spec, k) => {
          const d = sp.slots[k]!.design;
          if (d.type !== 'ported') return;
          expect(P.portLengthM(d.volumeL / spec.count / 1000, d.tuneHz, d.portDiameterCm / 100), `${t.label} slot ${k}`).toBeGreaterThanOrEqual(0.02 - 1e-9);
        });
      });
      it('loads through the page action, keeping the number to build and the bracing', () => {
        const mine = L.sanitizeLoudspeaker({ ...L.defaultSpeaker('wtw'), quantity: 5, brace: 'window', chambers: 'separate' });
        const loaded = L.applySpeakerTemplate(mine, i);
        expect(loaded).toEqual(L.sanitizeLoudspeaker({ ...sp, quantity: 5, brace: 'window', chambers: 'separate' }));
      });
    });
  });
});

describe('the starting points hold the numbers they say', () => {
  it('woofer air, drivers and baffles', () => {
    const got = L.SPEAKER_TEMPLATES.map((t) => [t.speaker.slots[0]!.design.volumeL, P.ALL_DRIVER_CLASSES[t.speaker.slots[0]!.design.driverClass]!.name, t.speaker.baffleWidthCm, t.speaker.baffleHeightCm, t.speaker.xover[0]]);
    expect(got).toEqual([
      [3, '4 in', 14, 22, 3000],
      [8, '5.25 in', 20, 32, 2500],
      [12, '5.25 in', 20, 36, 2500],
      [25, '8 in', 24, 95, 1800],
      [5, '4 in mid', 16, 40, 2500],
      [20, '5.25 in', 18, 100, 2500],
      [40, '10 in', 28, 110, 350],
      [8, '5.25 in', 20, 85, 300],
    ]);
    expect(L.SPEAKER_TEMPLATES[6]!.speaker.xover).toEqual([350, 3000]);
    expect(L.SPEAKER_TEMPLATES[7]!.speaker.xover).toEqual([300, 2500]);
  });
});

describe('levelling', () => {
  it('brings every driver to the quietest one, which stays at 0 dB', () => {
    const sp = L.defaultSpeaker('three-way');
    const lev = L.levelSpeaker({ ...sp, slots: sp.slots.map((s) => ({ ...s, trimDb: 3 })) }); // old trims are ignored
    const native = L.nativeLevels(lev);
    const played = native.map((x, k) => x + lev.slots[k]!.trimDb);
    for (const q of played) expect(Math.abs(q - played[0]!)).toBeLessThan(0.11);
    expect(Math.min(...lev.slots.map((s) => s.trimDb))).toBe(Math.min(...lev.slots.map((s) => s.trimDb)));
    expect(lev.slots.some((s) => s.trimDb === 0)).toBe(true);
    expect(lev.slots.every((s) => s.trimDb <= 0)).toBe(true);
  });
  it('a slot with no passband is left alone', () => {
    const sp = L.sanitizeLoudspeaker({ ...L.defaultSpeaker('three-way'), xover: [20000 / 1.3, 8000] });
    expect(() => L.levelSpeaker(sp)).not.toThrow();
  });
  it('the native level is the box response over the range the driver plays, from 200 Hz to 12 kHz', () => {
    const sp = L.defaultSpeaker('two-way');
    const ev = L.loudspeakerEvaluator(sp);
    const want = (k: number, lo: number, hi: number): number => {
      const xs = L.SPEAKER_FREQS.filter((f) => f >= lo && f <= hi).map((f) => P.splDb(P.abs(ev.slots[k]!.box(f))));
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    const n = L.nativeLevels(sp);
    expect(n[0]).toBeCloseTo(want(0, 200, 2500), 9);
    expect(n[1]).toBeCloseTo(want(1, 2500, 12000), 9);
    expect(ev.slots.map((x) => [x.bottomHz, x.topHz])).toEqual([[0, 2500], [2500, Infinity]]);
  });
  it('the 2.5-way: the bass woofer plays up to the first crossover, the main woofer to the second, the tweeter above it', () => {
    const ev = L.loudspeakerEvaluator(L.defaultSpeaker('two-and-half'));
    expect(ev.slots.map((x) => [x.bottomHz, x.topHz])).toEqual([[0, 300], [0, 2500], [2500, Infinity]]);
  });
});

describe('port defaults', () => {
  const woofer = (name: string, volumeL: number): M.Design => ({ ...M.DEFAULT_DESIGN, driverClass: cls(name), volumeL, type: 'ported' });
  it('tune at Fs (Vas/Vb)^0.31 and use a port half the cone across', () => {
    const d = woofer('8 in', 25);
    const dr = P.ALL_DRIVER_CLASSES[cls('8 in')]!;
    const got = L.portedDefaults(d);
    expect(got.tuneHz).toBe(Math.round(dr.fs * (dr.vasM3 / 0.025) ** 0.31));
    expect(got.portDiameterCm).toBeCloseTo(Math.round(L.coneDiameterM(dr.sd) * 50 * 10) / 10, 6);
  });
  it('a chamber shared by two drivers gives each half the air', () => {
    const one = L.portedDefaults(woofer('5.25 in', 6), 1);
    const two = L.portedDefaults(woofer('5.25 in', 12), 2);
    expect(two).toEqual(one);
  });
  it('a port too narrow for its chamber has no length, so it is widened until the tube can be cut', () => {
    const got = L.portedDefaults(woofer('3 in', 900));
    expect(got.portDiameterCm).toBeGreaterThan(L.coneDiameterM(P.ALL_DRIVER_CLASSES[cls('3 in')]!.sd) * 50); // wider than half the cone
    expect(got).toEqual({ tuneHz: 15, portDiameterCm: 8.4 }); // the widening steps are 15 % plus a millimetre
    expect(L.portedDefaults(woofer('4 in', 300))).toEqual({ tuneHz: 24, portDiameterCm: 7.8 });
    expect(P.portLengthM(0.9, got.tuneHz, got.portDiameterCm / 100)).toBeGreaterThanOrEqual(0.02);
    // a chamber that suits the driver keeps the full half-cone port
    const fine = L.portedDefaults(woofer('8 in', 25));
    expect(fine.portDiameterCm).toBeCloseTo(8.3, 6);
    expect(P.portLengthM(0.025, fine.tuneHz, fine.portDiameterCm / 100)).toBeGreaterThanOrEqual(0.02);
  });
  it('widening stops at the widest port the page allows', () => {
    const custom: M.Design = { ...M.DEFAULT_DESIGN, driverClass: M.CUSTOM_CLASS, custom: { ...M.DEFAULT_DESIGN.custom, sdCm2: 15, fsHz: 20, vasL: 1 }, volumeL: 1000, type: 'ported' };
    expect(L.portedDefaults(custom).portDiameterCm).toBeLessThanOrEqual(M.BOX_RANGES.portDiameterCm.max);
    expect(L.portedDefaults({ ...custom, volumeL: 20 }).portDiameterCm).toBeLessThan(M.BOX_RANGES.portDiameterCm.max);
  });
  it('the tuning stays in the allowed range', () => {
    for (const c of P.ALL_DRIVER_CLASSES) for (const v of [0.2, 5, 100, 900]) {
      const t = L.portedDefaults({ ...M.DEFAULT_DESIGN, driverClass: cls(c.name), volumeL: v, type: 'ported' }).tuneHz;
      expect(t).toBeGreaterThanOrEqual(M.BOX_RANGES.tuneHz.min);
      expect(t).toBeLessThanOrEqual(M.BOX_RANGES.tuneHz.max);
    }
  });
});
