// A4 pass condition: for a reference box the cut list reproduces the designed internal volume (to 0.5 %) and every panel
// dimension matches a hand calculation. The geometry itself is asserted against the shared cab_* vectors in the physics tests.
import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import * as B from '../src/build';
import * as L from '../src/buildlist';
import * as M from '../src/model';
import * as S from '../src/system';

const design = (more: Partial<M.Design>): M.Design => ({ ...M.DEFAULT_DESIGN, driverClass: 2, ...more }); // the 15 in class: Sd 0.0855 m2
const band = (d: M.Design, more: Partial<S.Band> = {}): S.Band => ({ ...S.DEFAULT_PROJECT.bands[0]!, design: d, ...more });
const project = (bands: S.Band[], more: Partial<S.Project> = {}): S.Project =>
  S.sanitizeProject({ ...S.DEFAULT_PROJECT, nBands: bands.length, bands: [...bands, ...S.DEFAULT_PROJECT.bands.slice(bands.length)], ...more });
const row = (v: L.BuildView, part: string): L.CutRow => v.cutList.find((r) => r.part === part)!;
const sealed100 = design({ type: 'sealed', volumeL: 100 });

describe('cut list of a sealed box', () => {
  const p = project([band(sealed100)]);
  const v = L.computeBuild(p);
  const t = 18;

  it('hand calculation: panel sizes follow from the interior and the wall', () => {
    const s = (0.1 + P.driverDisplacement(0.0855)) ** (1 / 3) / (1 * 1.5 * 1) ** (1 / 3);
    const wI = s * 1000;
    const hI = s * 1500;
    expect(row(v, 'Front baffle').l).toBe(Math.round(wI + 2 * t));
    expect(row(v, 'Front baffle').w).toBe(Math.round(hI + 2 * t));
    expect(row(v, 'Top and bottom').l).toBe(Math.round(wI + 2 * t));
    expect(row(v, 'Top and bottom').w).toBe(Math.round(wI)); // depth ratio 1: interior depth = interior width
    expect(row(v, 'Sides').l).toBe(Math.round(hI));
    expect(row(v, 'Sides').w).toBe(Math.round(wI));
    expect([row(v, 'Front baffle').qty, row(v, 'Back').qty, row(v, 'Top and bottom').qty, row(v, 'Sides').qty]).toEqual([1, 1, 2, 2]);
  });

  it('the cut list rebuilds the designed volume to within 0.5 %', () => {
    const wI = (row(v, 'Front baffle').l - 2 * t) / 1000;
    const hI = row(v, 'Sides').l / 1000;
    const dI = row(v, 'Top and bottom').w / 1000;
    const air = wI * hI * dI - P.driverDisplacement(0.0855);
    expect(Math.abs(air - 0.1) / 0.1).toBeLessThan(0.005);
  });

  it('bill of materials: sheets, driver, screws and glue follow from the cut list', () => {
    const joint = v.cutList.reduce((a, r) => a + r.qty * (r.l + r.w) * 2, 0) / 2 / 1000;
    expect(v.bom.find((b) => b.item === 'Wood screws')!.qty).toBe(Math.ceil(joint / L.SCREW_SPACING));
    expect(v.bom.find((b) => b.item === 'Wood glue')!.qty).toBe(Math.ceil(joint / L.GLUE_PER_BOTTLE));
    expect(v.bom.find((b) => b.item === '15 in driver')!.qty).toBe(1);
    expect(v.bom.find((b) => b.unit === 'sheets')!.qty).toBe(v.sheets);
    expect(v.bom.find((b) => b.item.startsWith('Damping'))!.qty).toBeGreaterThan(0.5);
    expect(v.waste).toBeGreaterThan(0);
    expect(v.waste).toBeLessThan(1);
  });

  it('several drivers in a band mean several cabinets', () => {
    const two = L.computeBuild(project([band(sealed100, { count: 2, series: 1 })]));
    expect(row(two, 'Front baffle').qty).toBe(2);
    expect(row(two, 'Sides').qty).toBe(4);
    expect(two.bom.find((b) => b.item === '15 in driver')!.qty).toBe(2);
    expect(two.pieces.length).toBe(2 * v.pieces.length);
  });

  it('no sheet is bigger than stock, and nothing overlaps its kerf neighbour', () => {
    const placed = v.pieces.filter((x) => x.placement.sheet >= 0);
    for (const x of placed) {
      expect(x.placement.x + x.placement.w).toBeLessThanOrEqual(2.44 + 1e-9);
      expect(x.placement.y + x.placement.h).toBeLessThanOrEqual(1.22 + 1e-9);
    }
    for (const a of placed)
      for (const b of placed)
        if (a !== b && a.placement.sheet === b.placement.sheet) {
          const apart = a.placement.x + a.placement.w <= b.placement.x + 1e-9 || b.placement.x + b.placement.w <= a.placement.x + 1e-9 || a.placement.y + a.placement.h <= b.placement.y + 1e-9 || b.placement.y + b.placement.h <= a.placement.y + 1e-9;
          expect(apart).toBe(true);
        }
  });
});

