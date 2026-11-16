// v1.6 folded horns: the model, the cut list, the 3D view and the drawing.
import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import { foldSvg } from '../src/export';
import * as L from '../src/buildlist';
import { layout3d } from '../src/layout3d';
import * as M from '../src/model';
import * as S from '../src/system';

const horn = (more: Partial<M.HornDesign> = {}, d: Partial<M.Design> = {}): M.Design => M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: 3, type: 'horn', volumeL: 60, ...d, horn: { ...M.DEFAULT_DESIGN.horn, throatCm2: 600, mouthCm2: 4000, widthCm: 60, ...more } });
const project = (d: M.Design): S.Project => S.sanitizeProject({ ...S.DEFAULT_PROJECT, nBands: 1, bands: [{ ...S.DEFAULT_PROJECT.bands[0]!, design: d }, ...S.DEFAULT_PROJECT.bands.slice(1)] });
const folded = (legs = 4, depthCm = 120, more: Partial<M.HornDesign> = {}): M.Design => horn({ fold: true, legs, depthCm, ...more });
const foldCab = (p: S.Project): L.Cabinet => L.computeBuild(p).bands[0]!.cabinets.find((c) => c.title === 'Folded horn')!;
const T = 0.018;

describe('model', () => {
  it('old horns are unfolded, and fold fields are clamped', () => {
    expect(M.sanitize({ type: 'horn', horn: { flare: 'exponential' } }).horn.fold).toBe(false);
    const h = M.sanitize({ type: 'horn', horn: { fold: true, legs: 99, depthCm: 5 } }).horn;
    expect(h.legs).toBe(8);
    expect(h.depthCm).toBe(20);
    expect(M.sanitize({ type: 'horn', horn: { fold: 'yes', legs: 3.6 } }).horn).toMatchObject({ fold: false, legs: 4 });
  });
  it('the folded horn is simulated as its legs, and the response is finite', () => {
    const d = folded();
    const g = M.hornGeometry(d);
    expect(g.fold).not.toBeNull();
    expect(g.built).toEqual(g.fold!.joints);
    const c = M.compute(d);
    expect(c.horn!.fold).not.toBeNull();
    expect(c.curves.responseDb.every(Number.isFinite)).toBe(true);
    expect(c.readouts.some((r) => r.label.startsWith('Folded box'))).toBe(true);
  });
  it('the wall thickness changes the fold, so it must reach the simulation', () => {
    const a = M.hornGeometry(folded(), 0.018).fold!;
    const b = M.hornGeometry(folded(), 0.025).fold!;
    expect(b.hO).not.toBeCloseTo(a.hO, 6);
    expect(M.hornGeometry(horn()).fold).toBeNull();
  });
  it('odd legs, a depth that is too small and one that is too large are each warned about', () => {
    expect(M.compute(folded(3)).warnings.some((w) => w.includes('odd number'))).toBe(true);
    expect(M.compute(folded(4, 30)).warnings.some((w) => w.includes('need'))).toBe(true);
    expect(M.compute(folded(4, 290)).warnings.some((w) => w.includes('fewer legs or less depth'))).toBe(true);
    expect(M.compute(folded(4, 105)).warnings.some((w) => w.includes('odd number') || w.includes('fewer legs'))).toBe(false);
  });
  it('the straight-panel warning is not shown for a folded horn', () => {
    expect(M.compute(folded()).warnings.some((w) => w.includes('panel lengths'))).toBe(false);
    expect(M.compute(horn({ panelsCm: '50 50' })).warnings.some((w) => w.includes('panel lengths'))).toBe(true);
  });
});

