// 1.15: the home speaker's cabinet can be a trapezoid or a tapered tower: the baffle stays the size asked for (it is the wide end), the depth
// follows from the air; chamber partitions and any port position are built in, and what the shape cannot do falls back to a rectangle with a warning.
import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import * as B from '../src/buildlist';
import { baffleSvg } from '../src/export';
import { layout3d } from '../src/layout3d';
import * as L from '../src/loudspeaker';
import * as S from '../src/system';

const project = (sp: L.Loudspeaker): S.Project => S.sanitizeProject({ ...S.DEFAULT_PROJECT, kind: 'speaker', speaker: sp });
const speaker = (id: L.ArrangementId, edit: (s: L.Loudspeaker) => void = () => {}): L.Loudspeaker => {
  const s = L.defaultSpeaker(id);
  edit(s);
  return L.sanitizeLoudspeaker(s);
};
const build = (sp: L.Loudspeaker) => B.computeBuild(project(sp)).bands[0]!;
const dispOf = (cls: string): number => P.driverDisplacement(P.ALL_DRIVER_CLASSES.find((d) => d.name === cls)!.sd);

describe('the speaker shape settings', () => {
  it('default to a rectangle at taper 0.7, and bad values are cleaned', () => {
    const d = L.defaultSpeaker('two-way');
    expect([d.boxShape, d.taper]).toEqual(['box', 0.7]);
    const s = L.sanitizeLoudspeaker({ ...d, boxShape: 'pyramid', taper: 9 } as never);
    expect([s.boxShape, s.taper]).toEqual(['box', 1]);
    expect(L.sanitizeLoudspeaker({ ...d, boxShape: 'tower', taper: 0.5 }).boxShape).toBe('tower');
  });
  it('a speaker template keeps the shape', () => {
    const sp = speaker('two-way', (s) => {
      s.boxShape = 'tower';
      s.taper = 0.4;
    });
    const t = L.applySpeakerTemplate(sp, 1);
    expect([t.boxShape, t.taper]).toEqual(['tower', 0.4]);
  });
});

describe.each(['trapezoid', 'tower'] as const)('a %s speaker', (shape) => {
  const sp = speaker('two-way', (s) => {
    s.boxShape = shape;
    s.taper = 0.6;
  });
  const b = build(sp);
  const cab = b.cabinets[0]!;
  const g = cab.taper!;
  it('has the baffle size asked for and holds the designed air', () => {
    expect(cab.geometry.wO).toBeCloseTo(0.2, 12);
    expect(cab.geometry.hO).toBeCloseTo(0.32, 12);
    expect(g.axis).toBe(shape === 'trapezoid' ? 'plan' : 'height');
    expect(g.netM3).toBeCloseTo(0.008, 9);
    expect(((g.wideI + g.narrowI) / 2) * g.hI * g.dI - dispOf('5.25 in') - dispOf('1 in dome')).toBeCloseTo(0.008, 9);
  });
  it('is deeper than the rectangle for the same air, and the cut list is the taper panels', () => {
    const rect = build(speaker('two-way')).cabinets[0]!;
    expect(cab.geometry.dI).toBeGreaterThan(rect.geometry.dI);
    expect(cab.panels.map((x) => x.name)).toEqual(P.taperPanels(g).map((x) => x.name));
    expect(b.warnings.join(' ')).toMatch(/at \d+\.\d degrees/);
  });
  it('has a lining area', () => {
    expect(cab.liningM2).toBeGreaterThan(0);
    expect(cab.liningM2).toBeGreaterThan(build(speaker('two-way')).cabinets[0]!.liningM2! - 0.5);
  });
  it('has its holes on the wide baffle and draws in 3D', () => {
    expect(cab.holes!.length).toBeGreaterThan(0);
    const l = layout3d(B.computeBuild(project(sp)), project(sp));
    expect(l.extent[2]).toBeCloseTo(g.dO, 12);
    expect(l.extent[0]).toBeCloseTo(g.wideO, 12);
  });
});

