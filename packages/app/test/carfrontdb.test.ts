// 1.11.1: the car's front speakers take database drivers: their cut-out and mounting depth (or an estimate), names, ring, checks, build.
import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import * as B from '../src/buildlist';
import * as F from '../src/carfront';
import * as C from '../src/carsub';
import { importFromDesign } from '../src/crossoverimport';
import { DB_CSV_TEMPLATE, parseDriverCsvEntries } from '../src/drivers/csv';
import { type DriverEntry, buildEntry, sanitizeSnapshot, snapshotOf } from '../src/drivers/entry';
import { FIELDS } from '../src/drivers/fields';
import { emptyDb, upsertEntry } from '../src/drivers/library';
import { libraryUpdate } from '../src/drivers/pick';
import * as M from '../src/model';
import * as S from '../src/system';

const mk = (over: Record<string, unknown>, id: string): DriverEntry => {
  const r = buildEntry({ fs: 55, re: 3.6, qes: 0.7, qms: 3.5, vasM3: 0.012, sd: 0.0136, xmax: 0.006, pe: 100, kind: 'woofer', manufacturer: 'Acme', model: id, ...over } as never, id, '2026-11-23');
  if (!r.ok) throw new Error(r.errors.join());
  return r.entry;
};
/** A 6.5 in-ish door woofer with its own mounting numbers, and the same without them. */
const W = mk({ cutoutWM: 0.15, depthM: 0.075 }, 'w1');
const W_BARE = mk({}, 'w2');
const OVAL = mk({ cutoutWM: 0.216, cutoutHM: 0.14, depthM: 0.08 }, 'w3');
const TW = mk({ fs: 1200, re: 4, qes: 1, qms: 2.5, vasM3: 2.5e-5, sd: 5e-4, xmax: 5e-4, pe: 40, kind: 'tweeter' }, 't1');
const snap = (e: DriverEntry) => snapshotOf(e)!;

const front = (patch: Partial<F.CarFront>): F.CarFront => F.sanitizeFront({ ...F.DEFAULT_FRONT, enabled: true, ...patch });
const project = (f: F.CarFront): S.Project => S.sanitizeProject({ ...S.DEFAULT_PROJECT, kind: 'car', car: C.sanitizeCar({ ...C.DEFAULT_CAR, front: f }) });

describe('mounting numbers on a database driver', () => {
  it('are optional, in millimetres on the form, range checked and kept in the snapshot', () => {
    expect([W.cutoutWM, W.depthM, W.cutoutHM]).toEqual([0.15, 0.075, undefined]);
    expect(FIELDS.filter((f) => f.key === 'cutoutWM' || f.key === 'cutoutHM' || f.key === 'depthM').map((f) => [f.unit, f.scale])).toEqual([['mm', 1e-3], ['mm', 1e-3], ['mm', 1e-3]]);
    expect(buildEntry({ fs: 55, re: 3.6, qes: 0.7, qms: 3.5, cutoutWM: 0.01 }, 'x', 'n').ok).toBe(false);
    expect(buildEntry({ fs: 55, re: 3.6, qes: 0.7, qms: 3.5, depthM: 1 }, 'x', 'n').ok).toBe(false);
    expect([snap(W).cutoutWM, snap(W).depthM, snap(W).cutoutHM]).toEqual([0.15, 0.075, undefined]);
    expect(snap(W_BARE).cutoutWM).toBeUndefined();
    const s = snap(OVAL);
    expect(sanitizeSnapshot(s)).toEqual(s);
    expect(sanitizeSnapshot({ ...s, depthM: 5 })).toBeUndefined();
    expect(sanitizeSnapshot({ ...s, cutoutHM: 'x' })).toBeUndefined();
    expect(sanitizeSnapshot({ ...s, cutoutWM: 0.001 })).toBeUndefined();
  });
  it('come from CSV columns in millimetres', () => {
    expect(DB_CSV_TEMPLATE.split('\n')[0]).toContain('cutout_mm,cutout_h_mm,depth_mm');
    expect(DB_CSV_TEMPLATE.split('\n')[0]!.split(',')).toHaveLength(DB_CSV_TEMPLATE.split('\n')[1]!.split(',').length);
    const r = parseDriverCsvEntries('model,fs,qts,qes,re,Cutout mm,Cutout height,Mounting depth\nD1,55,0.5,0.7,3.6,150,140,75\n', '2026-11-23', () => 'c1');
    expect(r.errors).toEqual([]);
    expect([r.entries[0]!.cutoutWM, r.entries[0]!.cutoutHM, r.entries[0]!.depthM]).toEqual([0.15, 0.14, 0.075]);
  });
  it('a change of mounting numbers in the library is offered as an update', () => {
    const d = M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: M.CUSTOM_CLASS, libDriver: snap(W) });
    expect(libraryUpdate(d, upsertEntry(emptyDb(), W))).toBeNull();
    expect(libraryUpdate(d, upsertEntry(emptyDb(), mk({ cutoutWM: 0.16, depthM: 0.075 }, 'w1')))).not.toBeNull();
    expect(libraryUpdate(d, upsertEntry(emptyDb(), mk({ cutoutWM: 0.15, depthM: 0.08 }, 'w1')))).not.toBeNull();
    expect(libraryUpdate(d, upsertEntry(emptyDb(), mk({ cutoutWM: 0.15, cutoutHM: 0.1, depthM: 0.075 }, 'w1')))).not.toBeNull();
  });
});