describe('build', () => {
  const p = project(folded());
  const v = L.computeBuild(p);
  const b = v.bands[0]!;
  const cab = foldCab(p);
  it('a folded horn is a box with one septum per fold, and no free-standing horn sections', () => {
    expect(b.horn).toBeNull();
    expect(cab.fold).toBeDefined();
    expect(cab.panels.filter((x) => x.name.startsWith('Fold septum'))).toHaveLength(3);
    expect(v.cutList.some((r) => r.part.startsWith('Horn 1'))).toBe(false);
    expect(v.cutList.filter((r) => r.part.includes('Fold septum'))).toHaveLength(3);
  });
  it('the box is the layout: walls are the outside, septa are the inside width by their length', () => {
    const f = cab.fold!;
    expect(cab.geometry.wO).toBeCloseTo(f.wO, 12);
    const sep = cab.panels.filter((x) => x.name.startsWith('Fold septum'));
    sep.forEach((s, k) => {
      expect(s.l).toBeCloseTo(f.septaLength[k]!, 12);
      expect(s.w).toBeCloseTo(0.6, 12);
    });
    expect(cab.panels.find((x) => x.name === 'Front baffle')!.l).toBeCloseTo(f.wO, 12);
  });
  it('the throat opens at the top front and the mouth at the bottom front', () => {
    const holes = L.holePositions(cab);
    expect(holes).toHaveLength(2);
    expect(holes[0]!.cy).toBeLessThan(holes[1]!.cy);
    expect(holes[1]!.cy).toBeGreaterThan(cab.geometry.hO / 2);
    expect(holes.every((h) => h.shape === 'rect')).toBe(true);
    const oddProject = project(folded(3));
    expect(L.holePositions(foldCab(oddProject))).toHaveLength(1);
    expect(L.computeBuild(oddProject).warnings.some((w) => w.includes('odd number'))).toBe(true);
  });
  it('a depth that is too small is built at the minimum and says so', () => {
    const shallow = project(folded(4, 30));
    expect(L.computeBuild(shallow).warnings.some((x) => x.includes('asked for'))).toBe(true);
    expect(foldCab(shallow).geometry.dO).toBeGreaterThan(0.3);
  });
  it('the chambers are still built and the unfolded horn is unchanged', () => {
    expect(b.cabinets.map((c) => c.title)).toEqual(['Rear chamber', 'Throat chamber', 'Folded horn']);
    const straight = L.computeBuild(project(horn())).bands[0]!;
    expect(straight.horn).not.toBeNull();
    expect(straight.cabinets.some((c) => c.fold)).toBe(false);
  });
  it('the rear-loaded scoop folds too', () => {
    const bb = L.computeBuild(project(folded(4, 140, { loading: 'rear', throatChamberL: 30 }))).bands[0]!;
    expect(bb.cabinets.map((c) => c.title)).toEqual(['Chamber behind the cone', 'Folded horn']);
  });
});

describe('3D and drawing', () => {
  const p = project(folded());
  const v = L.computeBuild(p);
  const l = layout3d(v, p);
  const f = foldCab(p).fold!;
  const walls = (): ReturnType<typeof layout3d>['boxes'] => l.boxes.filter((x) => x.kind === 'panel' && Math.abs(x.size[0] - f.wO) < 1e-9 && Math.abs(x.size[1] - f.hO) < 1e-9);
  const septa = (): ReturnType<typeof layout3d>['boxes'] => l.boxes.filter((x) => x.kind === 'divider' && x.size[0] === f.wI);
  it('no straight horn prisms; the septa are dividers inside the box', () => {
    expect(l.prisms).toHaveLength(0);
    expect(septa()).toHaveLength(3);
    expect(walls().length).toBeGreaterThanOrEqual(2);
    septa().forEach((s, k) => {
      expect(s.size[2]).toBeCloseTo(f.septaLength[k]!, 12);
      expect(Number.isFinite(s.center[1] + s.center[2])).toBe(true);
    });
  });
  it('septa fixed to the front wall reach the front inner face, the others the back', () => {
    const zs = walls().map((x) => x.center[2]);
    const frontInner = Math.max(...zs) - T / 2;
    const backInner = Math.min(...zs) + T / 2;
    const s = septa();
    expect(s[0]!.center[2] + s[0]!.size[2] / 2).toBeCloseTo(frontInner, 9);
    expect(s[1]!.center[2] - s[1]!.size[2] / 2).toBeCloseTo(backInner, 9);
  });
  it('the first septum lies below the first leg, inside the box', () => {
    const wall = walls()[0]!;
    const top = wall.center[1] + f.hO / 2 - T;
    expect(top - (septa()[0]!.center[1] + T / 2)).toBeCloseTo(f.septaTop[0]!, 9);
  });
  it('the side view draws one rectangle for the box, one per septum, a label per leg and the mouth', () => {
    const svg = foldSvg(f, T, 'Test');
    expect([...svg.matchAll(/<rect /g)]).toHaveLength(1 + 3);
    expect([...svg.matchAll(/leg \d/g)]).toHaveLength(4);
    expect(svg).toContain('mouth');
    const exp: P.Flare = { kind: 'exponential', throatM2: 0.06, mouthM2: 0.4, cutoffHz: 40, t: 1, lengthM: 0 };
    expect(foldSvg(P.foldHorn(exp, 0.6, 3, 1.2, T), T, 'odd')).not.toContain('>mouth<');
    const w = Number(/viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)![1]);
    expect(w).toBeCloseTo(f.dO * 1000, 0);
  });
});

