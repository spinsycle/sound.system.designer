import { describe, expect, it } from 'vitest';
import * as P from '@soundsystemdesigner/physics';
import { autoName, buildEntry, ebp, entryFromRecord, entryToSpec, genericEntries, guessKind, isUsable, missingFields, parseEntry, vdM3 } from '../src/drivers/entry';
import { buildRecord } from '../src/probe/record';

const NOW = '2026-11-23';
const base = { fs: 38, re: 3.4, qes: 0.5, qms: 5 };
const ok = (i: Parameters<typeof buildEntry>[0]) => {
  const r = buildEntry(i, 'x', NOW);
  if (!r.ok) throw new Error(r.errors.join('|'));
  return r.entry;
};

describe('buildEntry', () => {
  it('derives the third Q from any two', () => {
    const a = ok({ ...base });
    expect(a.qts).toBeCloseTo(1 / (1 / 0.5 + 1 / 5), 12);
    expect(a.derived).toContain('qts');
    const b = ok({ fs: 38, re: 3.4, qts: a.qts, qms: 5 });
    expect(b.qes).toBeCloseTo(0.5, 9);
    const c = ok({ fs: 38, re: 3.4, qts: a.qts, qes: 0.5 });
    expect(c.qms).toBeCloseTo(5, 9);
  });
  it('defaults identity to Generic and names it from the parts', () => {
    const e = ok({ ...base });
    expect([e.manufacturer, e.series, e.model]).toEqual(['Generic', 'Generic', 'Generic']);
    expect(e.source).toBe('hand');
    expect(autoName({ manufacturer: 'Acme', series: 'Pro', model: 'W12' })).toBe('Acme Pro W12');
    expect(autoName({ manufacturer: 'Generic', series: 'Generic', model: 'Generic' })).toBe('Generic');
    expect(ok({ ...base, manufacturer: 'Acme', model: 'W12' }).name).toBe('Acme W12');
    expect(ok({ ...base, name: ' mine ' }).name).toBe('mine');
  });
  it('refuses missing, out-of-range and inconsistent numbers, one message each', () => {
    const bad = (i: Parameters<typeof buildEntry>[0]) => {
      const r = buildEntry(i, 'x', NOW);
      return r.ok ? [] : r.errors;
    };
    expect(bad({ re: 3, qes: 0.5, qms: 5 })).toContain('fs is required.');
    expect(bad({ fs: 40, qes: 0.5, qms: 5 })).toContain('Re is required.');
    expect(bad({ fs: 40, re: 3, qes: 0.5 }).join()).toMatch(/two of Qts/);
    expect(bad({ ...base, fs: 1 }).join()).toMatch(/fs must be/);
    expect(bad({ ...base, sd: NaN }).join()).toMatch(/Sd must be/);
    expect(bad({ ...base, fs: 6000 }).join()).toMatch(/fs must be/);
    expect(bad({ ...base, sd: 2 }).join()).toMatch(/Sd must be/);
    expect(bad({ ...base, qts: 0.9 }).join()).toMatch(/does not match/);
    expect(bad({ fs: 40, re: 3, qts: 0.6, qms: 0.5 }).join()).toMatch(/Qms must be larger/);
  });
  it('accepts three consistent Q values and keeps them as entered', () => {
    const q = 1 / (1 / 0.5 + 1 / 5);
    const e = ok({ ...base, qts: q * 1.05 });
    expect(e.qts).toBeCloseTo(q * 1.05, 12);
    expect(e.derived).not.toContain('qts');
  });
  it('derives Vas from Cms and Sd, then Mms, Bl and Rms, matching deriveDriver', () => {
    const d = P.DRIVER_CLASSES[1]!;
    const dd = P.deriveDriver(d);
    const e = ok({ fs: d.fs, re: d.re, qes: d.qes, qms: d.qms, vasM3: d.vasM3, sd: d.sd });
    expect(e.cms).toBeCloseTo(dd.cms, 12);
    expect(e.mms).toBeCloseTo(dd.mms, 9);
    expect(e.bl).toBeCloseTo(dd.bl, 9);
    expect(e.rms).toBeCloseTo(dd.rms, 9);
    expect(e.derived).toEqual(expect.arrayContaining(['qts', 'cms', 'mms', 'bl', 'rms']));
    const back = ok({ fs: d.fs, re: d.re, qes: d.qes, qms: d.qms, cms: dd.cms, sd: d.sd });
    expect(back.vasM3).toBeCloseTo(d.vasM3, 12);
    expect(back.derived).toContain('vasM3');
  });
  it('does not derive Vas without Sd, and keeps entered Mms/Bl/Rms', () => {
    const e = ok({ ...base, cms: 1e-3 });
    expect(e.vasM3).toBeUndefined();
    const f = ok({ ...base, mms: 0.1, bl: 12, rms: 3 });
    expect([f.bl, f.rms]).toEqual([12, 3]);
    expect(f.cms).toBeCloseTo(1 / (2 * Math.PI * 38) ** 2 / 0.1, 12);
  });
  it('keeps extended fields and clamps text', () => {
    const e = ok({ ...base, le: 0.001, sensDb: 91, znomOhm: 4, xmechM: 0.02, notes: 'n'.repeat(5000), kind: 'tweeter', favourite: true });
    expect([e.le, e.sensDb, e.znomOhm, e.xmechM, e.kind, e.favourite]).toEqual([0.001, 91, 4, 0.02, 'tweeter', true]);
    expect(e.notes).toHaveLength(2000);
    expect(ok({ ...base, kind: 'bogus' as never }).kind).toBe('woofer');
  });
});

