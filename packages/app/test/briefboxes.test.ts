// Milestone B: the Ollama brief offers the new box types. The model names the part (and for a 6th- or 8th-order band-pass the passband and
// layout); the app sizes the chambers, ports and lines with the same code the pages use. Strict validation, the schema, the prompts.
import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import * as B from '../src/brief';
import * as H from '../src/briefhome';
import * as M from '../src/model';

type Obj = Record<string, any>;

const raw = (more: Obj = {}): Obj => ({ driver: '15 in', type: 'ported', volumeL: 100, tuneHz: 40, portDiameterCm: 12, frontVolumeL: 10, passbandLoHz: 40, passbandHiHz: 80, layout: 'vented', ...more });
const ok = (more: Obj = {}): M.Design => {
  const v = B.validateDesign(raw(more), 'd', false);
  expect(v.errors).toEqual([]);
  return v.value!;
};
const bad = (more: Obj): string[] => B.validateDesign(raw(more), 'd', false).errors;
const base = { ...M.DEFAULT_DESIGN, driverClass: P.ALL_DRIVER_CLASSES.findIndex((d) => d.name === '15 in') };

describe('the validator takes the new types', () => {
  it('passive: the box air and tuning are the model\'s, the radiator copies the driver, QL 7', () => {
    const d = ok({ type: 'passive', volumeL: 80, tuneHz: 38 });
    expect(d.type).toBe('passive');
    expect([d.volumeL, d.tuneHz, d.qL]).toEqual([80, 38, 7]);
    expect(d.pr).toEqual(M.DEFAULT_DESIGN.pr);
    expect(bad({ type: 'passive', tuneHz: 1 }).some((e) => e.includes('d.tuneHz'))).toBe(true);
    expect(bad({ type: 'passive', volumeL: undefined }).some((e) => e.includes('d.volumeL'))).toBe(true);
  });

  it('6th order: the app sizes the box for the passband named, with ports that fit', () => {
    const d = ok({ type: 'bandpass6', passbandLoHz: 35, passbandHiHz: 70 });
    const want = M.bandpassStart(base, 'bandpass6', 1, { loHz: 35, hiHz: 70 });
    expect(d.type).toBe('bandpass6');
    expect(d.volumeL).toBe(want.volumeL);
    expect(d.frontVolumeL).toBe(want.frontVolumeL);
    expect(d.tuneHz).toBe(want.tuneHz);
    expect(d.bp6.rearTuneHz).toBe(want.bp6!.rearTuneHz);
    expect([d.bp6.loHz, d.bp6.hiHz]).toEqual([35, 70]);
    expect(M.portLengthOf(d, d.frontVolumeL)).toBeGreaterThan(0);
    expect(M.bp6RearPortLengthM(d)).toBeGreaterThan(0);
    // the model's own volume, tuning and port numbers are ignored for this type
    expect(ok({ type: 'bandpass6', passbandLoHz: 35, passbandHiHz: 70, volumeL: 5, tuneHz: 150 }).volumeL).toBe(d.volumeL);
  });

  it('8th order: the layout is the model\'s, the sizing the helper\'s for that layout', () => {
    for (const layout of ['vented', 'chain', 'sealed'] as const) {
      const d = ok({ type: 'bandpass8', passbandLoHz: 40, passbandHiHz: 90, layout });
      const want = M.bandpassStart({ ...base, bp8: { ...base.bp8, layout } }, 'bandpass8', 1, { loHz: 40, hiHz: 90 });
      expect(d.bp8.layout).toBe(layout);
      expect(d.volumeL).toBe(want.volumeL);
      expect(d.bp8.innerVolumeL).toBe(want.bp8!.innerVolumeL);
      expect(d.frontVolumeL).toBe(want.frontVolumeL);
    }
  });

  it('transmission line and TQWT: sized by the app from the driver alone', () => {
    const line = ok({ type: 'tline', volumeL: 7 });
    expect(line.tl).toEqual(M.tlSettingsFor(M.driverOf(base), 'taper', 'extended', 'acousta'));
    const tq = ok({ type: 'tqwt', volumeL: 7 });
    expect(tq.tl).toEqual(M.tqwtSettingsFor(M.driverOf(base)));
    expect(tq.plotRange).toBe('low');
  });

  it('rejects what is wrong, naming the field', () => {
    expect(bad({ type: 'bandpass6', passbandLoHz: undefined }).some((e) => e.includes('d.passbandLoHz'))).toBe(true);
    expect(bad({ type: 'bandpass6', passbandHiHz: undefined }).some((e) => e.includes('d.passbandHiHz'))).toBe(true);
    expect(bad({ type: 'bandpass6', passbandLoHz: 1 }).some((e) => e.includes('d.passbandLoHz') && e.includes('below the minimum 15'))).toBe(true);
    expect(bad({ type: 'bandpass6', passbandLoHz: 60, passbandHiHz: 65 }).some((e) => e.includes('at least 1.2 times passbandLoHz'))).toBe(true);
    expect(bad({ type: 'bandpass8', layout: 'nonsense' }).some((e) => e.includes('d.layout: expected one of "vented", "chain", "sealed"'))).toBe(true);
    // the passband and layout are only checked for the types that use them
    expect(B.validateDesign(raw({ type: 'ported', passbandLoHz: 'x', layout: 'y' }), 'd', false).ok).toBe(true);
    expect(B.validateDesign(raw({ type: 'bandpass6', layout: 'y' }), 'd', false).ok).toBe(true);
  });

  it('a type outside the allowed list is rejected', () => {
    const errs = B.validateDesign(raw({ type: 'bandpass6' }), 'd', false, { types: ['sealed', 'ported'] }).errors;
    expect(errs.some((e) => e.includes('d.type: expected one of "sealed", "ported"'))).toBe(true);
  });
});

