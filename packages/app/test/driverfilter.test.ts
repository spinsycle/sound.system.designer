import { describe, expect, it } from 'vitest';
import { type DriverEntry, buildEntry, genericEntries } from '../src/drivers/entry';
import { FIELDS, blankForm, fmt, formFromEntry, inputFromForm, shown } from '../src/drivers/fields';
import { NO_FILTER, coneIn, filterDrivers, manufacturers, sortDrivers } from '../src/drivers/filter';

const mk = (over: Record<string, unknown>, id: string): DriverEntry => {
  const r = buildEntry({ fs: 38, re: 3.4, qes: 0.5, qms: 5, vasM3: 0.06, sd: 0.048, xmax: 0.008, pe: 400, ...over } as never, id, '2026-11-23');
  if (!r.ok) throw new Error(r.errors.join());
  return r.entry;
};
const A = mk({ manufacturer: 'Acme', series: 'Pro', model: 'W12', favourite: true, fs: 30, kind: 'subwoofer' }, 'a');
const B = mk({ manufacturer: 'Zed', model: 'T1', fs: 1500, vasM3: undefined, sd: 6e-4, notes: 'silk dome', kind: 'tweeter', qes: 1, qms: 2.5 }, 'b');
const C = mk({ manufacturer: 'Acme', model: 'W8', fs: 60, sd: 0.02, source: 'csv', pe: undefined }, 'c');
const L = [A, B, C];
const ids = (l: DriverEntry[]) => l.map((e) => e.id);

describe('filterDrivers', () => {
  it('no filter keeps everything', () => expect(filterDrivers(L, NO_FILTER)).toEqual(L));
  it('searches every word across name, maker, series, model, notes and kind', () => {
    expect(ids(filterDrivers(L, { ...NO_FILTER, text: 'acme pro' }))).toEqual(['a']);
    expect(ids(filterDrivers(L, { ...NO_FILTER, text: ' SILK ' }))).toEqual(['b']);
    expect(ids(filterDrivers(L, { ...NO_FILTER, text: 'w12 acme' }))).toEqual(['a']);
    expect(ids(filterDrivers(L, { ...NO_FILTER, text: 'tweeter' }))).toEqual(['b']);
    expect(filterDrivers(L, { ...NO_FILTER, text: 'acme nothing' })).toEqual([]);
  });
  it('favourites, usable, kind, source and maker', () => {
    expect(ids(filterDrivers(L, { ...NO_FILTER, favouritesOnly: true }))).toEqual(['a']);
    expect(ids(filterDrivers(L, { ...NO_FILTER, usableOnly: true }))).toEqual(['a']); // b has no Vas, c no Pe
    expect(ids(filterDrivers(L, { ...NO_FILTER, kind: 'tweeter' }))).toEqual(['b']);
    expect(ids(filterDrivers(L, { ...NO_FILTER, source: 'csv' }))).toEqual(['c']);
    expect(ids(filterDrivers(L, { ...NO_FILTER, manufacturer: 'Acme' }))).toEqual(['a', 'c']);
  });
  it('ranges include their ends and exclude a driver with no value', () => {
    expect(ids(filterDrivers(L, { ...NO_FILTER, fs: { min: 30, max: 60 } }))).toEqual(['a', 'c']);
    expect(ids(filterDrivers(L, { ...NO_FILTER, fs: { min: 31 } }))).toEqual(['b', 'c']);
    expect(ids(filterDrivers(L, { ...NO_FILTER, fs: { max: 29.9 } }))).toEqual([]);
    expect(ids(filterDrivers(L, { ...NO_FILTER, qts: { min: 0.4, max: 0.5 } }))).toEqual(['a', 'c']);
    expect(ids(filterDrivers(L, { ...NO_FILTER, vasL: { min: 50 } }))).toEqual(['a', 'c']); // b has no Vas
    const d = coneIn(A)!;
    expect(d).toBeCloseTo(9.7, 1);
    expect(ids(filterDrivers(L, { ...NO_FILTER, coneIn: { min: 9, max: 10 } }))).toEqual(['a']);
    expect(coneIn({ ...A, sd: undefined })).toBeUndefined();
  });
  it('lists makers once, sorted', () => expect(manufacturers([...L, A])).toEqual(['Acme', 'Zed']));
});

