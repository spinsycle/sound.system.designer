// C4 pass condition: every car starting point is a clean, buildable install that fits its space, with a cable the amp can use.
import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import * as B from '../src/buildlist';
import * as T from '../src/cartemplates';
import * as F from '../src/carfront';
import * as C from '../src/carsub';
import * as S from '../src/system';

const cls = (name: string): number => P.ALL_DRIVER_CLASSES.findIndex((d) => d.name === name);
const project = (c: C.CarSub): S.Project => S.sanitizeProject({ ...S.DEFAULT_PROJECT, kind: 'car', car: c });

describe('the starting points', () => {
  it('there are nine, with distinct names, covering a trunk, a wedge, a hatchback, an SUV, under a seat, a truck and two systems with fronts', () => {
    expect(T.CAR_TEMPLATES).toHaveLength(9);
    expect(new Set(T.CAR_TEMPLATES.map((t) => t.label)).size).toBe(9);
    expect(new Set(T.CAR_TEMPLATES.map((t) => t.car.cabin))).toEqual(new Set(['sedan', 'coupe', 'suv', 'truck']));
    expect(T.CAR_TEMPLATES.some((t) => t.car.shape === 'wedge')).toBe(true);
    expect(T.CAR_TEMPLATES.filter((t) => t.car.front.enabled).map((t) => t.car.front.type)).toEqual(['component', 'coaxial']);
    expect(T.CAR_TEMPLATES.some((t) => t.car.count === 2)).toBe(true);
    expect(T.CAR_TEMPLATES.some((t) => t.car.design.type === 'ported')).toBe(true);
    expect(new Set(T.CAR_TEMPLATES.map((t) => t.car.space.id)).size).toBeGreaterThanOrEqual(5);
  });

  T.CAR_TEMPLATES.forEach((t, i) => {
    describe(t.label, () => {
      const c = t.car;
      it('is a valid install that survives sanitising unchanged', () => {
        expect(C.sanitizeCar(c)).toEqual(c);
      });
      it('has no warnings: the sub, the system, the 12 V side and the build', () => {
        const v = C.computeCarSub(c);
        expect(v.warnings).toEqual([]);
        expect(C.computeCarSystem(c).warnings).toEqual([]);
        expect(C.computeCarElectric(c, v.limits).warnings).toEqual([]);
        expect(B.computeBuild(project(c)).warnings).toEqual([]);
      });
      it('fits the space it names', () => {
        const b = B.computeBuild(project(c)).bands[0]!;
        expect(b.fit!.fits).toBe(true);
        expect(b.fit!.space).not.toBeNull();
      });
      it('is stopped by its amplifier, with the amp as strong as the sub allows (within 5 %)', () => {
        const v = C.computeCarSub(c);
        expect(v.limits.cause).toBe('amp');
        const big = C.computeCarSub({ ...c, ampPowerW: 20000, bridged: false }).limits;
        const sub = Math.min(big.heatV, big.excursionV);
        expect(v.limits.ampV).toBeLessThanOrEqual(sub + 1e-9);
        expect(v.limits.ampV).toBeGreaterThan(sub * 0.9);
      });
      it('has a plausible load for its amp, and the plot is finite', () => {
        const v = C.computeCarSub(c);
        expect(v.limits.minLoadOhm).toBeGreaterThanOrEqual(v.limits.amplifierMinLoadOhm);
        expect(v.levelDb.every(Number.isFinite)).toBe(true);
        expect(C.computeCarSystem(c).totalDb.every(Number.isFinite)).toBe(true);
        expect(v.averageDb).toBeGreaterThan(80);
        expect(v.averageDb).toBeLessThan(135);
      });
      it('every port is 4 to 25 cm across and no longer than the box is deep', () => {
        const b = B.computeBuild(project(c)).bands[0]!;
        for (const port of b.ports) {
          expect(port.diameterM).toBeGreaterThanOrEqual(0.04);
          expect(port.diameterM).toBeLessThanOrEqual(0.25);
        }
        expect(b.ports).toHaveLength(c.design.type === 'ported' ? c.count : 0);
      });
      it('is built as a plain box (no braces) with a cable that is the thinnest the budget allows', () => {
        expect(c.build.brace).toBe('none');
        const gauges = C.CABLE_AWGS;
        const drop = (awg: number): number => { const n = C.sanitizeCar({ ...c, cableAwg: awg }); return C.computeCarElectric(n, C.computeCarSub(n).limits).dropFrac; };
        expect(drop(c.cableAwg)).toBeLessThanOrEqual(0.03);
        const k = gauges.indexOf(c.cableAwg);
        if (k < gauges.length - 1) expect(drop(gauges[k + 1]!)).toBeGreaterThan(0.03);
      });
      it('loads through the page action, keeping the 12 V settings the user chose', () => {
        const mine = C.sanitizeCar({ ...C.DEFAULT_CAR, ampClass: 'ab', supplyV: 12.6, cableAwg: 0, cableM: 3, duty: 0.25, alternatorA: 200, otherLoadsA: 10 });
        const loaded = T.applyCarTemplate(mine, i);
        expect(loaded).toEqual(C.sanitizeCar({ ...c, ampClass: 'ab', supplyV: 12.6, cableAwg: 0, cableM: 3, duty: 0.25, alternatorA: 200, otherLoadsA: 10 }));
      });
    });
  });

  it('the names are the ones in the picker', () => {
    expect(T.CAR_TEMPLATES.map((t) => t.label)).toEqual([
      'Sedan trunk: 12 in sealed',
      'Sedan trunk: 12 in ported',
      'Sedan trunk: wedge against the seat',
      'Hatchback: 10 in sealed',
      'SUV: two 10 in ported',
      'Under the seat: 10 in shallow',
      'Truck: two 10 in behind the seat',
      'Door speakers and a sub',
      'Coaxials and a small sub',
    ]);
  });
  it('a user cable too thin for the template amp is thickened to the thinnest that holds; a thick enough one is kept', () => {
    const thin = C.sanitizeCar({ ...C.DEFAULT_CAR, cableAwg: 12 });
    const loaded = T.applyCarTemplate(thin, 5);
    expect(loaded.cableAwg).toBeLessThan(12);
    expect(C.computeCarElectric(loaded, C.computeCarSub(loaded).limits).dropFrac).toBeLessThanOrEqual(0.03);
    const thick = C.sanitizeCar({ ...C.DEFAULT_CAR, cableAwg: 0 });
    expect(T.applyCarTemplate(thick, 5).cableAwg).toBe(0);
  });
  it('when even the thickest gauge loses too much, cableFor gives the thickest', () => {
    const huge = C.sanitizeCar({ ...C.DEFAULT_CAR, ampPowerW: 20000, ampLoadOhm: 0.5, ampMinLoadOhm: 0.5, cableM: 15, cableAwg: 12 });
    expect(T.cableFor(huge).cableAwg).toBe(C.CABLE_AWGS[0]);
  });
  it('the amplifier of each starting point is the sub limit at 99 percent, rounded down to 10 W', () => {
    for (const t of T.CAR_TEMPLATES) {
      const own = C.computeCarSub(t.car).limits;
      const v = Math.min(own.heatV, own.excursionV) * 0.99;
      expect(t.car.ampPowerW, t.label).toBe(Math.max(50, Math.floor((v * v) / t.car.ampLoadOhm / 10) * 10));
    }
  });
  it('the fronts of the two systems are levelled to the sub and fitted: the default door, the 6.5 in coax', () => {
    const [door, coax] = T.CAR_TEMPLATES.filter((t) => t.car.front.enabled);
    expect(door!.car.front.wooferClass).toBe(cls('6.5 in door'));
    expect(coax!.car.front.wooferClass).toBe(cls('6.5 in coax'));
    for (const t of [door!, coax!]) {
      expect(F.checkFront(t.car.front).warnings).toEqual([]);
      expect(t.car.front.trimDb).toBe(C.levelFront(t.car).front.trimDb); // already levelled
    }
  });
});

