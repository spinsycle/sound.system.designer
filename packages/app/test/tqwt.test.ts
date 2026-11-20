import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import * as L from '../src/buildlist';
import { layout3d } from '../src/layout3d';
import * as M from '../src/model';
import * as S from '../src/system';

const driver = P.ALL_DRIVER_CLASSES[1]!;
const dq = (more: Partial<M.Design> = {}): M.Design => M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: 1, type: 'tqwt', tl: M.tqwtSettingsFor(driver), ...more });
const val = (c: M.Computed, label: string): string | undefined => [...c.readouts, ...c.extras].find((r) => r.label.startsWith(label))?.value;
const build = (design: M.Design) => L.computeBuild(S.sanitizeProject({ ...S.DEFAULT_PROJECT, bands: [{ design }] }));

describe('TQWT design rule (N2)', () => {
  it('is c/(4 Fs) long, the mouth the cone area, the closed end four times that, the driver at a third', () => {
    const des = P.tqwtDesign(driver);
    expect(des.lengthM).toBeCloseTo(P.C / (4 * driver.fs), 12);
    expect(des.exitM2).toBe(driver.sd);
    expect(des.startM2).toBeCloseTo(4 * driver.sd, 12);
    expect(des.offset).toBeCloseTo(1 / 3, 12);
    expect(des.chamberM3).toBe(0);
  });

  it('as app settings: line fields from the rule, light stuffing over the closed half, accepted by sanitize', () => {
    const tl = M.tqwtSettingsFor(driver);
    expect(tl.kind).toBe('offset');
    expect(tl.offsetPct).toBe(33);
    expect(tl.densityLb).toBe(0.5);
    expect(tl.stuffedPct).toBe(50);
    expect(tl.chamberL).toBe(0);
    expect(tl.lengthCm).toBeCloseTo((P.C / (4 * driver.fs)) * 100, 1);
    expect(M.sanitize({ type: 'tqwt', tl }).type).toBe('tqwt');
  });
});

describe('TQWT in the app model (N2)', () => {
  it('simulates as the transmission line with the same settings', () => {
    const a = M.compute(dq());
    const b = M.compute(M.sanitize({ ...dq(), type: 'tline' }));
    expect(a.curves.responseDb).toEqual(b.curves.responseDb);
    expect(a.curves.impedanceOhm).toEqual(b.curves.impedanceOhm);
    for (const key of ['responseDb', 'excursionMm', 'impedanceOhm', 'phaseDeg', 'groupDelayMs'] as const) expect(a.curves[key].every(Number.isFinite)).toBe(true);
  });

  it('readouts: line resonance, driver position, mouth against the cone, and the level and line-area rows', () => {
    const c = M.compute(dq());
    expect(val(c, 'Line resonance fp')).toMatch(/Hz/);
    expect(val(c, 'Driver position from the closed end')).toMatch(/33 % of the line/);
    expect(val(c, 'Mouth area against the cone')).toBe('100 %');
    expect(val(c, 'Line exit area')).toMatch(/cm²/);
    expect(val(c, 'Highest steady level')).toMatch(/dB SPL/);
    expect(c.markers.map((m) => m.label)).toContain('fp');
  });

  it('warns on a mouth far smaller than the cone, and on a driver far from a third of the way up', () => {
    const tl = M.tqwtSettingsFor(driver);
    expect(M.compute(dq({ tl: { ...tl, exitCm2: tl.exitCm2 * 0.5 } })).warnings.some((w) => w.includes("cone's area"))).toBe(true);
    expect(M.compute(dq()).warnings.some((w) => w.includes("cone's area"))).toBe(false);
    expect(M.compute(dq({ tl: { ...tl, offsetPct: 10 } })).warnings.some((w) => w.includes('of the way up the line'))).toBe(true);
    expect(M.compute(dq({ tl: { ...tl, offsetPct: 33 } })).warnings.some((w) => w.includes('of the way up the line'))).toBe(false);
  });

  it('the summary says TQWT and the length', () => {
    expect(S.summary(dq())).toContain('TQWT,');
  });
});

describe('TQWT column geometry (N2)', () => {
  const geo = M.tlGeometryOf(dq());
  const col = P.tqwtColumn(geo, 0.3, 0.02);

  it('is as wide as the driver and the top need, and its depths make the line areas', () => {
    expect(col.wI).toBeGreaterThanOrEqual(0.3 + 0.04 - 1e-12);
    expect(col.wI).toBeGreaterThanOrEqual(0.8 * Math.sqrt(geo.startM2) - 1e-12);
    expect(col.wI * col.depthTopI).toBeCloseTo(geo.startM2, 12);
    expect(col.wI * col.depthMouthI).toBeCloseTo(geo.exitM2, 12);
    expect(col.sections.length).toBe(P.TQWT_SECTIONS);
  });

  it('the staircase back follows the exponential taper at every station, and the sections chain', () => {
    col.sections.forEach((s, k) => {
      expect(s.d1 * col.wI).toBeCloseTo(geo.startM2 * (geo.exitM2 / geo.startM2) ** (s.x1 / geo.lengthM), 12);
      expect(s.slant).toBeCloseTo(Math.hypot(s.x2 - s.x1, s.d2 - s.d1), 12);
      if (k > 0) expect(s.d1).toBeCloseTo(col.sections[k - 1]!.d2, 12);
    });
    expect(col.sections[0]!.x1).toBe(0);
    expect(col.sections[col.sections.length - 1]!.x2).toBeCloseTo(geo.lengthM, 12);
  });

  it("holds the line's own air to within 3 %", () => {
    expect(Math.abs(col.volumeM3 - M.tlLineVolumeM3(geo)) / M.tlLineVolumeM3(geo)).toBeLessThan(0.03);
  });

  it('a wide driver sets the width: its hole plus a margin each side', () => {
    expect(P.tqwtColumn(geo, 0.9, 0.02).wI).toBeCloseTo(0.94, 12);
    // a narrow driver and a small closed end: the 0.2 m minimum
    expect(P.tqwtColumn({ ...geo, startM2: 0.01, exitM2: 0.0025 }, 0.05, 0.01).wI).toBeCloseTo(0.2, 12);
  });

  it('puts the driver a third of the line from the closed end', () => {
    expect(col.driverFromTop).toBeCloseTo(geo.lengthM * geo.offset, 12);
  });
});

