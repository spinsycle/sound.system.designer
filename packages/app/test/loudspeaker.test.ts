// H2 pass condition: a speaker's response is the spec's chain (legs, baffle step, group volume) and nothing else; old projects are unchanged.
import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import * as L from '../src/loudspeaker';
import * as M from '../src/model';
import * as S from '../src/system';

const dbOf = (c: P.Cx): number => P.splDb(P.abs(c));
const cls = (name: string): number => P.ALL_DRIVER_CLASSES.findIndex((d) => d.name === name);

describe('the arrangements', () => {
  it('every arrangement is well formed: slots low to high, the layout names each driver once', () => {
    for (const a of L.ARRANGEMENTS) {
      expect(a.slots[a.slots.length - 1]!.role, a.id).toBe('tweeter');
      expect(a.layout.length, a.id).toBe(a.slots.reduce((n, s) => n + s.count, 0));
      a.slots.forEach((s, k) => expect(a.layout.filter((x) => x === k).length, `${a.id} slot ${k}`).toBe(s.count));
      expect(a.xover.length, a.id).toBe(a.slots.length - 1);
    }
    expect(L.ARRANGEMENTS.map((a) => a.id)).toEqual(['two-way', 'mtm', 'wtw', 'tmm', 'three-way', 'two-and-half']);
  });
  it('an unknown arrangement falls back to the 2-way', () => {
    expect(L.arrangementOf('nope' as L.ArrangementId).id).toBe('two-way');
    expect(L.sanitizeLoudspeaker({ arrangement: 'nope' }).arrangement).toBe('two-way');
  });
});

describe('sanitise', () => {
  it('garbage becomes the default; numbers are clamped; always three slots', () => {
    expect(L.sanitizeLoudspeaker(null)).toEqual(L.defaultSpeaker());
    expect(L.sanitizeLoudspeaker('x')).toEqual(L.defaultSpeaker());
    const s = L.sanitizeLoudspeaker({ baffleWidthCm: 1e6, baffleHeightCm: -5, xover: [1, 1e9], slots: [{ backCm: 99, trimDb: -99, open: 1, invert: 'y' }], chambers: 'x', baffleStep: 0 });
    expect(s.baffleWidthCm).toBe(80);
    expect(L.SPEAKER_RANGES.baffleHeightCm.max).toBe(200);
    expect(s.baffleHeightCm).toBe(L.SPEAKER_RANGES.baffleHeightCm.min);
    expect(s.xover).toEqual([L.SPEAKER_XOVER_RANGE.min, L.SPEAKER_XOVER_RANGE.max]);
    expect(s.slots).toHaveLength(3);
    expect([s.slots[0]!.backCm, s.slots[0]!.trimDb, s.slots[0]!.open, s.slots[0]!.invert]).toEqual([30, -20, false, false]);
    expect(s.chambers).toBe('shared');
    expect(s.baffleStep).toBe(true); // only an explicit false turns it off
    expect(L.sanitizeLoudspeaker({ baffleStep: false }).baffleStep).toBe(false);
    expect(L.sanitizeLoudspeaker({ chambers: 'separate' }).chambers).toBe('separate');
    expect(L.sanitizeLoudspeaker({ quantity: 99 }).quantity).toBe(8);
    expect(L.sanitizeLoudspeaker({ quantity: 0 }).quantity).toBe(1);
    expect(L.sanitizeLoudspeaker({ quantity: 3.4 }).quantity).toBe(3);
    expect(L.sanitizeLoudspeaker({ brace: 'window' }).brace).toBe('window');
    expect(L.sanitizeLoudspeaker({ brace: 'x' }).brace).toBe('none');
    expect(L.sanitizeLoudspeaker({ slots: [{ open: true, invert: true }] }).slots[0]).toMatchObject({ open: true, invert: true });
  });
  it('changing the arrangement keeps the drivers and restarts the crossovers', () => {
    const a = L.defaultSpeaker();
    a.slots[0]!.design = { ...a.slots[0]!.design, volumeL: 11 };
    const b = L.applyArrangement({ ...a, xover: [999, 999] }, 'three-way');
    expect(b.arrangement).toBe('three-way');
    expect(b.slots[0]!.design.volumeL).toBe(11);
    expect(b.xover).toEqual([400, 3000]);
    expect(L.applyArrangement(a, 'mtm').xover).toEqual([2500, 3000]);
  });
});