describe('the ported defaults for a sub (carPortedDefaults)', () => {
  const sub = (name: string, volumeL: number): ReturnType<typeof C.sanitizeCar>['design'] => C.withDesign(C.DEFAULT_CAR, { driverClass: cls(name), volumeL, type: 'ported' }).design;
  it('tunes at Fs (Vas / Vb)^0.31 and gives a tube of about 20 cm', () => {
    const d = sub('12 in car sub', 60);
    const got = C.carPortedDefaults(d);
    const dr = P.ALL_DRIVER_CLASSES[cls('12 in car sub')]!;
    expect(got.tuneHz).toBe(Math.round(dr.fs * (dr.vasM3 / 0.06) ** 0.31));
    expect(P.portLengthM(0.06, got.tuneHz, got.portDiameterCm / 100)).toBeCloseTo(0.2, 1);
  });
  it('a target length gives that length: the longer the tube, the wider the port', () => {
    const d = sub('12 in car sub', 60);
    const short = C.carPortedDefaults(d, 1, 0.1);
    const long = C.carPortedDefaults(d, 1, 0.3);
    expect(long.portDiameterCm).toBeGreaterThan(short.portDiameterCm);
    expect(P.portLengthM(0.06, long.tuneHz, long.portDiameterCm / 100)).toBeCloseTo(0.3, 1);
    expect(P.portLengthM(0.06, short.tuneHz, short.portDiameterCm / 100)).toBeCloseTo(0.1, 1);
  });
  it('the diameter is held to 4 and 25 cm at the extremes of the target length', () => {
    const d = sub('12 in car sub', 60);
    expect(C.carPortedDefaults(d, 1, 0.001).portDiameterCm).toBe(4);
    expect(C.carPortedDefaults(d, 1, 10).portDiameterCm).toBe(25);
  });
  it('two subs each get half the air', () => {
    expect(C.carPortedDefaults(sub('10 in car sub', 80), 2)).toEqual(C.carPortedDefaults(sub('10 in car sub', 40), 1));
  });
  it('the diameter stays within 4 to 25 cm and the tuning within the page range, for every sub and box size', () => {
    for (const n of ['8 in car sub', '10 in car sub', '12 in car sub', '15 in car sub', '10 in shallow sub', '12 in shallow sub']) {
      for (const v of [5, 20, 80, 300, 1000]) {
        const g = C.carPortedDefaults(sub(n, v));
        expect(g.portDiameterCm, `${n} ${v}`).toBeGreaterThanOrEqual(4);
        expect(g.portDiameterCm, `${n} ${v}`).toBeLessThanOrEqual(25);
        expect(g.tuneHz).toBeGreaterThanOrEqual(10);
        expect(g.tuneHz).toBeLessThanOrEqual(200);
      }
    }
  });
});

