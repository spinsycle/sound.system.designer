// v1.5 driver layouts and rectangular ports: how they reach the cut list, the baffle and the bill of materials.
import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import * as C from '../src/carsub';
import * as L from '../src/buildlist';
import * as M from '../src/model';
import * as S from '../src/system';
import { baffleSvg } from '../src/export';
import { layout3d } from '../src/layout3d';

const design = (more: Partial<M.Design>): M.Design => ({ ...M.DEFAULT_DESIGN, driverClass: 2, ...more }); // the 15 in class: Sd 0.0855 m2
const band = (d: M.Design, more: Partial<S.Band> = {}): S.Band => ({ ...S.DEFAULT_PROJECT.bands[0]!, design: d, ...more });
const project = (bands: S.Band[]): S.Project => S.sanitizeProject({ ...S.DEFAULT_PROJECT, nBands: bands.length, bands: [...bands, ...S.DEFAULT_PROJECT.bands.slice(bands.length)] });
const lay = (more: Partial<M.DriverLayout>): M.DriverLayout => ({ ...M.DEFAULT_LAYOUT, ...more });
const ported = (more: Partial<M.Design>): M.Design => design({ type: 'ported', volumeL: 100, tuneHz: 40, ...more });

describe('rectangular ports', () => {
  const rect = ported({ portShape: 'rect', portWidthCm: 20, portHeightCm: 5, portOrient: 'horizontal' });
  it('the length comes from the area with the equivalent-diameter end correction', () => {
    expect(M.portLengthOf(rect, 100)).toBeCloseTo(P.portLengthFromAreaM(0.1, 40, 0.2 * 0.05), 12);
    expect(M.portLengthOf(ported({}), 100)).toBeCloseTo(P.portLengthM(0.1, 40, 0.1), 12);
  });
  it('a rectangular port is a slot in the baffle with sheet pieces, not a tube', () => {
    const v = L.computeBuild(project([band(rect)]));
    const b = v.bands[0]!;
    expect(b.port!.shape).toBe('rect');
    const pos = L.holePositions(b.cabinets[0]!);
    const slot = pos.find((h) => h.kind === 'port')!;
    expect(slot.shape).toBe('rect');
    expect(slot.w).toBeCloseTo(0.2, 12);
    expect(slot.h).toBeCloseTo(0.05, 12);
    expect(v.bom.some((x) => x.item.startsWith('Round port tube'))).toBe(false);
    const sides = v.cutList.filter((r) => r.part.startsWith('Rectangular port'));
    expect(sides.map((r) => r.qty)).toEqual([2, 2]);
    expect(sides[0]!.w).toBe(Math.round((0.2 + 2 * 0.018) * 1000));
    expect(sides[1]!.w).toBe(50);
  });
  it('vertical turns the slot: the long side runs up the baffle', () => {
    const v = L.computeBuild(project([band({ ...rect, portOrient: 'vertical' })]));
    const slot = L.holePositions(v.bands[0]!.cabinets[0]!).find((h) => h.kind === 'port')!;
    expect(slot.w).toBeCloseTo(0.05, 12);
    expect(slot.h).toBeCloseTo(0.2, 12);
  });
  it('the box holds the designed air with the port wood counted', () => {
    const b = L.computeBuild(project([band(rect)])).bands[0]!;
    expect(b.cabinets[0]!.geometry.netM3).toBeCloseTo(0.1, 9);
    const round = L.computeBuild(project([band(ported({}))])).bands[0]!;
    // a different port displaces a different amount, so the outside differs
    expect(b.cabinets[0]!.geometry.wO * b.cabinets[0]!.geometry.hO).not.toBeCloseTo(round.cabinets[0]!.geometry.wO * round.cabinets[0]!.geometry.hO, 6);
  });
});

describe('magnet in and out', () => {
  it('a motor sticking out displaces less, so the box is smaller outside and holds the same air', () => {
    const inside = L.computeBuild(project([band(design({ type: 'sealed', volumeL: 20 }))])).bands[0]!.cabinets[0]!;
    const out = L.computeBuild(project([band(design({ type: 'sealed', volumeL: 20, layout: lay({ mount: 'out' }) }))])).bands[0]!.cabinets[0]!;
    expect(out.geometry.netM3).toBeCloseTo(0.02, 9);
    expect(out.geometry.wO * out.geometry.hO * out.geometry.dO).toBeLessThan(inside.geometry.wO * inside.geometry.hO * inside.geometry.dO);
    expect(out.magnetOut).toBe(true);
  });
});

