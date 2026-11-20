import { describe, expect, it } from 'vitest';
import { CSV_TEMPLATE, parseDriverCsv } from '../src/probe/csvimport';
import { parseRecord, serializeRecord, toCustomFields } from '../src/probe/record';

const D = '2026-11-19';
const H = 'name,fs_hz,qts,qes,qms,re_ohm,vas_l,sd_cm2,xmax_mm,pe_w,le_mh\n';

describe('parseDriverCsv', () => {
  it('reads the template into a complete datasheet record with converted units', () => {
    const { records, errors } = parseDriverCsv(CSV_TEMPLATE, D);
    expect(errors).toEqual([]);
    const r = records[0]!;
    expect(r.method).toBe('datasheet');
    expect(r.incomplete).toBe(false);
    expect(r.sd).toBeCloseTo(0.052, 9);
    expect(r.xmax).toBeCloseTo(0.008, 9);
    expect(r.vasM3!.v).toBeCloseTo(0.09, 9);
    expect(r.fs.band).toBe(0);
    expect(toCustomFields(r)).toEqual({ fsHz: 38, qts: 0.35, qms: 4.5, vasL: 90, sdCm2: 520, reOhm: 5.4, xmaxMm: 8, powerW: 400 });
  });
  it('survives a JSON round trip through parseRecord', () => {
    const r = parseDriverCsv(CSV_TEMPLATE, D).records[0]!;
    const back = parseRecord(serializeRecord(r));
    expect(back.ok && back.record).toEqual(r);
  });
  it('derives the missing Q from the other two', () => {
    const t = (row: string) => parseDriverCsv(H + row, D).records[0]!;
    const a = t('A,40,,0.4,4,6,,,,,');
    expect(a.qts.v).toBeCloseTo(1 / (1 / 0.4 + 1 / 4), 12);
    const b = t('B,40,0.35,,4.5,6,,,,,');
    expect(b.qes.v).toBeCloseTo((0.35 * 4.5) / (4.5 - 0.35), 12);
    const c = t('C,40,0.35,0.4,,6,,,,,');
    expect(c.qms.v).toBeCloseTo((0.35 * 0.4) / (0.4 - 0.35), 12);
    expect(c.incomplete).toBe(true); // no Sd, Xmax, Pe, Vas
  });
  it('rejects inconsistent Q, bad numbers, duplicates and missing names row by row, keeping good rows', () => {
    const { records, errors } = parseDriverCsv(H + 'Good,40,0.35,0.4,2.8,6,,,,,\nBad Q,40,0.5,0.4,4.5,6,,,,,\nNeg,-1,0.35,0.4,,6,,,,,\n,40,0.35,0.4,,6,,,,,\nGood,41,0.35,0.4,,6,,,,,\nText,abc,0.35,0.4,,6,,,,,', D);
    expect(records.map((r) => r.name)).toEqual(['Good']);
    expect(errors).toHaveLength(5);
    expect(errors[0]).toMatch(/Row 3 \(Bad Q\).*do not agree/);
    expect(errors[3]).toMatch(/duplicate/);
  });
  it('accepts tabs, semicolons, quotes, BOM, CRLF and decimal commas', () => {
    const tab = parseDriverCsv('﻿Model\tFs\tQts\tQes\tRe\r\n"Foo, 10"\t45\t0,3\t0,35\t3.2\r\n', D);
    expect(tab.errors).toEqual([]);
    expect(tab.records[0]!.name).toBe('Foo, 10');
    expect(tab.records[0]!.qts.v).toBe(0.3);
    const semi = parseDriverCsv('name;fs;qts;qes;re\nX;45;0.3;0.35;3.2', D);
    expect(semi.records).toHaveLength(1);
  });
  it('reports a header that lacks required columns, and an empty file', () => {
    expect(parseDriverCsv('name,fs,qts\nA,40,0.3', D).errors[0]).toMatch(/Missing: re, two of qts\/qes\/qms/);
    expect(parseDriverCsv('name,fs', D).errors[0]).toMatch(/header row and at least one/);
  });
});
