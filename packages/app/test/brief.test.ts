// A6 pass condition, part one: out-of-range, wrongly typed or incomplete model output is rejected by the validator (one test
// per rule), and a valid answer becomes a project the calculators accept.
import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import * as B from '../src/brief';
import * as L from '../src/buildlist';
import * as M from '../src/model';
import * as S from '../src/system';

const sub = { driver: '18 in', type: 'ported', volumeL: 200, tuneHz: 38, portDiameterCm: 12 };
const tops = { driver: '12 in', type: 'sealed', volumeL: 50 };
const hornDesign = { driver: '1 in HF', type: 'horn', volumeL: 0.2, horn: { loading: 'front', flare: 'exponential', cutoffHz: 700, throatCm2: 4, mouthCm2: 150, throatChamberL: 0, widthCm: 15 } };
const amp = { ampPowerW: 600, ampLoadOhm: 4, ampMinLoadOhm: 2 };
const system = (): Record<string, unknown> => ({
  label: 'Two-way PA',
  note: 'A ported sub and sealed tops.',
  nBands: 2,
  xoverHz: [110],
  lowestHz: 40,
  distanceM: 10,
  bands: [
    { design: structuredClone(sub), count: 1, series: 1, ...amp },
    { design: structuredClone(tops), count: 2, series: 1, ampPowerW: 400, ampLoadOhm: 4, ampMinLoadOhm: 2 },
  ],
});
const box = (): Record<string, unknown> => ({ label: 'Sub', note: 'A ported 18.', ...structuredClone(sub) });

describe('a valid design', () => {
  it('a one-box answer becomes a design with the chosen class, type and sizes, and its label', () => {
    const v = B.validateDesign(box(), '$', true);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.value!.driverClass).toBe(3);
    expect([v.value!.type, v.value!.volumeL, v.value!.tuneHz, v.value!.portDiameterCm]).toEqual(['ported', 200, 38, 12]);
    expect(v.value!.label).toBe('Sub');
    expect(M.compute(v.value!).warnings.some((w) => w.includes('cannot tune'))).toBe(false);
  });

  it('every driver class name maps to its index, and a custom driver carries its values', () => {
    P.DRIVER_CLASSES.forEach((d, i) => expect(B.validateDesign({ ...tops, driver: d.name }, '$', false).value!.driverClass).toBe(i));
    const c = { fsHz: 40, qts: 0.4, qms: 5, vasL: 80, sdCm2: 300, reOhm: 6, xmaxMm: 8, powerW: 300 };
    const v = B.validateDesign({ ...tops, driver: 'custom', custom: c }, '$', false);
    expect(v.value!.driverClass).toBe(M.CUSTOM_CLASS);
    expect(v.value!.custom).toEqual(c);
  });

  it('a horn answer keeps its flare, loading and areas, and picks the high plot range for a high cutoff', () => {
    const v = B.validateDesign(hornDesign, '$', false).value!;
    expect([v.type, v.horn.loading, v.horn.flare, v.horn.cutoffHz, v.horn.throatCm2, v.horn.mouthCm2, v.plotRange]).toEqual(['horn', 'front', 'exponential', 700, 4, 150, 'high']);
    expect(B.validateDesign({ ...hornDesign, horn: { ...hornDesign.horn, cutoffHz: 100 } }, '$', false).value!.plotRange).toBe('low');
  });

  it('a band-pass box needs and keeps its front volume', () => {
    const v = B.validateDesign({ driver: '15 in', type: 'bandpass', volumeL: 60, frontVolumeL: 40, tuneHz: 60, portDiameterCm: 8 }, '$', false).value!;
    expect([v.type, v.frontVolumeL]).toEqual(['bandpass', 40]);
  });
});