describe('ported, band-pass and braces', () => {
  it('a ported box has a port tube, the hole on the baffle, and a larger box than the sealed one', () => {
    const ported = L.computeBuild(project([band(design({ type: 'ported', volumeL: 100, tuneHz: 40, portDiameterCm: 10 }))]));
    const b = ported.bands[0]!;
    expect(b.port!.diameterM).toBeCloseTo(0.1, 12);
    expect(b.port!.lengthM).toBeCloseTo(P.portLengthM(0.1, 40, 0.1), 12);
    expect(b.cabinets[0]!.cutouts.map((c) => c.kind)).toEqual(['driver', 'port']);
    expect(b.cabinets[0]!.cutouts[0]!.diameterM).toBeCloseTo(2 * Math.sqrt(0.0855 / Math.PI), 12);
    expect(b.cabinets[0]!.geometry.netM3).toBeCloseTo(0.1, 9);
    expect(b.cabinets[0]!.geometry.wO).toBeGreaterThan(L.computeBuild(project([band(sealed100)])).bands[0]!.cabinets[0]!.geometry.wO);
    expect(ported.bom.some((x) => x.item.startsWith('Round port tube'))).toBe(true);
  });

  it('a port that does not fit is reported and left out', () => {
    expect(P.portLengthM(1, 200, 0.4)).toBeLessThan(0);
    const v = L.computeBuild(project([band(design({ type: 'ported', volumeL: 1000, tuneHz: 200, portDiameterCm: 40 }))]));
    expect(v.warnings.some((w) => w.includes('port does not fit'))).toBe(true);
    expect(v.bands[0]!.port).toBeNull();
    expect(v.bom.some((x) => x.item.startsWith('Round port tube'))).toBe(false);
  });

  it('a band-pass box is one cabinet of both chambers with a divider', () => {
    const v = L.computeBuild(project([band(design({ type: 'bandpass', volumeL: 60, frontVolumeL: 40, tuneHz: 60, portDiameterCm: 8 }))]));
    expect(v.bands[0]!.cabinets.length).toBe(1);
    expect(v.bands[0]!.cabinets[0]!.geometry.netM3).toBeCloseTo(0.1, 9);
    expect(row(v, 'Divider').qty).toBe(1);
    expect(v.warnings.some((w) => w.includes('60 % of the interior depth'))).toBe(true);
  });

  it('braces add frames to the list and enlarge the box', () => {
    const none = L.computeBuild(project([band(sealed100, { build: { rw: 1, rh: 1.5, rd: 3, brace: 'none' } })]));
    const win = L.computeBuild(project([band(sealed100, { build: { rw: 1, rh: 1.5, rd: 3, brace: 'window' } })]));
    expect(none.cutList.some((r) => r.part === 'Brace frame')).toBe(false);
    expect(row(win, 'Brace frame').qty).toBe(2);
    expect(row(win, 'Brace frame').note).toContain('window');
    expect(win.bands[0]!.cabinets[0]!.geometry.wI).toBeGreaterThan(none.bands[0]!.cabinets[0]!.geometry.wI);
  });
});

