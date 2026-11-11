// H3 pass condition: a speaker's cabinet holds the air its chambers need, the baffle is the size asked for, every driver and port has
// a hole in its place, and the cut list, BOM, drawings and 3D view all follow from the same geometry.
import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import * as B from '../src/buildlist';
import * as X from '../src/export';
import { layout3d } from '../src/layout3d';
import * as L from '../src/loudspeaker';
import * as S from '../src/system';

const cls = (name: string): number => P.ALL_DRIVER_CLASSES.findIndex((d) => d.name === name);
const project = (sp: L.Loudspeaker, more: Partial<S.Project> = {}): S.Project => S.sanitizeProject({ ...S.DEFAULT_PROJECT, kind: 'speaker', speaker: sp, ...more });
const speaker = (id: L.ArrangementId, edit: (s: L.Loudspeaker) => void = () => {}): L.Loudspeaker => {
  const s = L.defaultSpeaker(id);
  edit(s);
  return L.sanitizeLoudspeaker(s);
};
const T = 0.018;
/** A small ported slot: a 3 cm port tuned at 60 Hz fits a 2 L chamber. */
const portedSmall = (s: L.Loudspeaker): void => {
  s.slots[0]!.design.type = 'ported';
  s.slots[0]!.design.tuneHz = 60;
  s.slots[0]!.design.portDiameterCm = 3;
};

describe('the cabinet', () => {
  const p = project(speaker('two-way'));
  const v = B.computeBuild(p);
  const cab = v.bands[0]!.cabinets[0]!;
  it('is one cabinet, as wide and high as the baffle asked for', () => {
    expect(v.bands).toHaveLength(1);
    expect(cab.geometry.wO).toBeCloseTo(0.2, 12);
    expect(cab.geometry.hO).toBeCloseTo(0.32, 12);
    expect(v.bands[0]!.count).toBe(2);
  });
  it('holds the designed air: interior volume less the drivers is the woofer chamber (the dome has its back built in)', () => {
    const g = cab.geometry;
    const disp = P.driverDisplacement(P.ALL_DRIVER_CLASSES[cls('5.25 in')]!.sd) + P.driverDisplacement(P.ALL_DRIVER_CLASSES[cls('1 in dome')]!.sd);
    expect(g.wI * g.hI * g.dI - disp).toBeCloseTo(0.008, 9);
    expect(cab.panels.find((x) => x.name === 'Chamber partition')).toBeUndefined();
  });
  it('cuts the same panels as any box: one chamber, no partition', () => {
    expect(cab.panels.map((x) => x.name)).toEqual(['Front baffle', 'Back', 'Top and bottom', 'Sides']);
    const rows = v.cutList.filter((r) => r.part === 'Front baffle');
    expect(rows[0]).toMatchObject({ band: 'Speaker', qty: 2, l: 200, w: 320 });
  });
});

describe('exact geometry', () => {
  it('an MTM cabinet holds exactly the air of its chambers once drivers, ports and partitions are taken out', () => {
    const s = speaker('mtm', portedSmall);
    s.slots[0]!.design.volumeL = 6;
    const sp = L.sanitizeLoudspeaker(s);
    const b = B.computeBuild(project(sp)).bands[0]!;
    const g = b.cabinets[0]!.geometry;
    const mid = P.ALL_DRIVER_CLASSES[cls('4 in mid')]!;
    const dome = P.ALL_DRIVER_CLASSES[cls('1 in dome')]!;
    const port = P.portLengthM(0.006 / 2, 60, 0.03);
    const disp = 2 * P.driverDisplacement(mid.sd) + P.driverDisplacement(dome.sd) + 2 * P.portDisplacement(0.03, port); // one shared chamber, the dome's back is built in: no partition
    expect(g.wI * g.hI * g.dI - disp).toBeCloseTo(0.006, 9);
    expect(b.ports).toHaveLength(2);
    for (const x of b.ports) expect(x.lengthM).toBeCloseTo(port, 12); // each driver's port is for half the air
  });
  it('braces take their wood out of the air too', () => {
    const s = speaker('two-way', (x) => {
      x.slots[0]!.design.volumeL = 60;
      x.brace = 'window';
    });
    const g = B.computeBuild(project(s)).bands[0]!.cabinets[0]!.geometry;
    expect(g.braces).toBeGreaterThan(0);
    const disp = P.driverDisplacement(P.ALL_DRIVER_CLASSES[cls('5.25 in')]!.sd) + P.driverDisplacement(P.ALL_DRIVER_CLASSES[cls('1 in dome')]!.sd);
    expect(g.wI * g.hI * g.dI - disp - g.braces * P.braceVolume(g.wI, g.hI, T)).toBeCloseTo(0.06, 9);
    expect(g.netM3).toBeCloseTo(0.06, 9); // the geometry reports the air that is left
  });
  it('the driver stack starts a third of the way down the spare height', () => {
    const cab = B.computeBuild(project(speaker('two-way'))).bands[0]!.cabinets[0]!;
    const [tw, wf] = B.holePositions(cab);
    const total = 2 * (tw!.r + wf!.r) + B.HOLE_GAP;
    expect(tw!.cy - tw!.r).toBeCloseTo((cab.geometry.hO - total) / 3, 12);
  });
  it('a baffle too narrow for hole plus margins, or just too short for the stack plus a margin, is flagged', () => {
    expect(B.computeBuild(project(speaker('two-way', (x) => (x.baffleWidthCm = 12)))).warnings.some((w) => w.includes('wide baffle'))).toBe(true);
    expect(B.computeBuild(project(speaker('two-way', (x) => (x.baffleHeightCm = 19)))).warnings.some((w) => w.includes('high baffle'))).toBe(true);
    expect(B.computeBuild(project(speaker('two-way', (x) => (x.baffleHeightCm = 21)))).warnings).toEqual([]);
  });
});