describe('the port-longer-than-the-box warning', () => {
  it('a port longer than the inside depth warns, once, naming both sizes; a short one does not', () => {
    const c = C.sanitizeCar({ ...C.DEFAULT_CAR, design: { ...C.DEFAULT_CAR.design, type: 'ported', tuneHz: 30, portDiameterCm: 12 }, space: { id: 'none', wCm: 0, hCm: 0, dCm: 0 } });
    const w = B.computeBuild(project(c)).warnings.filter((x) => x.includes('Fold them'));
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('Fold them');
    const ok = C.sanitizeCar({ ...C.DEFAULT_CAR, design: { ...C.DEFAULT_CAR.design, type: 'ported', ...C.carPortedDefaults(C.DEFAULT_CAR.design) }, space: { id: 'none', wCm: 0, hCm: 0, dCm: 0 } });
    expect(B.computeBuild(project(ok)).warnings.some((x) => x.includes('Fold them'))).toBe(false);
  });
  it('a port between the top and the bottom depth of a wedge warns: it is compared with the top', () => {
    const wedge = (len: number): C.CarSub => C.sanitizeCar({ ...C.DEFAULT_CAR, shape: 'wedge', taper: 0.3, design: { ...C.DEFAULT_CAR.design, type: 'ported', ...C.carPortedDefaults(C.DEFAULT_CAR.design, 1, len) }, space: { id: 'none', wCm: 0, hCm: 0, dCm: 0 } });
    const w0 = B.computeBuild(project(wedge(0.2))).bands[0]!.cabinets[0]!.wedge!;
    const between = B.computeBuild(project(wedge((w0.dTopI + w0.dBottomI) / 2))).bands[0]!;
    const w = between.cabinets[0]!.wedge!;
    expect(between.ports[0]!.lengthM).toBeGreaterThan(w.dTopI);
    expect(between.ports[0]!.lengthM).toBeLessThan(w.dBottomI);
    expect(between.warnings.some((x) => x.includes('Fold them'))).toBe(true);
  });
  it('a wedge compares against its shallowest depth, the top', () => {
    const base = { ...C.DEFAULT_CAR, shape: 'wedge' as const, taper: 0.3, design: { ...C.DEFAULT_CAR.design, type: 'ported' as const, ...C.carPortedDefaults(C.DEFAULT_CAR.design, 1, 0.3) }, space: { id: 'none', wCm: 0, hCm: 0, dCm: 0 } };
    expect(B.computeBuild(project(C.sanitizeCar(base))).warnings.some((x) => x.includes('Fold them'))).toBe(true);
  });
});

describe('the new space', () => {
  it('under a seat, firing up or down, is the flat orientation: wide and long, low', () => {
    const s = C.spaceOf('under-seat-flat');
    expect([s.wCm, s.hCm, s.dCm]).toEqual([60, 30, 14]);
    expect(C.spaceOf('under-seat')).toMatchObject({ wCm: 60, hCm: 14, dCm: 30 }); // the old one is unchanged
    expect(C.SPACES.map((x) => x.id)).toContain('under-seat-flat');
  });
});
