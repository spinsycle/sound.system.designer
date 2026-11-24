// 1.14: tapered boxes (trapezoid and tower) in the build: the cabinet, its cut list notes, the fit checks, what falls back to rectangular.
import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import { BOX_SHAPES, DEFAULT_BUILD, DEFAULT_TAPER, TAPER_RANGE, sanitizeBuild } from '../src/build';
import { computeBuild, panelNote, taperBaffleWidthAt, taperHoleNarrow } from '../src/buildlist';
import * as M from '../src/model';
import * as S from '../src/system';

const proj = (design: Partial<M.Design>, build: Record<string, unknown> = {}): S.Project =>
  S.sanitizeProject({ ...S.DEFAULT_PROJECT, nBands: 1, bands: [{ design: M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: 1, type: 'sealed', volumeL: 60, ...design }), build }] });
const band = (p: S.Project) => computeBuild(p).bands[0]!;
const taperOf = (p: S.Project) => band(p).cabinets[0]!.taper;

describe('build options', () => {
  it('shape and taper are stored, clamped and default to a rectangular box', () => {
    expect(sanitizeBuild({}).shape).toBe('box');
    expect(sanitizeBuild({}).taper).toBe(DEFAULT_TAPER);
    expect(sanitizeBuild({ shape: 'trapezoid', taper: 0.5 })).toMatchObject({ shape: 'trapezoid', taper: 0.5 });
    expect(sanitizeBuild({ shape: 'tower' }).shape).toBe('tower');
    expect(sanitizeBuild({ shape: 'sphere' }).shape).toBe('box');
    expect(sanitizeBuild({ taper: 0.01 }).taper).toBe(TAPER_RANGE.min);
    expect(sanitizeBuild({ taper: 7 }).taper).toBe(TAPER_RANGE.max);
    expect([TAPER_RANGE.min, TAPER_RANGE.max]).toEqual([0.3, 1]);
    expect(sanitizeBuild({ taper: 0.2 }).taper).toBe(0.3);
    expect(sanitizeBuild({ taper: 1.5 }).taper).toBe(1);
    expect(sanitizeBuild({ taper: 'x' }).taper).toBe(DEFAULT_TAPER);
    expect(DEFAULT_BUILD.shape).toBe('box');
    expect(BOX_SHAPES.map((b) => b.id)).toEqual(['box', 'trapezoid', 'tower']);
  });
  it('a stored project with no shape is a rectangular box, and the shape survives a round trip', () => {
    const p = proj({}, {});
    expect(p.bands[0]!.build.shape).toBe('box');
    expect(taperOf(p)).toBeUndefined();
    const t = proj({}, { shape: 'tower', taper: 0.55 });
    const back = S.sanitizeProject(JSON.parse(JSON.stringify(t)));
    expect(back.bands[0]!.build).toMatchObject({ shape: 'tower', taper: 0.55 });
  });
});

describe('taperBaffleWidthAt', () => {
  const plan = P.solveTaper(0.05, 0, 1.6, 2.6, 1, 0.5, 'plan', 0.018);
  const tower = P.solveTaper(0.05, 0, 1.6, 2.6, 1, 0.5, 'height', 0.018);
  it('a trapezoid front is as wide everywhere; a tower is narrow at the top and wide at the bottom, linearly', () => {
    expect(taperBaffleWidthAt(plan, 0)).toBe(plan.wideO);
    expect(taperBaffleWidthAt(plan, plan.hO)).toBe(plan.wideO);
    expect(taperBaffleWidthAt(tower, 0)).toBe(tower.narrowO);
    expect(taperBaffleWidthAt(tower, tower.hO)).toBe(tower.wideO);
    expect(taperBaffleWidthAt(tower, tower.hO / 2)).toBeCloseTo((tower.narrowO + tower.wideO) / 2, 12);
    expect(taperBaffleWidthAt(tower, -1)).toBe(tower.narrowO);
    expect(taperBaffleWidthAt(tower, 99)).toBe(tower.wideO);
  });
});