describe('horns and warnings', () => {
  const dance = S.applyTemplate(S.DEFAULT_PROJECT, S.TEMPLATES.findIndex((t) => t.label.includes('dancehall')));
  const v = L.computeBuild(dance);

  it('horn bands get straight sections whose sides and tops follow the table', () => {
    const hb = v.bands.find((b) => b.horn)!;
    const view = M.compute(dance.bands[v.bands.indexOf(hb)]!.design).horn!;
    expect(hb.horn!.sections.length).toBe(view.table.length - 1);
    const s0 = hb.horn!.sections[0]!;
    const [a, b] = [view.table[0]!, view.table[1]!];
    expect(s0.sideLen).toBeCloseTo((b.xCm - a.xCm) / 100, 12);
    expect(s0.slant).toBeCloseTo(Math.hypot((b.xCm - a.xCm) / 100, (b.heightCm - a.heightCm) / 200), 12);
    expect(v.cutList.filter((r) => r.part.startsWith('Horn 1:')).length).toBe(2 * v.bands.filter((x) => x.horn).length);
  });

  it('no panel lengths entered: the list says the horn was approximated', () => {
    expect(v.warnings.some((w) => w.includes('straight sections along the ideal flare'))).toBe(true);
  });

  it('a piece bigger than the sheet is reported and kept out of the sheet count', () => {
    const small = L.computeBuild({ ...dance, shop: { ...dance.shop, sheetLmm: 500, sheetWmm: 500 } });
    expect(small.warnings.some((w) => w.includes('larger than a 500 x 500 mm sheet'))).toBe(true);
    expect(small.pieces.some((x) => x.placement.sheet < 0)).toBe(true);
  });

  it('a driver that cannot fit the baffle is reported', () => {
    const narrow = L.computeBuild(project([band(design({ driverClass: 3, type: 'sealed', volumeL: 30 }), { build: { rw: 0.2, rh: 5, rd: 5, brace: 'none' } })]));
    expect(narrow.warnings.some((w) => w.includes('does not fit') && w.includes('baffle'))).toBe(true);
    expect(L.computeBuild(project([band(sealed100)])).warnings.filter((w) => w.includes('baffle'))).toEqual([]);
  });

  it('the driver and port together must fit the baffle', () => {
    const wide = L.computeBuild(project([band(design({ type: 'ported', volumeL: 40, tuneHz: 40, portDiameterCm: 12 }), { build: { rw: 1, rh: 1, rd: 0.5, brace: 'none' } })]));
    const g = wide.bands[0]!.cabinets[0]!.geometry;
    const d = wide.bands[0]!.cabinets[0]!.cutouts;
    expect(d[0]!.diameterM + 2 * L.HOLE_MARGIN).toBeLessThan(Math.min(g.wO, g.hO)); // each hole fits alone
    expect(d[0]!.diameterM + d[1]!.diameterM + 3 * L.HOLE_MARGIN).toBeGreaterThan(Math.max(g.wO, g.hO)); // but not both
    expect(wide.warnings.some((w) => w.includes('driver and port holes do not both fit'))).toBe(true);
    const roomy = L.computeBuild(project([band(design({ type: 'ported', volumeL: 100, tuneHz: 40, portDiameterCm: 10 }), { build: { rw: 1, rh: 1.5, rd: 1, brace: 'none' } })]));
    expect(roomy.warnings.some((w) => w.includes('baffle'))).toBe(false);
  });
});

describe('shop and build settings', () => {
  it('stored values are clamped, and round-trip through the project', () => {
    expect(B.sanitizeShop({ thicknessMm: 1, sheetLmm: 1e6, sheetWmm: 'x', kerfMm: -2 })).toEqual({ thicknessMm: 3, sheetLmm: 6000, sheetWmm: 1220, kerfMm: 0 });
    expect(B.sanitizeBuild({ rw: 0, rh: 99, rd: 2, brace: 'bogus' })).toEqual({ rw: 0.2, rh: 5, rd: 2, brace: 'none' });
    expect(B.sanitizeBuild({ brace: 'window' }).brace).toBe('window');
    const p = project([band(sealed100, { build: { rw: 1.2, rh: 1, rd: 2, brace: 'single' } })], { shop: { thicknessMm: 12, sheetLmm: 2500, sheetWmm: 1250, kerfMm: 2 } });
    expect(S.sanitizeProject(p)).toEqual(p);
    expect(p.bands[0]!.build.brace).toBe('single');
    expect(p.shop.thicknessMm).toBe(12);
    expect(S.sanitizeProject({ view: 'build' }).view).toBe('build');
  });

  it('a thinner wall makes the outside smaller and the same air', () => {
    const thin = L.computeBuild(project([band(sealed100)], { shop: { ...B.DEFAULT_SHOP, thicknessMm: 12 } }));
    const thick = L.computeBuild(project([band(sealed100)], { shop: { ...B.DEFAULT_SHOP, thicknessMm: 25 } }));
    expect(thin.bands[0]!.cabinets[0]!.geometry.wO).toBeLessThan(thick.bands[0]!.cabinets[0]!.geometry.wO);
    expect(thin.bands[0]!.cabinets[0]!.geometry.netM3).toBeCloseTo(thick.bands[0]!.cabinets[0]!.geometry.netM3, 9);
  });

  it('every starting point yields a cut list with finite positive sizes', () => {
    S.TEMPLATES.forEach((_, i) => {
      const v = L.computeBuild(S.applyTemplate(S.DEFAULT_PROJECT, i));
      expect(v.cutList.length).toBeGreaterThan(0);
      for (const r of v.cutList) {
        expect(Number.isFinite(r.l) && r.l > 0 && Number.isFinite(r.w) && r.w > 0 && r.qty > 0).toBe(true);
      }
    });
  });
});