describe('several drivers in one box', () => {
  const d = design({ type: 'sealed', volumeL: 30, layout: lay({ cols: 2 }) });
  it('a 2 x 2 grid: four driver holes, centred, two columns', () => {
    const p = project([band(d, { count: 4, perBox: 4 })]);
    const bb = L.computeBuild(p).bands[0]!;
    expect(bb.count).toBe(1);
    expect(bb.drivers[0]!.qty).toBe(4);
    expect(bb.cabinets[0]!.geometry.netM3).toBeCloseTo(0.12, 9); // each driver keeps its own 30 L
    const holes = L.holePositions(bb.cabinets[0]!);
    expect(holes).toHaveLength(4);
    expect(new Set(holes.map((h) => h.cx.toFixed(6))).size).toBe(2);
    expect(new Set(holes.map((h) => h.cy.toFixed(6))).size).toBe(2);
  });
  it('perBox that does not divide the count falls back to one per box', () => {
    const p = S.sanitizeProject({ ...S.DEFAULT_PROJECT, bands: [{ ...band(d), count: 4, perBox: 3 }] });
    expect(p.bands[0]!.perBox).toBe(1);
  });
  it('the response is the same as the same drivers in their own boxes', () => {
    const a = S.computeSystem(project([band(d, { count: 4, perBox: 4 })]));
    const b = S.computeSystem(project([band(d, { count: 4, perBox: 1 })]));
    expect(a.bands[0]!.levelDb).toEqual(b.bands[0]!.levelDb);
  });
  it('holes that do not fit the baffle are reported', () => {
    const wide = design({ type: 'sealed', volumeL: 1, layout: lay({ cols: 4 }) });
    const v = L.computeBuild(project([band(wide, { count: 8, perBox: 8 })]));
    expect(v.warnings.some((w) => w.includes('do not fit'))).toBe(true);
  });
});

describe('push-pull', () => {
  it('half the drivers go on the back wall; an odd count is warned about', () => {
    const d = design({ type: 'sealed', volumeL: 30, layout: lay({ pushPull: true }) });
    const bb = L.computeBuild(project([band(d, { count: 2, perBox: 2 })])).bands[0]!;
    expect(L.holePositions(bb.cabinets[0]!).filter((h) => h.kind === 'driver')).toHaveLength(1);
    expect(L.holePositions(bb.cabinets[0]!, true)).toHaveLength(1);
    const odd = L.computeBuild(project([band(d, { count: 3, perBox: 3 })]));
    expect(odd.warnings.some((w) => w.includes('pairs'))).toBe(true);
    const one = L.computeBuild(project([band(d)]));
    expect(one.warnings.some((w) => w.includes('at least two'))).toBe(true);
  });
});

describe('facing down', () => {
  it('the baffle is the bottom panel and the floor clearance is checked', () => {
    const d = design({ type: 'sealed', volumeL: 60, layout: lay({ facing: 'down', clearanceCm: 1 }) });
    const v = L.computeBuild(project([band(d)]));
    const cab = v.bands[0]!.cabinets[0]!;
    expect(cab.facing).toBe('down');
    expect(L.holePositions(cab)[0]!.cy).toBeCloseTo(cab.geometry.dO / 2, 6);
    expect(v.warnings.some((w) => w.includes('floor clearance'))).toBe(true);
    const ok = L.computeBuild(project([band({ ...d, layout: lay({ facing: 'down', clearanceCm: 30 }) })]));
    expect(ok.warnings.some((w) => w.includes('floor clearance'))).toBe(false);
  });
});

describe('old designs are unchanged', () => {
  it('a design with none of the new fields gets the plain layout and a round port', () => {
    const old = M.sanitize({ driverClass: 2, type: 'ported', volumeL: 100, tuneHz: 40, portDiameterCm: 10 });
    expect(old.layout).toEqual(M.DEFAULT_LAYOUT);
    expect(old.portShape).toBe('round');
    expect(L.computeBuild(project([band(old)])).bands[0]!.cabinets[0]!.holes).toBeUndefined();
  });
  it('layout values are clamped and unknown values dropped', () => {
    const l = M.sanitizeLayout({ cols: 99, mount: 'sideways', pushPull: 'yes', facing: 'up', clearanceCm: -5 });
    expect(l).toEqual({ cols: 8, mount: 'in', pushPull: false, facing: 'front', clearanceCm: 0 });
  });
});

describe('car subs', () => {
  it('a grid and rectangular ports reach the car build', () => {
    const car = structuredClone(C.DEFAULT_CAR);
    car.count = 4;
    car.design = { ...car.design, type: 'ported', volumeL: 120, tuneHz: 36, portShape: 'rect', portWidthCm: 12, portHeightCm: 6, layout: lay({ cols: 2 }) };
    const p = S.sanitizeProject({ ...S.DEFAULT_PROJECT, kind: 'car', car });
    const bb = L.computeBuild(p).bands[0]!;
    expect(bb.ports.every((x) => x.shape === 'rect')).toBe(true);
    const drivers = L.holePositions(bb.cabinets[0]!).filter((h) => h.kind === 'driver');
    expect(drivers).toHaveLength(4);
    expect(new Set(drivers.map((h) => h.cy.toFixed(6))).size).toBe(2);
  });
});

