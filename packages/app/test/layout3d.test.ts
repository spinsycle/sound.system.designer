// The 3D preview's geometry against the cut list: the panel boxes hold the same wood, the holes sit on the baffle,
// and the horn's prisms follow its sections.
import { describe, expect, it } from 'vitest';
import * as L from '../src/buildlist';
import * as D from '../src/layout3d';
import * as M from '../src/model';
import * as S from '../src/system';

const one = (design: Partial<M.Design>, build: Partial<S.Band['build']> = {}): S.Project =>
  S.sanitizeProject({ ...S.DEFAULT_PROJECT, bands: [{ design: { ...M.DEFAULT_DESIGN, driverClass: 2, ...design }, build }] });
const vol = (b: D.Box3): number => b.size[0] * b.size[1] * b.size[2];

describe('cabinet boxes', () => {
  const p = one({ type: 'sealed', volumeL: 100 });
  const v = L.computeBuild(p);
  const lay = D.layout3d(v, p);

  it('the six panels hold the wood of the cut list, and fill the outside box', () => {
    const wood = lay.boxes.filter((b) => b.kind === 'panel').reduce((a, b) => a + vol(b), 0);
    const cutMm2 = v.cutList.filter((r) => ['Front baffle', 'Back', 'Top and bottom', 'Sides'].includes(r.part)).reduce((a, r) => a + r.l * r.w * r.qty, 0);
    expect(wood).toBeCloseTo(cutMm2 * 1e-6 * 0.018, 4); // the cut list is rounded to the millimetre
    const g = v.bands[0]!.cabinets[0]!.geometry;
    expect(wood).toBeCloseTo(g.wO * g.hO * g.dO - g.wI * g.hI * g.dI, 9);
  });

  it('the panels together span exactly the outside of the cabinet', () => {
    const g = v.bands[0]!.cabinets[0]!.geometry;
    const lo = [0, 1, 2].map((k) => Math.min(...lay.boxes.map((b) => b.center[k]! - b.size[k]! / 2)));
    const hi = [0, 1, 2].map((k) => Math.max(...lay.boxes.map((b) => b.center[k]! + b.size[k]! / 2)));
    expect(lo[0]!).toBeCloseTo(0, 12);
    expect(hi[0]!).toBeCloseTo(g.wO, 12);
    expect(lo[1]!).toBeCloseTo(0, 12);
    expect(hi[1]!).toBeCloseTo(g.hO, 12);
    expect(lo[2]!).toBeCloseTo(-g.dO, 12);
    expect(hi[2]!).toBeCloseTo(0, 12);
  });

  it('panels do not overlap each other (they only touch)', () => {
    const ps = lay.boxes.filter((b) => b.kind === 'panel');
    for (const a of ps)
      for (const b of ps)
        if (a !== b) {
          const overlap = [0, 1, 2].every((k) => Math.abs(a.center[k]! - b.center[k]!) < (a.size[k]! + b.size[k]!) / 2 - 1e-9);
          expect(overlap).toBe(false);
        }
  });

  it('the bottom sits on y = 0 and the baffle faces +z at z = 0', () => {
    const ys = lay.boxes.map((b) => b.center[1] - b.size[1] / 2);
    expect(Math.min(...ys)).toBeCloseTo(0, 12);
    const front = lay.boxes[0]!;
    expect(front.center[2] + front.size[2] / 2).toBeCloseTo(0, 12);
    expect(lay.extent[1]).toBeCloseTo(v.bands[0]!.cabinets[0]!.geometry.hO, 12);
    expect(lay.extent[2]).toBeCloseTo(v.bands[0]!.cabinets[0]!.geometry.dO, 12);
  });

  it('a driver hole sits on the baffle, in front of it, as large as its cutout', () => {
    expect(lay.discs.length).toBe(1);
    const d = lay.discs[0]!;
    expect(d.radius).toBeCloseTo(v.bands[0]!.cabinets[0]!.cutouts[0]!.diameterM / 2, 12);
    expect(d.center[2]).toBeGreaterThan(0);
    expect(d.center[2]).toBeLessThan(0.01);
    expect(d.center[0]).toBeCloseTo(v.bands[0]!.cabinets[0]!.geometry.wO / 2, 12);
  });
});