describe('sortDrivers', () => {
  it('favourites first by default, then by name; does not change the input', () => {
    const copy = [...L];
    expect(ids(sortDrivers(L, 'favourite', 'asc'))).toEqual(['a', 'c', 'b'].map((x) => x)); // a favourite; c "Acme W8" before b "Zed T1"
    expect(L).toEqual(copy);
    expect(ids(sortDrivers(L, 'favourite', 'desc'))).toEqual(['c', 'b', 'a']); // non-favourites first, still by name
  });
  it('sorts text and numbers both ways, missing numbers last either way', () => {
    expect(ids(sortDrivers(L, 'name', 'asc'))).toEqual(['a', 'c', 'b']);
    expect(ids(sortDrivers(L, 'name', 'desc'))).toEqual(['b', 'c', 'a']);
    expect(ids(sortDrivers(L, 'fs', 'asc'))).toEqual(['a', 'c', 'b']);
    expect(ids(sortDrivers(L, 'fs', 'desc'))).toEqual(['b', 'c', 'a']);
    expect(ids(sortDrivers(L, 'pe', 'asc'))).toEqual(['a', 'b', 'c']); // c has no Pe
    expect(ids(sortDrivers(L, 'pe', 'desc'))).toEqual(['a', 'b', 'c']);
    expect(ids(sortDrivers(L, 'manufacturer', 'asc'))).toEqual(['a', 'c', 'b']);
    expect(ids(sortDrivers(L, 'manufacturer', 'desc'))).toEqual(['b', 'a', 'c']); // Zed, then Acme by name
    expect(ids(sortDrivers(L, 'kind', 'asc'))).toEqual(['a', 'b', 'c']); // subwoofer, tweeter, woofer
    expect(ids(sortDrivers(L, 'vas', 'asc'))).toEqual(['a', 'c', 'b']);
    expect(ids(sortDrivers(L, 'qts', 'asc'))).toEqual(['a', 'c', 'b']); // a and c tie, so by name
  });
});

describe('the driver form', () => {
  it('converts datasheet units to SI and back', () => {
    const f = { ...blankForm(), fs: '38', re: '3,4', qes: '0.5', qms: '5', vasM3: '60', sd: '480', xmax: '8', pe: '400', le: '1.2', mms: '85', cms: '0.2', xmechM: '12' };
    const { input, errors } = inputFromForm(f);
    expect(errors).toEqual([]);
    expect(input).toMatchObject({ fs: 38, re: 3.4, vasM3: 0.06, sd: 0.048, xmax: 0.008, pe: 400, le: 0.0012, mms: 0.085, cms: 0.0002, xmechM: 0.012 });
    const e = buildEntry(input, 'x', '2026-11-23');
    if (!e.ok) throw new Error(e.errors.join());
    const back = formFromEntry(e.entry);
    expect(back.vasM3).toBe('60');
    expect(back.sd).toBe('480');
    expect(back.le).toBe('1.2');
    expect(back.qts).toBe(''); // derived, so not offered as typed
    expect(back.cms).toBe('0.2');
    expect(back.bl).toBe(''); // derived
  });
  it('reports a field that is not a number and ignores empty ones', () => {
    const { input, errors } = inputFromForm({ ...blankForm(), fs: 'abc', re: '4' });
    expect(errors).toEqual(['fs is not a number.']);
    expect(input).toMatchObject({ re: 4 });
    expect('fs' in input).toBe(false);
  });
  it('an automatic name stays empty so it follows maker, series and model; a typed name is kept', () => {
    expect(formFromEntry(A).name).toBe('');
    expect(formFromEntry(mk({ name: 'My sub' }, 'n')).name).toBe('My sub');
    expect(formFromEntry(A).manufacturer).toBe('Acme');
    expect(formFromEntry(C).series).toBe('');
  });
  it('keeps identity from the entry being edited; a generic becomes hand-made', () => {
    const g = genericEntries()[0]!;
    const r = inputFromForm(formFromEntry(g), g).input;
    expect(r.source).toBe('hand');
    const k = inputFromForm(formFromEntry(C), C).input;
    expect([k.source, k.favourite, k.addedAt]).toEqual(['csv', false, C.addedAt]);
    expect(inputFromForm(formFromEntry(A)).input.source).toBeUndefined();
    expect(inputFromForm({ ...blankForm(), kind: 'bogus' as never }).input.kind).toBeUndefined();
    expect(inputFromForm({ ...blankForm(), kind: 'tweeter' }).input.kind).toBe('tweeter');
  });
  it('formats numbers briefly', () => {
    expect(fmt(0.1 + 0.2)).toBe('0.3');
    expect(fmt(123456.789)).toBe('123457');
    expect(shown(FIELDS.find((f) => f.key === 'sd')!, 0.048)).toBe('480');
  });
});