describe('arrangement defaults and switching', () => {
  const names = (sp: L.Loudspeaker): string[] => sp.slots.map((x) => P.ALL_DRIVER_CLASSES[x.design.driverClass]!.name);
  it('each role starts with a driver that suits it, and air for all its drivers', () => {
    expect(names(L.defaultSpeaker('two-way')).slice(0, 2)).toEqual(['5.25 in', '1 in dome']);
    expect(names(L.defaultSpeaker('mtm')).slice(0, 2)).toEqual(['4 in mid', '1 in dome']);
    expect(names(L.defaultSpeaker('three-way'))).toEqual(['8 in', '4 in mid', '1 in dome']);
    expect(L.defaultSpeaker('wtw').slots[0]!.design.volumeL).toBe(16);
    expect(L.defaultSpeaker('mtm').slots[0]!.design.volumeL).toBe(4);
    expect(L.defaultSpeaker('three-way').slots[0]!.design.volumeL).toBe(25);
    for (const a of L.ARRANGEMENTS) expect(L.computeLoudspeaker(L.defaultSpeaker(a.id)).warnings, a.id).toEqual([]);
  });
  it('the baffle and crossovers restart at the new arrangement, as do the slots whose role changed', () => {
    const a = L.defaultSpeaker('two-way');
    a.slots[0]!.design = { ...a.slots[0]!.design, driverClass: cls('6.5 in'), volumeL: 13 };
    const b = L.applyArrangement(L.sanitizeLoudspeaker({ ...a, baffleWidthCm: 33 }), 'three-way');
    expect(b.slots[0]!.design.driverClass).toBe(cls('6.5 in')); // woofer stays a woofer
    expect(b.slots[0]!.design.volumeL).toBe(13);
    expect(P.ALL_DRIVER_CLASSES[b.slots[1]!.design.driverClass]!.name).toBe('4 in mid'); // the tweeter is not the midrange now
    expect(P.ALL_DRIVER_CLASSES[b.slots[2]!.design.driverClass]!.name).toBe('1 in dome');
    expect([b.baffleWidthCm, b.baffleHeightCm]).toEqual([26, 85]);
    const back = L.applyArrangement(b, 'two-way');
    expect(P.ALL_DRIVER_CLASSES[back.slots[1]!.design.driverClass]!.name).toBe('1 in dome');
    expect(back.slots[0]!.design.volumeL).toBe(13);
  });
  it('the 2.5-way names its two woofers apart', () => {
    expect(L.computeLoudspeaker(L.defaultSpeaker('two-and-half')).slots.map((x) => x.name)).toEqual(['Bass woofer', 'Main woofer', 'Tweeter']);
    expect(new Set(L.ARRANGEMENTS.flatMap((a) => [new Set(a.slots.map((_, k) => L.slotLabel(a, k))).size === a.slots.length])).size).toBe(1);
  });
});

describe('the response is the spec chain', () => {
  // the shared vector speaker_2way_*: woofer sealed 10 L, dome sealed 0.5 L, LR4 2.5 kHz, tweeter -3 dB and 0.02 m back, 0.2 m baffle
  const sp = (): L.Loudspeaker => {
    const d = L.defaultSpeaker('two-way');
    d.slots[0]!.design = { ...d.slots[0]!.design, driverClass: cls('5.25 in'), volumeL: 10 };
    d.slots[1]!.design = { ...d.slots[1]!.design, driverClass: cls('1 in dome'), volumeL: 0.5 };
    d.slots[1]!.trimDb = -3;
    d.slots[1]!.backCm = 2;
    d.baffleWidthCm = 20;
    d.xover = [2500, 3000];
    return L.sanitizeLoudspeaker(d);
  };
  it('equals legs x box response x trim, summed with the depth delay, times the baffle step', () => {
    const s = sp();
    const ev = L.loudspeakerEvaluator(s);
    for (const f of [150, 500, 2500, 8000]) {
      const legs = P.crossoverBands(f, [2500]);
      const dw = M.driverOf(s.slots[0]!.design);
      const dt = M.driverOf(s.slots[1]!.design);
      const pw = P.scale(P.mul(legs[0]!, M.rawEvaluator(s.slots[0]!.design)(f).g), P.referencePressure(dw, M.REF_VOLTS));
      const pt = P.scale(P.mul(legs[1]!, M.rawEvaluator(s.slots[1]!.design)(f).g), P.referencePressure(dt, M.REF_VOLTS) * 10 ** (-3 / 20));
      const sum = P.systemPressure(f, [{ pressure: pw, delayS: 0 }, { pressure: pt, delayS: 0.02 / P.C }]);
      const want = P.mul(sum, P.baffleStepShelf(f, 0.2));
      expect(dbOf(ev.total(f))).toBeCloseTo(dbOf(want), 9);
    }
  });
  it('the baffle step switch changes only the bass, by 6 dB at the bottom', () => {
    const on = L.loudspeakerEvaluator(sp());
    const off = L.loudspeakerEvaluator({ ...sp(), baffleStep: false });
    expect(dbOf(on.total(30)) - dbOf(off.total(30))).toBeCloseTo(-6.02, 1);
    expect(Math.abs(dbOf(on.total(15000)) - dbOf(off.total(15000)))).toBeLessThan(0.05);
  });
  it('trim and polarity act on their slot only', () => {
    const s = sp();
    const base = L.loudspeakerEvaluator(s).slots[1]!.played(8000);
    const trimmed = L.loudspeakerEvaluator({ ...s, slots: [s.slots[0]!, { ...s.slots[1]!, trimDb: -9 }, s.slots[2]!] }).slots[1]!.played(8000);
    expect(dbOf(trimmed) - dbOf(base)).toBeCloseTo(-6, 6);
    const inv = L.loudspeakerEvaluator({ ...s, slots: [s.slots[0]!, { ...s.slots[1]!, invert: true }, s.slots[2]!] }).slots[1]!.played(8000);
    expect(inv.re).toBeCloseTo(-base.re, 9);
    expect(inv.im).toBeCloseTo(-base.im, 9);
  });
});