describe('frontInfoOf', () => {
  it('a class is its generic numbers, never estimated', () => {
    const f = front({});
    expect(F.frontInfoOf(f)).toEqual({ ...F.FRONT_INFO['6.5 in door']!, estimated: false });
    expect(F.frontInfoOf(front({ type: 'coaxial', wooferClass: P.ALL_DRIVER_CLASSES.findIndex((d) => d.name === '6x9 coax') }))!.cutout.kind).toBe('oval');
  });
  it('a database driver uses its own cut-out and depth', () => {
    const i = F.frontInfoOf(front({ wooferDriver: snap(W) }))!;
    expect(i).toEqual({ depthCm: 7.5, cutout: { kind: 'round', wCm: 15, hCm: 15 }, coax: false, estimated: false });
    const o = F.frontInfoOf(front({ wooferDriver: snap(OVAL) }))!;
    expect(o.cutout).toEqual({ kind: 'oval', wCm: 21.6, hCm: 14 });
    // a height equal to the width is a round hole
    expect(F.frontInfoOf(front({ wooferDriver: snap(mk({ cutoutWM: 0.15, cutoutHM: 0.15, depthM: 0.07 }, 'r1')) }))!.cutout).toEqual({ kind: 'round', wCm: 15, hCm: 15 });
    expect(F.frontInfoOf(front({ type: 'coaxial', wooferClass: P.ALL_DRIVER_CLASSES.findIndex((d) => d.name === '6.5 in coax'), wooferDriver: snap(W) }))!.coax).toBe(true);
  });
  it('without them the numbers are estimated from the cone and flagged', () => {
    const i = F.frontInfoOf(front({ wooferDriver: snap(W_BARE) }))!;
    const cone = M.driverOf(M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: M.CUSTOM_CLASS, libDriver: snap(W_BARE) })).sd;
    const coneCm = ((2 * Math.sqrt(cone / Math.PI)) * 100);
    expect(i.estimated).toBe(true);
    expect(i.cutout.wCm).toBeCloseTo(Math.round(coneCm * 1.06 * 10) / 10, 9);
    expect(i.depthCm).toBeCloseTo(Math.round((coneCm * 0.45 + 1) * 10) / 10, 9);
    // close to the generic 6.5 in door's 14.2 cm and 7 cm
    expect(Math.abs(i.cutout.wCm - 14.2)).toBeLessThan(0.8);
    expect(Math.abs(i.depthCm - 7)).toBeLessThan(0.8);
    // only one of the two entered is still an estimate
    expect(F.frontInfoOf(front({ wooferDriver: snap(mk({ cutoutWM: 0.15 }, 'h')) }))!.estimated).toBe(true);
    expect(F.frontInfoOf(front({ wooferDriver: snap(mk({ depthM: 0.07 }, 'h2')) }))!.estimated).toBe(true);
  });
});

