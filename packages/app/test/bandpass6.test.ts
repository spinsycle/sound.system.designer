import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import * as L from '../src/buildlist';
import { layout3d } from '../src/layout3d';
import * as M from '../src/model';
import * as S from '../src/system';

const d6 = (more: Partial<M.Design> = {}): M.Design => M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: 2, type: 'bandpass6', volumeL: 120, frontVolumeL: 80, tuneHz: 40, ...more });
const val = (c: M.Computed, label: string): string | undefined => [...c.readouts, ...c.extras].find((r) => r.label.startsWith(label))?.value;
const build = (design: M.Design) => L.computeBuild(S.sanitizeProject({ ...S.DEFAULT_PROJECT, bands: [{ design }] }));
const bp6 = (patch: Partial<M.Bp6Design>): M.Bp6Design => ({ ...M.DEFAULT_DESIGN.bp6, ...patch });

describe('6th-order band-pass in the app model (N1)', () => {
  it('is a box type, defaults for stored designs, and the passband ordering holds', () => {
    expect(M.BOX_KINDS.some((k) => k.id === 'bandpass6')).toBe(true);
    const { bp6: _b, ...older } = M.DEFAULT_DESIGN;
    expect(M.sanitize({ ...older, type: 'bandpass6' }).bp6).toEqual(M.DEFAULT_DESIGN.bp6);
    expect(M.sanitize({ bp6: { loHz: 100, hiHz: 100 } }).bp6.hiHz).toBeCloseTo(120, 9);
    expect(M.sanitize({ bp6: { rearTuneHz: 9999, rearPortDiameterCm: 0 } }).bp6).toMatchObject({ rearTuneHz: 200, rearPortDiameterCm: 2 });
  });

  it('the plotted response is the physics response, the displacement and impedance follow', () => {
    const d = d6({ qL: 7 });
    const c = M.compute(d);
    const driver = M.driverOf(d);
    const r = P.deriveDriver(driver);
    const k = c.freqs.findIndex((f) => f >= 45);
    const f = c.freqs[k]!;
    const g = P.bandpass6G(f, driver.fs, r.qts, driver.vasM3 / 0.12, driver.vasM3 / 0.08, d.bp6.rearTuneHz, 40, 7, 7);
    expect(c.curves.responseDb[k]).toBeCloseTo(P.dB(P.abs(g)), 9);
    const x = P.bandpass6X(f, driver, r, driver.vasM3 / 0.12, driver.vasM3 / 0.08, d.bp6.rearTuneHz, 40, 7, 7);
    expect(c.curves.excursionMm[k]).toBeCloseTo(P.abs(x) * P.peakVoltsForPower(d.powerW, driver.re) * 1000, 9);
    expect(c.curves.impedanceOhm[k]).toBeCloseTo(P.abs(P.impedanceFromDisplacement(f, x, r.bl, driver.re)), 9);
    for (const key of ['responseDb', 'excursionMm', 'impedanceOhm', 'phaseDeg', 'groupDelayMs'] as const) expect(c.curves[key].every(Number.isFinite)).toBe(true);
  });

  it('qL 0 is lossless: nulls in the displacement at both tunings', () => {
    const c = M.compute(d6({ qL: 0, tuneHz: 40, bp6: bp6({ rearTuneHz: 70 }) }));
    const at = (f: number): number => c.curves.excursionMm[c.freqs.reduce((best, x, i) => (Math.abs(x - f) < Math.abs(c.freqs[best]! - f) ? i : best), 0)]!;
    expect(at(40)).toBeLessThan(at(55));
    expect(at(70)).toBeLessThan(at(55));
  });

  it('readouts: both port lengths and both tunings on the plots; a rear port length that is negative is flagged', () => {
    const c = M.compute(d6());
    expect(val(c, 'Port length')).toMatch(/cm/);
    expect(val(c, 'Rear port length')).toMatch(/cm/);
    const d = d6();
    expect(Number.parseFloat(val(c, 'Rear port length')!)).toBeCloseTo(P.portLengthM(d.volumeL / 1000, d.bp6.rearTuneHz, d.bp6.rearPortDiameterCm / 100) * 100, 0);
    expect(c.markers.map((m) => m.label)).toEqual(expect.arrayContaining(['fb', 'fr']));
    // a very fat rear port in a small rear chamber at a low tuning cannot be tuned
    const bad = M.compute(d6({ volumeL: 500, bp6: bp6({ rearTuneHz: 100, rearPortDiameterCm: 4 }) }));
    expect(val(bad, 'Rear port length')).toBe('does not fit');
    expect(bad.warnings.some((w) => w.includes('rear port cannot tune'))).toBe(true);
  });

  it('warns when the two tunings are about equal, and when the rear vent is under the Cookbook minimum', () => {
    expect(M.compute(d6({ tuneHz: 50, bp6: bp6({ rearTuneHz: 50.5 }) })).warnings.some((w) => w.includes('almost equal'))).toBe(true);
    expect(M.compute(d6()).warnings.some((w) => w.includes('almost equal'))).toBe(false);
    expect(M.compute(d6({ bp6: bp6({ rearPortDiameterCm: 2 }) })).warnings.some((w) => w.includes('rear vent'))).toBe(true);
  });

  it('carries the level readouts of U1', () => {
    expect(val(M.compute(d6()), 'Highest steady level')).toMatch(/dB SPL/);
  });

  it('the summary names both tunings', () => {
    expect(S.summary(d6())).toContain('6th-order band-pass at 45 and 40 Hz');
  });
});