describe('taperHoleNarrow', () => {
  const tower = P.solveTaper(0.05, 0, 1.6, 2.6, 1, 0.5, 'height', 0.018);
  it('null while the hole and its 2 cm margin fit the baffle where its top edge sits; the width there when not', () => {
    const cy = tower.hO / 2;
    const h = 0.1;
    const wide = taperBaffleWidthAt(tower, cy - h / 2);
    expect(taperHoleNarrow(tower, { cy, h, w: wide - 0.04 - 1e-6 })).toBeNull();
    expect(taperHoleNarrow(tower, { cy, h, w: wide - 0.04 + 1e-3 })).toBeCloseTo(wide, 12);
    // a hole as wide as the baffle, with no room for the margin, does not fit
    expect(taperHoleNarrow(tower, { cy, h, w: wide })).toBeCloseTo(wide, 12);
    // lower down the baffle is wider: the same hole fits there
    expect(taperHoleNarrow(tower, { cy: tower.hO - 0.06, h, w: wide - 0.01 })).toBeNull();
  });
  it('a trapezoid front is as wide everywhere', () => {
    const plan = P.solveTaper(0.05, 0, 1.6, 2.6, 1, 0.5, 'plan', 0.018);
    expect(taperHoleNarrow(plan, { cy: 0.05, h: 0.1, w: plan.wideO - 0.05 })).toBeNull();
    expect(taperHoleNarrow(plan, { cy: 0.05, h: 0.1, w: plan.wideO - 0.03 })).toBe(plan.wideO);
  });
});

describe('panelNote', () => {
  it('joins what it has with a semicolon: a window, a trapezoid, a bevel', () => {
    const both: P.Panel = { name: 'Brace frame', l: 0.5, w: 0.3, qty: 1, poly: [[0, 0], [0.5, 0], [0.4, 0.3], [0.1, 0.3]], bevelDeg: 7.25, bevelEdges: 'its ends' };
    const note = panelNote(both, 'mm');
    expect(note).toBe('cut the window out; trapezoid: 500 mm on one edge and 300 mm on the parallel one; the bounding rectangle is listed; bevel 7.3 degrees on its ends');
    expect(panelNote({ name: 'Back', l: 1, w: 1, qty: 1 }, 'mm')).toBe('');
    expect(panelNote({ name: 'Back', l: 1, w: 1, qty: 1, bevelDeg: 4 }, 'mm')).toBe('bevel 4 degrees on its ends');
  });
});