describe('the schema and prompts', () => {
  it('ask for the passband and layout of a 6th- or 8th-order box on every list that allows one, and not otherwise', () => {
    const pa = B.designSchema(false) as { properties: Record<string, any>; required: string[] };
    expect(pa.required).toEqual(expect.arrayContaining(['passbandLoHz', 'passbandHiHz', 'layout']));
    expect(pa.properties.passbandLoHz).toEqual({ type: 'number', minimum: M.BP6_RANGES.loHz.min, maximum: M.BP6_RANGES.loHz.max });
    expect(pa.properties.passbandHiHz).toEqual({ type: 'number', minimum: M.BP6_RANGES.hiHz.min, maximum: M.BP6_RANGES.hiHz.max });
    expect(pa.properties.layout.enum).toEqual(['vented', 'chain', 'sealed']);
    const six = B.designSchema(false, { types: ['sealed', 'bandpass6'] }) as { properties: Record<string, any>; required: string[] };
    expect(six.required).toEqual(expect.arrayContaining(['passbandLoHz', 'passbandHiHz']));
    expect(six.required).not.toContain('layout');
    expect(six.properties.layout).toBeUndefined();
    const sp = H.speakerSchema() as Obj;
    expect(sp.properties.slots.items.required).not.toContain('passbandLoHz');
    expect(sp.properties.slots.items.properties.layout).toBeUndefined();
    const car = H.carSchema() as Obj;
    expect(car.properties.sub.required).toEqual(expect.arrayContaining(['passbandLoHz', 'passbandHiHz', 'layout']));
  });

  it('the prompts name the new types and fields', () => {
    for (const mode of ['box', 'system'] as const) {
      const p = B.systemPrompt(mode);
      for (const w of ['"passive"', '"bandpass6"', '"bandpass8"', '"tline"', '"tqwt"', 'passbandLoHz', 'passbandHiHz', '"chain"']) expect(p).toContain(w);
    }
    expect(H.speakerPrompt()).toContain('"passive"');
    expect(H.speakerPrompt()).toContain('passive radiator');
    const car = H.carPrompt();
    for (const w of ['"bandpass6"', '"bandpass8"', '"passive"', 'passbandLoHz', '30 to 60 Hz']) expect(car).toContain(w);
  });

  it('the examples in the prompts satisfy their own schema (they carry every always-required field)', () => {
    const pa = B.designSchema(true) as { required: string[] };
    const prompt = B.systemPrompt('box');
    const ex = JSON.parse(prompt.slice(prompt.indexOf('{"label":"Example"'))) as Obj;
    for (const k of pa.required) expect(ex[k]).toBeDefined();
  });

  it('metrics work for every new type', () => {
    for (const type of ['passive', 'bandpass6', 'bandpass8', 'tline', 'tqwt'] as const) {
      const m = B.boxMetricsOf(ok({ type }));
      expect(m.readouts.length).toBeGreaterThan(0);
      expect(Number.isFinite(m.volumeL)).toBe(true);
      expect(Number.isFinite(m.sheets)).toBe(true);
    }
  });
});

const sub = (more: Obj): Obj => ({ driver: '12 in car sub', type: 'sealed', volumeL: 40, tuneHz: 40, portDiameterCm: 10, frontVolumeL: 20, passbandLoHz: 30, passbandHiHz: 60, layout: 'vented', count: 1, series: 1, coils: 2, coilSeries: 1, ...more });
const carRaw = (s: Obj): Obj => ({
  label: 'Trunk sub',
  note: 'A band-pass.',
  cabin: 'sedan',
  sub: s,
  amp: { powerW: 500, loadOhm: 1, minLoadOhm: 1, bridged: false, class: 'd', subsonicHz: 25 },
  supply: { supplyV: 13.8, cableAwg: 4, cableM: 5, duty: 0.125, alternatorA: 120, otherLoadsA: 40 },
  space: { id: 'trunk-full', shape: 'box', taper: 0.5 },
  front: { enabled: false },
});

