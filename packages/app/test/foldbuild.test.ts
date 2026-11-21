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
  it('a front-loaded horn has only the mouth on the front, at the bottom; a rear-loaded one also has the driver at the top', () => {
    const holes = L.holePositions(cab);
    expect(holes).toHaveLength(1);
    expect(holes[0]!.shape).toBe('rect');
    expect(holes[0]!.cy).toBeGreaterThan(cab.geometry.hO / 2);
    const rear = foldCab(project(folded(4, 120, { loading: 'rear', throatChamberL: 30 })));
    const rh = L.holePositions(rear);
    expect(rh).toHaveLength(2);
    expect(rh[0]!.kind).toBe('driver');
    expect(rh[0]!.cy).toBeLessThan(rh[1]!.cy);
    expect(rh[1]!.cy).toBeGreaterThan(rear.geometry.hO / 2);
    const oddProject = project(folded(3));
    expect(L.holePositions(foldCab(oddProject))).toHaveLength(0);
    expect(L.computeBuild(oddProject).warnings.some((w) => w.includes('odd number'))).toBe(true);
  });
  it('a depth that is too small is built at the minimum and says so', () => {
    const shallow = project(folded(4, 30));
    expect(L.computeBuild(shallow).warnings.some((x) => x.includes('asked for'))).toBe(true);
    expect(foldCab(shallow).geometry.dO).toBeGreaterThan(0.3);
  });
  it('the driver chamber is inside the folded box, above a shelf, and the unfolded horn is unchanged', () => {
    expect(b.cabinets.map((c) => c.title)).toEqual(['Folded horn']);
    expect(cab.chamber).toBeDefined();
    expect(cab.chamber!.driverOn).toBe('shelf');
    expect(cab.panels.some((x) => x.name === 'Chamber shelf')).toBe(true);
    expect(L.computeBuild(project(horn())).bands[0]!.cabinets.map((c) => c.title)).toEqual(['Rear chamber', 'Throat chamber']);
    const straight = L.computeBuild(project(horn())).bands[0]!;
    expect(straight.horn).not.toBeNull();
    expect(straight.cabinets.some((c) => c.fold)).toBe(false);
  });
  it('the rear-loaded scoop folds too', () => {
    const bb = L.computeBuild(project(folded(4, 140, { loading: 'rear', throatChamberL: 30 }))).bands[0]!;
    expect(bb.cabinets.map((c) => c.title)).toEqual(['Folded horn']);
    expect(bb.cabinets[0]!.chamber!.driverOn).toBe('front');
  });
});