describe('a tapered box in the build', () => {
  it('trapezoid: the air is held, the baffle is the wide front, the cut list has the panels with their notes', () => {
    const p = proj({}, { shape: 'trapezoid', taper: 0.6 });
    const b = band(p);
    const c = b.cabinets[0]!;
    expect(c.taper!.axis).toBe('plan');
    expect(c.taper!.taper).toBe(0.6);
    expect(c.geometry.wO).toBe(c.taper!.wideO);
    expect(c.geometry.hO).toBe(c.taper!.hO);
    // the air asked for plus the driver's displacement is inside; the net is the design's 60 L
    expect(c.taper!.netM3).toBeCloseTo(0.06, 9);
    const v = computeBuild(p);
    const rows = Object.fromEntries(v.cutList.map((r) => [r.part, r]));
    expect(rows['Top and bottom (trapezoid)']!.note).toContain(`${Math.round(c.taper!.wideO * 1000)} mm on one edge and ${Math.round(c.taper!.narrowO * 1000)} mm on the parallel one`);
    expect(Object.keys(rows)).toEqual(['Front baffle (wide end)', 'Back (narrow end)', 'Top and bottom (trapezoid)', 'Sides (angled)']);
    expect(rows['Top and bottom (trapezoid)']!.note).toMatch(/trapezoid: .* on one edge and .* on the parallel one/);
    expect(rows['Sides (angled)']!.note).toMatch(/bevel \d+(\.\d)? degrees on the two edges that meet the front and the back/);
    expect(rows['Front baffle (wide end)']!.note).toBe('');
    expect(rows['Sides (angled)']!.qty).toBe(2);
    expect(v.sheets).toBeGreaterThan(0);
    expect(b.warnings.join(' ')).toMatch(/side walls angle in over the depth/);
    expect(b.warnings.join(' ')).toMatch(/test-fit/);
  });
  it('tower: trapezoid front and back, leaning sides', () => {
    const p = proj({}, { shape: 'tower', taper: 0.6 });
    const c = band(p).cabinets[0]!;
    expect(c.taper!.axis).toBe('height');
    const v = computeBuild(p);
    expect(v.cutList.map((r) => r.part)).toEqual(['Front baffle (trapezoid)', 'Back (trapezoid)', 'Bottom (wide end)', 'Top (narrow end)', 'Sides (leaning)']);
    expect(v.cutList[4]!.note).toMatch(/bevel .* degrees on the two edges that meet the top and the bottom/);
    expect(band(p).warnings.join(' ')).toMatch(/side walls lean in over the height/);
  });
  it('a ported box can be tapered; the port is sized from the design and listed', () => {
    const p = proj({ type: 'ported', volumeL: 80, tuneHz: 42 }, { shape: 'trapezoid', taper: 0.7 });
    const b = band(p);
    expect(b.cabinets[0]!.taper).toBeDefined();
    expect(b.ports.length).toBe(1);
    expect(b.cabinets[0]!.taper!.netM3).toBeCloseTo(0.08, 9);
  });
  it('a taper of 1 gives the volume of the same rectangular box', () => {
    const t = proj({}, { shape: 'trapezoid', taper: 1 });
    const r = proj({}, {});
    expect(taperOf(t)!.wideI).toBeCloseTo(band(r).cabinets[0]!.geometry.wI, 9);
    expect(taperOf(t)!.dI).toBeCloseTo(band(r).cabinets[0]!.geometry.dI, 9);
  });
  it('the lining is the walls other than the baffle, inside', () => {
    const up = (v: number): number => Math.ceil(v * 10 - 1e-9) / 10;
    const plan = taperOf(proj({}, { shape: 'trapezoid', taper: 0.6 }))!;
    const lp = band(proj({}, { shape: 'trapezoid', taper: 0.6 })).cabinets[0]!.liningM2;
    const planExpected = 2 * plan.slantI * plan.hI + plan.narrowI * plan.hI + (plan.wideI + plan.narrowI) * plan.dI;
    expect(lp).toBe(up(planExpected));
    const tower = taperOf(proj({}, { shape: 'tower', taper: 0.6 }))!;
    const lt = band(proj({}, { shape: 'tower', taper: 0.6 })).cabinets[0]!.liningM2;
    const towerExpected = 2 * tower.slantI * tower.dI + ((tower.wideI + tower.narrowI) / 2) * tower.hI + (tower.wideI + tower.narrowI) * tower.dI;
    expect(lt).toBe(up(towerExpected));
    // a wrong side, or a single side, would be a different number
    expect(up(planExpected - plan.slantI * plan.hI)).not.toBe(lp);
    expect(up(2 * plan.slantI * plan.dI + plan.narrowI * plan.hI + (plan.wideI + plan.narrowI) * plan.dI)).not.toBe(lp);
    expect(up(2 * tower.slantI * tower.hI + ((tower.wideI + tower.narrowI) / 2) * tower.hI + (tower.wideI + tower.narrowI) * tower.dI)).not.toBe(lt);
  });
  it('lining is counted, and no proportion warning is made for a tapered box', () => {
    const p = proj({}, { shape: 'trapezoid', taper: 0.6, rw: 1, rh: 1, rd: 1 });
    expect(band(p).cabinets[0]!.liningM2).toBeGreaterThan(0);
    expect(band(p).warnings.join(' ')).not.toMatch(/share a standing wave/);
    // the same equal sides in a rectangular box do warn
    expect(band(proj({}, { rw: 1, rh: 1, rd: 1 })).warnings.join(' ')).toMatch(/share a standing wave/);
  });
  it('braces are built into a tapered box: frames in the cut list, the air held, no warning about missing braces', () => {
    const deep = { shape: 'trapezoid', taper: 0.6, brace: 'window', rd: 2.5 };
    const p = proj({ volumeL: 600 }, deep);
    const v = computeBuild(p);
    const frames = v.cutList.filter((r) => r.part.startsWith('Brace frame'));
    const g = taperOf(p)!;
    expect(g.braces).toBeGreaterThan(1);
    expect(frames).toHaveLength(g.braces);
    expect(frames[0]!.note).toContain('cut the window out');
    expect(g.netM3).toBeCloseTo(0.6, 9);
    expect(band(p).warnings.join(' ')).not.toMatch(/no braces/);
    expect(band(proj({ volumeL: 600 }, { ...deep, brace: 'none' })).cabinets[0]!.taper!.braces).toBe(0);
    const tower = computeBuild(proj({ volumeL: 600 }, { ...deep, shape: 'tower' }));
    const tf = tower.cutList.find((r) => r.part === 'Brace frame (trapezoid)')!;
    expect(tf.qty).toBe(taperOf(proj({ volumeL: 600 }, { ...deep, shape: 'tower' }))!.braces);
    expect(tf.note).toContain('cut the window out');
    expect(tf.note).toContain('trapezoid:');
  });
});

