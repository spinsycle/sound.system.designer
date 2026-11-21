// The Cookbook additions: box losses, fill, passive radiator, transmission line, vent checks and the build rules.
import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import * as B from '../src/brief';
import * as L from '../src/buildlist';
import * as M from '../src/model';
import * as S from '../src/system';

const d15 = (more: Partial<M.Design>): M.Design => M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: 2, ...more });
const build = (design: M.Design) => L.computeBuild(S.sanitizeProject({ ...S.DEFAULT_PROJECT, bands: [{ design }] }));
const val = (c: M.Computed, label: string): string => [...c.readouts, ...c.extras].find((r) => r.label.startsWith(label))!.value;

describe('box losses and fill', () => {
  it('a stored design with no qL is lossless and unchanged; a new one starts at the Cookbook QL of 7', () => {
    const { qL: _q, pr: _p, tl: _t, fillPct: _f, ...older } = M.DEFAULT_DESIGN;
    const old = M.sanitize(older);
    expect(old.qL).toBe(0);
    expect(old.fillPct).toBe(0);
    expect(M.sanitize(null).qL).toBe(7);
    expect(M.DEFAULT_DESIGN.qL).toBe(7);
    expect(M.sanitize({ ...older, qL: 3 }).qL).toBe(3);
  });
  it('QL 7 changes the ported response and QL 0 does not', () => {
    const base = d15({ type: 'ported', volumeL: 120, tuneHz: 38, qL: 0 });
    const lossless = M.evaluateAt(base, 45).responseDb;
    const lossy = M.evaluateAt({ ...base, qL: 7 }, 45).responseDb;
    expect(lossy).not.toBeCloseTo(lossless, 2);
    expect(M.evaluateAt(d15({ type: 'ported', volumeL: 120, tuneHz: 38 }), 45).responseDb).toBe(lossy);
  });
  it('full fibre fill lowers a sealed box Qtc and the peak at fc', () => {
    const base = d15({ type: 'sealed', volumeL: 60 });
    const peak = (d: M.Design): number => Math.max(...M.compute(d).curves.responseDb);
    expect(peak({ ...base, fillPct: 100 })).toBeLessThan(peak(base));
  });
});

describe('passive radiator', () => {
  const pr = d15({ type: 'passive', volumeL: 100, tuneHz: 30, qL: 7 });
  it('the added mass tunes the box to the asked tuning', () => {
    const b = M.prOf(pr);
    expect(b.addedKg).toBeGreaterThan(0);
    expect(b.fbHz).toBeCloseTo(30, 6);
  });
  it('computes finite curves and the radiator readouts', () => {
    const c = M.compute(pr);
    for (const k of Object.keys(c.curves) as (keyof typeof c.curves)[]) expect(c.curves[k].every(Number.isFinite), k).toBe(true);
    expect(val(c, 'Mass to add')).toMatch(/ g$/);
    expect(val(c, 'Box tuning fB')).toBe('30.0 Hz');
  });
  it('warns when the radiator would travel past its Xmax, and when it is already too heavy', () => {
    const c = M.compute({ ...pr, powerW: 2000, pr: { ...pr.pr, xmaxMm: 1 } });
    expect(c.warnings.some((w) => w.includes('past its'))).toBe(true);
    const heavy = M.compute({ ...pr, tuneHz: 80, pr: { ...pr.pr, massG: 50000 } });
    expect(heavy.warnings.some((w) => w.includes('heavier'))).toBe(true);
  });
  it('the cut list has a second round hole, the radiator in the parts list, and a mass note', () => {
    const v = build(pr);
    const cab = v.bands[0]!.cabinets[0]!;
    expect(cab.cutouts.filter((x) => x.kind === 'driver').length).toBe(2);
    expect(v.bom.some((x) => x.item.startsWith('Passive radiator'))).toBe(true);
    expect(v.warnings.some((w) => w.includes('add ') && w.includes('g to the passive radiator'))).toBe(true);
  });
});

