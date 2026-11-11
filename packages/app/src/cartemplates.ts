// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Starting points for the car page: a sub in a trunk, an SUV, under a seat or behind a truck seat, with or without front speakers.
// Generic and invented, like every part in the app: places to start from, not designs of any car.
import * as P from '@soundsystemdesigner/physics';
import { DEFAULT_BUILD } from './build';
import { DEFAULT_FRONT, applyFront } from './carfront';
import {
  CABLE_AWGS,
  type CarSub,
  DEFAULT_CAR,
  MAX_DROP_FRAC,
  carPortedDefaults,
  computeCarElectric,
  computeCarSub,
  levelFront,
  sanitizeCar,
  spaceOf,
} from './carsub';
import { DEFAULT_DESIGN, type Design, sanitize } from './model';

export interface CarTemplate {
  label: string;
  description: string;
  car: CarSub;
}

const classIndex = (name: string): number => P.ALL_DRIVER_CLASSES.findIndex((d) => d.name === name);

interface Spec {
  cabin: P.CabinId;
  cls: string;
  count?: number;
  type: 'sealed' | 'ported';
  volumeL: number;
  /** Dual coils in series (a higher load) and subs in series strings. */
  coilSeries?: 1 | 2;
  series?: number;
  loadOhm: number;
  minLoadOhm: number;
  space: string;
  shape?: 'box' | 'wedge';
  taper?: number;
  build: { rw: number; rh: number; rd: number };
  front?: { type: 'component' | 'coaxial'; cls: string; mount?: 'door' | 'kick' | 'dash' };
}

/** The thinnest cable gauge of the page that holds the drop within budget at the install's current, thickest if none does. */
export function cableFor(c: CarSub): CarSub {
  for (let k = CABLE_AWGS.length - 1; k >= 0; k--) {
    const next = sanitizeCar({ ...c, cableAwg: CABLE_AWGS[k]! });
    if (computeCarElectric(next, computeCarSub(next).limits).dropFrac <= MAX_DROP_FRAC) return next;
  }
  return sanitizeCar({ ...c, cableAwg: CABLE_AWGS[0]! });
}

/** An amplifier that just reaches the sub's own limit (heat or cone), rounded down to 10 W: the install is then limited by its amp and clean. */
function ampJustWithin(c: CarSub): CarSub {
  const own = computeCarSub(c).limits; // the heat and cone limits do not depend on the amplifier
  const v = Math.min(own.heatV, own.excursionV) * 0.99;
  return sanitizeCar({ ...c, ampPowerW: Math.max(50, Math.floor((v * v) / c.ampLoadOhm / 10) * 10) });
}

function template(s: Spec): CarSub {
  const count = s.count ?? 1;
  const base: Design = sanitize({ ...DEFAULT_DESIGN, driverClass: classIndex(s.cls), type: s.type, volumeL: s.volumeL, plotRange: 'low' });
  const design: Design = s.type === 'ported' ? { ...base, ...carPortedDefaults(base, count) } : base;
  let c = sanitizeCar({
    ...DEFAULT_CAR,
    cabin: s.cabin,
    design,
    count,
    series: s.series ?? 1,
    coils: 2,
    coilSeries: s.coilSeries ?? 1,
    ampLoadOhm: s.loadOhm,
    ampMinLoadOhm: s.minLoadOhm,
    bridged: false,
    space: { id: s.space, ...pickSpace(s.space) },
    shape: s.shape ?? 'box',
    taper: s.taper ?? DEFAULT_CAR.taper,
    build: { ...DEFAULT_BUILD, ...s.build, brace: 'none' },
  });
  c = ampJustWithin(c);
  if (s.front) {
    const f = applyFront({ ...DEFAULT_FRONT, enabled: true }, { type: s.front.type, mount: s.front.mount ?? 'door' });
    c = sanitizeCar({ ...c, front: applyFront(f, { wooferClass: classIndex(s.front.cls) }) });
    c = levelFront(c);
  }
  return cableFor(c);
}

const pickSpace = (id: string): { wCm: number; hCm: number; dCm: number } => {
  const s = spaceOf(id);
  return { wCm: s.wCm, hCm: s.hCm, dCm: s.dCm };
};

