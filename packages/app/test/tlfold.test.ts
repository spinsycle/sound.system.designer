import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import * as L from '../src/buildlist';
import * as M from '../src/model';
import * as S from '../src/system';

const driver = P.ALL_DRIVER_CLASSES[2]!;
const tl = (kind: P.TlKind = 'taper'): M.Design => M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: 2, type: 'tline', tl: M.tlSettingsFor(driver, kind, 'extended', 'acousta') });
const build = (design: M.Design) => L.computeBuild(S.sanitizeProject({ ...S.DEFAULT_PROJECT, bands: [{ design }] }));

describe('transmission line cut as a folded duct (U2)', () => {
  it('the profile is the simulation taper: start area at 0, exit area at the end, exponential between', () => {
    const geo = M.tlGeometryOf(tl());
    const pr = P.tlProfile(geo);
    expect(pr.length).toBe(geo.lengthM);
    expect(pr.area(0)).toBeCloseTo(geo.startM2, 12);
    expect(pr.area(geo.lengthM)).toBeCloseTo(geo.exitM2, 12);
    expect(pr.area(geo.lengthM / 2)).toBeCloseTo(Math.sqrt(geo.startM2 * geo.exitM2), 12);
  });

  it('folding the flare through the profile gives the same layout as the flare itself (refactor guard)', () => {
    const fl: P.Flare = { kind: 'exponential', throatM2: 0.05, mouthM2: 0.5, cutoffHz: 60, t: 1, lengthM: 0 };
    for (const style of ['stepped', 'tapered'] as const) {
      const a = P.foldHorn(fl, 0.6, 4, 1.2, 0.018, style);
      const b = P.foldProfile(P.flareProfile(fl), 0.6, 4, 1.2, 0.018, style);
      expect(b).toEqual(a);
    }
  });

  it('the folded line carries a path of the right length, an even leg count, the exit on the front, and septa in the cut list', () => {
    const d = tl();
    const geo = M.tlGeometryOf(d);
    const v = build(d);
    const cab = v.bands[0]!.cabinets.find((c) => c.title === 'Transmission line')!;
    const f = cab.fold!;
    expect(f.heights.length % 2).toBe(0);
    expect(f.mouthAtFront).toBe(true);
    expect(f.feasible).toBe(true);
    expect(f.length).toBe(geo.lengthM);
    // the legs and their turns reproduce the line length within the turn allowance
    expect(f.leg * f.heights.length).toBeLessThanOrEqual(geo.lengthM + 1e-9);
    expect(v.cutList.filter((r) => r.part.includes('Fold septum')).reduce((a, r) => a + r.qty, 0)).toBe(f.heights.length - 1);
    // each leg's cross-section is the profile's area at its middle (stepped folds)
    f.heights.forEach((h, k) => {
      const mid = (f.starts[k]! + f.ends[k]!) / 2;
      expect(f.wI * h).toBeCloseTo(P.tlProfile(geo).area(mid), 9);
    });
  });

  it('a driver chamber joins the line start: the model chamber when it has one, else a coupling box with a warning', () => {
    const none = build(tl('taper'));
    const withCh = build(tl('chamber'));
    const chamber = (v: ReturnType<typeof build>) => v.bands[0]!.cabinets.find((c) => c.title === 'Chamber behind the cone')!;
    expect(chamber(none)).toBeDefined();
    expect(none.bands[0]!.warnings.some((w) => w.includes('the cut list adds'))).toBe(true);
    expect(withCh.bands[0]!.warnings.some((w) => w.includes('the cut list adds') && w.includes('simulation has'))).toBe(false);
    // the chamber cabinet holds the driver hole; the folded box does not
    expect(chamber(withCh).cutouts.some((x) => x.kind === 'driver')).toBe(true);
    expect(withCh.bands[0]!.cabinets.find((c) => c.title === 'Transmission line')!.cutouts.some((x) => x.kind === 'driver')).toBe(false);
  });

  it('3D draws a divider box for every septum of the folded line', () => {
    const p = S.sanitizeProject({ ...S.DEFAULT_PROJECT, bands: [{ design: tl() }] });
    const v = L.computeBuild(p);
    const f = v.bands[0]!.cabinets.find((c) => c.title === 'Transmission line')!.fold!;
    const lay = layoutOf(v, p);
    expect(lay.boxes.filter((b) => b.kind === 'divider').length).toBe(f.heights.length - 1);
  });

  it('the line box is as wide as the start area asks, and holds no more depth than the folds need', () => {
    const d = tl();
    const geo = M.tlGeometryOf(d);
    const f = build(d).bands[0]!.cabinets.find((c) => c.title === 'Transmission line')!.fold!;
    expect(f.wI).toBeCloseTo(Math.max(0.25, 1.5 * Math.sqrt(geo.startM2)), 6);
    // the suggested depth is rounded up to the centimetre, so no more than that over the minimum
    expect(f.dI - f.minDepthI).toBeLessThan(0.011);
  });

  it("the driver's box holds the baffle (hole plus margins) and is at least 10 cm deep", () => {
    const d = tl();
    const driverM = 2 * Math.sqrt(P.ALL_DRIVER_CLASSES[2]!.sd / Math.PI);
    const g = build(d).bands[0]!.cabinets.find((c) => c.title === 'Chamber behind the cone')!.geometry;
    expect(g.wI).toBeGreaterThanOrEqual(driverM + 2 * L.HOLE_MARGIN - 1e-9);
    expect(g.dI).toBeGreaterThanOrEqual(0.1 - 1e-9);
    expect(g.dI).toBeLessThan(0.16);
    expect(g.hI / g.wI).toBeCloseTo(1.15, 1);
  });

  it('a line that cannot fold at any width falls back to one box with a septum and says so', () => {
    const base = tl();
    const d = M.sanitize({ ...base, tl: { ...base.tl, lengthCm: 20, startCm2: 20000, exitCm2: 20000 } });
    const v = build(d);
    expect(v.bands[0]!.cabinets.map((c) => c.title)).toEqual(['Transmission-line box']);
    expect(v.cutList.some((r) => r.part.includes('Divider'))).toBe(true);
    expect(v.bands[0]!.warnings.some((w) => w.includes('no fold of this line fits'))).toBe(true);
  });
});

import { layout3d as layoutOf } from '../src/layout3d';