describe('braces, dividers and ports', () => {
  it('braces appear inside the box, evenly spaced in depth', () => {
    const p = one({ type: 'sealed', volumeL: 100 }, { rw: 1, rh: 1.5, rd: 3, brace: 'window' });
    const v = L.computeBuild(p);
    const lay = D.layout3d(v, p);
    const braces = lay.boxes.filter((b) => b.kind === 'brace');
    expect(braces.length).toBe(2);
    const g = v.bands[0]!.cabinets[0]!.geometry;
    const zs = braces.map((b) => b.center[2]).sort((a, b) => a - b);
    expect(zs[1]! - zs[0]!).toBeCloseTo(g.dI / 3, 9);
    expect(zs[0]!).toBeGreaterThan(-g.dO);
  });

  it('a band-pass box has a divider at its rear chamber share of the depth', () => {
    const p = one({ type: 'bandpass', volumeL: 60, frontVolumeL: 40, tuneHz: 60, portDiameterCm: 8 });
    const v = L.computeBuild(p);
    const lay = D.layout3d(v, p);
    const div = lay.boxes.filter((b) => b.kind === 'divider');
    expect(div.length).toBe(1);
    const g = v.bands[0]!.cabinets[0]!.geometry;
    const back = lay.boxes[1]!; // the back panel
    expect(div[0]!.center[2] - (back.center[2] + back.size[2] / 2)).toBeCloseTo(0.6 * g.dI, 9);
  });

  it('a port longer than the box is drawn only as long as the box is deep', () => {
    const p = one({ type: 'ported', volumeL: 20, tuneHz: 20, portDiameterCm: 4 });
    const v = L.computeBuild(p);
    const g = v.bands[0]!.cabinets[0]!.geometry;
    expect(v.bands[0]!.port!.lengthM).toBeGreaterThan(g.dI);
    expect(D.layout3d(v, p).tubes[0]!.length).toBeCloseTo(g.dI, 12);
  });

  it('a ported box gets a tube of the port radius, behind the port hole', () => {
    const p = one({ type: 'ported', volumeL: 100, tuneHz: 40, portDiameterCm: 10 });
    const v = L.computeBuild(p);
    const lay = D.layout3d(v, p);
    expect(lay.tubes.length).toBe(1);
    expect(lay.tubes[0]!.radius).toBeCloseTo(0.05, 12);
    expect(lay.tubes[0]!.length).toBeLessThanOrEqual(v.bands[0]!.cabinets[0]!.geometry.dI + 1e-12);
    const port = lay.discs.find((d) => d.kind === 'port')!;
    expect(lay.tubes[0]!.center[0]).toBeCloseTo(port.center[0], 12);
    expect(lay.tubes[0]!.center[1]).toBeCloseTo(port.center[1], 12);
  });
});

describe('systems and horns', () => {
  const roots = S.applyTemplate(S.DEFAULT_PROJECT, S.TEMPLATES.findIndex((t) => t.label.includes('roots dub')));
  const v = L.computeBuild(roots);
  const lay = D.layout3d(v, roots);

  it('bands stand side by side with a gap, none overlapping in x', () => {
    const spans = v.bands.map((_, k) => {
      const bs = lay.boxes.filter((b) => b.band === k);
      return [Math.min(...bs.map((b) => b.center[0] - b.size[0] / 2)), Math.max(...bs.map((b) => b.center[0] + b.size[0] / 2))] as const;
    });
    for (let k = 1; k < spans.length; k++) expect(spans[k]![0]).toBeGreaterThanOrEqual(spans[k - 1]![1] + D.GAP - 1e-9);
  });

  it('two plain boxes stand exactly one gap apart', () => {
    const d = { ...M.DEFAULT_DESIGN, type: 'sealed' as const, volumeL: 50, driverClass: 2 };
    const p = S.sanitizeProject({ ...S.DEFAULT_PROJECT, nBands: 2, bands: [{ design: d }, { design: d }] });
    const l = D.layout3d(L.computeBuild(p), p);
    const right = (k: number): number => Math.max(...l.boxes.filter((b) => b.band === k).map((b) => b.center[0] + b.size[0] / 2));
    const left = (k: number): number => Math.min(...l.boxes.filter((b) => b.band === k).map((b) => b.center[0] - b.size[0] / 2));
    expect(left(1) - right(0)).toBeCloseTo(D.GAP, 12);
    expect(l.extent[0]).toBeCloseTo(right(1), 12);
  });

  it('a horn has one prism per section, joined end to end, with the section heights', () => {
    const hb = v.bands.findIndex((b) => b.horn);
    const prisms = lay.prisms.filter((q) => q.band === hb);
    const secs = v.bands[hb]!.horn!.sections;
    expect(prisms.length).toBe(secs.length);
    prisms.forEach((q, i) => {
      expect(q.points[3]![1]).toBeCloseTo(secs[i]!.h1, 12);
      expect(q.points[7]![1]).toBeCloseTo(secs[i]!.h2, 12);
      expect(q.points[4]![2] - q.points[0]![2]).toBeCloseTo(secs[i]!.sideLen, 12);
      if (i > 0) expect(q.points[0]![2]).toBeCloseTo(prisms[i - 1]!.points[4]![2], 12);
    });
    const w = roots.bands[hb]!.design.horn.widthCm / 100;
    expect(prisms[0]!.points[1]![0] - prisms[0]!.points[0]![0]).toBeCloseTo(w, 12);
    expect(lay.extent[1]).toBeGreaterThanOrEqual(Math.max(...secs.flatMap((s) => [s.h1, s.h2])));
  });

  it('every coordinate is finite, for every starting point', () => {
    S.TEMPLATES.forEach((_, i) => {
      const proj = S.applyTemplate(S.DEFAULT_PROJECT, i);
      const l = D.layout3d(L.computeBuild(proj), proj);
      const nums = [...l.boxes.flatMap((b) => [...b.size, ...b.center]), ...l.discs.flatMap((d) => [...d.center, d.radius]), ...l.prisms.flatMap((q) => q.points.flat()), ...l.extent];
      expect(nums.every(Number.isFinite)).toBe(true);
      expect(l.extent.every((e) => e > 0)).toBe(true);
    });
  });
});