describe('design rules, one at a time', () => {
  const cases: [string, (d: Record<string, unknown>) => void, string][] = [
    ['not an object', () => undefined, ''],
    ['missing label', (d) => delete d.label, 'label'],
    ['empty note', (d) => (d.note = '  '), 'note'],
    ['label too long', (d) => (d.label = 'x'.repeat(41)), 'label: 41 characters'],
    ['unknown driver', (d) => (d.driver = '9 in'), 'driver: expected one of'],
    ['driver not a string', (d) => (d.driver = 3), 'driver: expected one of'],
    ['unknown box type', (d) => (d.type = 'transmission line'), 'type: expected one of'],
    ['volume missing', (d) => delete d.volumeL, 'volumeL: expected a number'],
    ['volume as text', (d) => (d.volumeL = '200'), 'volumeL: expected a number'],
    ['volume too large', (d) => (d.volumeL = 5000), 'volumeL: 5000 is above the maximum 1000 L'],
    ['volume too small', (d) => (d.volumeL = 0.01), 'is below the minimum'],
    ['volume NaN-like', (d) => (d.volumeL = null), 'volumeL: expected a number'],
    ['tuning missing for ported', (d) => delete d.tuneHz, 'tuneHz'],
    ['tuning too high', (d) => (d.tuneHz = 400), 'tuneHz: 400 is above'],
    ['port too narrow', (d) => (d.portDiameterCm = 1), 'portDiameterCm: 1 is below'],
  ];
  for (const [name, mutate, want] of cases) {
    it(`rejects: ${name}`, () => {
      const d = box();
      if (name === 'not an object') {
        const v = B.validateDesign(7, '$', true);
        expect(v.ok).toBe(false);
        expect(v.errors[0]).toContain('expected an object');
        return;
      }
      mutate(d);
      const v = B.validateDesign(d, '$', true);
      expect(v.ok).toBe(false);
      expect(v.value).toBeNull();
      expect(v.errors.some((e) => e.includes(want))).toBe(true);
    });
  }

  it('a custom driver must carry all its values in range', () => {
    const base = { fsHz: 40, qts: 0.4, qms: 5, vasL: 80, sdCm2: 300, reOhm: 6, xmaxMm: 8, powerW: 300 };
    expect(B.validateDesign({ ...tops, driver: 'custom' }, '$', false).errors[0]).toContain('custom: required');
    expect(B.validateDesign({ ...tops, driver: 'custom', custom: { ...base, qts: 5 } }, '$', false).errors.some((e) => e.includes('custom.qts: 5 is above'))).toBe(true);
    const { fsHz: _f, ...missing } = base;
    expect(B.validateDesign({ ...tops, driver: 'custom', custom: missing }, '$', false).errors.some((e) => e.includes('custom.fsHz'))).toBe(true);
  });

  it('a sealed box or a horn may carry a tuneHz, which changes nothing', () => {
    const plain = B.validateDesign(tops, '$', false).value!;
    const withTune = B.validateDesign({ ...tops, tuneHz: 38 }, '$', false).value!;
    expect(withTune).toEqual(plain);
    expect(B.validateDesign({ ...hornDesign, tuneHz: 38 }, '$', false).errors).toEqual([]);
  });

  it('a band-pass box also needs its tuning and port, and a rear-loaded horn is accepted', () => {
    const bp = { driver: '15 in', type: 'bandpass', volumeL: 60, frontVolumeL: 40, tuneHz: 60, portDiameterCm: 8 };
    const { tuneHz: _t, ...noTune } = bp;
    const { portDiameterCm: _p, ...noPort } = bp;
    expect(B.validateDesign(noTune, '$', false).errors.some((e) => e.includes('tuneHz'))).toBe(true);
    expect(B.validateDesign(noPort, '$', false).errors.some((e) => e.includes('portDiameterCm'))).toBe(true);
    const rear = B.validateDesign({ ...hornDesign, horn: { ...hornDesign.horn, loading: 'rear' } }, '$', false);
    expect(rear.errors).toEqual([]);
    expect(rear.value!.horn.loading).toBe('rear');
  });

  it('a band-pass box without its front volume is rejected', () => {
    const e = B.validateDesign({ driver: '15 in', type: 'bandpass', volumeL: 60, tuneHz: 60, portDiameterCm: 8 }, '$', false).errors;
    expect(e.some((x) => x.includes('frontVolumeL'))).toBe(true);
  });

  it('horn rules: object, loading, flare, mouth larger than throat, a cutoff or a length, t for hyperbolic', () => {
    const h = (patch: Record<string, unknown>, drop: string[] = []): string[] => {
      const horn = { ...hornDesign.horn, ...patch } as Record<string, unknown>;
      for (const k of drop) delete horn[k];
      return B.validateDesign({ ...hornDesign, horn }, '$', false).errors;
    };
    expect(B.validateDesign({ driver: '1 in HF', type: 'horn', volumeL: 0.2 }, '$', false).errors[0]).toContain('horn: required');
    expect(h({ loading: 'side' }).some((e) => e.includes('loading'))).toBe(true);
    expect(h({ flare: 'spiral' }).some((e) => e.includes('flare: expected one of'))).toBe(true);
    expect(h({ mouthCm2: 3 }).some((e) => e.includes('mouth must be larger than the throat'))).toBe(true);
    expect(h({}, ['cutoffHz']).some((e) => e.includes('cutoffHz'))).toBe(true);
    expect(h({ flare: 'conical' }, ['cutoffHz']).some((e) => e.includes('lengthM'))).toBe(true);
    expect(h({ flare: 'conical', lengthM: 0.5 }, ['cutoffHz'])).toEqual([]);
    expect(h({ flare: 'hyperbolic' }).some((e) => e.includes('horn.t'))).toBe(true);
    expect(h({ flare: 'hyperbolic', t: 0.6 })).toEqual([]);
    expect(h({ widthCm: 1000 }).some((e) => e.includes('widthCm: 1000 is above'))).toBe(true);
    expect(h({ throatChamberL: -1 }).some((e) => e.includes('throatChamberL'))).toBe(true);
  });
});