describe('what the shape cannot do', () => {
  it('bracing is built in and the air still holds', () => {
    const sp = speaker('two-way', (s) => {
      s.boxShape = 'trapezoid';
      s.brace = 'window';
      s.slots[0]!.design.volumeL = 60;
      s.baffleHeightCm = 90;
    });
    const g = build(sp).cabinets[0]!.taper!;
    expect(g.braces).toBeGreaterThan(0);
    expect(g.netM3).toBeCloseTo(0.06, 9);
    expect(g.wideO).toBeCloseTo(0.2, 12);
    expect(g.hO).toBeCloseTo(0.9, 12);
  });
  it('a baffle facing down: built rectangular, with the reason', () => {
    const sp = speaker('two-way', (s) => {
      s.boxShape = 'tower';
      s.slots.forEach((x) => (x.design.layout.facing = 'down'));
    });
    const b = build(sp);
    expect(b.cabinets[0]!.taper).toBeUndefined();
    expect(b.warnings.join(' ')).toMatch(/a baffle facing down/);
  });
  it('a tower warns when a hole reaches the leaning wall at the narrow top; a trapezoid does not', () => {
    const tower = build(speaker('two-way', (s) => {
      s.boxShape = 'tower';
      s.taper = 0.3;
    }));
    expect(tower.warnings.join(' ')).toMatch(/from the leaning side wall/);
    const trap = build(speaker('two-way', (s) => {
      s.boxShape = 'trapezoid';
      s.taper = 0.3;
    }));
    expect(trap.warnings.join(' ')).not.toMatch(/leaning side wall/);
  });
});

const threeWay = (shape: 'trapezoid' | 'tower', edit: (s: L.Loudspeaker) => void = () => {}) =>
  speaker('three-way', (x) => {
    x.boxShape = shape;
    x.taper = 0.6;
    x.chambers = 'separate';
    edit(x);
  });
const airOf = (sp: L.Loudspeaker): number => {
  const arr = L.arrangementOf(sp.arrangement);
  return sp.slots.reduce((a, x, k) => a + (x.open || arr.slots[k]!.role === 'tweeter' ? 0 : x.design.volumeL / 1000), 0);
};
const ported = (shape: 'trapezoid' | 'tower', place: L.Loudspeaker['portPos']['place'], taper = 0.6, dx = 0) =>
  speaker('two-way', (s) => {
    s.boxShape = shape;
    s.taper = taper;
    s.portPos.place = place;
    s.portPos.dxCm = dx;
    const d = s.slots[0]!.design;
    d.type = 'ported';
    d.volumeL = 20;
    d.tuneHz = 50;
    d.portDiameterCm = 5;
  });

describe.each(['trapezoid', 'tower'] as const)('a %s speaker with chamber partitions', (shape) => {
  const sp = threeWay(shape);
  const b = build(sp);
  const cab = b.cabinets[0]!;
  const g = cab.taper!;
  it('is built in the shape, not rectangular, with one partition for each chamber after the first', () => {
    expect(g).toBeDefined();
    expect(g.shelfAt).toHaveLength(1);
    expect(b.warnings.join(' ')).not.toMatch(/built rectangular/);
    const names = cab.panels.map((x) => x.name).filter((n) => n.startsWith('Chamber partition'));
    expect(names).toEqual([shape === 'trapezoid' ? 'Chamber partition (trapezoid)' : 'Chamber partition 1 of 1']);
    expect(cab.shelves).toEqual(g.shelfAt);
  });
  it('holds the designed air with the partitions taken out, the baffle unchanged', () => {
    expect(g.shelfM3).toBeGreaterThan(0);
    expect(g.netM3).toBeCloseTo(airOf(sp), 9);
    expect(cab.geometry.wO).toBeCloseTo(sp.baffleWidthCm / 100, 12);
    expect(cab.geometry.hO).toBeCloseTo(sp.baffleHeightCm / 100, 12);
  });
  it('puts the partition where the air above it is the first chamber\'s share', () => {
    const s = g.shelfAt[0]!;
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(g.hI);
    // layout is tweeter, mid, woofer from the top: the mid's chamber is first
    const frac = sp.slots[1]!.design.volumeL / (sp.slots[1]!.design.volumeL + sp.slots[0]!.design.volumeL);
    const above = shape === 'trapezoid' ? s : g.narrowI * s + ((g.wideI - g.narrowI) * s * s) / (2 * g.hI);
    const total = shape === 'trapezoid' ? g.hI : ((g.wideI + g.narrowI) / 2) * g.hI;
    expect(above / total).toBeCloseTo(frac, 9);
  });
  it('draws in 3D with the partition as one more plate', () => {
    const one = threeWay(shape, (x) => (x.slots[1]!.open = true));
    const count = (q: L.Loudspeaker): number => {
      const l = layout3d(B.computeBuild(project(q)), project(q));
      return l.prisms.length + l.boxes.length;
    };
    expect(count(sp)).toBe(count(one) + 1);
    expect(layout3d(B.computeBuild(project(sp)), project(sp)).extent[2]).toBeCloseTo(g.dO, 12);
  });
});