describe('a car brief with the new types', () => {
  it('a 6th-order sub is sized for one sub and the install\'s air is that times the count', () => {
    const one = H.validateCar(carRaw(sub({ type: 'bandpass6' })));
    const three = H.validateCar(carRaw(sub({ type: 'bandpass6', count: 3 })));
    expect(one.errors).toEqual([]);
    expect(three.errors).toEqual([]);
    const a = one.value!.car.design;
    const b = three.value!.car.design;
    expect(a.type).toBe('bandpass6');
    expect(b.volumeL / a.volumeL).toBeCloseTo(3, 1);
    expect(b.frontVolumeL / a.frontVolumeL).toBeCloseTo(3, 1);
    expect(b.tuneHz).toBe(a.tuneHz);
    expect(b.bp6.rearTuneHz).toBe(a.bp6.rearTuneHz);
  });

  it('an 8th-order sub scales its inner chamber too, and keeps the layout', () => {
    const one = H.validateCar(carRaw(sub({ type: 'bandpass8', layout: 'chain' }))).value!.car.design;
    const two = H.validateCar(carRaw(sub({ type: 'bandpass8', layout: 'chain', count: 2 }))).value!.car.design;
    expect(two.bp8.layout).toBe('chain');
    expect(two.bp8.innerVolumeL / one.bp8.innerVolumeL).toBeCloseTo(2, 1);
    expect(two.volumeL / one.volumeL).toBeCloseTo(2, 1);
  });

  it('a passive sub keeps the whole-install air the model gave; a sealed sub is not scaled', () => {
    const p = H.validateCar(carRaw(sub({ type: 'passive', volumeL: 70, tuneHz: 35, count: 2 }))).value!.car.design;
    expect([p.type, p.volumeL, p.tuneHz]).toEqual(['passive', 70, 35]);
    expect(H.validateCar(carRaw(sub({ count: 2 }))).value!.car.design.volumeL).toBe(40);
  });

  it('a TQWT or a transmission line sub is rejected: the car has no room for one', () => {
    for (const type of ['tqwt', 'tline', 'horn']) expect(H.validateCar(carRaw(sub({ type }))).errors.some((e) => e.includes('sub.type: expected one of'))).toBe(true);
  });

  it('what it makes is accepted by the calculators', () => {
    for (const type of ['bandpass6', 'bandpass8', 'passive'] as const) {
      const c = H.validateCar(carRaw(sub({ type, count: 2 }))).value!.car;
      const m = H.carMetricsOf(c);
      expect(Number.isFinite(m.levelDb)).toBe(true);
      expect(Number.isFinite(m.sheets)).toBe(true);
    }
  });
});

const spk = (slot0: Obj): Obj => ({
  label: 'Bookshelf',
  note: 'A passive-radiator two-way.',
  arrangement: 'two-way',
  baffleWidthCm: 20,
  baffleHeightCm: 34,
  xoverHz: [2500],
  chambers: 'shared',
  baffleStep: true,
  quantity: 2,
  slots: [{ driver: '5.25 in', type: 'sealed', volumeL: 8, tuneHz: 50, portDiameterCm: 5, open: false, ...slot0 }, { driver: '1 in dome', type: 'sealed', volumeL: 0.5, tuneHz: 50, portDiameterCm: 5, open: false }],
});

describe('a speaker brief with the passive radiator', () => {
  it('a passive woofer slot is accepted, and builds with its radiator', () => {
    const v = H.validateSpeaker(spk({ type: 'passive', volumeL: 6, tuneHz: 45 }));
    expect(v.errors).toEqual([]);
    const d = v.value!.speaker.slots[0]!.design;
    expect([d.type, d.volumeL, d.tuneHz]).toEqual(['passive', 6, 45]);
    const m = H.speakerMetricsOf(v.value!.speaker);
    expect(Number.isFinite(m.sensitivityDb)).toBe(true);
  });

  it('a tweeter slot may not be passive, and a band-pass woofer is still rejected', () => {
    const bt = spk({});
    (bt.slots as Obj[])[1]!.type = 'passive';
    expect(H.validateSpeaker(bt).errors.some((e) => e.includes('slots[1].type: expected one of "sealed"'))).toBe(true);
    expect(H.validateSpeaker(spk({ type: 'bandpass6' })).errors.some((e) => e.includes('slots[0].type: expected one of "sealed", "ported", "passive"'))).toBe(true);
  });
});
