// Cross-implementation parity: parity.jsonl holds numbers computed by the Sound System plugin's own C++ functions
// (analyticG, the displacement forms, systemResponse, roomDirectResponse) at its v1 tag for random configurations,
// including out-of-range inputs that exercise the clamps. This library must reproduce every one.
// Regenerate with tools/parity-dump.ps1; never hand-edit the file.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as P from '../src/index';

type C2 = [number, number];
interface BoxCase {
  cls: number;
  type: number;
  volumeL: number;
  tuneHz: number;
  frontVolumeL: number;
  hornThroatCm2: number;
  hornMouthCm2: number;
  hornLengthM: number;
  custom: P.CustomDriverFields;
}
type Case =
  | { kind: 'box'; p: BoxCase; driver: number[]; f: number[]; g: C2[]; x: C2[] }
  | { kind: 'sys'; p: { bands: number; xover: number[]; align: boolean; band: (Omit<P.BandSettings, 'box'> & { box: BoxCase })[] }; fs: number; f: number[]; h: C2[] }
  | { kind: 'room'; p: P.RoomParams; fs: number; f: number[]; h: C2[]; directGain: number; tailGain: number };

const cases = readFileSync(new URL('./parity.jsonl', import.meta.url), 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as Case);

const TYPES: P.BoxType[] = ['sealed', 'ported', 'bandpass', 'horn'];

// The plugin's class index: below 8 a generic class (negative means class 0), anything above is the Custom driver.
const box = (b: BoxCase): P.BoxParams => ({
  ...b,
  type: TYPES[b.type]!,
  driver: b.cls < P.DRIVER_CLASSES.length ? P.DRIVER_CLASSES[Math.max(b.cls, 0)]! : P.customDriver(b.custom),
});

/** Relative to the reference's magnitude; 1e-9 leaves room for the two languages' different operation order. */
function expectClose(got: P.Cx, want: C2, what: string): void {
  const err = Math.hypot(got.re - want[0], got.im - want[1]);
  const mag = Math.hypot(want[0], want[1]);
  expect(err, `${what}: got ${got.re},${got.im} want ${want}`).toBeLessThanOrEqual(1e-9 * mag + 1e-300);
}

const of = <K extends Case['kind']>(kind: K) => cases.filter((c): c is Extract<Case, { kind: K }> => c.kind === kind);

describe('parity with the plugin (v1)', () => {
  it('has the reference cases', () => {
    expect(of('box').length).toBeGreaterThanOrEqual(200);
    expect(of('sys').length).toBeGreaterThanOrEqual(100);
    expect(of('room').length).toBeGreaterThanOrEqual(50);
  });

  it('box response and cone displacement', () => {
    of('box').forEach((c, i) => {
      const d = box(c.p).driver;
      [d.fs, d.qes, d.qms, d.vasM3, d.sd, d.re, d.xmax, d.pe].forEach((v, k) =>
        expect(Math.abs(v - c.driver[k]!), `box ${i} driver field ${k}`).toBeLessThanOrEqual(1e-12 * Math.abs(c.driver[k]!)),
      );
      c.f.forEach((f, k) => {
        expectClose(P.boxResponse(box(c.p), f), c.g[k]!, `box ${i} G at ${f} Hz`);
        expectClose(P.boxDisplacement(box(c.p), f), c.x[k]!, `box ${i} X at ${f} Hz`);
      });
    });
  });

  it('whole-system response', () => {
    of('sys').forEach((c, i) => {
      const p: P.SystemParams = { ...c.p, band: c.p.band.map((b) => ({ ...b, box: box(b.box) })) };
      c.f.forEach((f, k) => expectClose(P.systemResponse(p, f, c.fs), c.h[k]!, `system ${i} at ${f} Hz`));
    });
  });

  it('room direct path and gains', () => {
    of('room').forEach((c, i) => {
      c.f.forEach((f, k) => expectClose(P.roomDirectResponse(c.p, f, c.fs), c.h[k]!, `room ${i} at ${f} Hz`));
      expect(P.directGain(c.p), `room ${i} direct gain`).toBeCloseTo(c.directGain, 12);
      expect(P.tailGain(c.p), `room ${i} tail gain`).toBeCloseTo(c.tailGain, 12);
    });
  });
});