describe.each(['trapezoid', 'tower'] as const)('a %s speaker with the port away from the stack', (shape) => {
  it('a port on the back wall: built in the shape, the hole on the back, none on the front', () => {
    const b = build(ported(shape, 'rear'));
    const cab = b.cabinets[0]!;
    expect(cab.taper).toBeDefined();
    expect(b.warnings.join(' ')).not.toMatch(/built rectangular/);
    expect(cab.rearHoles).toHaveLength(1);
    // centred on the back, whose width is the narrow end of a trapezoid and the baffle's width on a tower
    const rearW = shape === 'trapezoid' ? cab.taper!.narrowO : cab.taper!.wideO;
    expect(cab.rearHoles![0]!.cx).toBeCloseTo(rearW / 2, 12);
    expect(cab.holes!.every((h) => h.kind === 'driver')).toBe(true);
  });
  it('a port beside the top driver: built in the shape, its hole on the front next to the driver', () => {
    const b = build(ported(shape, 'top-right', 0.8));
    const cab = b.cabinets[0]!;
    expect(cab.taper).toBeDefined();
    expect(b.warnings.join(' ')).not.toMatch(/built rectangular/);
    const port = cab.holes!.find((h) => h.kind === 'port')!;
    const ref = cab.holes![0]!;
    expect(port.cx).toBeGreaterThan(ref.cx);
    expect(port.cy).toBeCloseTo(ref.cy, 12);
  });
});

describe('the rear port of a tapered speaker', () => {
  it('cuts the back plate in 3D: a box for a trapezoid, a trapezoid plate for a tower', () => {
    for (const shape of ['trapezoid', 'tower'] as const) {
      const sp = ported(shape, 'rear');
      const l = layout3d(B.computeBuild(project(sp)), project(sp));
      const g = build(sp).cabinets[0]!.taper!;
      const back = shape === 'trapezoid' ? l.boxes.find((x) => x.size[0] === g.narrowO && x.size[1] === g.hO) : l.prisms.find((x) => x.points.length === 8 && x.points[0]![2] < -g.dO + 0.02 && x.points[0]![2] > -g.dO && x.points[1]![0] - x.points[0]![0] > g.narrowO);
      expect(back, shape).toBeDefined();
      expect(back!.holes, shape).toHaveLength(1);
    }
  });
  it('a rear hole too wide for the narrow top of a tower is warned about, and not for a trapezoid', () => {
    const wide = (shape: 'trapezoid' | 'tower') =>
      build(
        speaker('two-way', (s) => {
          s.boxShape = shape;
          s.taper = 0.3;
          s.portPos.place = 'rear';
          s.portPos.dyCm = -12;
          const d = s.slots[0]!.design;
          d.type = 'ported';
          d.volumeL = 20;
          d.tuneHz = 50;
          d.portDiameterCm = 9;
        }),
      ).warnings.join(' ');
    expect(wide('tower')).toMatch(/port hole reaches/);
    expect(wide('trapezoid')).not.toMatch(/leaning side wall/);
  });
});