describe('woofer groups (MTM, WTW)', () => {
  const grouped = (id: L.ArrangementId): L.Loudspeaker => {
    const s = L.defaultSpeaker(id);
    s.slots[0]!.design = { ...s.slots[0]!.design, volumeL: 20 };
    return L.sanitizeLoudspeaker(s);
  };
  it('two matched drivers in 20 L equal one in 10 L, 6 dB louder, below the crossover', () => {
    const two = L.loudspeakerEvaluator({ ...grouped('wtw'), baffleStep: false });
    const one = L.defaultSpeaker('two-way');
    one.slots[0]!.design = { ...one.slots[0]!.design, volumeL: 10 };
    const oneEv = L.loudspeakerEvaluator({ ...L.sanitizeLoudspeaker(one), baffleStep: false });
    for (const f of [60, 100, 400]) expect(dbOf(two.total(f)) - dbOf(oneEv.total(f))).toBeCloseTo(20 * Math.log10(2), 1);
  });
  it('a band-pass pair halves both chambers, not only the rear one', () => {
    const bp = (n: 1 | 2, rear: number, front: number): number => {
      const s = L.defaultSpeaker(n === 2 ? 'wtw' : 'two-way');
      s.slots[0]!.design = { ...s.slots[0]!.design, type: 'bandpass', volumeL: rear, frontVolumeL: front, tuneHz: 80 };
      return dbOf(L.loudspeakerEvaluator({ ...L.sanitizeLoudspeaker(s), baffleStep: false }).total(80));
    };
    expect(bp(2, 20, 30) - bp(1, 10, 15)).toBeCloseTo(20 * Math.log10(2), 1);
  });
  it('shared and separate chambers give the same response', () => {
    const a = L.loudspeakerEvaluator(grouped('mtm'));
    const b = L.loudspeakerEvaluator({ ...grouped('mtm'), chambers: 'separate' });
    for (const f of [80, 800, 5000]) expect(dbOf(a.total(f))).toBe(dbOf(b.total(f)));
  });
  it('the slot is named for its count', () => {
    expect(L.slotName('woofer', 2)).toBe('2 Woofers');
    expect(L.slotName('tweeter', 1)).toBe('Tweeter');
    expect(L.slotName('mid', 1)).toBe('Midrange');
  });
});

describe('the 2.5-way', () => {
  it('slot 0 plays only below the first crossover; slot 1 carries on to the second', () => {
    const ev = L.loudspeakerEvaluator(L.defaultSpeaker('two-and-half'));
    const [a, b, t] = ev.slots;
    expect(P.abs(a!.leg(5000))).toBeLessThan(0.01);
    expect(P.abs(b!.leg(1000))).toBeGreaterThan(0.95);
    expect(P.abs(a!.leg(100))).toBeGreaterThan(0.95);
    expect(P.abs(t!.leg(100))).toBeLessThan(0.01);
    // woofer 2 and the tweeter are a plain 2-way at the second crossover
    const two = P.crossoverBands(2500, [2500]);
    expect(P.abs(b!.leg(2500))).toBeCloseTo(P.abs(two[0]!), 9);
    expect(P.abs(t!.leg(2500))).toBeCloseTo(P.abs(two[1]!), 9);
  });
});