describe('usable, spec and figures of merit', () => {
  it('is unusable until Vas, Sd, Xmax and Pe exist', () => {
    const e = ok({ ...base });
    expect(isUsable(e)).toBe(false);
    expect(missingFields(e)).toEqual(['Vas', 'Sd', 'Xmax', 'Pe']);
    expect(entryToSpec(e)).toBeNull();
    expect(vdM3(e)).toBeUndefined();
    const f = ok({ ...base, vasM3: 0.06, sd: 0.048, xmax: 0.008, pe: 400, le: 0.0005 });
    expect(isUsable(ok({ ...base, sd: 0.048, xmax: 0.008, pe: 400 }))).toBe(false); // no Vas
    expect(isUsable(f)).toBe(true);
    expect(entryToSpec(f)).toEqual({ name: 'Generic', fs: 38, qes: 0.5, qms: 5, vasM3: 0.06, sd: 0.048, re: 3.4, xmax: 0.008, pe: 400, le: 0.0005 });
    expect(vdM3(f)).toBeCloseTo(0.048 * 0.008, 15);
    expect(ebp(f)).toBeCloseTo(76, 9);
  });
});

describe('genericEntries', () => {
  const g = genericEntries();
  it('has one usable entry per class with a stable id and the class numbers', () => {
    expect(g).toHaveLength(P.ALL_DRIVER_CLASSES.length);
    g.forEach((e, i) => {
      expect(e.id).toBe(`generic-${i}`);
      expect(e.source).toBe('generic');
      expect(isUsable(e)).toBe(true);
      const s = entryToSpec(e)!;
      const d = P.ALL_DRIVER_CLASSES[i]!;
      expect([s.fs, s.re, s.qes, s.qms, s.vasM3, s.sd, s.xmax, s.pe]).toEqual([d.fs, d.re, d.qes, d.qms, d.vasM3, d.sd, d.xmax, d.pe]);
    });
    expect(new Set(g.map((e) => e.id)).size).toBe(g.length);
  });
  it('labels kinds sensibly', () => {
    const kind = (n: string) => g.find((e) => e.model === n)!.kind;
    expect(kind('12 in')).toBe('woofer');
    expect(kind('21 in')).toBe('subwoofer');
    expect(kind('12 in car sub')).toBe('subwoofer');
    expect(kind('1 in dome')).toBe('tweeter');
    expect(kind('1 in HF')).toBe('compression');
    expect(kind('6.5 in coax')).toBe('coaxial');
    expect(kind('2 in full-range')).toBe('fullrange');
    expect(kind('4 in mid')).toBe('midrange');
    expect(guessKind({ fs: 600 })).toBe('tweeter');
    expect(guessKind({ fs: 50, sd: 0.003 })).toBe('midrange');
  });
});

describe('entryFromRecord and parseEntry', () => {
  const fit = { re: 3.4, fs: 40, qms: 5, qes: 0.5, qts: 0.4545, leMH: 0, bands: { re: 0.01, fs: 0.01, qms: 0.05, qes: 0.05, qts: 0.04, leMH: 0 } } as never;
  const rec = buildRecord({ name: 'Bench 1', date: '2026-11-20', base: { fit, points: [] } });
  it('imports an incomplete probe record as an unusable entry', () => {
    const r = entryFromRecord(rec, 'p1', NOW);
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.entry.source).toBe('probe');
    expect(r.entry.addedAt).toBe('2026-11-20');
    expect(isUsable(r.entry)).toBe(false);
    expect(r.entry.record?.name).toBe('Bench 1');
  });
  it('a datasheet record is source datasheet and keeps entered Sd, Xmax, Pe, Vas', () => {
    const d = { ...rec, method: 'datasheet' as const, sd: 0.05, xmax: 0.007, pe: 300, vasM3: { v: 0.07, band: 0 } };
    const r = entryFromRecord(d, 'p2', NOW);
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.entry.source).toBe('datasheet');
    expect(isUsable(r.entry)).toBe(true);
  });
  it('round-trips through JSON, recomputing derived numbers instead of trusting them', () => {
    const e = ok({ ...base, vasM3: 0.06, sd: 0.048, xmax: 0.008, pe: 400, manufacturer: 'Acme', favourite: true });
    const stored = JSON.parse(JSON.stringify(e));
    const back = parseEntry(stored, NOW);
    expect(back.ok && back.entry).toEqual(e);
    stored.mms = 99; // mms is listed as derived, so this tampered value is ignored
    const again = parseEntry(stored, NOW);
    expect(again.ok && again.entry.mms).toBeCloseTo(e.mms!, 12);
  });
  it('refuses unreadable entries without throwing', () => {
    expect(parseEntry(null, NOW).ok).toBe(false);
    expect(parseEntry({ schema: 'nope' }, NOW).ok).toBe(false);
    expect(parseEntry({ schema: 'ssd.driver/1' }, NOW).ok).toBe(false);
    expect(parseEntry({ schema: 'ssd.driver/1', id: 'a', ...base, fs: '38' }, NOW).ok).toBe(false);
  });
});