describe('details the first pass left uncovered', () => {
  const p = project(folded());
  const cab = foldCab(p);
  const f = cab.fold!;
  it('the air of the box is its inside less the septa; the lining covers the walls and both sides of every septum', () => {
    expect(cab.geometry.netM3).toBeCloseTo(f.wI * f.hI * f.dI - f.septaLength.reduce((a, l) => a + f.wI * l * T, 0), 12);
    const septaArea = f.septaLength.reduce((a, l) => a + 2 * f.wI * l, 0);
    expect(cab.liningM2).toBe(Math.ceil((2 * (f.wI * f.hI + f.wI * f.dI + f.hI * f.dI) - f.wI * f.hI + septaArea) * 10 - 1e-9) / 10);
  });
  it('the throat opening is the flare throat across the width; the mouth is the last leg', () => {
    const holes = L.holePositions(cab);
    expect(holes[0]!.w).toBeCloseTo(0.6, 12);
    expect(holes[0]!.h).toBeCloseTo(0.06 / 0.6, 12);
    expect(holes[1]!.h).toBeCloseTo(f.heights[3]!, 12);
    expect(holes[1]!.cy).toBeCloseTo(f.hO - T - f.heights[3]! / 2, 12);
  });
  it('a wide horn does not trip the driver-and-port hole check', () => {
    const w = L.computeBuild(project(folded(4, 120, { widthCm: 150 })));
    expect(w.warnings.filter((x) => x.includes('does not fit') && !x.includes('396'))).toEqual([]);
  });
  it('a deep enough box has no depth warning', () => {
    expect(L.computeBuild(p).warnings.some((x) => x.includes('asked for'))).toBe(false);
  });
  it('the shop wall thickness reaches the system response of a folded horn', () => {
    const a = S.computeSystem(S.sanitizeProject({ ...p, shop: { ...p.shop, thicknessMm: 12 } }));
    const b = S.computeSystem(S.sanitizeProject({ ...p, shop: { ...p.shop, thicknessMm: 25 } }));
    expect(a.bands[0]!.levelDb).not.toEqual(b.bands[0]!.levelDb);
  });
  it('the drawing puts each septum where the layout says: from the front or back wall, below the legs above it', () => {
    const svg = foldSvg(f, T, 'Test');
    const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].slice(1);
        expect(rects).toHaveLength(3);
    expect(Number(rects[0]![1])).toBeCloseTo((f.dO - T - f.septaLength[0]!) * 1000, 0);
    expect(Number(rects[1]![1])).toBeCloseTo(T * 1000, 0);
    expect(Number(rects[0]![2])).toBeCloseTo((T + f.septaTop[0]!) * 1000, 0);
    expect(Number(rects[0]![3])).toBeCloseTo(f.septaLength[0]! * 1000, 0);
  });
});

