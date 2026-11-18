import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import { LIBRARY_KEY, loadLibrary, remove, saveLibrary, upsert } from '../src/probe/library';
import { type BuildInput, bandProblems, buildRecord, isIncomplete, parseRecord, recordFileName, serializeRecord, toCustomFields } from '../src/probe/record';

const D12 = P.ALL_DRIVER_CLASSES[1]!; // 12 in: fs 38, Sd 0.048 m^2, Vas 0.06 m^3, Xmax 8 mm, Pe 400 W

function curve(d: P.DriverSpec, massKg = 0, noise = 0): P.ImpedancePoint[] {
  const dd = P.deriveDriver(d);
  const mms = dd.mms + massKg;
  const fs = 1 / (2 * Math.PI * Math.sqrt(mms * dd.cms));
  const qms = (2 * Math.PI * fs * mms) / dd.rms;
  const qes = (2 * Math.PI * fs * mms * d.re) / (dd.bl * dd.bl);
  let s = 12345;
  const g = () => {
    if (!noise) return 0;
    const u = () => ((s = (s * 1664525 + 1013904223) >>> 0) + 0.5) / 4294967296;
    return Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  };
  return Array.from({ length: 120 }, (_, i) => {
    const f = 6 * Math.pow(230 / 6, i / 119);
    const z = P.freeAirImpedance([d.re, fs, qms, qes, 0], f);
    return { f, re: z.re * (1 + noise * g()), im: z.im * (1 + noise * g()) };
  });
}
const fitOf = (pts: P.ImpedancePoint[]) => ({ fit: P.fitFreeAir(pts), points: pts });
const dm = P.deriveDriver(D12).mms * 0.5;
const input = (extra: Partial<BuildInput> = {}): BuildInput => ({ name: ' Test 12 ', date: '2026-11-18', base: fitOf(curve(D12)), ...extra });
const withMass = { loaded: { ...fitOf(curve(D12, dm)), massKg: dm, massBand: 0.005 } };

describe('buildRecord', () => {
  it('a free-air sweep alone is incomplete', () => {
    const r = buildRecord(input());
    expect(r.name).toBe('Test 12');
    expect(r.method).toBe('free-air');
    expect(r.incomplete).toBe(true);
    expect(toCustomFields(r)).toBeNull();
    expect(r.sweeps).toHaveLength(1);
  });

  it('with an added-mass sweep and Sd it measures Vas; Sd, Xmax and Pe still make it complete', () => {
    const r1 = buildRecord(input({ ...withMass, sdM2: D12.sd }));
    expect(r1.method).toBe('free-air+added-mass');
    expect(r1.vasSource).toBe('measured');
    expect(Math.abs(r1.vasM3!.v - D12.vasM3) / D12.vasM3).toBeLessThan(0.01);
    expect(r1.incomplete).toBe(true); // no Xmax, Pe
    const r2 = buildRecord(input({ ...withMass, sdM2: D12.sd, xmaxM: D12.xmax, peW: D12.pe }));
    expect(r2.incomplete).toBe(false);
    expect(r2.sweeps!.map((s) => s.label)).toEqual(['free-air', 'added-mass']);
  });

  it('without an added-mass sweep Vas can be typed from a datasheet (band 0), which makes it complete', () => {
    const r = buildRecord(input({ sdM2: D12.sd, xmaxM: D12.xmax, peW: D12.pe, vasEnteredM3: D12.vasM3 }));
    expect(r.vasSource).toBe('entered');
    expect(r.vasM3!.band).toBe(0);
    expect(r.incomplete).toBe(false);
  });

  it('a measured Vas wins over a typed one', () => {
    const r = buildRecord(input({ ...withMass, sdM2: D12.sd, vasEnteredM3: 1 }));
    expect(r.vasSource).toBe('measured');
  });

  it('a complete record becomes Custom driver fields that give the original driver back', () => {
    const r = buildRecord(input({ ...withMass, sdM2: D12.sd, xmaxM: D12.xmax, peW: D12.pe }));
    const f = toCustomFields(r)!;
    const d = P.customDriver(f);
    const near = (a: number, b: number) => Math.abs(a - b) / b < 0.01;
    expect(near(d.fs, D12.fs) && near(d.qes, D12.qes) && near(d.qms, D12.qms) && near(d.vasM3, D12.vasM3) && near(d.sd, D12.sd) && near(d.re, D12.re)).toBe(true);
    expect(f.xmaxMm).toBeCloseTo(8, 6);
    expect(f.powerW).toBe(400);
  });
});