describe('sanitise and apply', () => {
  it('keeps valid database drivers and drops bad ones', () => {
    const f = front({ wooferDriver: snap(W), tweeterDriver: snap(TW) });
    expect(f.wooferDriver).toEqual(snap(W));
    expect(f.tweeterDriver).toEqual(snap(TW));
    expect(F.sanitizeFront({ ...f, wooferDriver: { ...snap(W), fs: 99999 } }).wooferDriver).toBeUndefined();
    expect(F.sanitizeFront({ ...f, tweeterDriver: 7 }).tweeterDriver).toBeUndefined();
    expect(F.sanitizeFront(F.DEFAULT_FRONT).wooferDriver).toBeUndefined();
  });
  it('choosing a class drops the database driver; choosing a driver keeps the class; a type change starts fresh', () => {
    const f = front({ wooferDriver: snap(W), tweeterDriver: snap(TW) });
    const cls = P.ALL_DRIVER_CLASSES.findIndex((d) => d.name === '5.25 in door');
    expect(F.applyFront(f, { wooferClass: cls }).wooferDriver).toBeUndefined();
    expect(F.applyFront(f, { wooferClass: cls }).tweeterDriver).toEqual(snap(TW));
    expect(F.applyFront(f, { tweeterClass: P.ALL_DRIVER_CLASSES.findIndex((d) => d.name === '1 in dome') }).tweeterDriver).toBeUndefined();
    expect(F.applyFront(f, { wooferClass: cls, wooferDriver: snap(W) }).wooferDriver).toEqual(snap(W));
    expect(F.applyFront(front({}), { wooferDriver: snap(W) }).wooferClass).toBe(F.DEFAULT_FRONT.wooferClass);
    const coax = F.applyFront(f, { type: 'coaxial' });
    expect(coax.wooferDriver).toBeUndefined();
    expect(coax.type).toBe('coaxial');
  });
  it('a new driver sets the opening to its cut-out plus 1 cm; an unchanged one leaves it', () => {
    expect(F.applyFront(front({}), { wooferDriver: snap(W) }).openingCm).toBeCloseTo(16, 9);
    const set = F.applyFront(front({}), { wooferDriver: snap(W) });
    expect(F.applyFront({ ...set, openingCm: 18 }, { airL: 12 }).openingCm).toBe(18);
    expect(F.applyFront(set, { wooferDriver: snap(OVAL) }).openingCm).toBeCloseTo(22.6, 9);
  });
  it('a picker patch becomes a front patch', () => {
    expect(F.frontPatchFrom('woofer', { driverClass: M.CUSTOM_CLASS, libDriver: snap(W) })).toEqual({ wooferDriver: snap(W) });
    expect(F.frontPatchFrom('tweeter', { driverClass: M.CUSTOM_CLASS, libDriver: snap(TW) })).toEqual({ tweeterDriver: snap(TW) });
    expect(F.frontPatchFrom('woofer', { driverClass: 7 })).toEqual({ wooferClass: 7 });
    expect(F.frontPatchFrom('tweeter', { driverClass: 9 })).toEqual({ tweeterClass: 9 });
    expect(F.frontPatchFrom('woofer', { driverClass: M.CUSTOM_CLASS })).toEqual({});
  });
});