describe('what falls back to a rectangular box', () => {
  it('a band-pass box is built rectangular with a warning', () => {
    const b = band(proj({ type: 'bandpass', volumeL: 40, frontVolumeL: 40, tuneHz: 60 }, { shape: 'trapezoid' }));
    expect(b.cabinets[0]!.taper).toBeUndefined();
    expect(b.warnings.join(' ')).toMatch(/is for sealed, ported and passive-radiator boxes with one driver facing front; this has a bandpass box/);
  });
  it('several drivers per box, push-pull, columns and a baffle facing down are built rectangular', () => {
    const many = S.sanitizeProject({ ...S.DEFAULT_PROJECT, nBands: 1, bands: [{ design: M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: 1, type: 'sealed', volumeL: 120 }), build: { shape: 'tower' }, count: 2, perBox: 2 }] });
    expect(computeBuild(many).bands[0]!.cabinets[0]!.taper).toBeUndefined();
    expect(computeBuild(many).bands[0]!.warnings.join(' ')).toMatch(/several drivers in a box/);
    const down = proj({ layout: { ...M.DEFAULT_LAYOUT, facing: 'down' } }, { shape: 'tower' });
    expect(taperOf(down)).toBeUndefined();
    const cols = proj({ layout: { ...M.DEFAULT_LAYOUT, cols: 2 } }, { shape: 'tower' });
    expect(taperOf(cols)).toBeUndefined();
    const pp = proj({ layout: { ...M.DEFAULT_LAYOUT, pushPull: true } }, { shape: 'tower' });
    expect(taperOf(pp)).toBeUndefined();
  });
  it('a horn and a folded horn are untouched by the shape', () => {
    const h = proj({ type: 'horn', volumeL: 40 }, { shape: 'trapezoid' });
    expect(band(h).cabinets.every((c) => !c.taper)).toBe(true);
  });
  it('a rectangular box has no shape warnings', () => {
    expect(band(proj({}, {})).warnings.join(' ')).not.toMatch(/tapered|trapezoid|rectangular/);
  });
});

describe('the baffle of a tower narrows towards the top', () => {
  it('a hole wider than the baffle where it sits is warned about, a narrower one is not', () => {
    // an 18 in driver (a 0.33 m cone) in a steeply tapered tower: the top of the baffle is far narrower than the hole
    const tight = band(proj({ driverClass: 3, volumeL: 150 }, { shape: 'tower', taper: 0.3 }));
    expect(tight.warnings.join(' ')).toMatch(/hole reaches .* from the leaning side wall/);
    const wide = band(proj({ driverClass: 3, volumeL: 150 }, { shape: 'trapezoid', taper: 0.3 }));
    expect(wide.warnings.join(' ')).not.toMatch(/leaning side wall/);
    const mild = band(proj({ driverClass: 1, volumeL: 60 }, { shape: 'tower', taper: 0.9 }));
    expect(mild.warnings.join(' ')).not.toMatch(/leaning side wall/);
  });
});