describe('a valid system', () => {
  const v = B.validateSystem(system());

  it('becomes a project with the bands, crossover, amps and listening distance given', () => {
    expect(v.errors).toEqual([]);
    const p = v.value!.project;
    expect([p.nBands, p.xover[0], p.lowestHz, p.distanceM]).toEqual([2, 110, 40, 10]);
    expect([p.bands[0]!.design.driverClass, p.bands[1]!.design.driverClass]).toEqual([3, 1]);
    expect([p.bands[1]!.count, p.bands[1]!.ampPowerW, p.bands[0]!.ampPowerW]).toEqual([2, 400, 600]);
    expect(v.value!.label).toBe('Two-way PA');
    expect(p.view).toBe('system');
  });

  it('is levelled like a starting point, and the calculators accept it (finite levels and limits)', () => {
    const p = v.value!.project;
    const c = S.computeSystem(p);
    expect(p.bands.slice(0, 2).some((b) => b.trimDb !== 0)).toBe(true);
    expect(Number.isFinite(c.limits.referenceDb) && Number.isFinite(c.limits.headroomDb)).toBe(true);
    expect(c.levelDb.every(Number.isFinite)).toBe(true);
    expect(S.sanitizeProject(p)).toEqual(p);
  });

  it('a one-band system needs an empty crossover list', () => {
    const one = system();
    one.nBands = 1;
    one.xoverHz = [];
    (one.bands as unknown[]).length = 1;
    expect(B.validateSystem(one).errors).toEqual([]);
  });
});