describe('details the first pass left uncovered', () => {
  const ceil10 = (v: number): number => Math.ceil(v * 10 - 1e-9) / 10;

  it('the band-pass port is tuned against the front chamber', () => {
    const v = L.computeBuild(project([band(design({ type: 'bandpass', volumeL: 60, frontVolumeL: 40, tuneHz: 60, portDiameterCm: 8 }))]));
    expect(v.bands[0]!.port!.lengthM).toBeCloseTo(P.portLengthM(0.04, 60, 0.08), 12);
  });

  it('a front-loaded horn has a rear chamber and a throat chamber, named in the cut list', () => {
    const v = L.computeBuild(project([band(design({ type: 'horn', volumeL: 20, horn: { ...M.DEFAULT_DESIGN.horn, throatChamberL: 2 } }))]));
    expect(v.bands[0]!.cabinets.map((c) => c.title)).toEqual(['Rear chamber', 'Throat chamber']);
    expect(v.cutList.some((r) => r.part === 'Rear chamber: Front baffle')).toBe(true);
    expect(v.cutList.some((r) => r.part === 'Throat chamber: Sides')).toBe(true);
    const tiny = L.computeBuild(project([band(design({ type: 'horn', volumeL: 20, horn: { ...M.DEFAULT_DESIGN.horn, throatChamberL: 0.04 } }))]));
    expect(tiny.bands[0]!.cabinets.length).toBe(1);
  });

  it('a hole that only just fails to fit the baffle is reported', () => {
    // 30 L at 0.5 : 1 : 1 inside gives a baffle about 0.24 m wide: the 15 in driver's 0.33 m hole plus margins does not fit, though 2 x the baffle would
    const v = L.computeBuild(project([band(design({ type: 'sealed', volumeL: 30 }), { build: { rw: 0.5, rh: 1, rd: 1, brace: 'none' } })]));
    const g = v.bands[0]!.cabinets[0]!.geometry;
    const hole = v.bands[0]!.cabinets[0]!.cutouts[0]!.diameterM;
    expect(hole + 2 * L.HOLE_MARGIN).toBeGreaterThan(Math.min(g.wO, g.hO));
    expect(hole + 2 * L.HOLE_MARGIN).toBeLessThan(2 * Math.min(g.wO, g.hO));
    expect(v.warnings.some((w) => w.includes('does not fit') && w.includes('baffle'))).toBe(true);
  });

  it('lining covers every wall but the baffle, rounded up to 0.1 m2, once per cabinet', () => {
    const one = L.computeBuild(project([band(sealed(100))]));
    const g = one.bands[0]!.cabinets[0]!.geometry;
    const want = ceil10(2 * (g.wI * g.hI + g.wI * g.dI + g.hI * g.dI) - g.wI * g.hI);
    expect(one.bands[0]!.cabinets[0]!.liningM2).toBeCloseTo(want, 12);
    expect(one.bom.find((b) => b.item.startsWith('Damping'))!.qty).toBeCloseTo(want, 12);
    const two = L.computeBuild(project([band(sealed(100), { count: 2, series: 1 })]));
    expect(two.bom.find((b) => b.item.startsWith('Damping'))!.qty).toBeCloseTo(2 * want, 12);
  });

  it('waste is the share of the sheets the pieces do not cover; oversize pieces are not counted as covering', () => {
    const v = L.computeBuild(project([band(sealed(100))]));
    const used = v.pieces.reduce((a, x) => a + x.placement.w * x.placement.h, 0);
    expect(v.waste).toBeCloseTo(1 - used / (v.sheets * 2.44 * 1.22), 12);
    const small = L.computeBuild(project([band(sealed(100))], { shop: { ...B.DEFAULT_SHOP, sheetLmm: 600, sheetWmm: 500 } }));
    expect(small.pieces.some((x) => x.placement.sheet < 0)).toBe(true);
    const placed = small.pieces.filter((x) => x.placement.sheet >= 0).reduce((a, x) => a + x.placement.w * x.placement.h, 0);
    expect(small.waste).toBeCloseTo(1 - placed / (small.sheets * 0.6 * 0.5), 12);
  });
});

function sealed(volumeL: number): M.Design {
  return design({ type: 'sealed', volumeL });
}