describe('3D and drawing', () => {
  const p = project(folded());
  const v = L.computeBuild(p);
  const l = layout3d(v, p);
  const f = foldCab(p).fold!;
  const hO = foldCab(p).geometry.hO;
  const drop = foldCab(p).chamber!.heightM + T; // the chamber and its shelf sit above the legs
  const walls = (): ReturnType<typeof layout3d>['boxes'] => l.boxes.filter((x) => x.kind === 'panel' && Math.abs(x.size[0] - f.wO) < 1e-9 && Math.abs(x.size[1] - hO) < 1e-9);
  const septa = (): ReturnType<typeof layout3d>['boxes'] => l.boxes.filter((x) => x.kind === 'divider' && x.size[0] === f.wI && x.size[1] === T && !x.holes);
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
    const top = wall.center[1] + hO / 2 - T - drop;
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
    const gh = cab.geometry.hI;
    expect(cab.liningM2).toBe(Math.ceil((2 * (f.wI * gh + f.wI * f.dI + gh * f.dI) - f.wI * gh + septaArea) * 10 - 1e-9) / 10);
  });
  it('the mouth is the last leg; a rear-loaded chamber opens into the first leg through the flare throat across the width', () => {
    const holes = L.holePositions(cab);
    expect(holes[0]!.h).toBeCloseTo(f.heights[3]!, 12);
    expect(holes[0]!.cy).toBeCloseTo(cab.geometry.hO - T - f.heights[3]! / 2, 12);
    const rear = foldCab(project(folded(4, 120, { loading: 'rear', throatChamberL: 30 })));
    expect(rear.chamber!.throatDepthM).toBeCloseTo(Math.min(0.06 / rear.fold!.wI, rear.chamber!.depthM), 12);
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

describe('tapered legs (the scoop)', () => {
  const tap = (legs = 2, depthCm = 150, more: Partial<M.HornDesign> = {}): M.Design => folded(legs, depthCm, { foldStyle: 'tapered', widthCm: 90, loading: 'rear', throatChamberL: 40, mouthCm2: 6000, ...more });
  const p = project(tap());
  const cab = foldCab(p);
  const f = cab.fold!;
  it('foldStyle is stepped unless it says tapered', () => {
    expect(M.sanitize({ type: 'horn', horn: {} }).horn.foldStyle).toBe('stepped');
    expect(M.sanitize({ type: 'horn', horn: { foldStyle: 'wavy' } }).horn.foldStyle).toBe('stepped');
    expect(M.sanitize({ type: 'horn', horn: { foldStyle: 'tapered' } }).horn.foldStyle).toBe('tapered');
    expect(f.style).toBe('tapered');
  });
  it('the septa are cut to their slope length and named with the angle', () => {
    const sep = cab.panels.filter((x) => x.name.startsWith('Fold septum'));
    expect(sep).toHaveLength(1);
    expect(sep[0]!.l).toBeCloseTo(f.septaSlant[0]!, 12);
    expect(sep[0]!.l).toBeGreaterThan(f.septaLength[0]!);
    expect(sep[0]!.name).toMatch(/sloped \d+\.\d deg (down|up) to the back/);
  });
  it('the septum name carries its angle in degrees and its direction', () => {
    const sep = cab.panels.find((x) => x.name.startsWith('Fold septum'))!;
    const deg = (Math.abs(f.septaAngle[0]!) * 180) / Math.PI;
    expect(sep.name).toContain(`sloped ${deg.toFixed(1)} deg ${f.septaAngle[0]! >= 0 ? 'down' : 'up'} to the back`);
    expect(deg).toBeGreaterThan(1);
  });
  it('each 3D septum sits where its top face is at the middle of its run, for both anchors', () => {
    const p4 = project(tap(4, 120));
    const l4 = layout3d(L.computeBuild(p4), p4);
    const f4 = foldCab(p4).fold!;
    const sep = l4.boxes.filter((x) => x.kind === 'divider' && x.size[0] === f4.wI && x.size[1] === T && !x.holes);
    expect(sep).toHaveLength(3);
    const c4 = foldCab(p4);
    sep.forEach((b, k) => {
      const front = f4.septaAnchor[k] === 'front';
      const dMid = front ? f4.septaLength[k]! / 2 : f4.dI - f4.septaLength[k]! / 2;
      const top = f4.septaFrontTop[k]! + ((f4.septaBackTop[k]! - f4.septaFrontTop[k]!) * dMid) / f4.dI;
      expect(b.center[1]).toBeCloseTo(c4.geometry.hO - T - (c4.chamber!.heightM + T) - top - T / 2, 9);
      expect(b.center[2]).toBeCloseTo(-T - dMid, 9);
    });
  });
  it('the side view puts each plate at its two ends, from the front wall or the back wall', () => {
    const p4 = project(tap(4, 120));
    const f4 = foldCab(p4).fold!;
    const polys = [...foldSvg(f4, T, 'x').matchAll(/<polygon points="([^"]+)"/g)].map((m) => m[1]!.split(' ').map((q) => q.split(',').map(Number)));
    expect(polys).toHaveLength(3);
    polys.forEach((pts, k) => {
      const front = f4.septaAnchor[k] === 'front';
      const d0 = front ? 0 : f4.dI - f4.septaLength[k]!;
      const d1 = front ? f4.septaLength[k]! : f4.dI;
      const top = (d: number): number => T + f4.septaFrontTop[k]! + ((f4.septaBackTop[k]! - f4.septaFrontTop[k]!) * d) / f4.dI;
      const mm = (m: number): number => m * 1000;
      expect(pts[0]![0]).toBeCloseTo(mm(f4.dO - T - d0), 0);
      expect(pts[0]![1]).toBeCloseTo(mm(top(d0)), 0);
      expect(pts[1]![0]).toBeCloseTo(mm(f4.dO - T - d1), 0);
      expect(pts[1]![1]).toBeCloseTo(mm(top(d1)), 0);
    });
  });
  it('the throat and the mouth are the first and last legs at the front wall', () => {
    const holes = L.holePositions(cab);
    expect(cab.chamber!.throatDepthM).toBeCloseTo(Math.min(0.06 / 0.9, cab.chamber!.depthM), 12);
    expect(holes[1]!.h).toBeCloseTo(f.heightsFront[1]!, 12);
  });
  it('the 3D septum is tilted by its angle and lies inside the box', () => {
    const l = layout3d(L.computeBuild(p), p);
    const sep = l.boxes.find((x) => x.kind === 'divider' && x.size[0] === f.wI)!;
    expect(sep.tilt).toBeCloseTo(-f.septaAngle[0]!, 12);
    expect(sep.size[2]).toBeCloseTo(f.septaSlant[0]!, 12);
    const nums = l.boxes.flatMap((b) => [...b.size, ...b.center, b.tilt ?? 0]);
    expect(nums.every(Number.isFinite)).toBe(true);
    // a stepped fold has no tilt
    const ls = layout3d(L.computeBuild(project(folded())), project(folded()));
    expect(ls.boxes.every((b) => b.tilt === undefined)).toBe(true);
  });
  it('the side view draws sloped plates as polygons and labels both ends of every leg', () => {
    const svg = foldSvg(f, T, 'scoop');
    expect([...svg.matchAll(/<polygon /g)]).toHaveLength(1);
    expect([...svg.matchAll(/<rect /g)]).toHaveLength(1);
    expect(svg).toContain('front');
    expect(svg).not.toContain('NaN');
    expect(foldSvg(foldCab(project(folded())).fold!, T, 'stepped')).not.toContain('<polygon');
  });
  it('the response is finite and closer to the straight horn than the stepped fold of the same box', () => {
    const c = M.compute(tap());
    expect(c.curves.responseDb.every(Number.isFinite)).toBe(true);
    const ideal = M.compute(horn({ loading: 'rear', throatChamberL: 40, mouthCm2: 6000, widthCm: 90 }, { volumeL: 60 })).curves.responseDb;
    const stepped = M.compute(tap(2, 150, { foldStyle: 'stepped' })).curves.responseDb;
    const dist = (a: number[]): number => a.reduce((acc, v, i) => acc + (v - ideal[i]!) ** 2, 0);
    expect(dist(c.curves.responseDb)).toBeLessThan(dist(stepped));
  });
  it('the Scoop starting point is a working tapered fold: no fold warnings and a recommendation that works', () => {
    const preset = M.HORN_PRESETS.find((x) => x.label === 'Scoop')!;
    const d = M.sanitize({ ...M.DEFAULT_DESIGN, type: 'horn', ...preset.patch });
    expect(d.horn.foldStyle).toBe('tapered');
    expect(d.horn.fold).toBe(true);
    const w = M.compute(d).warnings.filter((x) => ['cannot fit', 'odd number', 'asked for', 'fewer legs or less depth', 'Recommended fold'].some((k) => x.includes(k)));
    expect(w).toEqual([]);
    const b = L.computeBuild(project(d));
    expect(b.bands[0]!.cabinets.some((c) => c.title === 'Folded horn')).toBe(true);
    expect(b.warnings.some((x) => x.includes('cannot fit'))).toBe(false);
  });
  it('the model asks for the recommendation of the style it is in', () => {
    const bad = tap(3, 40);
    const flare = M.hornGeometry(bad).flare;
    const tapered = P.suggestFold(flare, 0.9, 0.018, 'tapered');
    const stepped = P.suggestFold(flare, 0.9, 0.018, 'stepped');
    expect(tapered).not.toEqual(stepped); // the two styles recommend different boxes for this flare
    expect(M.compute(bad).horn!.suggest).toEqual(tapered);
    const asStepped = M.sanitize({ ...bad, horn: { ...bad.horn, foldStyle: 'stepped' } });
    expect(M.compute(asStepped).horn!.suggest).toEqual(stepped);
  });
  it('a recommendation for a tapered fold clears the fold warnings for the tapered fold', () => {
    const bad = tap(3, 40);
    const sug = M.compute(bad).horn!.suggest;
    expect(sug).not.toBeNull();
    const fixed = M.sanitize({ ...bad, horn: { ...bad.horn, legs: sug!.legs, widthCm: Math.round(sug!.widthM * 1000) / 10, depthCm: Math.round(sug!.depthOutM * 1000) / 10 } });
    expect(M.compute(fixed).warnings.filter((x) => ['cannot fit', 'odd number', 'asked for', 'fewer legs or less depth', 'Recommended fold'].some((k) => x.includes(k)))).toEqual([]);
  });
});

describe('the driver is in the box: one cabinet, chamber at the top', () => {
  for (const loading of ['front', 'rear'] as const) {
    const p = project(folded(4, 120, { loading, throatChamberL: 30 }));
    const v = L.computeBuild(p);
    const cab = v.bands[0]!.cabinets[0]!;
    const lay = layout3d(v, p);
    it(`${loading}-loaded: the 3D view is only the folded box, with the wood of the cut list`, () => {
      expect(v.bands[0]!.cabinets).toHaveLength(1);
      expect(lay.extent[0]).toBeCloseTo(cab.geometry.wO, 9);
      expect(lay.extent[1]).toBeCloseTo(cab.geometry.hO, 9);
      expect(lay.extent[2]).toBeCloseTo(cab.geometry.dO, 9);
      const wood = lay.boxes.reduce((a, x) => a + x.size[0] * x.size[1] * x.size[2], 0);
      const cut = v.cutList.reduce((a, r) => a + r.l * r.w * r.qty, 0);
      expect(wood).toBeCloseTo(cut * 1e-6 * T, 3);
    });
    it(`${loading}-loaded: the driver sits inside the box's outline and its hole is cut where it is mounted`, () => {
      expect(lay.drivers).toHaveLength(1);
      const d = lay.drivers[0]!;
      expect(d.flange[0]).toBeGreaterThan(0);
      expect(d.flange[0]).toBeLessThan(cab.geometry.wO);
      expect(d.flange[1]).toBeGreaterThan(cab.geometry.hO - cab.chamber!.heightM - 3 * T - 1e-9);
      expect(d.flange[1]).toBeLessThan(cab.geometry.hO);
      const shelf = lay.boxes.find((x) => x.holes && x.holeAxis === 'y')!;
      expect(shelf).toBeDefined();
      if (loading === 'rear') {
        const front = lay.boxes.find((x) => x.kind === 'panel' && x.holes && x.holes.some((h) => h.radius > 0 && !h.shape))!;
        expect(front).toBeDefined();
      } else expect(shelf.holes!.some((h) => !h.shape)).toBe(true);
    });
  }
  it('the side view shows the chamber and shelf above the legs', () => {
    const c = foldCab(project(folded()));
    const svg = foldSvg(c.fold!, T, 'x', 'mm', c.chamber);
    expect(svg).toContain('driver chamber');
    const h = Number(/viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)![2]);
    expect(h).toBeCloseTo(c.geometry.hO * 1000, 0);
  });
});