describe('settings that cannot fold (a 6 m2 mouth on a 60 cm wide horn)', () => {
  const huge = (legs = 4): M.Design => horn({ fold: true, legs, depthCm: 300, throatCm2: 506, mouthCm2: 60000, cutoffHz: 40.9 }, { volumeL: 100 });
  it('nothing is NaN: the model, the cut list, the 3D view and the drawing', () => {
    const d = huge();
    const c = M.compute(d);
    expect(c.curves.responseDb.every(Number.isFinite)).toBe(true);
    const p = S.sanitizeProject({ ...project(d), units: 'in' });
    const v = L.computeBuild(p);
    expect(v.cutList.every((r) => Number.isFinite(r.l) && Number.isFinite(r.w))).toBe(true);
    expect(v.bands[0]!.warnings.join(' ')).not.toContain('NaN');
    const l = layout3d(v, p);
    const nums = [...l.boxes.flatMap((b) => [...b.size, ...b.center]), ...l.discs.flatMap((x) => [...x.center, x.radius]), ...l.extent];
    expect(nums.every(Number.isFinite)).toBe(true);
    const f = v.bands[0]!.cabinets.find((x) => x.title === 'Folded horn')!.fold!;
    expect(foldSvg(f, T, 'x')).not.toContain('NaN');
  });
  it('the box page and the Build page both say the folds cannot fit', () => {
    expect(M.compute(huge()).warnings.some((w) => w.includes('cannot fit'))).toBe(true);
    expect(L.computeBuild(project(huge())).warnings.some((w) => w.includes('cannot fit'))).toBe(true);
    expect(M.compute(folded()).warnings.some((w) => w.includes('cannot fit'))).toBe(false);
    expect(L.computeBuild(project(folded())).warnings.some((w) => w.includes('cannot fit'))).toBe(false);
  });
});

describe('recommended fold', () => {
  const FOLD_WARNS = ['cannot fit', 'odd number', 'asked for', 'fewer legs or less depth', 'need '];
  const foldWarns = (d: M.Design): string[] => M.compute(d).warnings.filter((w) => FOLD_WARNS.some((x) => w.includes(x)));
  const apply = (d: M.Design, s: { legs: number; widthM: number; depthOutM: number }): M.Design => M.sanitize({ ...d, horn: { ...d.horn, legs: s.legs, widthCm: Math.round(s.widthM * 1000) / 10, depthCm: Math.round(s.depthOutM * 1000) / 10 } });
  const user = (): M.Design => horn({ fold: true, legs: 2, depthCm: 300, throatCm2: 506, mouthCm2: 60000, cutoffHz: 20.5 }, { volumeL: 100 });

  it('the box depth can be set high enough: 912 cm is not clamped back to 300', () => {
    expect(M.sanitize({ type: 'horn', horn: { depthCm: 912 } }).horn.depthCm).toBe(912);
    expect(M.sanitize({ type: 'horn', horn: { depthCm: 5000 } }).horn.depthCm).toBe(1000);
  });
  it('a fold that does not work gets a recommendation, and applying it clears every fold warning', () => {
    const d = user();
    const c = M.compute(d);
    expect(c.horn!.suggest ?? c.horn!.maxMouthCm2).not.toBeNull();
    if (c.horn!.suggest) {
      const fixed = apply(d, c.horn!.suggest);
      expect(foldWarns(fixed)).toEqual([]);
      expect(M.compute(fixed).horn!.suggest).toBeNull();
    }
  });
  it('the recommendation works from any leg count, depth and width the user could have typed', () => {
    for (const legs of [2, 3, 4, 8]) {
      for (const depthCm of [30, 120, 1000]) {
        for (const widthCm of [20, 60, 200]) {
          const d = horn({ fold: true, legs, depthCm, widthCm, throatCm2: 600, mouthCm2: 6000 });
          const sug = M.compute(d).horn!.suggest;
          if (sug) expect(foldWarns(apply(d, sug))).toEqual([]);
        }
      }
    }
  });
  it('a box much deeper than the folds need also gets a recommendation', () => {
    const slack = folded(4, 160);
    const f = M.compute(slack).horn!.fold!;
    expect(f.dI).toBeGreaterThan(f.minDepthI * 1.25);
    expect(M.compute(slack).horn!.suggest).not.toBeNull();
    const snug = folded(4, Math.ceil((f.minDepthI + 2 * 0.018) * 100) + 2);
    expect(M.compute(snug).horn!.suggest).toBeNull();
  });
  it('a working fold has no recommendation and no mouth advice', () => {
    expect(M.compute(folded()).horn!.suggest).toBeNull();
    expect(M.compute(folded()).horn!.maxMouthCm2).toBeNull();
  });
  it('the recommendation widens a very narrow horn in steps until the fold works', () => {
    const narrow = horn({ fold: true, legs: 4, depthCm: 300, widthCm: 5, throatCm2: 600, mouthCm2: 20000 });
    const sug = M.compute(narrow).horn!.suggest;
    expect(sug).not.toBeNull();
    expect(sug!.widthM).toBeGreaterThan(0.05);
    expect(foldWarns(apply(narrow, sug!))).toEqual([]);
  });
});
