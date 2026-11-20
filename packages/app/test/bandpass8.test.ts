import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import * as L from '../src/buildlist';
import { layout3d } from '../src/layout3d';
import * as M from '../src/model';
import * as S from '../src/system';

const d8 = (more: Partial<M.Design> = {}): M.Design => M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: 2, type: 'bandpass8', volumeL: 120, frontVolumeL: 90, tuneHz: 45, bp8: { innerVolumeL: 70, innerTuneHz: 70, innerPortDiameterCm: 15 }, ...more });
const val = (c: M.Computed, label: string): string | undefined => [...c.readouts, ...c.extras].find((r) => r.label.startsWith(label))?.value;
const build = (design: M.Design) => L.computeBuild(S.sanitizeProject({ ...S.DEFAULT_PROJECT, bands: [{ design }] }));
const bp6 = (patch: Partial<M.Bp6Design>): M.Bp6Design => ({ ...M.DEFAULT_DESIGN.bp6, ...patch });
const bp8 = (patch: Partial<M.Bp8Design>): M.Bp8Design => ({ innerVolumeL: 70, innerTuneHz: 70, innerPortDiameterCm: 15, layout: 'vented', ...patch });

describe('8th-order band-pass in the app model (N3)', () => {
  it('is a box type, defaults for stored designs, and the ranges clamp', () => {
    expect(M.BOX_KINDS.some((k) => k.id === 'bandpass8')).toBe(true);
    const { bp8: _b, ...older } = M.DEFAULT_DESIGN;
    expect(M.sanitize({ ...older, type: 'bandpass8' }).bp8).toEqual(M.DEFAULT_DESIGN.bp8);
    expect(M.sanitize({ bp8: { innerVolumeL: 99999, innerTuneHz: 1, innerPortDiameterCm: 0 } }).bp8).toEqual({ innerVolumeL: 1000, innerTuneHz: 10, innerPortDiameterCm: 2, layout: 'vented' });
  });

  it('the plotted response is the physics response; displacement and impedance follow', () => {
    const d = d8({ qL: 7 });
    const c = M.compute(d);
    const driver = M.driverOf(d);
    const r = P.deriveDriver(driver);
    const k = c.freqs.findIndex((f) => f >= 50);
    const f = c.freqs[k]!;
    const a = [driver.vasM3 / 0.12, driver.vasM3 / 0.07, driver.vasM3 / 0.09] as const;
    const g = P.bandpass8G(f, driver.fs, r.qts, a[0], a[1], a[2], d.bp6.rearTuneHz, 70, 45, 7, 7, 7);
    expect(c.curves.responseDb[k]).toBeCloseTo(P.dB(P.abs(g)), 9);
    const x = P.bandpass8X(f, driver, r, a[0], a[1], a[2], d.bp6.rearTuneHz, 70, 45, 7, 7, 7);
    expect(c.curves.excursionMm[k]).toBeCloseTo(P.abs(x) * P.peakVoltsForPower(d.powerW, driver.re) * 1000, 9);
    expect(c.curves.impedanceOhm[k]).toBeCloseTo(P.abs(P.impedanceFromDisplacement(f, x, r.bl, driver.re)), 9);
    for (const key of ['responseDb', 'excursionMm', 'impedanceOhm', 'phaseDeg', 'groupDelayMs'] as const) expect(c.curves[key].every(Number.isFinite)).toBe(true);
  });

  it('readouts: the three port lengths, the chambers, the tunings on the plots; a port that does not fit is flagged', () => {
    const c = M.compute(d8());
    expect(val(c, 'Port length')).toMatch(/cm/);
    expect(val(c, 'Rear port length')).toMatch(/cm/);
    expect(val(c, 'Port 1 length')).toMatch(/cm/);
    expect(val(c, 'Chambers')).toBe('120, 70.0, 90.0 L');
    expect(c.markers.map((m) => m.label)).toEqual(expect.arrayContaining(['fb', 'fr', 'f1']));
    const d = d8();
    expect(Number.parseFloat(val(c, 'Port 1 length')!)).toBeCloseTo(P.portLengthInternalM(d.bp8.innerVolumeL / 1000, d.bp8.innerTuneHz, d.bp8.innerPortDiameterCm / 100) * 100, 0);
    const bad = M.compute(d8({ bp8: bp8({ innerVolumeL: 900, innerTuneHz: 150, innerPortDiameterCm: 3 }) }));
    expect(val(bad, 'Port 1 length')).toBe('does not fit');
    expect(bad.warnings.some((w) => w.includes('port 1 cannot tune'))).toBe(true);
    const badRear = M.compute(d8({ volumeL: 500, bp6: bp6({ rearTuneHz: 100, rearPortDiameterCm: 4 }) }));
    expect(val(badRear, 'Rear port length')).toBe('does not fit');
  });

  it('warns about a vent under the Cookbook minimum for port 1 and the rear port', () => {
    expect(M.compute(d8({ bp8: bp8({ innerPortDiameterCm: 2 }) })).warnings.some((w) => w.includes('port 1 is 2.0 cm'))).toBe(true);
    expect(M.compute(d8({ bp6: bp6({ rearPortDiameterCm: 2 }) })).warnings.some((w) => w.includes('rear vent is 2.0 cm'))).toBe(true);
  });

  it('carries the level readouts of U1, and the summary names the three tunings', () => {
    expect(val(M.compute(d8()), 'Highest steady level')).toMatch(/dB SPL/);
    expect(S.summary(d8())).toContain('8th-order band-pass at 45, 70 and 45 Hz');
  });
});