describe('chambers and partitions', () => {
  const build = (s: L.Loudspeaker): B.BandBuild => B.computeBuild(project(s)).bands[0]!;
  const partitions = (s: L.Loudspeaker): number => build(s).cabinets[0]!.panels.find((x) => x.name === 'Chamber partition')?.qty ?? 0;
  it('a shared chamber needs no partition, and a dome tweeter never adds one', () => {
    for (const id of ['two-way', 'mtm', 'wtw', 'tmm'] as const) expect(partitions(speaker(id)), id).toBe(0);
  });
  it('separate chambers add one shelf between two woofers; a 3-way and a 2.5-way have one between their two chambers', () => {
    expect(partitions(speaker('wtw', (s) => (s.chambers = 'separate')))).toBe(1);
    expect(partitions(speaker('mtm', (s) => (s.chambers = 'separate')))).toBe(1);
    expect(partitions(speaker('three-way'))).toBe(1);
    expect(partitions(speaker('two-and-half'))).toBe(1);
    expect(partitions(speaker('two-way', (s) => (s.chambers = 'separate')))).toBe(0); // one driver: one chamber
  });
  it('an open-baffle woofer has no chamber, so a pair of them needs no shelf', () => {
    expect(partitions(speaker('wtw', (s) => { s.chambers = 'separate'; s.slots[0]!.open = true; }))).toBe(0);
  });
  it('a shelf is a flat panel, interior width by interior depth, and the air balance still holds', () => {
    const b = build(speaker('wtw', (s) => (s.chambers = 'separate')));
    const cab = b.cabinets[0]!;
    const g = cab.geometry;
    expect(cab.panels.find((x) => x.name === 'Chamber partition')).toMatchObject({ l: g.wI, w: g.dI, qty: 1 });
    const wf = P.ALL_DRIVER_CLASSES[cls('5.25 in')]!;
    const dome = P.ALL_DRIVER_CLASSES[cls('1 in dome')]!;
    const disp = 2 * P.driverDisplacement(wf.sd) + P.driverDisplacement(dome.sd) + g.wI * g.dI * T;
    expect(g.wI * g.hI * g.dI - disp).toBeCloseTo(0.016, 9); // the two woofers' 16 L, the dome's back is its own
    expect(g.netM3).toBeCloseTo(0.016, 9);
  });
  it('the shelves sit where the air above them runs out, counted from the top of the interior', () => {
    const mtm = build(speaker('mtm', (s) => (s.chambers = 'separate'))).cabinets[0]!;
    expect(mtm.shelves).toHaveLength(1);
    expect(mtm.shelves![0]!).toBeCloseTo(mtm.geometry.hI / 2, 12); // two equal chambers
    const three = build(speaker('three-way')).cabinets[0]!; // from the top: the midrange (2 L), then the woofer (25 L)
    expect(three.shelves![0]!).toBeCloseTo((three.geometry.hI * 2) / 27, 12);
    expect(build(speaker('two-way')).cabinets[0]!.shelves).toEqual([]);
  });
  it('an open-baffle tweeter adds no chamber, and the dome\'s own air does not make the cabinet bigger', () => {
    expect(partitions(speaker('two-way', (s) => (s.slots[1]!.open = true)))).toBe(0);
    const depth = (v: number): number => build(speaker('two-way', (s) => (s.slots[1]!.design.volumeL = v))).cabinets[0]!.geometry.dI;
    expect(depth(5)).toBe(depth(0.5));
  });
  it('a bigger chamber makes a deeper cabinet', () => {
    const depth = (vol: number): number => B.computeBuild(project(speaker('two-way', (s) => (s.slots[0]!.design.volumeL = vol)))).bands[0]!.cabinets[0]!.geometry.dI;
    expect(depth(20)).toBeGreaterThan(depth(8));
    expect(depth(8)).toBeGreaterThan(0.1);
  });
  it('the cabinet is never shallower than 100 mm, even with no air at all', () => {
    const s = speaker('two-way', (x) => {
      x.slots[0]!.open = true;
      x.slots[1]!.open = true;
    });
    expect(B.computeBuild(project(s)).bands[0]!.cabinets[0]!.geometry.dI).toBeCloseTo(0.1, 12);
  });
  it('braces are counted and their wood taken out of the air', () => {
    const deep = speaker('two-way', (s) => {
      s.slots[0]!.design.volumeL = 60;
      s.brace = 'window';
    });
    const g = B.computeBuild(project(deep)).bands[0]!.cabinets[0]!.geometry;
    expect(g.braces).toBe(Math.max(0, Math.ceil(g.dI / P.BRACE_SPACING - 1e-12) - 1));
    expect(g.braces).toBeGreaterThan(0);
  });
});