describe('transmission line', () => {
  const driver = M.driverOf(d15({}));
  const tl = d15({ type: 'tline', tl: M.tlSettingsFor(driver, 'taper', 'extended', 'acousta') });
  it('sizing a line from the tables gives the book length and an f3 near the table', () => {
    const des = P.tlDesign(driver, 'taper', 'extended');
    expect(tl.tl.lengthCm).toBeCloseTo(des.lengthM * 100, 0);
    const c = M.compute(tl);
    const f3 = Number(val(c, 'F3').replace(' Hz', ''));
    expect(f3 / des.f3Hz).toBeGreaterThan(0.8);
    expect(f3 / des.f3Hz).toBeLessThan(1.2);
    for (const k of Object.keys(c.curves) as (keyof typeof c.curves)[]) expect(c.curves[k].every(Number.isFinite), k).toBe(true);
  });
  it('line volume of a tapered line is the log-mean area times length', () => {
    expect(M.tlLineVolumeM3({ lengthM: 2, startM2: 0.2, exitM2: 0.05, chamberM3: 0, offset: 0, stuffing: 'acousta', densityLb: 1, stuffedShare: 0.8 })).toBeCloseTo((2 * 0.15) / Math.log(4), 12);
    expect(M.tlLineVolumeM3({ lengthM: 2, startM2: 0.1, exitM2: 0.1, chamberM3: 0, offset: 0, stuffing: 'acousta', densityLb: 1, stuffedShare: 0.8 })).toBeCloseTo(0.2, 12);
  });
  it('the cut list is a folded line (septa, a mouth) with a driver chamber, and stuffing in the bill', () => {
    const v = build(tl);
    expect(v.cutList.some((r) => r.part.includes('Fold septum'))).toBe(true);
    const line = v.bands[0]!.cabinets.find((c) => c.title === 'Transmission line')!;
    expect(line.fold).toBeDefined();
    expect(line.cutouts.some((x) => x.kind === 'port')).toBe(true);
    expect(line.chamber).toBeDefined(); // the driver's chamber is in the same box
    expect(v.bands[0]!.cabinets.map((c) => c.title)).toEqual(['Transmission line']);
    expect(v.bom.some((x) => x.item === 'Line stuffing (loose fibre)' && x.qty > 0)).toBe(true);
  });
  it('warns about a thin line and a missing taper', () => {
    const c = M.compute({ ...tl, tl: { ...tl.tl, startCm2: 50, exitCm2: 400 } });
    expect(c.warnings.some((w) => w.includes('narrower at the driver'))).toBe(true);
    expect(c.warnings.some((w) => w.includes('exit is larger'))).toBe(true);
  });
});

describe('vent checks and efficiency readouts', () => {
  it('a small vent is flagged against the Cookbook minimum and the area ratio', () => {
    const c = M.compute(d15({ type: 'ported', volumeL: 150, tuneHz: 40, portDiameterCm: 4 }));
    expect(c.warnings.some((w) => w.includes("Cookbook's minimum"))).toBe(true);
    expect(c.warnings.some((w) => w.includes('9:1'))).toBe(true);
  });
  it('a wide vent passes', () => {
    const c = M.compute(d15({ type: 'ported', volumeL: 150, tuneHz: 40, portDiameterCm: 25 }));
    expect(c.warnings.some((w) => w.includes("Cookbook's minimum"))).toBe(false);
  });
  it('reference efficiency and displacement-limited output are shown for sealed and ported', () => {
    const c = M.compute(d15({ type: 'ported', volumeL: 150, tuneHz: 40, qL: 7 }));
    expect(val(c, 'Reference efficiency')).toMatch(/dB at 1 W/);
    expect(val(c, 'Displacement-limited output')).toMatch(/dB at 1 m/);
  });
});