describe('open-baffle drivers', () => {
  it('a planar tweeter without a box is a high-pass at its own Fs', () => {
    const s = L.defaultSpeaker('two-way');
    s.slots[1]!.design = { ...s.slots[1]!.design, driverClass: cls('Planar tweeter') };
    s.slots[1]!.open = true;
    const ev = L.loudspeakerEvaluator(L.sanitizeLoudspeaker(s));
    const d = P.ALL_DRIVER_CLASSES[cls('Planar tweeter')]!;
    expect(P.abs(ev.slots[1]!.g(d.fs))).toBeCloseTo(P.deriveDriver(d).qts, 9);
    expect(P.abs(ev.slots[1]!.g(d.fs * 20))).toBeCloseTo(1, 2);
  });
});

describe('warnings and numbers', () => {
  it('the default bookshelf is clean and has a sensible sensitivity', () => {
    const v = L.computeLoudspeaker(L.defaultSpeaker());
    expect(v.warnings).toEqual([]);
    expect(v.levelDb).toHaveLength(L.SPEAKER_FREQS.length);
    expect(v.levelDb.every(Number.isFinite)).toBe(true);
    expect(v.stepHz).toBeCloseTo(575, 6);
    expect(v.sensitivityDb).toBeGreaterThan(60);
    expect(v.sensitivityDb).toBeLessThan(110);
    expect(v.slots.map((x) => x.name)).toEqual(['Woofer', 'Tweeter']);
  });
  it('a tweeter crossed under twice its resonance, a beaming woofer and a too-narrow baffle are each flagged', () => {
    const low = L.sanitizeLoudspeaker({ ...L.defaultSpeaker(), xover: [1500, 3000] });
    expect(L.computeLoudspeaker(low).warnings.some((w) => w.includes('under twice'))).toBe(true);
    expect(L.computeLoudspeaker(L.defaultSpeaker()).warnings.some((w) => w.includes('under twice'))).toBe(false);
    const big = L.defaultSpeaker();
    big.slots[0]!.design = { ...big.slots[0]!.design, driverClass: cls('10 in') };
    expect(L.computeLoudspeaker(L.sanitizeLoudspeaker(big)).warnings.some((w) => w.includes('narrow its beam'))).toBe(true);
    expect(L.computeLoudspeaker(L.sanitizeLoudspeaker({ ...big, baffleWidthCm: 8 })).warnings.some((w) => w.includes('does not fit'))).toBe(true);
  });
  it('crossovers closer than 1.2x are moved and said so; the step off gives no step note', () => {
    const v = L.computeLoudspeaker(L.sanitizeLoudspeaker({ ...L.defaultSpeaker('three-way'), xover: [1000, 1100] }));
    expect(v.xover[1]).toBeCloseTo(1200, 6);
    expect(v.notes.some((n) => n.includes('Crossover 2 is used at'))).toBe(true);
    const off = L.computeLoudspeaker({ ...L.defaultSpeaker(), baffleStep: false });
    expect(off.stepHz).toBe(0);
    expect(off.notes.some((n) => n.includes('Baffle step'))).toBe(false);
  });
  it('cone diameter and ka follow the formulas', () => {
    expect(L.coneDiameterM(Math.PI * 0.05 ** 2)).toBeCloseTo(0.1, 12);
    expect(L.kaOf(P.C / Math.PI, 1)).toBeCloseTo(1, 12);
  });
});

describe('old projects are unchanged (golden check)', () => {
  it('every template gives the same system response with or without a speaker in the project', () => {
    S.TEMPLATES.forEach((_, i) => {
      const a = S.applyTemplate(S.DEFAULT_PROJECT, i);
      const b = S.sanitizeProject({ ...a, kind: 'speaker', speaker: L.defaultSpeaker('three-way') });
      expect(S.computeSystem(b).levelDb).toEqual(S.computeSystem(a).levelDb);
    });
  });
  it('a project without the new fields opens as a system with the default speaker', () => {
    const { kind, speaker, ...old } = S.DEFAULT_PROJECT;
    void kind;
    void speaker;
    const p = S.sanitizeProject(old);
    expect(p.kind).toBe('system');
    expect(p.speaker).toEqual(L.defaultSpeaker());
    expect(S.sanitizeProject({ ...old, kind: 'speaker' }).kind).toBe('speaker');
  });
});
