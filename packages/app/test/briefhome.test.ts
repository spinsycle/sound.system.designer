// v1.4: the brief for a home speaker and a car install. Out-of-range, wrongly typed or inconsistent model output is rejected by
// the validator (one test per rule); a valid answer becomes a design the calculators accept; the ask-validate-retry path works.
import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import * as B from '../src/brief';
import * as H from '../src/briefhome';
import * as L from '../src/loudspeaker';
import * as C from '../src/carsub';
import * as F from '../src/carfront';
import { FLAVOURS } from '../src/brief';
import { designVariant, MAX_ATTEMPTS } from '../src/ollama';

type Obj = Record<string, any>;

const speaker = (): Obj => ({
  label: 'Bookshelf',
  note: 'A sealed two-way.',
  arrangement: 'two-way',
  baffleWidthCm: 20,
  baffleHeightCm: 34,
  xoverHz: [2500],
  chambers: 'shared',
  baffleStep: true,
  quantity: 2,
  slots: [
    { driver: '5.25 in', type: 'sealed', volumeL: 8, tuneHz: 50, portDiameterCm: 5, open: false },
    { driver: '1 in dome', type: 'sealed', volumeL: 0.5, tuneHz: 50, portDiameterCm: 5, open: false },
  ],
});

const car = (): Obj => ({
  label: 'Trunk sub',
  note: 'One 12 in sealed.',
  cabin: 'sedan',
  sub: { driver: '12 in car sub', type: 'sealed', volumeL: 40, tuneHz: 40, portDiameterCm: 10, frontVolumeL: 20, count: 1, series: 1, coils: 2, coilSeries: 1 },
  amp: { powerW: 500, loadOhm: 1, minLoadOhm: 1, bridged: false, class: 'd', subsonicHz: 25 },
  supply: { supplyV: 13.8, cableAwg: 4, cableM: 5, duty: 0.125, alternatorA: 120, otherLoadsA: 40 },
  space: { id: 'trunk-compact', shape: 'box', taper: 0.5 },
  front: { enabled: false },
});

const frontOn = (): Obj => ({ enabled: true, type: 'component', mount: 'door', woofer: '6.5 in door', tweeter: '1 in dome', airL: 20, depthCm: 9, openingCm: 15.2, ringCm: 1, xoverSubHz: 100, xoverTweeterHz: 2400 });

describe('a valid speaker answer', () => {
  it('becomes the arrangement, drivers, baffle and crossover named, levelled, with the label', () => {
    const v = H.validateSpeaker(speaker());
    expect(v.errors).toEqual([]);
    const sp = v.value!.speaker;
    expect(v.value!.label).toBe('Bookshelf');
    expect(sp.arrangement).toBe('two-way');
    expect([sp.baffleWidthCm, sp.baffleHeightCm, sp.quantity, sp.chambers, sp.baffleStep]).toEqual([20, 34, 2, 'shared', true]);
    expect(sp.xover[0]).toBe(2500);
    expect(sp.slots[0]!.design.driverClass).toBe(P.ALL_DRIVER_CLASSES.findIndex((d) => d.name === '5.25 in'));
    expect(sp.slots[1]!.design.driverClass).toBe(P.ALL_DRIVER_CLASSES.findIndex((d) => d.name === '1 in dome'));
    expect([sp.slots[0]!.design.volumeL, sp.slots[1]!.design.volumeL]).toEqual([8, 0.5]);
    expect(sp.slots[0]!.design.plotRange).toBe('high');
    // levelled: the same trims a starting point gets
    expect(sp.slots.map((s) => s.trimDb)).toEqual(L.levelSpeaker(sp).slots.map((s) => s.trimDb));
    expect(sp.slots[1]!.trimDb).not.toBe(0);
  });

  it('a ported woofer keeps its tuning and port; a sealed one ignores them', () => {
    const a = speaker();
    a.slots[0] = { driver: '8 in', type: 'ported', volumeL: 25, tuneHz: 45, portDiameterCm: 7, open: false };
    const sp = H.validateSpeaker(a).value!.speaker;
    expect([sp.slots[0]!.design.type, sp.slots[0]!.design.tuneHz, sp.slots[0]!.design.portDiameterCm]).toEqual(['ported', 45, 7]);
    expect(sp.slots[1]!.design.type).toBe('sealed');
  });

  it('every arrangement is accepted with its own slot and crossover counts', () => {
    for (const arr of L.ARRANGEMENTS) {
      const a = speaker();
      a.arrangement = arr.id;
      a.xoverHz = arr.xover.length === 2 ? [350, 3000] : [2500];
      a.slots = arr.slots.map((s) => ({ driver: s.role === 'tweeter' ? '1 in dome' : s.role === 'mid' ? '4 in mid' : '5.25 in', type: 'sealed', volumeL: s.role === 'tweeter' ? 0.5 : 6, tuneHz: 50, portDiameterCm: 5, open: false }));
      const v = H.validateSpeaker(a);
      expect([arr.id, v.errors]).toEqual([arr.id, []]);
      expect(v.value!.speaker.arrangement).toBe(arr.id);
    }
  });

  it('a planar tweeter may have no box', () => {
    const a = speaker();
    a.slots[1] = { driver: 'Planar tweeter', type: 'sealed', volumeL: 0.5, tuneHz: 50, portDiameterCm: 5, open: true };
    expect(H.validateSpeaker(a).value!.speaker.slots[1]!.open).toBe(true);
  });
});