describe('8th-order band-pass cut list and 3D (N3)', () => {
  it('one cabinet with two dividers, the driver hole and two baffle ports; port 1 is a tube in the bill of materials only', () => {
    const d = d8();
    const v = build(d);
    const b = v.bands[0]!;
    expect(b.cabinets.map((c) => c.title)).toEqual(['8th-order band-pass box']);
    expect(v.cutList.find((r) => r.part === 'Divider')!.qty).toBe(2);
    expect(b.ports.length).toBe(2);
    expect(b.cabinets[0]!.cutouts.filter((x) => x.kind === 'port').length).toBe(2);
    expect(b.innerPorts!.length).toBe(1);
    expect(b.innerPorts![0]!.lengthM).toBeCloseTo(P.portLengthInternalM(0.07, 70, 0.15), 12);
    expect(b.innerPorts![0]!.diameterM).toBeCloseTo(0.15, 12);
    expect(b.ports[0]!.lengthM).toBeCloseTo(M.portLengthOf(d, 90), 12);
    expect(b.ports[1]!.lengthM).toBeCloseTo(P.portLengthM(0.12, d.bp6.rearTuneHz, d.bp6.rearPortDiameterCm / 100), 12);
    const tubes = v.bom.filter((x) => x.item.startsWith('Round port tube'));
    expect(tubes.reduce((a, x) => a + x.qty, 0)).toBe(3);
    expect(b.warnings.some((w) => w.includes('8th-order box is one cabinet with two dividers'))).toBe(true);
  });

  it('the box holds more than the three chambers: the driver, three ports and two dividers take room', () => {
    const d = d8();
    const g = build(d).bands[0]!.cabinets[0]!.geometry;
    expect(g.wI * g.hI * g.dI).toBeGreaterThan((d.volumeL + d.bp8.innerVolumeL + d.frontVolumeL) / 1000);
  });

  it('a port that does not fit leaves its tube out and says so', () => {
    const v = build(d8({ bp8: bp8({ innerVolumeL: 900, innerTuneHz: 150, innerPortDiameterCm: 3 }) }));
    expect(v.bands[0]!.innerPorts).toBeUndefined();
    expect(v.bands[0]!.warnings.some((w) => w.includes('port 1 does not fit'))).toBe(true);
    const r = build(d8({ volumeL: 500, bp6: bp6({ rearTuneHz: 100, rearPortDiameterCm: 4 }) }));
    expect(r.bands[0]!.ports.length).toBe(1);
  });

  it('3D draws the two dividers at the rear and rear-plus-inner depth shares, and a tube for each baffle port', () => {
    const d = d8();
    const p = S.sanitizeProject({ ...S.DEFAULT_PROJECT, bands: [{ design: d }] });
    const v = L.computeBuild(p);
    const lay = layout3d(v, p);
    const dividers = lay.boxes.filter((x) => x.kind === 'divider');
    expect(dividers.length).toBe(2);
    const g = v.bands[0]!.cabinets[0]!.geometry;
    const total = 120 + 70 + 90;
    // a divider's z is the cabinet centre plus its share of the interior depth from the back wall's inner face
    const zs = dividers.map((x) => x.center[2]).sort((a, b) => a - b);
    expect(zs[0]!).toBeCloseTo(-g.dO / 2 - g.dI / 2 + g.dI * (120 / total), 9);
    expect(zs[1]! - zs[0]!).toBeCloseTo(g.dI * (70 / total), 9);
    expect(lay.tubes.length).toBe(2);
  });

  it('the 4th- and 6th-order boxes still draw their single divider', () => {
    for (const type of ['bandpass', 'bandpass6'] as const) {
      const p = S.sanitizeProject({ ...S.DEFAULT_PROJECT, bands: [{ design: M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: 2, type, volumeL: 120, frontVolumeL: 80, tuneHz: 40 }) }] });
      expect(layout3d(L.computeBuild(p), p).boxes.filter((x) => x.kind === 'divider').length).toBe(1);
    }
  });
});