describe('the baffle', () => {
  it('stacks the drivers in the arrangement order from the top, centred across', () => {
    const v = B.computeBuild(project(speaker('two-way')));
    const holes = B.holePositions(v.bands[0]!.cabinets[0]!);
    expect(holes).toHaveLength(2);
    expect(holes[0]!.r).toBeLessThan(holes[1]!.r); // the tweeter above the woofer
    for (const h of holes) expect(h.cx).toBeCloseTo(0.1, 12);
    expect(holes[1]!.cy - holes[1]!.r - (holes[0]!.cy + holes[0]!.r)).toBeCloseTo(B.HOLE_GAP, 12);
  });
  it('an MTM has the tweeter between two equal woofers; a WTW the same; a TMM the tweeter on top', () => {
    const radii = (id: L.ArrangementId): number[] => B.holePositions(B.computeBuild(project(speaker(id))).bands[0]!.cabinets[0]!).map((h) => h.r);
    const m = radii('mtm');
    expect(m[0]).toBeCloseTo(m[2]!, 12);
    expect(m[1]).toBeLessThan(m[0]!);
    const t = radii('tmm');
    expect(t[0]).toBeLessThan(t[1]!);
    expect(t[1]).toBeCloseTo(t[2]!, 12);
  });
  it('a ported woofer puts its port under the drivers; a woofer pair gets two', () => {
    const one = B.computeBuild(project(speaker('two-way', (s) => (s.slots[0]!.design.type = 'ported'))));
    const holes = B.holePositions(one.bands[0]!.cabinets[0]!);
    expect(holes.map((h) => h.kind)).toEqual(['driver', 'driver', 'port']);
    expect(holes[2]!.cy).toBeGreaterThan(holes[1]!.cy);
    expect(one.bands[0]!.ports).toHaveLength(1);
    const two = B.computeBuild(project(speaker('wtw', (s) => (s.slots[0]!.design.type = 'ported'))));
    expect(two.bands[0]!.ports).toHaveLength(2);
    expect(B.holePositions(two.bands[0]!.cabinets[0]!).filter((h) => h.kind === 'port')).toHaveLength(2);
  });
  it('warns when a hole is wider than the baffle or the stack is taller than it', () => {
    const wide = B.computeBuild(project(speaker('two-way', (s) => {
      s.slots[0]!.design.driverClass = cls('10 in');
      s.baffleWidthCm = 15;
    })));
    expect(wide.warnings.some((w) => w.includes('wide baffle'))).toBe(true);
    const tall = B.computeBuild(project(speaker('three-way', (s) => (s.baffleHeightCm = 12))));
    expect(tall.warnings.some((w) => w.includes('high baffle'))).toBe(true);
    expect(B.computeBuild(project(speaker('two-way'))).warnings).toEqual([]);
  });
  it('warns about a port that does not fit and about slot types it cannot build', () => {
    const bad = B.computeBuild(project(speaker('two-way', (s) => {
      s.slots[0]!.design.type = 'ported';
      s.slots[0]!.design.tuneHz = 200;
      s.slots[0]!.design.volumeL = 60;
      s.slots[0]!.design.portDiameterCm = 40;
    })));
    expect(bad.warnings.some((w) => w.includes('port does not fit'))).toBe(true);
    expect(bad.bands[0]!.ports).toHaveLength(0);
    const bp = B.computeBuild(project(speaker('two-way', (s) => (s.slots[0]!.design.type = 'bandpass'))));
    expect(bp.warnings.some((w) => w.includes('built as a sealed chamber'))).toBe(true);
  });
});