describe('system rules, one at a time', () => {
  const cases: [string, (s: Record<string, unknown>) => void, string][] = [
    ['missing label', (s) => delete s.label, 'label'],
    ['bands not a number', (s) => (s.nBands = 'two'), 'nBands: expected a number'],
    ['too many bands', (s) => (s.nBands = 5), 'nBands: 5 is above the maximum'],
    ['fractional bands', (s) => (s.nBands = 1.5), 'nBands: 1.5 is not a whole number'],
    ['crossover list missing', (s) => delete s.xoverHz, 'xoverHz: expected a list'],
    ['wrong number of crossovers', (s) => (s.xoverHz = [100, 900]), '2 bands need 1 crossover'],
    ['crossover out of range', (s) => (s.xoverHz = [10]), 'xoverHz[0]: 10 is below'],
    ['crossovers too close', (s) => ((s.nBands = 3), (s.xoverHz = [100, 110]), (s.bands as unknown[]).push({ design: tops, count: 1, series: 1, ...amp })), 'at least 1.2 times apart'],
    ['crossovers falling', (s) => ((s.nBands = 3), (s.xoverHz = [900, 100]), (s.bands as unknown[]).push({ design: tops, count: 1, series: 1, ...amp })), 'must rise'],
    ['lowest frequency high', (s) => (s.lowestHz = 900), 'lowestHz: 900 is above'],
    ['distance missing', (s) => delete s.distanceM, 'distanceM'],
    ['bands list missing', (s) => delete s.bands, 'bands: expected a list'],
    ['wrong number of band entries', (s) => ((s.bands as unknown[]).length = 1), '2 bands need 2 entries'],
    ['band not an object', (s) => ((s.bands as unknown[])[0] = 4), 'bands[0]: expected an object'],
    ['band design invalid', (s) => (((s.bands as Record<string, Record<string, unknown>>[])[0]!.design!.volumeL) = 9999), 'bands[0].design.volumeL: 9999 is above'],
    ['count zero', (s) => (((s.bands as Record<string, unknown>[])[0]!.count) = 0), 'bands[0].count: 0 is below'],
    ['count fractional', (s) => (((s.bands as Record<string, unknown>[])[0]!.count) = 2.5), 'bands[0].count: 2.5 is not a whole number'],
    ['series does not divide count', (s) => (Object.assign((s.bands as Record<string, unknown>[])[1]!, { count: 3, series: 2 })), 'bands[1].series: 2 must divide the driver count 3'],
    ['amp load not offered', (s) => (((s.bands as Record<string, unknown>[])[0]!.ampLoadOhm) = 6), 'ampLoadOhm: expected one of 2, 4, 8, 16'],
    ['amp power huge', (s) => (((s.bands as Record<string, unknown>[])[0]!.ampPowerW) = 1e6), 'ampPowerW: 1000000 is above'],
    ['amp minimum load missing', (s) => delete (s.bands as Record<string, unknown>[])[0]!.ampMinLoadOhm, 'ampMinLoadOhm'],
  ];
  for (const [name, mutate, want] of cases) {
    it(`rejects: ${name}`, () => {
      const s = system();
      mutate(s);
      const v = B.validateSystem(s);
      expect(v.ok).toBe(false);
      expect(v.value).toBeNull();
      expect(v.errors.some((e) => e.includes(want)), v.errors.join(' | ')).toBe(true);
    });
  }

  it('not an object', () => {
    expect(B.validateSystem('hello').errors).toEqual(['expected an object']);
  });
});