describe('8th-order layouts in the app (N3b)', () => {
  const lay = (layout: P.Bp8Layout, more: Partial<M.Design> = {}): M.Design => d8({ bp8: bp8({ layout }), ...more });

  it('the layout is stored, defaults to vented, and an unknown one is vented', () => {
    expect(M.DEFAULT_DESIGN.bp8.layout).toBe('vented');
    expect(M.sanitize({ bp8: { layout: 'sealed' } }).bp8.layout).toBe('sealed');
    expect(M.sanitize({ bp8: { layout: 'chain' } }).bp8.layout).toBe('chain');
    expect(M.sanitize({ bp8: { layout: 'nonsense' } }).bp8.layout).toBe('vented');
    expect(M.BP8_LAYOUTS.map((l) => l.id)).toEqual(['vented', 'chain', 'sealed']);
  });

  it('the plotted response follows the layout', () => {
    for (const layout of ['vented', 'sealed', 'chain'] as const) {
      const d = lay(layout, { qL: 7 });
      const c = M.compute(d);
      const driver = M.driverOf(d);
      const r = P.deriveDriver(driver);
      const k = c.freqs.findIndex((f) => f >= 50);
      const f = c.freqs[k]!;
      const g = P.bandpass8G(f, driver.fs, r.qts, driver.vasM3 / 0.12, driver.vasM3 / 0.07, driver.vasM3 / 0.09, d.bp6.rearTuneHz, 70, 45, 7, 7, 7, layout);
      expect(c.curves.responseDb[k]).toBeCloseTo(P.dB(P.abs(g)), 9);
      for (const key of ['responseDb', 'excursionMm', 'impedanceOhm', 'phaseDeg', 'groupDelayMs'] as const) expect(c.curves[key].every(Number.isFinite)).toBe(true);
    }
    const a = M.compute(lay('vented')).curves.responseDb;
    const b = M.compute(lay('sealed')).curves.responseDb;
    expect(a.some((v, i) => Math.abs(v - b[i]!) > 0.5)).toBe(true);
  });

  it('sealed: no rear port readout, no fr marker, no rear vent warning, and the summary says so', () => {
    const c = M.compute(lay('sealed'));
    expect(val(c, 'Rear port length')).toBeUndefined();
    expect(c.markers.map((m) => m.label)).not.toContain('fr');
    expect(c.markers.map((m) => m.label)).toContain('f1');
    expect(c.notes.some((n) => n.includes('Rear-sealed layout'))).toBe(true);
    expect(M.compute(lay('sealed', { bp6: bp6({ rearPortDiameterCm: 2 }) })).warnings.some((w) => w.includes('rear vent'))).toBe(false);
    expect(S.summary(lay('sealed'))).toContain('rear-sealed two-stage band-pass at 70 and 45 Hz');
  });

  it('chain: the rear port joins two chambers, so it takes the internal end correction; the summary says rear into front', () => {
    const d = lay('chain');
    const c = M.compute(d);
    expect(val(c, 'Rear port length, into the inner chamber')).toMatch(/cm/);
    expect(Number.parseFloat(val(c, 'Rear port length')!)).toBeCloseTo(P.portLengthInternalM(d.volumeL / 1000, d.bp6.rearTuneHz, d.bp6.rearPortDiameterCm / 100) * 100, 0);
    expect(M.bp8RearPortLengthM(d)).toBeCloseTo(P.portLengthInternalM(0.12, d.bp6.rearTuneHz, d.bp6.rearPortDiameterCm / 100), 12);
    // vented: the rear port goes to the room
    expect(M.bp8RearPortLengthM(lay('vented'))).toBeCloseTo(P.portLengthM(0.12, d.bp6.rearTuneHz, d.bp6.rearPortDiameterCm / 100), 12);
    expect(S.summary(d)).toContain('8th-order band-pass (rear into front) at 45, 70 and 45 Hz');
    expect(c.notes.some((n) => n.includes('rear vented into the front chamber'))).toBe(true);
  });

  it('cut list: vented has two baffle ports, sealed one, chain one; the tubes in the bill follow (3, 2, 3)', () => {
    const tubes = (v: ReturnType<typeof build>): number => v.bom.filter((x) => x.item.startsWith('Round port tube')).reduce((a, x) => a + x.qty, 0);
    const vented = build(lay('vented'));
    const sealed = build(lay('sealed'));
    const chain = build(lay('chain'));
    expect(vented.bands[0]!.ports.length).toBe(2);
    expect(sealed.bands[0]!.ports.length).toBe(1);
    expect(chain.bands[0]!.ports.length).toBe(1);
    expect(vented.bands[0]!.innerPorts!.length).toBe(1);
    expect(sealed.bands[0]!.innerPorts!.length).toBe(1);
    expect(chain.bands[0]!.innerPorts!.length).toBe(2);
    expect([tubes(vented), tubes(sealed), tubes(chain)]).toEqual([3, 2, 3]);
    for (const v of [vented, sealed, chain]) expect(v.cutList.find((r) => r.part === 'Divider')!.qty).toBe(2);
    expect(sealed.bands[0]!.warnings.some((w) => w.includes('rear chamber is sealed'))).toBe(true);
    expect(chain.bands[0]!.warnings.some((w) => w.includes('through the driver') && w.includes('into the inner front chamber'))).toBe(true);
  });

  it("chain's rear tube is the internal length, the vented one the room length; port 1 is internal in both", () => {
    const dc = lay('chain');
    const dv = lay('vented');
    const chain = build(dc).bands[0]!;
    const vented = build(dv).bands[0]!;
    expect(chain.innerPorts![1]!.lengthM).toBeCloseTo(P.portLengthInternalM(0.12, dc.bp6.rearTuneHz, dc.bp6.rearPortDiameterCm / 100), 12);
    expect(vented.ports[1]!.lengthM).toBeCloseTo(P.portLengthM(0.12, dv.bp6.rearTuneHz, dv.bp6.rearPortDiameterCm / 100), 12);
    expect(chain.innerPorts![0]!.lengthM).toBeCloseTo(P.portLengthInternalM(0.07, 70, 0.15), 12);
    expect(vented.innerPorts![0]!.lengthM).toBeCloseTo(P.portLengthInternalM(0.07, 70, 0.15), 12);
  });

  it('a sealed rear has no rear port to fit: a hopeless rear port setting gives no warning and no tube', () => {
    const d = lay('sealed', { volumeL: 500, bp6: bp6({ rearTuneHz: 100, rearPortDiameterCm: 4 }) });
    expect(build(d).bands[0]!.warnings.some((w) => w.includes('rear port does not fit'))).toBe(false);
    expect(M.compute(d).warnings.some((w) => w.includes('rear port cannot tune'))).toBe(false);
    expect(build(d).bands[0]!.innerPorts!.length).toBe(1);
    // the same setting does warn when the rear port exists
    expect(M.compute(lay('chain', { volumeL: 500, bp6: bp6({ rearTuneHz: 100, rearPortDiameterCm: 4 }) })).warnings.some((w) => w.includes('rear port cannot tune'))).toBe(true);
  });

  it('the port diameter helper for an internal port uses the internal end correction', () => {
    const driver = M.driverOf(d8());
    const dia = M.portDiameterCmFor(driver, 70, 70, 8, true);
    expect(P.portLengthInternalM(0.07, 70, dia / 100) * 100).toBeGreaterThanOrEqual(7.9);
    expect(P.portLengthInternalM(0.07, 70, (dia * 0.95) / 100) * 100 < 8 || dia * 0.95 < P.minVentDiameterM(P.displacementVolume(driver), 70) * 100).toBe(true);
    expect(M.portDiameterCmFor(driver, 70, 70, 8, true)).toBeGreaterThanOrEqual(M.portDiameterCmFor(driver, 70, 70, 8, false) - 1e-9);
  });
});