describe('bill of materials', () => {
  it('counts every driver of every speaker, one terminal per speaker, port tubes per port', () => {
    const v = B.computeBuild(project(speaker('mtm', portedSmall), { shop: S.DEFAULT_PROJECT.shop }));
    const bom = new Map(v.bom.map((b) => [b.item, b.qty]));
    expect(bom.get('4 in mid driver')).toBe(4); // 2 per speaker, 2 speakers
    expect(bom.get('1 in dome driver')).toBe(2);
    expect(v.bom.find((b) => b.item.startsWith('Round port tube'))).toMatchObject({ qty: 4 });
    expect(v.bom.find((b) => b.item === 'Speaker terminal or connector')).toMatchObject({ qty: 2, note: 'one per speaker' });
    expect(v.notes[0]).toContain('crossover is not part of this list');
  });
  it('a PA system build is unchanged: its notes have no crossover line and its drivers are one per band', () => {
    const roots = S.applyTemplate(S.DEFAULT_PROJECT, 4);
    const v = B.computeBuild(roots);
    expect(v.notes.some((n) => n.includes('crossover is not part'))).toBe(false);
    expect(v.bands.every((b) => b.drivers.length === 1 && b.drivers[0]!.qty === 1)).toBe(true);
  });
});

describe('drawings, exports and 3D follow the cabinet', () => {
  const p = project(speaker('mtm', portedSmall));
  const v = B.computeBuild(p);
  it('the baffle SVG has a circle for every hole', () => {
    const svg = X.baffleSvg(v.bands[0]!.cabinets[0]!, 'Speaker: Cabinet');
    expect((svg.match(/<circle/g) ?? []).length).toBe(v.bands[0]!.cabinets[0]!.cutouts.length);
  });
  it('the 3D view has every hole and every port tube, and no divider from a stale band-pass band', () => {
    const bp = S.sanitizeProject({ ...p, bands: [{ design: { ...S.DEFAULT_PROJECT.bands[0]!.design, type: 'bandpass' } }] });
    const lay = layout3d(B.computeBuild(bp), bp);
    expect(lay.discs).toHaveLength(v.bands[0]!.cabinets[0]!.cutouts.length);
    expect(lay.tubes).toHaveLength(v.bands[0]!.ports.length);
    expect(lay.boxes.some((b) => b.kind === 'divider')).toBe(false);
    for (const b of lay.boxes) for (const n of [...b.size, ...b.center]) expect(Number.isFinite(n)).toBe(true);
  });
  it('the 3D view draws each chamber shelf flat, at the height the cut list gives it', () => {
    const sep = project(speaker('mtm', (s) => (s.chambers = 'separate')));
    const vv = B.computeBuild(sep);
    const cab = vv.bands[0]!.cabinets[0]!;
    const lay = layout3d(vv, sep);
    const shelf = lay.boxes.filter((b) => b.kind === 'divider');
    expect(shelf).toHaveLength(1);
    const g = cab.geometry;
    expect(shelf[0]!.size[0]).toBeCloseTo(g.wI, 12);
    expect(shelf[0]!.size[1]).toBeCloseTo(0.018, 12);
    expect(shelf[0]!.size[2]).toBeCloseTo(g.dI, 12);
    // its centre is below the top panel's underside by the shelf's distance
    const top = g.hO - 0.018;
    expect(shelf[0]!.center[1]).toBeCloseTo(top - cab.shelves![0]!, 12);
  });
  it('every sheet piece is placed and the sheets are counted', () => {
    expect(v.sheets).toBeGreaterThan(0);
    expect(v.pieces.every((x) => x.placement.sheet >= 0)).toBe(true);
    expect(X.sheetSvg(v, p, 0)).toContain('<svg');
  });
});