describe('build rules from chapter 5', () => {
  it('equal interior sides are flagged, the book ratios are not', () => {
    expect(L.proportionWarning('Box', { wI: 0.4, hI: 0.8, dI: 0.41 })).toContain('width and depth');
    expect(L.proportionWarning('Box', { wI: 0.4, hI: 0.8, dI: 0.5 })).toBeNull();
    for (const r of L.BOOK_PROPORTIONS) expect(L.proportionWarning('Box', { wI: r.rw, hI: r.rh, dI: r.rd })).toBeNull();
  });
  it('axial modes are c / 2L', () => {
    const m = L.axialModesHz({ wI: 0.343, hI: 0.686, dI: 0.5 });
    expect(m.w).toBeCloseTo(500, 6);
    expect(m.h).toBeCloseTo(250, 6);
    expect(m.d).toBeCloseTo(343, 6);
  });
  it('a gasket for every driver and felt for thin walls are in the bill', () => {
    const p = S.sanitizeProject({ ...S.DEFAULT_PROJECT, shop: { ...S.DEFAULT_PROJECT.shop, thicknessMm: 12 }, bands: [{ design: d15({ type: 'sealed', volumeL: 100 }) }] });
    const v = L.computeBuild(p);
    expect(v.bom.some((x) => x.item.startsWith('Driver gasket') && x.qty > 0)).toBe(true);
    expect(v.bom.some((x) => x.item.startsWith('Wall damping sheet'))).toBe(true);
    expect(L.computeBuild(S.sanitizeProject({ ...S.DEFAULT_PROJECT, bands: [{ design: d15({ type: 'sealed', volumeL: 100 }) }] })).bom.some((x) => x.item.startsWith('Wall damping sheet'))).toBe(false);
  });
  it('a wall thinner than 12 mm is warned', () => {
    const p = S.sanitizeProject({ ...S.DEFAULT_PROJECT, shop: { ...S.DEFAULT_PROJECT.shop, thicknessMm: 9 }, bands: [{ design: d15({ type: 'sealed', volumeL: 100 }) }] });
    expect(L.computeBuild(p).warnings.some((w) => w.includes('thinner than the Cookbook'))).toBe(true);
  });
});

describe('the Ollama brief offers every box type (v1.9)', () => {
  it('the schema offers the Cookbook types too', () => {
    expect(M.BRIEF_KINDS).toEqual(['sealed', 'ported', 'passive', 'bandpass', 'bandpass6', 'bandpass8', 'tline', 'tqwt', 'horn']);
    expect(JSON.stringify(B.designSchema(false))).toContain('tline');
    expect(M.BRIEF_KINDS).toEqual(M.BOX_KINDS.map((k) => k.id).sort((a, b) => M.BRIEF_KINDS.indexOf(a) - M.BRIEF_KINDS.indexOf(b)));
  });
});

describe('survivors closed', () => {
  it('an offset line puts the driver that share along the line', () => {
    const d = d15({ type: 'tline', tl: { ...M.tlSettingsFor(M.driverOf(d15({})), 'offset', 'standard', 'acousta'), offsetPct: 30 } });
    expect(M.tlGeometryOf(d).offset).toBeCloseTo(0.3, 12);
    expect(M.tlGeometryOf({ ...d, tl: { ...d.tl, kind: 'taper' } }).offset).toBe(0);
  });
  it('the line length is held to 20 to 1000 cm', () => {
    expect(M.sanitize({ ...M.DEFAULT_DESIGN, tl: { ...M.DEFAULT_DESIGN.tl, lengthCm: 5000 } }).tl.lengthCm).toBe(1000);
    expect(M.sanitize({ ...M.DEFAULT_DESIGN, tl: { ...M.DEFAULT_DESIGN.tl, lengthCm: 5 } }).tl.lengthCm).toBe(20);
  });
  it('gasket length is one turn round every driver hole plus 10 %; felt is 60 % of the outside wall area', () => {
    const p = S.sanitizeProject({ ...S.DEFAULT_PROJECT, shop: { ...S.DEFAULT_PROJECT.shop, thicknessMm: 12 }, bands: [{ design: d15({ type: 'sealed', volumeL: 100 }) }] });
    const v = L.computeBuild(p);
    const dia = 2 * Math.sqrt(M.driverOf(d15({})).sd / Math.PI);
    const gasket = v.bom.find((x) => x.item.startsWith('Driver gasket'))!;
    expect(gasket.qty).toBeCloseTo(Math.ceil(Math.PI * dia * 1.1 * 10 - 1e-9) / 10, 10);
    const g = v.bands[0]!.cabinets[0]!.geometry;
    const area = 2 * (g.wO * g.hO + g.wO * g.dO + g.hO * g.dO);
    const felt = v.bom.find((x) => x.item.startsWith('Wall damping sheet'))!;
    expect(felt.qty).toBeCloseTo(Math.ceil(area * 0.6 * 10 - 1e-9) / 10, 10);
  });
});