describe('TQWT cut list and 3D (N2)', () => {
  it('one column cabinet: front baffle, closed top, a back section and a side pair for every section, one driver hole', () => {
    const v = build(dq());
    const b = v.bands[0]!;
    expect(b.cabinets.map((c) => c.title)).toEqual(['TQWT column']);
    const parts = v.cutList.map((r) => r.part);
    expect(parts.some((x) => x.includes('Front baffle'))).toBe(true);
    expect(parts.some((x) => x.includes('Closed top'))).toBe(true);
    expect(parts.filter((x) => x.includes('Back section')).length).toBe(P.TQWT_SECTIONS);
    expect(v.cutList.filter((r) => r.part.includes('Side section')).every((r) => r.qty === 2)).toBe(true);
    expect(v.cutList.filter((r) => r.part.includes('Side section')).length).toBe(P.TQWT_SECTIONS);
    expect(b.cabinets[0]!.cutouts.filter((x) => x.kind === 'driver').length).toBe(1);
    expect(b.cabinets[0]!.column).toBeDefined();
  });

  it('the front baffle is as tall as the line plus the top, the back sections are as wide as the inside, and the driver hole is on the baffle', () => {
    const d = dq();
    const geo = M.tlGeometryOf(d);
    const c = build(d).bands[0]!.cabinets[0]!;
    const t = 0.018;
    const front = c.panels.find((x) => x.name === 'Front baffle')!;
    expect(front.w).toBeCloseTo(geo.lengthM + t, 12);
    expect(front.l).toBeCloseTo(c.column!.wI + 2 * t, 12);
    for (const p of c.panels.filter((x) => x.name.startsWith('Back section'))) expect(p.l).toBeCloseTo(c.column!.wI, 12);
    expect(c.holes![0]!.cy).toBeCloseTo(t + geo.lengthM * geo.offset, 12);
    expect(c.holes![0]!.cx).toBeCloseTo(front.l / 2, 12);
  });

  it('warns about the open mouth and feet, and the air against the line', () => {
    const w = build(dq()).bands[0]!.warnings;
    expect(w.some((x) => x.includes('mouth is open at the bottom'))).toBe(true);
    expect(w.some((x) => x.includes('the TQWT is a column'))).toBe(true);
  });

  it('stuffing is in the bill of materials', () => {
    expect(build(dq()).bom.some((x) => x.item === 'Line stuffing (loose fibre)' && x.qty > 0)).toBe(true);
  });

  it('3D: front and top boxes, two side prisms and a back prism for every section, the driver on the front at the right height', () => {
    const d = dq();
    const p = S.sanitizeProject({ ...S.DEFAULT_PROJECT, bands: [{ design: d }] });
    const v = L.computeBuild(p);
    const lay = layout3d(v, p);
    expect(lay.boxes.length).toBe(2);
    expect(lay.prisms.length).toBe(3 * P.TQWT_SECTIONS);
    expect(lay.drivers.length).toBe(1);
    const g = v.bands[0]!.cabinets[0]!.geometry;
    const geo = M.tlGeometryOf(d);
    expect(lay.drivers[0]!.flange[1]).toBeCloseTo(g.hO - (0.018 + geo.lengthM * geo.offset), 9);
    expect(lay.drivers[0]!.flange[2]).toBe(0);
    expect(lay.extent[1]).toBeCloseTo(g.hO, 12);
    // the driver faces out of the front, its motor towards -z (into the column)
    expect(lay.drivers[0]!.dir).toEqual([0, 0, -1]);
    // the depth is the box's outside depth: front panel, closed top depth, back sheet
    expect(lay.extent[2]).toBeCloseTo(g.dO, 12);
    // the closed top sits on the very top of the column
    const cap = lay.boxes.find((b) => b.size[1] === 0.018)!;
    expect(cap.center[1]).toBeCloseTo(g.hO - 0.009, 12);
    // the first section starts at the closed end (top of the line) and the last ends at the mouth on the floor
    const ys = lay.prisms.flatMap((q) => q.points.map((pt) => pt[1]));
    expect(Math.max(...ys)).toBeCloseTo(geo.lengthM, 12);
    expect(Math.min(...ys)).toBeCloseTo(0, 12);
  });

  it('the back sections are cut to their slope length', () => {
    const c = build(dq()).bands[0]!.cabinets[0]!;
    c.column!.sections.forEach((s, k) => {
      const panel = c.panels.find((x) => x.name === `Back section ${k + 1}`)!;
      expect(panel.w).toBeCloseTo(s.slant, 12);
      expect(panel.w).toBeGreaterThan(s.x2 - s.x1);
    });
  });
});