describe('3D and exports follow the layout', () => {
  const lay3 = (more: Partial<M.DriverLayout>, d: Partial<M.Design> = {}, band: Partial<S.Band> = {}): { v: L.BuildView; l: ReturnType<typeof import('../src/layout3d').layout3d> } => {
    const p = project([band0({ type: 'ported', volumeL: 80, tuneHz: 40, layout: lay(more), ...d }, band)]);
    const v = L.computeBuild(p);
    return { v, l: layout3d(v, p) };
  };
  const band0 = (d: Partial<M.Design>, more: Partial<S.Band>): S.Band => band(design(d), more);

  it('one installed driver per driver hole, flange on the baffle, motor inside; outside when the magnet is out', () => {
    const inn = lay3({}).l;
    expect(inn.drivers).toHaveLength(1);
    expect(inn.drivers[0]!.dir).toEqual([0, 0, -1]);
    expect(inn.drivers[0]!.flange[2]).toBeCloseTo(0, 12);
    const out = lay3({ mount: 'out' }).l;
    expect(out.drivers[0]!.dir).toEqual([0, 0, 1]);
    expect(out.drivers[0]!.flange[2]).toBeCloseTo(-0.018, 12); // on the inner face of the baffle
  });
  it('a grid puts one driver at each hole; push-pull adds the back wall, facing away', () => {
    const g = lay3({ cols: 2 }, {}, { count: 4, perBox: 4 }).l;
    expect(g.drivers).toHaveLength(4);
    const pp = lay3({ pushPull: true }, { type: 'sealed' }, { count: 2, perBox: 2 }).l;
    expect(pp.drivers).toHaveLength(2);
    expect(pp.drivers.map((x) => x.dir[2]).sort()).toEqual([-1, 1]);
    expect(pp.discs.some((x) => x.rotY !== undefined)).toBe(true);
  });
  it('facing down lifts the cabinet by the clearance and puts the driver on the bottom face', () => {
    const { l } = lay3({ facing: 'down', clearanceCm: 15 }, { type: 'sealed' });
    const bottom = Math.min(...l.boxes.map((b) => b.center[1] - b.size[1] / 2));
    expect(bottom).toBeCloseTo(0.15, 9);
    expect(l.drivers[0]!.dir).toEqual([0, 1, 0]);
    expect(l.drivers[0]!.flange[1]).toBeCloseTo(0.15, 9);
    expect(l.extent[1]).toBeGreaterThan(0.15);
  });
  it('a rectangular port is a slot disc and a box tube; every coordinate is finite', () => {
    const { l } = lay3({ cols: 2, pushPull: true, facing: 'down' }, { portShape: 'rect', portWidthCm: 12, portHeightCm: 4 }, { count: 4, perBox: 4 });
    expect(l.tubes[0]!.rect).toBeDefined();
    expect(l.tubes[0]!.axis).toBe('y');
    expect(l.discs.some((x) => x.shape === 'rect')).toBe(true);
    const nums = [...l.boxes.flatMap((b) => [...b.size, ...b.center]), ...l.discs.flatMap((x) => [...x.center, x.radius]), ...l.drivers.flatMap((x) => [...x.flange, ...x.dir, x.radius]), ...l.tubes.flatMap((x) => [...x.center, x.radius, x.length]), ...l.extent];
    expect(nums.every(Number.isFinite)).toBe(true);
  });
  it('the SVG baffle draws a rectangle for a slot port and a second drawing for the back wall', () => {
    const { v } = lay3({ pushPull: true }, { portShape: 'rect', portWidthCm: 12, portHeightCm: 4, type: 'ported' }, { count: 2, perBox: 2 });
    const cab = v.bands[0]!.cabinets[0]!;
    const front = baffleSvg(cab, 'Box');
    expect(front).toContain('<rect x=');
    expect([...front.matchAll(/<circle /g)]).toHaveLength(1);
    expect([...baffleSvg(cab, 'Box', 'mm', true).matchAll(/<circle /g)]).toHaveLength(1);
    const down = lay3({ facing: 'down' }, { type: 'sealed' }).v.bands[0]!.cabinets[0]!;
    const wh = baffleSvg(down, 'Box').match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!;
    expect(Number(wh[2])).toBeCloseTo(down.geometry.dO * 1000, 0);
    expect(Number(wh[2])).not.toBeCloseTo(down.geometry.hO * 1000, 0);
  });
  it('the new fields survive a project file round trip', async () => {
    const { serializeProject, parseProjectFile } = await import('../src/projectfile');
    const p = project([band0({ portShape: 'rect', portWidthCm: 12, layout: lay({ cols: 3, mount: 'out', pushPull: true, facing: 'down', clearanceCm: 22 }), type: 'ported' }, { count: 6, perBox: 3 })]);
    const back = parseProjectFile(serializeProject(p));
    expect(back.ok).toBe(true);
    const q = back.project!;
    expect(q.bands[0]!.design.layout).toEqual(p.bands[0]!.design.layout);
    expect(q.bands[0]!.design.portShape).toBe('rect');
    expect(q.bands[0]!.perBox).toBe(3);
  });
});

