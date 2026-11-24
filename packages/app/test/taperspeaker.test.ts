// 1.15: the home speaker's cabinet can be a trapezoid or a tapered tower: the baffle stays the size asked for (it is the wide end), the depth
// follows from the air, and anything the shape cannot do falls back to a rectangle with a warning.
import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import * as B from '../src/buildlist';
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
  it('chamber partitions: built rectangular, with the reason', () => {
    const sp = speaker('three-way', (s) => {
      s.boxShape = 'tower';
      s.chambers = 'separate';
    });
    const b = build(sp);
    expect(b.cabinets[0]!.panels.some((x) => x.name === 'Chamber partition')).toBe(true);
    expect(b.cabinets[0]!.taper).toBeUndefined();
    expect(b.warnings.join(' ')).toMatch(/needs one chamber.*chamber partitions.*built rectangular/);
  });
  it('a port away from the stack: built rectangular, with the reason', () => {
    const sp = speaker('two-way', (s) => {
      s.boxShape = 'trapezoid';
      s.portPos.place = 'rear';
    });
    const b = build(sp);
    expect(b.cabinets[0]!.taper).toBeUndefined();
    expect(b.warnings.join(' ')).toMatch(/the port placed away from the stack/);
  });
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