describe('6th-order helper and port diameters (N1)', () => {
  const driver = M.driverOf(d6());
  it('the port diameter helper gives the narrowest port at least 8 cm long that is not under the Cookbook minimum vent', () => {
    for (const [ch, f] of [[150, 45], [60, 90], [300, 30]] as const) {
      const dia = M.portDiameterCmFor(driver, ch, f);
      const len = (cm: number): number => P.portLengthM(ch / 1000, f, cm / 100) * 100;
      const dMin = P.minVentDiameterM(P.displacementVolume(driver), f) * 100;
      expect(len(dia)).toBeGreaterThanOrEqual(7.9);
      expect(dia).toBeGreaterThanOrEqual(dMin - 0.01);
      // narrower and it is either under the minimum vent or too short
      expect(dia * 0.95 < dMin || len(dia * 0.95) < 8).toBe(true);
    }
  });

  it('a chamber too big for its tuning gets the widest port the box allows', () => {
    expect(M.portDiameterCmFor(driver, 1000, 200)).toBe(M.BOX_RANGES.portDiameterCm.max);
  });

  it('what the helper designs builds: both ports fit and the cut list has both tubes', () => {
    const a = P.bandpass6Design(driver, 40, 80, 7);
    const d = d6({
      volumeL: a.rearL,
      frontVolumeL: a.frontL,
      tuneHz: a.frontHz,
      portDiameterCm: M.portDiameterCmFor(driver, a.frontL, a.frontHz),
      bp6: bp6({ rearTuneHz: a.rearHz, rearPortDiameterCm: M.portDiameterCmFor(driver, a.rearL, a.rearHz) }),
    });
    const c = M.compute(d);
    expect(val(c, 'Port length')).toMatch(/cm$/);
    expect(val(c, 'Rear port length')).toMatch(/cm$/);
    expect(build(d).bands[0]!.ports.length).toBe(2);
  });
});

describe('6th-order band-pass cut list and 3D (N1)', () => {
  it('one cabinet with a divider, the driver hole and two ports; the rear port is round at its own diameter and length', () => {
    const d = d6({ bp6: bp6({ rearPortDiameterCm: 8 }) });
    const v = build(d);
    const b = v.bands[0]!;
    expect(b.cabinets.map((c) => c.title)).toEqual(['6th-order band-pass box']);
    expect(v.cutList.some((r) => r.part.includes('Divider'))).toBe(true);
    expect(b.ports.length).toBe(2);
    expect(b.ports[1]!.diameterM).toBeCloseTo(0.08, 9);
    // the rear port tunes the REAR chamber, with the rear tuning (not the front's)
    expect(b.ports[1]!.lengthM).toBeCloseTo(P.portLengthM(d.volumeL / 1000, d.bp6.rearTuneHz, 0.08), 12);
    expect(M.bp6RearPortLengthM(d)).toBeCloseTo(b.ports[1]!.lengthM, 12);
    expect(b.ports[0]!.lengthM).toBeCloseTo(M.portLengthOf(d, d.frontVolumeL), 12);
    expect(b.cabinets[0]!.cutouts.filter((x) => x.kind === 'port').length).toBe(2);
    expect(b.warnings.some((w) => w.includes('6th-order box is one cabinet'))).toBe(true);
  });

  it('the box holds more than the two chambers: the driver and both ports take room', () => {
    const d = d6();
    const g = build(d).bands[0]!.cabinets[0]!.geometry;
    expect(g.wI * g.hI * g.dI).toBeGreaterThan((d.volumeL + d.frontVolumeL) / 1000);
  });

  it('a rear port that does not fit leaves it out of the cut list and says so', () => {
    const v = build(d6({ volumeL: 500, bp6: bp6({ rearTuneHz: 100, rearPortDiameterCm: 4 }) }));
    expect(v.bands[0]!.ports.length).toBe(1);
    expect(v.bands[0]!.warnings.some((w) => w.includes('rear port does not fit'))).toBe(true);
  });

  it('3D draws the divider and a tube for each port', () => {
    const p = S.sanitizeProject({ ...S.DEFAULT_PROJECT, bands: [{ design: d6() }] });
    const lay = layout3d(L.computeBuild(p), p);
    expect(lay.boxes.filter((x) => x.kind === 'divider').length).toBe(1);
    expect(lay.tubes.length).toBe(2);
  });
});