describe('what the fronts do with a database driver', () => {
  it('the woofer and tweeter designs carry the driver, and the response uses its numbers', () => {
    const f = front({ wooferDriver: snap(W), tweeterDriver: snap(TW) });
    expect(M.driverOf(F.wooferDesign(f)).fs).toBe(55);
    expect(M.driverOf(F.wooferDesign(f)).name).toBe(W.name);
    expect(M.driverOf(F.tweeterDesign(f)).fs).toBe(1200);
    const p = F.frontPressures(f);
    const base = F.frontPressures(front({}));
    expect(Number.isFinite(P.abs(p.woofer(300)))).toBe(true);
    expect(Number.isFinite(P.abs(p.tweeter!(5000)))).toBe(true);
    expect(P.abs(p.woofer(40))).not.toBeCloseTo(P.abs(base.woofer(40)), 6);
    expect(M.driverOf(F.wooferDesign(front({}))).name).toBe('6.5 in door');
  });
  it('the ring, names and checks follow the driver', () => {
    const f = front({ wooferDriver: snap(W), openingCm: 16, depthCm: 9 });
    const ring = F.ringOf(f)!;
    expect(ring.title).toBe(`${W.name} adapter ring`);
    expect(ring.inner).toEqual({ kind: 'round', wCm: 15, hCm: 15 });
    expect(F.wooferName(f)).toBe(W.name);
    expect(F.wooferName(front({}))).toBe('6.5 in door');
    expect(F.tweeterName(front({ tweeterDriver: snap(TW) }))).toBe(TW.name);
    expect(F.tweeterName(front({}))).toBe('1 in dome');
    expect(F.checkFront(f).warnings.join(' ')).not.toMatch(/guessed from its cone/);
    expect(F.checkFront(f).needDepthCm).toBeCloseTo(8.5, 9);
    const shallow = F.checkFront(front({ wooferDriver: snap(W), depthCm: 5 })).warnings.join(' ');
    expect(shallow).toContain(W.name);
    expect(shallow).toContain('7.5 cm driver');
    const bare = F.checkFront(front({ wooferDriver: snap(W_BARE) })).warnings.join(' ');
    expect(bare).toMatch(/has no cut-out or mounting depth entered/);
    // 2000 Hz is under twice this tweeter's 1200 Hz resonance, but not under twice the generic 1 in dome's 900 Hz
    expect(F.checkFront(front({ tweeterDriver: snap(TW), xoverTweeterHz: 2000 })).warnings.join(' ')).toContain(`The ${TW.name} is crossed at 2000 Hz`);
    expect(F.checkFront(front({ xoverTweeterHz: 2000 })).warnings.join(' ')).not.toMatch(/is crossed at 2000 Hz, under twice/);
    expect(F.checkFront(front({ tweeterDriver: snap(TW), xoverTweeterHz: 2600 })).warnings.join(' ')).not.toMatch(/under twice its/);
  });
  it('the build lists the driver names and a ring with the driver cut-out; the crossover import sees the driver', () => {
    const p = project(front({ wooferDriver: snap(W), tweeterDriver: snap(TW) }));
    const v = B.computeBuild(p);
    const bom = new Map(v.bom.map((b) => [b.item, b.qty]));
    expect(bom.get(`${W.name} (front, one each side)`)).toBe(2);
    expect(bom.get(`${TW.name} tweeter (front, one each side)`)).toBe(2);
    expect(v.cutList.find((r) => r.part === `${W.name} adapter ring`)!.note).toContain('15 cm round');
    const imp = importFromDesign(p, 'car');
    if (!imp.ok) throw new Error(imp.reason);
    expect(imp.drivers[0]!.fsHz).toBeCloseTo(55, 6);
    expect(imp.drivers[1]!.fsHz).toBeCloseTo(1200, 6);
  });
  it('survives a project save and open', () => {
    const p = project(front({ wooferDriver: snap(W), tweeterDriver: snap(TW) }));
    const back = S.sanitizeProject(JSON.parse(JSON.stringify(p)));
    expect(back.car.front.wooferDriver).toEqual(snap(W));
    expect(back.car.front.tweeterDriver).toEqual(snap(TW));
  });
});