describe('details the first pass left uncovered', () => {
  const sealedN = (n: number, more: Partial<M.Design> = {}): L.BandBuild => L.computeBuild(project([band(design({ type: 'sealed', volumeL: 30, ...more }), { count: n, perBox: n })])).bands[0]!;
  it('every driver in a shared box adds its own displacement to the inside', () => {
    const g = sealedN(2).cabinets[0]!.geometry;
    expect(g.wI * g.hI * g.dI).toBeCloseTo(0.06 + 2 * P.driverDisplacementMount(0.0855, false), 9);
  });
  it('a ported box has a port for each driver', () => {
    const b = L.computeBuild(project([band(design({ type: 'ported', volumeL: 80, tuneHz: 40 }), { count: 4, perBox: 4 })])).bands[0]!;
    expect(b.ports).toHaveLength(4);
  });
  it('push-pull with three drivers puts the extra one on the front', () => {
    const b = sealedN(3, { layout: lay({ pushPull: true }) });
    expect(L.holePositions(b.cabinets[0]!)).toHaveLength(2);
    expect(L.holePositions(b.cabinets[0]!, true)).toHaveLength(1);
  });
  it('automatic columns put a car box row of subs in a single row', () => {
    const car = structuredClone(C.DEFAULT_CAR);
    car.count = 3;
    const bb = L.computeBuild(S.sanitizeProject({ ...S.DEFAULT_PROJECT, kind: 'car', car })).bands[0]!;
    expect(new Set(L.holePositions(bb.cabinets[0]!).map((h) => h.cy.toFixed(6))).size).toBe(1);
  });
  it('floor clearance below a quarter of the hole size is warned about, above is not', () => {
    const make = (cm: number): string[] => L.computeBuild(project([band(design({ type: 'sealed', volumeL: 100, layout: lay({ facing: 'down', clearanceCm: cm }) }))])).warnings;
    expect(make(5).some((w) => w.includes('floor clearance'))).toBe(true); // a 15 in cone is about 33 cm: a quarter is 8 cm
    expect(make(9).some((w) => w.includes('floor clearance'))).toBe(false);
  });
  it('a speaker takes its columns and facing from the layout and lays the drivers out in columns', () => {
    const sp = structuredClone(S.DEFAULT_PROJECT.speaker);
    const lo = lay({ cols: 2, facing: 'down' });
    sp.slots = sp.slots.map((s, k) => ({ ...s, design: { ...s.design, layout: k === 0 ? lo : lay({}) } }));
    const cab = L.computeBuild(S.sanitizeProject({ ...S.DEFAULT_PROJECT, kind: 'speaker', speaker: sp })).bands[0]!.cabinets[0]!;
    expect(cab.facing).toBe('down');
    const holes = L.holePositions(cab);
    expect(new Set(holes.map((h) => h.cx.toFixed(6))).size).toBe(2);
  });
  it('a motor out on a floor-facing cabinet sits on the inside of the bottom panel; the driver is within the depth', () => {
    const p = project([band(design({ type: 'sealed', volumeL: 60, layout: lay({ facing: 'down', clearanceCm: 15, mount: 'out' }) }))]);
    const l = layout3d(L.computeBuild(p), p);
    expect(l.drivers[0]!.flange[1]).toBeCloseTo(0.15 + 0.018, 9);
    expect(l.drivers[0]!.flange[2]).toBeLessThan(0);
    expect(l.discs[0]!.center[2]).toBeLessThan(0);
    expect(l.discs[0]!.tilt).toBeCloseTo(Math.PI / 2, 12);
    expect(l.drivers[0]!.flange[2]).toBeGreaterThan(-L.computeBuild(p).bands[0]!.cabinets[0]!.geometry.dO);
  });
  it('the equivalent diameter of a port is that of the round port with the same area', () => {
    const sq = design({ portShape: 'rect', portWidthCm: 10, portHeightCm: 10 });
    expect(M.portEquivDiameterM(sq)).toBeCloseTo((2 * 0.1) / Math.sqrt(Math.PI), 12);
    expect(M.portEquivDiameterM(design({ portDiameterCm: 12 }))).toBeCloseTo(0.12, 12);
  });
});