describe('band gate', () => {
  it('clean measurements pass; a tiny added mass is refused for its Mms, Cms, Bl and Vas', () => {
    expect(bandProblems(buildRecord(input({ ...withMass, sdM2: D12.sd })))).toEqual([]);
    const tiny = P.deriveDriver(D12).mms * 0.002;
    const noisyBase = fitOf(curve(D12, 0, 0.01));
    const noisyLoaded = fitOf(curve(D12, tiny, 0.01));
    const r = buildRecord({ ...input({ sdM2: D12.sd }), base: noisyBase, loaded: { ...noisyLoaded, massKg: tiny, massBand: 0.01 } });
    const p = bandProblems(r).join(' ');
    expect(p).toContain('Mms');
    expect(p).toContain('Vas');
  });

  it('a typed datasheet Vas (band 0) is never refused', () => {
    expect(bandProblems(buildRecord(input({ vasEnteredM3: 0.06 })))).toEqual([]);
  });
});

describe('parseRecord', () => {
  const full = () => buildRecord(input({ ...withMass, sdM2: D12.sd, xmaxM: D12.xmax, peW: D12.pe }));

  it('round-trips a record', () => {
    const r = full();
    const back = parseRecord(serializeRecord(r));
    expect(back.ok && back.record).toEqual(r);
  });

  it('recomputes incomplete instead of trusting the file', () => {
    const o = JSON.parse(serializeRecord(buildRecord(input())));
    o.incomplete = false;
    const back = parseRecord(JSON.stringify(o));
    expect(back.ok && back.record.incomplete).toBe(true);
    expect(isIncomplete({ sd: 1, xmax: 1, pe: 1, vasM3: { v: 1, band: 0 } })).toBe(false);
  });

  it('rejects other files, bad JSON, missing or non-positive numbers, and added-mass records without the mass numbers', () => {
    expect(parseRecord('{not json').ok).toBe(false);
    expect(parseRecord('{"schema":"something.else"}').ok).toBe(false);
    const o = JSON.parse(serializeRecord(full()));
    expect(parseRecord(JSON.stringify({ ...o, fs: { v: -3, band: 0.01 } })).ok).toBe(false);
    expect(parseRecord(JSON.stringify({ ...o, qes: undefined })).ok).toBe(false);
    expect(parseRecord(JSON.stringify({ ...o, sd: 0 })).ok).toBe(false);
    expect(parseRecord(JSON.stringify({ ...o, mms: undefined })).ok).toBe(false);
    expect(parseRecord(JSON.stringify({ ...o, method: 'tape-measure' })).ok).toBe(false);
  });

  it('file names are safe', () => {
    expect(recordFileName(buildRecord(input({ name: 'Eminence / Alpha 15"' })))).toBe('Eminence-Alpha-15.driver.json');
    expect(recordFileName(buildRecord(input({ name: '???' })))).toBe('driver.driver.json');
  });
});

describe('library', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  const rec = (name: string) => buildRecord(input({ name }));

  it('saves, loads, replaces by name and removes', () => {
    const s = mem();
    let list = upsert(upsert([], rec('A')), rec('B'));
    list = upsert(list, rec('A'));
    expect(list.map((r) => r.name)).toEqual(['B', 'A']);
    expect(saveLibrary(list, s)).toBe(true);
    expect(loadLibrary(s).map((r) => r.name)).toEqual(['B', 'A']);
    expect(remove(list, 'B').map((r) => r.name)).toEqual(['A']);
  });

  it('skips unreadable entries and survives garbage and a failing store', () => {
    const s = mem();
    s.setItem(LIBRARY_KEY, JSON.stringify([serializeRecord(rec('Good')), 'garbage', 42]));
    expect(loadLibrary(s).map((r) => r.name)).toEqual(['Good']);
    s.setItem(LIBRARY_KEY, 'not json');
    expect(loadLibrary(s)).toEqual([]);
    expect(loadLibrary(null)).toEqual([]);
    expect(saveLibrary([rec('X')], { getItem: () => null, setItem: () => { throw new Error('full'); } })).toBe(false);
    expect(saveLibrary([rec('X')], null)).toBe(false);
  });
});