describe('the back and partitions of a tapered speaker, to scale', () => {
  it('a tower partition is a plate as wide as the interior, centred a share of the way down; a trapezoid partition is a flat prism', () => {
    const sp = threeWay('tower');
    const g = build(sp).cabinets[0]!.taper!;
    const l = layout3d(B.computeBuild(project(sp)), project(sp));
    const shelf = l.boxes.find((x) => x.kind === 'divider')!;
    expect(shelf.size[0]).toBeCloseTo(g.shelfWidths[0]!, 12);
    expect(shelf.center[1]).toBeCloseTo(g.hO - 0.018 - g.shelfAt[0]!, 12);
    const trap = threeWay('trapezoid');
    const gp = build(trap).cabinets[0]!.taper!;
    const lp = layout3d(B.computeBuild(project(trap)), project(trap));
    const flat = lp.prisms.find((x) => x.points.length === 8 && x.points.slice(0, 4).every((p) => p[1] === x.points[0]![1]) && x.points[4]![1] - x.points[0]![1] > 0 && x.points[4]![1] - x.points[0]![1] < 0.02 && x.points[0]![1] > 0.018 && x.points[0]![1] < gp.hO - 0.018 - 0.005)!;
    expect(flat).toBeDefined();
    expect((flat.points[0]![1] + flat.points[4]![1]) / 2).toBeCloseTo(gp.hO - 0.018 - gp.shelfAt[0]!, 12);
  });
  it('the rear hole is cut where seen from behind, and a disc sits just behind the back', () => {
    for (const shape of ['trapezoid', 'tower'] as const) {
      const sp = ported(shape, 'rear', 0.6, 3);
      const cab = build(sp).cabinets[0]!;
      const g = cab.taper!;
      const l = layout3d(B.computeBuild(project(sp)), project(sp));
      const hole = cab.rearHoles![0]!;
      const rearW = shape === 'trapezoid' ? g.narrowO : g.wideO;
      const back = shape === 'trapezoid' ? l.boxes.find((x) => x.size[0] === g.narrowO && x.size[1] === g.hO)! : l.prisms.find((x) => x.points.length === 8 && x.points[0]![2] < -g.dO + 0.02 && x.points[0]![2] > -g.dO && x.points[1]![0] - x.points[0]![0] > g.narrowO)!;
      const u = back.holes![0]!;
      expect(u.u).toBeCloseTo(shape === 'trapezoid' ? rearW / 2 - hole.cx : rearW - hole.cx, 12);
      expect(u.v).toBeCloseTo(shape === 'trapezoid' ? g.hO / 2 - hole.cy : g.hO - hole.cy, 12);
      const disc = l.discs.find((d) => d.kind === 'port' && d.center[2] < -g.dO)!;
      expect(disc.center[0]).toBeCloseTo(g.wideO / 2 + rearW / 2 - hole.cx, 12);
      expect(disc.center[1]).toBeCloseTo(g.hO - hole.cy, 12);
    }
  });
  it('the back drawing is the width of the back: the narrow end of a trapezoid, the trapezoid of a tower', () => {
    const w = (svg: string): number => Number(/viewBox="0 0 ([\d.]+) /.exec(svg)![1]);
    const trap = build(ported('trapezoid', 'rear')).cabinets[0]!;
    expect(w(baffleSvg(trap, 't', 'mm', true))).toBe(Math.round(trap.taper!.narrowO * 10000) / 10);
    expect(w(baffleSvg(trap, 't', 'mm', false))).toBe(Math.round(trap.taper!.wideO * 10000) / 10);
    const tower = build(ported('tower', 'rear')).cabinets[0]!;
    expect(baffleSvg(tower, 't', 'mm', true)).toContain('<polygon');
  });
});

describe('what the shape still cannot do', () => {
  it('several columns of drivers: built rectangular, with the reason', () => {
    const b = build(speaker('two-way', (s) => {
      s.boxShape = 'tower';
      s.slots.forEach((x) => (x.design.layout.cols = 2));
    }));
    expect(b.cabinets[0]!.taper).toBeUndefined();
    expect(b.warnings.join(' ')).toMatch(/several columns/);
  });
});