describe('schema, prompt and metrics', () => {
  it('the JSON schema carries the same ranges as the validator', () => {
    const d = B.designSchema(true) as { properties: Record<string, { minimum?: number; maximum?: number; enum?: unknown[] }>; required: string[] };
    expect(d.properties.volumeL!.minimum).toBe(M.BOX_RANGES.volumeL.min);
    expect(d.properties.volumeL!.maximum).toBe(M.BOX_RANGES.volumeL.max);
    expect(d.properties.driver!.enum).toEqual(P.DRIVER_CLASSES.map((c) => c.name)); // the model may not invent a custom driver
    expect(d.properties.type!.enum).toEqual(['sealed', 'ported', 'bandpass', 'horn']);
    expect(d.required).toEqual(expect.arrayContaining(['driver', 'type', 'volumeL', 'tuneHz', 'label', 'note']));
    for (const k of ['tuneHz', 'portDiameterCm', 'frontVolumeL']) expect(B.designSchema(false).required).toContain(k);
    expect((B.systemSchema() as { properties: { bands: { items: { properties: { design: { required: string[] } } } } } }).properties.bands.items.properties.design.required).toContain('tuneHz');
    expect(B.designSchema(false).required).not.toContain('label');
    const s = B.systemSchema() as { properties: Record<string, { maximum?: number; maxItems?: number }>; required: string[] };
    expect(s.properties.distanceM!.maximum).toBe(S.DISTANCE_RANGE.max);
    expect(s.properties.bands!.maxItems).toBe(4);
    expect(s.properties.xoverHz!.maxItems).toBe(3);
    expect(s.required).toContain('bands');
  });

  it('the prompt lists every driver class and the limits, and the box prompt differs from the system prompt', () => {
    const sys = B.systemPrompt('system');
    for (const d of P.DRIVER_CLASSES) expect(sys).toContain(`"${d.name}"`);
    expect(sys).toContain('1 to 4 bands');
    expect(sys).toContain('ampLoadOhm');
    expect(sys).toContain('2, 4, 8, 16');
    expect(sys).toContain('never calculate');
    expect(sys).toContain('Horn mouth area');
    expect(sys).toContain('ALWAYS include all three');
    expect(sys).toContain('Format example');
    expect(sys).not.toContain('"custom"');
    const one = B.systemPrompt('box');
    expect(one).toContain('Design ONE box');
    expect(one).not.toContain('nBands');
    expect(B.userPrompt('  a small club  ', B.FLAVOURS[1]!)).toBe(`Brief: a small club\n\nVariant: Loud. ${B.FLAVOURS[1]!.hint}`);
    expect(B.retryPrompt(['a: bad', 'b: worse'])).toContain('- a: bad\n- b: worse');
    expect(B.retryPrompt(Array.from({ length: 30 }, (_, i) => `e${i}`)).split('\n- ').length - 1).toBe(12);
    expect(B.FLAVOURS.map((f) => f.id)).toEqual(['compact', 'loud', 'deep']);
  });

  it('system metrics count bands, sheets, warnings and the headroom', () => {
    const p = B.validateSystem(system()).value!.project;
    const m = B.metricsOf(p);
    expect(m.bands).toBe(2);
    expect(m.lowestHz).toBe(40);
    expect(m.sheets).toBeGreaterThan(0);
    expect(m.warnings).toBe(S.computeSystem(p).warnings.length + L.computeBuild(p).warnings.length);
    expect(m.headroomDb).toBeCloseTo(S.computeSystem(p).limits.headroomDb, 12);
    expect(m.levelDb).toBeCloseTo(S.computeSystem(p).limits.referenceDb, 12);
  });

  it('a horn without panel lengths adds build warnings to the counts', () => {
    const sys = system();
    (sys.bands as Record<string, unknown>[])[1]!.design = structuredClone(hornDesign);
    const p = B.validateSystem(sys).value!.project;
    expect(L.computeBuild(p).warnings.length).toBeGreaterThan(0);
    expect(B.metricsOf(p).warnings).toBe(S.computeSystem(p).warnings.length + L.computeBuild(p).warnings.length);
    const d = B.validateDesign(hornDesign, '$', false).value!;
    const bm = B.boxMetricsOf(d);
    expect(bm.warnings).toBe(M.compute(d).warnings.length + L.computeBuild(S.sanitizeProject({ ...S.DEFAULT_PROJECT, nBands: 1, bands: [{ design: d }] })).warnings.length);
    expect(bm.warnings).toBeGreaterThan(M.compute(d).warnings.length);
  });

  it('box metrics give the readouts, the volume and the sheets', () => {
    const d = B.validateDesign(box(), '$', true).value!;
    const m = B.boxMetricsOf(d);
    expect(m.volumeL).toBe(200);
    expect(m.readouts.length).toBe(2);
    expect(m.readouts[0]).toContain('F3');
    expect(m.sheets).toBeGreaterThan(0);
  });
});