describe('hole positions', () => {
  it('one hole is centred on the baffle; two are stacked 20 mm apart and centred as a pair', () => {
    const solo = L.computeBuild(project([band(sealed(100))])).bands[0]!.cabinets[0]!;
    const h = L.holePositions(solo);
    expect(h.length).toBe(1);
    expect(h[0]!.cx).toBeCloseTo(solo.geometry.wO / 2, 12);
    expect(h[0]!.cy).toBeCloseTo(solo.geometry.hO / 2, 12);
    const two = L.computeBuild(project([band(design({ type: 'ported', volumeL: 100, tuneHz: 40, portDiameterCm: 10 }))])).bands[0]!.cabinets[0]!;
    const [a, b] = L.holePositions(two);
    expect(b!.cy - a!.cy).toBeCloseTo(a!.r + 0.02 + b!.r, 12);
    expect((a!.cy - a!.r + (b!.cy + b!.r)) / 2).toBeCloseTo(two.geometry.hO / 2, 12);
  });
});

describe('inch units', () => {
  const inch = (more: Partial<S.Project> = {}): S.Project => ({ ...project([band(sealed(100))]), units: 'in', shop: { thicknessMm: 19.05, sheetLmm: 2438.4, sheetWmm: 1219.2, kerfMm: 3.175 }, ...more });

  it('the project remembers its unit, and only mm or in', () => {
    expect(S.DEFAULT_PROJECT.units).toBe('mm');
    expect(S.sanitizeProject({ units: 'in' }).units).toBe('in');
    expect(S.sanitizeProject({ units: 'cubits' }).units).toBe('mm');
    expect(S.sanitizeProject({ units: 5 }).units).toBe('mm');
    expect(S.sanitizeProject(inch())).toEqual(inch());
  });

  it('the bill of materials names the sheet and the port tube in inches', () => {
    const p = inch({ bands: [band(design({ type: 'ported', volumeL: 100, tuneHz: 40, portDiameterCm: 10 })), ...S.DEFAULT_PROJECT.bands.slice(1)].map((b) => b) });
    const v = L.computeBuild({ ...p, nBands: 1 });
    expect(v.bom.find((b) => b.unit === 'sheets')!.item).toBe('Sheet 96 x 48 in, 3/4 in');
    const tube = v.bom.find((b) => b.item.startsWith('Round port tube'))!.item;
    expect(tube).toContain(' in inside');
    expect(tube).toContain('3 15/16 in inside');
    expect(tube).not.toContain('mm');
    const screws = v.bom.find((b) => b.item === 'Wood screws')!.note;
    expect(screws).toContain('one per 5 7/8 in of joint');
    expect(screws).toContain(' ft)');
    expect(v.bom.find((b) => b.item === 'Wood glue')!.note).toBe('one per 32.8 ft of joint');
    expect(v.notes.join(' ')).toContain('a window brace as a 1 15/16 in frame');
  });

  it('the same project in millimetres reads as before', () => {
    const p = { ...inch(), units: 'mm' as const, shop: B.DEFAULT_SHOP };
    const v = L.computeBuild(p);
    expect(v.bom.find((b) => b.unit === 'sheets')!.item).toBe('Sheet 2440 x 1220 mm, 18 mm');
    expect(v.bom.find((b) => b.item === 'Wood screws')!.note).toContain('one per 150 mm of joint');
    expect(v.bom.find((b) => b.item === 'Wood glue')!.note).toBe('one per 10.0 m of joint');
  });

  it('warnings quote sizes in inches', () => {
    const wide = L.computeBuild({ ...project([band(design({ driverClass: 3, type: 'sealed', volumeL: 30 }), { build: { rw: 0.2, rh: 5, rd: 5, brace: 'none' } })]), units: 'in' });
    expect(wide.warnings.some((w) => / in hole does not fit the .* x .* in baffle/.test(w))).toBe(true);
    expect(wide.warnings.join(' ')).not.toContain(' mm');
    const small = L.computeBuild({ ...inch(), shop: { ...inch().shop, sheetLmm: 508, sheetWmm: 508 } });
    expect(small.warnings.some((w) => w.includes('is larger than a 20 x 20 in sheet'))).toBe(true);
  });

  it('the cut list keeps millimetres inside: the unit only changes how it is shown', () => {
    const a = L.computeBuild(project([band(sealed(100))]));
    const b = L.computeBuild({ ...project([band(sealed(100))]), units: 'in' });
    expect(b.cutList).toEqual(a.cutList);
  });
});