export const CAR_TEMPLATES: readonly CarTemplate[] = [
  {
    label: 'Sedan trunk: 12 in sealed',
    description: 'One 12 in car sub, dual coil in parallel, in a 40 L sealed box across a compact trunk. The tight, simple start.',
    car: template({ cabin: 'sedan', cls: '12 in car sub', type: 'sealed', volumeL: 40, loadOhm: 1, minLoadOhm: 1, space: 'trunk-compact', build: { rw: 1.8, rh: 1, rd: 1 } }),
  },
  {
    label: 'Sedan trunk: 12 in ported',
    description: 'The same sub in a 60 L ported box tuned near 34 Hz: louder at the bottom, bigger, in a full-size trunk.',
    car: template({ cabin: 'sedan', cls: '12 in car sub', type: 'ported', volumeL: 60, loadOhm: 1, minLoadOhm: 1, space: 'trunk-full', build: { rw: 2, rh: 1, rd: 1.2 } }),
  },
  {
    label: 'Sedan trunk: wedge against the seat',
    description: 'A 12 in sealed in a wedge: the baffle slopes back from the floor to follow the rear seat. 45 L, full-size trunk.',
    car: template({ cabin: 'sedan', cls: '12 in car sub', type: 'sealed', volumeL: 45, loadOhm: 1, minLoadOhm: 1, space: 'trunk-full', shape: 'wedge', taper: 0.6, build: { rw: 2.2, rh: 1.1, rd: 1.1 } }),
  },
  {
    label: 'Hatchback: 10 in sealed',
    description: 'A 10 in car sub in a 25 L sealed box on the cargo floor of a hatchback. A small cabin: lots of bass for the size.',
    car: template({ cabin: 'coupe', cls: '10 in car sub', type: 'sealed', volumeL: 25, loadOhm: 1, minLoadOhm: 1, space: 'hatch', build: { rw: 1.8, rh: 1, rd: 1 } }),
  },
  {
    label: 'SUV: two 10 in ported',
    description: 'Two 10 in car subs in one 70 L ported box on the cargo floor, coils in series to give the amp a 3.6 ohm load.',
    car: template({ cabin: 'suv', cls: '10 in car sub', count: 2, type: 'ported', volumeL: 70, coilSeries: 2, loadOhm: 2, minLoadOhm: 2, space: 'hatch', build: { rw: 3, rh: 1, rd: 1.4 } }),
  },
  {
    label: 'Under the seat: 10 in shallow',
    description: 'A shallow 10 in sub in a flat sealed box that fires up or down from under a seat: 10 L.',
    car: template({ cabin: 'truck', cls: '10 in shallow sub', type: 'sealed', volumeL: 10, loadOhm: 1, minLoadOhm: 1, space: 'under-seat-flat', build: { rw: 2, rh: 1, rd: 0.4 } }),
  },
  {
    label: 'Truck: two 10 in behind the seat',
    description: 'Two 10 in subs in a wide, shallow ported box behind the seat of an extended cab: 60 L.',
    car: template({ cabin: 'truck', cls: '10 in car sub', count: 2, type: 'ported', volumeL: 60, coilSeries: 2, loadOhm: 2, minLoadOhm: 2, space: 'behind-seat', build: { rw: 4, rh: 1.1, rd: 0.8 } }),
  },
  {
    label: 'Door speakers and a sub',
    description: 'A sedan system: a 12 in sealed sub in the trunk and a 6.5 in component set in the doors, crossed at 100 Hz and 2.4 kHz.',
    car: template({ cabin: 'sedan', cls: '12 in car sub', type: 'sealed', volumeL: 40, loadOhm: 1, minLoadOhm: 1, space: 'trunk-compact', build: { rw: 1.8, rh: 1, rd: 1 }, front: { type: 'component', cls: '6.5 in door' } }),
  },
  {
    label: 'Coaxials and a small sub',
    description: 'A hatchback system: an 8 in sealed sub and a pair of 6.5 in coaxials in the doors. The easy upgrade.',
    car: template({ cabin: 'coupe', cls: '8 in car sub', type: 'sealed', volumeL: 15, loadOhm: 1, minLoadOhm: 1, space: 'hatch', build: { rw: 1.6, rh: 1, rd: 1 }, front: { type: 'coaxial', cls: '6.5 in coax' } }),
  },
];

/** A starting point as the install, keeping the 12 V side (amplifier class, supply, cable, alternator, the car's loads) unless its cable is too thin for the template's amp. */
export function applyCarTemplate(c: CarSub, index: number): CarSub {
  const t = CAR_TEMPLATES[index]!.car;
  const next = sanitizeCar({ ...t, ampClass: c.ampClass, supplyV: c.supplyV, cableAwg: c.cableAwg, cableM: c.cableM, duty: c.duty, alternatorA: c.alternatorA, otherLoadsA: c.otherLoadsA });
  return computeCarElectric(next, computeCarSub(next).limits).dropFrac <= MAX_DROP_FRAC ? next : cableFor(next);
}