describe('speaker rules, one at a time', () => {
  const cases: [string, (d: Obj) => void, string][] = [
    ['not an object', () => undefined, ''],
    ['missing label', (d) => delete d.label, 'label'],
    ['unknown arrangement', (d) => (d.arrangement = 'quad'), 'arrangement: expected one of'],
    ['baffle too narrow', (d) => (d.baffleWidthCm = 3), 'baffleWidthCm: 3 is below the minimum 8'],
    ['baffle too tall', (d) => (d.baffleHeightCm = 400), 'baffleHeightCm: 400 is above the maximum 200'],
    ['quantity a fraction', (d) => (d.quantity = 2.5), 'quantity: 2.5 is not a whole number'],
    ['quantity too many', (d) => (d.quantity = 20), 'quantity: 20 is above the maximum 8'],
    ['chambers unknown', (d) => (d.chambers = 'both'), 'chambers: expected'],
    ['baffleStep not boolean', (d) => (d.baffleStep = 'yes'), 'baffleStep: expected true or false'],
    ['crossover list missing', (d) => delete d.xoverHz, 'xoverHz: expected a list'],
    ['crossover out of range', (d) => (d.xoverHz = [20]), 'xoverHz[0]: 20 is below the minimum 100'],
    ['two-way with two crossovers', (d) => (d.xoverHz = [2000, 4000]), 'xoverHz: a 2-way needs 1 crossover frequency, got 2'],
    ['three-way crossovers too close', (d) => {
      d.arrangement = 'three-way';
      d.xoverHz = [400, 450];
      d.slots.splice(1, 0, { driver: '4 in mid', type: 'sealed', volumeL: 2, tuneHz: 50, portDiameterCm: 5, open: false });
    }, 'at least 1.2 times apart'],
    ['slots missing', (d) => delete d.slots, 'slots: expected a list'],
    ['too few slots', (d) => d.slots.pop(), 'slots: a 2-way has 2 driver groups, got 1'],
    ['too many slots', (d) => d.slots.push({ driver: '1 in dome', type: 'sealed', volumeL: 0.5, tuneHz: 50, portDiameterCm: 5, open: false }), 'slots: a 2-way has 2 driver groups, got 3'],
    ['a second midrange in the tweeter slot names the role', (d) => (d.slots[1].driver = '4 in mid'), 'this is the Tweeter group (group 2 of 2 for a 2-way): use a tweeter class'],
    ['unknown driver', (d) => (d.slots[0].driver = '99 in'), 'slots[0].driver: expected one of'],
    ['a PA horn driver is not a home driver', (d) => (d.slots[0].driver = '1 in HF'), 'slots[0].driver'],
    ['a tweeter in the woofer slot', (d) => (d.slots[0].driver = '1 in dome'), 'slots[0].driver'],
    ['a woofer in the tweeter slot', (d) => (d.slots[1].driver = '5.25 in'), 'slots[1].driver'],
    ['a tweeter box that is ported', (d) => (d.slots[1].type = 'ported'), 'slots[1].type: expected one of "sealed"'],
    ['a band-pass woofer', (d) => (d.slots[0].type = 'bandpass'), 'slots[0].type: expected one of "sealed", "ported"'],
    ['a horn woofer', (d) => (d.slots[0].type = 'horn'), 'slots[0].type'],
    ['volume too big', (d) => (d.slots[0].volumeL = 5000), 'slots[0].volumeL: 5000 is above the maximum 1000'],
    ['ported without tuning', (d) => {
      d.slots[0].type = 'ported';
      delete d.slots[0].tuneHz;
    }, 'slots[0].tuneHz'],
    ['open missing', (d) => delete d.slots[0].open, 'slots[0].open: expected true or false'],
    ['open woofer', (d) => (d.slots[0].open = true), 'slots[0].open: only a tweeter can have no box'],
  ];
  for (const [name, edit, want] of cases) {
    it(name, () => {
      const d = speaker();
      edit(d);
      const v = H.validateSpeaker(name === 'not an object' ? 'a speaker' : d);
      expect(v.ok).toBe(false);
      expect(v.value).toBeNull();
      expect(v.errors.join('\n')).toContain(want);
      expect(v.errors.length).toBeGreaterThan(0);
    });
  }

  it('reports every error at once, not just the first', () => {
    const d = speaker();
    d.baffleWidthCm = 3;
    d.quantity = 99;
    d.slots[0].driver = '99 in';
    expect(H.validateSpeaker(d).errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('a valid car answer', () => {
  it('becomes the sub, box, amp, supply and space named, with the label', () => {
    const v = H.validateCar(car());
    expect(v.errors).toEqual([]);
    const c = v.value!.car;
    expect(v.value!.label).toBe('Trunk sub');
    expect(c.cabin).toBe('sedan');
    expect(c.design.driverClass).toBe(P.ALL_DRIVER_CLASSES.findIndex((d) => d.name === '12 in car sub'));
    expect([c.design.type, c.design.volumeL, c.design.plotRange]).toEqual(['sealed', 40, 'low']);
    expect([c.count, c.series, c.coils, c.coilSeries]).toEqual([1, 1, 2, 1]);
    expect([c.ampPowerW, c.ampLoadOhm, c.ampMinLoadOhm, c.bridged, c.ampClass, c.subsonicHz]).toEqual([500, 1, 1, false, 'd', 25]);
    expect([c.supplyV, c.cableAwg, c.cableM, c.duty, c.alternatorA, c.otherLoadsA]).toEqual([13.8, 4, 5, 0.125, 120, 40]);
    expect([c.space.id, c.shape, c.front.enabled]).toEqual(['trunk-compact', 'box', false]);
  });

  it('a ported, band-pass or wedge answer keeps its fields', () => {
    const a = car();
    a.sub = { ...a.sub, type: 'ported', volumeL: 60, tuneHz: 36, portDiameterCm: 12 };
    a.space = { id: 'hatch', shape: 'wedge', taper: 0.4 };
    const c = H.validateCar(a).value!.car;
    expect([c.design.type, c.design.tuneHz, c.design.portDiameterCm, c.shape, c.taper]).toEqual(['ported', 36, 12, 'wedge', 0.4]);
    a.sub = { ...a.sub, type: 'bandpass', frontVolumeL: 30 };
    expect(H.validateCar(a).value!.car.design.frontVolumeL).toBe(30);
  });

  it('a custom space carries its size', () => {
    const a = car();
    a.space = { id: 'custom', wCm: 70, hCm: 30, dCm: 35, shape: 'box', taper: 0.5 };
    expect(H.validateCar(a).value!.car.space).toEqual({ id: 'custom', wCm: 70, hCm: 30, dCm: 35 });
  });

  it('front speakers are built and levelled to the sub, the tweeter too', () => {
    const a = car();
    a.front = frontOn();
    const v = H.validateCar(a);
    expect(v.errors).toEqual([]);
    const c = v.value!.car;
    expect(c.front.enabled).toBe(true);
    expect([c.front.type, c.front.mount, c.front.airL, c.front.xoverSubHz, c.front.xoverTweeterHz]).toEqual(['component', 'door', 20, 100, 2400]);
    expect(F.FRONT_COMPONENT_CLASSES[1]).toBe('6.5 in door');
    expect(P.ALL_DRIVER_CLASSES[c.front.wooferClass]!.name).toBe('6.5 in door');
    expect(P.ALL_DRIVER_CLASSES[c.front.tweeterClass]!.name).toBe('1 in dome');
    const lv = C.levelFront(c);
    expect([c.front.trimDb, c.front.tweeterTrimDb]).toEqual([lv.front.trimDb, lv.front.tweeterTrimDb]);
    expect(c.front.tweeterTrimDb).not.toBe(0);
  });

  it('a coaxial front needs no tweeter or tweeter crossover', () => {
    const a = car();
    a.front = { enabled: true, type: 'coaxial', mount: 'dash', woofer: '5.25 in coax', airL: 5, depthCm: 8, openingCm: 12.8, ringCm: 1, xoverSubHz: 90 };
    const v = H.validateCar(a);
    expect(v.errors).toEqual([]);
    expect(P.ALL_DRIVER_CLASSES[v.value!.car.front.wooferClass]!.name).toBe('5.25 in coax');
    expect(v.value!.car.front.tweeterTrimDb).toBe(0);
  });

  it('a disabled front ignores the rest of its fields', () => {
    const a = car();
    a.front = { enabled: false, type: 'nonsense', woofer: 'nope' };
    const v = H.validateCar(a);
    expect(v.errors).toEqual([]);
    expect(v.value!.car.front.enabled).toBe(false);
  });
});

describe('car rules, one at a time', () => {
  const cases: [string, (d: Obj) => void, string][] = [
    ['missing label', (d) => delete d.label, 'label'],
    ['unknown cabin', (d) => (d.cabin = 'tank'), 'cabin: expected one of'],
    ['sub group missing', (d) => delete d.sub, 'sub: expected an object'],
    ['a PA driver is not a car sub', (d) => (d.sub.driver = '18 in'), 'sub.driver: expected one of'],
    ['a horn sub', (d) => (d.sub.type = 'horn'), 'sub.type: expected one of "sealed", "ported", "bandpass"'],
    ['sub volume too small', (d) => (d.sub.volumeL = 0.01), 'sub.volumeL: 0.01 is below'],
    ['ported without tuning', (d) => {
      d.sub.type = 'ported';
      delete d.sub.tuneHz;
    }, 'sub.tuneHz'],
    ['band-pass without front volume', (d) => {
      d.sub.type = 'bandpass';
      delete d.sub.frontVolumeL;
    }, 'sub.frontVolumeL'],
    ['five subs', (d) => (d.sub.count = 5), 'sub.count: 5 is above the maximum 4'],
    ['half a sub', (d) => (d.sub.count = 1.5), 'sub.count: 1.5 is not a whole number'],
    ['series does not divide count', (d) => {
      d.sub.count = 3;
      d.sub.series = 2;
    }, 'sub.series: 2 must divide the sub count 3'],
    ['three voice coils', (d) => (d.sub.coils = 3), 'sub.coils: expected 1 or 2'],
    ['coil series without a second coil', (d) => {
      d.sub.coils = 1;
      d.sub.coilSeries = 2;
    }, 'sub.coilSeries: 2 needs a dual voice coil sub'],
    ['amp power too low', (d) => (d.amp.powerW = 10), 'amp.powerW: 10 is below the minimum 50'],
    ['amp load not offered', (d) => (d.amp.loadOhm = 3), 'amp.loadOhm: expected one of'],
    ['amp minimum load not offered', (d) => (d.amp.minLoadOhm = 8), 'amp.minLoadOhm: expected one of'],
    ['bridged not boolean', (d) => (d.amp.bridged = 'no'), 'amp.bridged: expected true or false'],
    ['amp class unknown', (d) => (d.amp.class = 'a'), 'amp.class: expected "d" or "ab"'],
    ['subsonic too high', (d) => (d.amp.subsonicHz = 200), 'amp.subsonicHz: 200 is above the maximum 60'],
    ['supply voltage too high', (d) => (d.supply.supplyV = 24), 'supply.supplyV: 24 is above the maximum 15.5'],
    ['cable gauge not offered', (d) => (d.supply.cableAwg = 5), 'supply.cableAwg: expected one of'],
    ['duty not offered', (d) => (d.supply.duty = 0.5), 'supply.duty: expected one of'],
    ['alternator too small', (d) => (d.supply.alternatorA = 5), 'supply.alternatorA: 5 is below the minimum 30'],
    ['unknown space', (d) => (d.space.id = 'roof'), 'space.id: expected one of'],
    ['custom space without size', (d) => (d.space = { id: 'custom', shape: 'box', taper: 0.5 }), 'space.wCm'],
    ['unknown shape', (d) => (d.space.shape = 'cube'), 'space.shape: expected "box" or "wedge"'],
    ['taper out of range', (d) => (d.space.taper = 2), 'space.taper: 2 is above the maximum 1'],
    ['front type unknown', (d) => (d.front = { ...frontOn(), type: 'tri' }), 'front.type: expected "component" or "coaxial"'],
    ['coax woofer on a component set', (d) => (d.front = { ...frontOn(), woofer: '6.5 in coax' }), 'front.woofer: for a component expected one of'],
    ['component woofer on a coaxial', (d) => (d.front = { ...frontOn(), type: 'coaxial' }), 'front.woofer: for a coaxial expected one of'],
    ['front mount unknown', (d) => (d.front = { ...frontOn(), mount: 'roof' }), 'front.mount: expected one of'],
    ['front tweeter unknown', (d) => (d.front = { ...frontOn(), tweeter: 'Planar tweeter' }), 'front.tweeter: expected one of'],
    ['front air out of range', (d) => (d.front = { ...frontOn(), airL: 500 }), 'front.airL: 500 is above the maximum 60'],
    ['front crossover out of range', (d) => (d.front = { ...frontOn(), xoverTweeterHz: 100 }), 'front.xoverTweeterHz: 100 is below the minimum 1000'],
    ['front enabled missing', (d) => (d.front = {}), 'front.enabled: expected true or false'],
  ];
  for (const [name, edit, want] of cases) {
    it(name, () => {
      const d = car();
      edit(d);
      const v = H.validateCar(d);
      expect(v.ok).toBe(false);
      expect(v.value).toBeNull();
      expect(v.errors.join('\n')).toContain(want);
    });
  }

  it('not an object', () => {
    expect(H.validateCar([]).ok).toBe(false);
    expect(H.validateCar(null).errors).toEqual(['expected an object']);
  });
});

describe('schemas and prompts', () => {
  it('the speaker schema offers exactly the arrangements, classes, types and ranges the validator takes', () => {
    const s = H.speakerSchema() as Obj;
    expect(s.properties.arrangement.enum).toEqual(L.ARRANGEMENTS.map((a) => a.id));
    expect(s.required).toEqual(['label', 'note', 'arrangement', 'baffleWidthCm', 'baffleHeightCm', 'xoverHz', 'chambers', 'baffleStep', 'quantity', 'slots']);
    expect(s.properties.baffleWidthCm).toEqual({ type: 'number', minimum: L.SPEAKER_RANGES.baffleWidthCm.min, maximum: L.SPEAKER_RANGES.baffleWidthCm.max });
    const slot = s.properties.slots.items;
    expect(slot.properties.driver.enum).toEqual([...H.SPEAKER_DRIVERS, ...H.SPEAKER_TWEETERS]);
    expect(slot.properties.type.enum).toEqual(['sealed', 'ported']);
    expect(slot.required).toEqual(expect.arrayContaining(['driver', 'type', 'volumeL', 'tuneHz', 'portDiameterCm', 'open']));
    expect(slot.properties.horn).toBeUndefined();
    expect(slot.properties.custom).toBeUndefined();
    expect(slot.properties.frontVolumeL).toBeUndefined();
    for (const n of [...H.SPEAKER_DRIVERS, ...H.SPEAKER_TWEETERS]) expect(P.ALL_DRIVER_CLASSES.some((d) => d.name === n)).toBe(true);
  });

  it('the car schema offers the cabins, spaces, loads, gauges and ranges the validator takes', () => {
    const s = H.carSchema() as Obj;
    expect(s.required).toEqual(['label', 'note', 'cabin', 'sub', 'amp', 'supply', 'space', 'front']);
    expect(s.properties.cabin.enum).toEqual(P.CABIN_TYPES.map((c) => c.id));
    expect(s.properties.sub.properties.driver.enum).toEqual([...H.CAR_SUB_CLASSES]);
    expect(s.properties.sub.properties.type.enum).toEqual(['sealed', 'ported', 'bandpass']);
    expect(s.properties.sub.required).toEqual(expect.arrayContaining(['frontVolumeL', 'count', 'series', 'coils', 'coilSeries']));
    expect(s.properties.amp.properties.loadOhm.enum).toEqual([...C.CAR_AMP_LOADS]);
    expect(s.properties.supply.properties.cableAwg.enum).toEqual([...C.CABLE_AWGS]);
    expect(s.properties.supply.properties.duty.enum).toEqual(C.MUSIC_DUTIES.map((m) => m.value));
    expect(s.properties.space.properties.id.enum).toEqual(C.SPACES.map((p) => p.id));
    expect(s.properties.front.required).toEqual(['enabled']);
    expect(s.properties.supply.properties.alternatorA).toEqual({ type: 'number', minimum: C.CAR_RANGES.alternatorA.min, maximum: C.CAR_RANGES.alternatorA.max });
  });

  it('the PA box schema is unchanged by the new options', () => {
    const d = B.designSchema(true) as Obj;
    expect(d.properties.driver.enum).toEqual(P.DRIVER_CLASSES.map((c) => c.name));
    expect(d.properties.horn).toBeDefined();
    expect(d.required).toContain('frontVolumeL');
  });

  it('the speaker prompt names every arrangement, class and range, and the car prompt every cabin, space and class', () => {
    const sp = H.speakerPrompt();
    for (const a of L.ARRANGEMENTS) expect(sp).toContain(`"${a.id}"`);
    for (const n of [...H.SPEAKER_DRIVERS, ...H.SPEAKER_TWEETERS]) expect(sp).toContain(`"${n}"`);
    expect(sp).toContain('8 to 80 cm');
    expect(sp).toContain('Format example');
    const cp = H.carPrompt();
    for (const c of P.CABIN_TYPES) expect(cp).toContain(`"${c.id}"`);
    for (const s of C.SPACES) expect(cp).toContain(`"${s.id}"`);
    for (const n of [...H.CAR_SUB_CLASSES, ...F.FRONT_COMPONENT_CLASSES, ...F.FRONT_COAX_CLASSES, ...F.FRONT_TWEETER_CLASSES]) expect(cp).toContain(`"${n}"`);
    expect(cp).toContain('50 to 20000 W');
    expect(cp).toContain('Format example');
  });

  it('the prompts own examples validate', () => {
    for (const [prompt, validate] of [[H.speakerPrompt(), H.validateSpeaker], [H.carPrompt(), H.validateCar]] as const) {
      const json = prompt.slice(prompt.lastIndexOf('{"label"'));
      const v = validate(JSON.parse(json));
      expect(v.errors).toEqual([]);
    }
  });
});

describe('metrics', () => {
  it('speaker metrics give the sensitivity, the -3 dB point, the air, the sheets and the warning count', () => {
    const sp = H.validateSpeaker(speaker()).value!.speaker;
    const m = H.speakerMetricsOf(sp);
    const view = L.computeLoudspeaker(sp);
    expect(m.sensitivityDb).toBeCloseTo(view.sensitivityDb, 12);
    expect(m.arrangement).toBe('2-way');
    expect(m.volumeL).toBeCloseTo(8.5, 12);
    expect(m.f3Hz).toBeGreaterThan(30);
    expect(m.f3Hz).toBeLessThan(300);
    const bare = L.computeLoudspeaker({ ...sp, baffleStep: false });
    expect(bare.levelDb[bare.freqs.indexOf(m.f3Hz)]!).toBeGreaterThanOrEqual(bare.sensitivityDb - 3);
    expect(bare.levelDb[bare.freqs.indexOf(m.f3Hz) - 1]!).toBeLessThan(bare.sensitivityDb - 3);
    expect(m.sheets).toBeGreaterThan(0);
    expect(m.warnings).toBeGreaterThanOrEqual(view.warnings.length);
  });

  it('a bigger sealed box reaches lower', () => {
    const small = speaker();
    const big = speaker();
    for (const d of [small, big]) d.slots[0].driver = '8 in';
    small.slots[0].volumeL = 6;
    big.slots[0].volumeL = 50;
    const f = (a: Obj): number => H.speakerMetricsOf(H.validateSpeaker(a).value!.speaker).f3Hz;
    expect(f(big)).toBeLessThan(f(small));
  });

  it('car metrics give the level, the headroom, the load, the fuse and the warning count', () => {
    const c = H.validateCar(car()).value!.car;
    const m = H.carMetricsOf(c);
    const v = C.computeCarSub(c);
    expect(m.levelDb).toBeCloseTo(v.averageDb, 12);
    expect(m.headroomDb).toBeCloseTo(v.limits.headroomDb, 12);
    expect(m.loadOhm).toBeCloseTo(v.loadOhm, 12);
    expect(m.fuseA).toBe(C.computeCarElectric(c, v.limits).fuseA);
    expect(m.sheets).toBeGreaterThan(0);
  });

  it('a thin cable on a big amp adds a warning', () => {
    const ok = car();
    const bad = car();
    bad.supply.cableAwg = 12;
    bad.supply.cableM = 12;
    expect(H.carMetricsOf(H.validateCar(bad).value!.car).warnings).toBeGreaterThan(H.carMetricsOf(H.validateCar(ok).value!.car).warnings);
  });

  it('front speakers add their warnings to the count', () => {
    const a = car();
    a.front = { ...frontOn(), depthCm: 3 };
    const without = H.carMetricsOf(H.validateCar(car()).value!.car).warnings;
    expect(H.carMetricsOf(H.validateCar(a).value!.car).warnings).toBeGreaterThan(without);
  });
});

describe('ask, validate, retry', () => {
  const reply = (body: unknown): Response => new Response(JSON.stringify({ message: { content: typeof body === 'string' ? body : JSON.stringify(body) } }), { status: 200 });
  const cfg = { baseUrl: 'http://localhost:11434', model: 'test' };

  it('a speaker answer is accepted on the first try, with the schema and prompt sent', async () => {
    const sent: Obj[] = [];
    const r = await designVariant('speaker', 'a bookshelf speaker', FLAVOURS[0], cfg, async (_u, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return reply(speaker());
    });
    expect(r.ok).toBe(true);
    expect(r.ok && r.attempts).toBe(1);
    expect(sent[0]!.format.properties.arrangement).toBeDefined();
    expect(sent[0]!.messages[0].content).toContain('home stereo loudspeaker');
    expect(sent[0]!.messages[1].content).toContain('a bookshelf speaker');
  });

  it('a bad speaker answer is sent back with the validator errors and the second is accepted', async () => {
    const bad = speaker();
    bad.slots[0].driver = '99 in';
    const sent: Obj[] = [];
    let n = 0;
    const r = await designVariant('speaker', 'x', FLAVOURS[1], cfg, async (_u, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return reply(n++ === 0 ? bad : speaker());
    });
    expect(r.ok && r.attempts).toBe(2);
    expect(sent[1]!.messages.at(-1).content).toContain('slots[0].driver');
  });

  it('a car answer that never validates is refused after two answers', async () => {
    const bad = car();
    bad.sub.count = 9;
    let n = 0;
    const r = await designVariant('car', 'x', FLAVOURS[2], cfg, async () => {
      n++;
      return reply(bad);
    });
    expect(n).toBe(MAX_ATTEMPTS);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.join()).toContain('sub.count');
  });

  it('a car reply that is not JSON is one error and a valid second reply passes', async () => {
    let n = 0;
    const sent: Obj[] = [];
    const r = await designVariant('car', 'x', FLAVOURS[0], cfg, async (_u, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return reply(n++ === 0 ? 'here is your install' : car());
    });
    expect(r.ok && r.attempts).toBe(2);
    expect(sent[1]!.messages.at(-1).content).toContain('not valid JSON');
    expect(sent[0]!.messages[0].content).toContain('car audio install');
  });
});
