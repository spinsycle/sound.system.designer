// A5 pass condition: the exported SVG and DXF files hold every piece at its cut-list size and sheet position, in millimetres.
import { describe, expect, it } from 'vitest';
import * as L from '../src/buildlist';
import * as X from '../src/export';
import * as M from '../src/model';
import * as S from '../src/system';
import * as U from '../src/units';

const roots = S.applyTemplate(S.DEFAULT_PROJECT, S.TEMPLATES.findIndex((t) => t.label.includes('roots dub')));
const sealed: S.Project = S.sanitizeProject({ ...S.DEFAULT_PROJECT, bands: [{ design: { ...M.DEFAULT_DESIGN, type: 'sealed', volumeL: 100, driverClass: 2 } }] });

/** Group-code pairs of a DXF file. */
const pairs = (dxf: string): [number, string][] => {
  const l = dxf.split('\n');
  const out: [number, string][] = [];
  for (let i = 0; i + 1 < l.length; i += 2) out.push([Number(l[i]), l[i + 1]!]);
  return out;
};
/** Entities as {type, codes}. */
const entities = (dxf: string): { type: string; layer: string; v: Record<number, string> }[] => {
  const p = pairs(dxf);
  const start = p.findIndex((x, i) => x[0] === 2 && x[1] === 'ENTITIES' && p[i - 1]![1] === 'SECTION');
  const out: { type: string; layer: string; v: Record<number, string> }[] = [];
  let cur: { type: string; layer: string; v: Record<number, string> } | null = null;
  for (const [code, val] of p.slice(start + 1)) {
    if (code === 0) {
      if (val === 'ENDSEC') break;
      cur = { type: val, layer: '', v: {} };
      out.push(cur);
    } else if (cur) {
      if (code === 8) cur.layer = val;
      else cur.v[code] = val;
    }
  }
  return out;
};

describe('sheet SVG', () => {
  const v = L.computeBuild(roots);
  const svg = X.sheetSvg(v, roots, 0);
  const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map((m) => m.slice(1).map(Number));

  it('is in millimetres at the sheet size', () => {
    expect(svg).toContain('width="2440mm" height="1220mm" viewBox="0 0 2440 1220"');
    expect(rects[0]).toEqual([0, 0, 2440, 1220]);
  });

  it('holds every piece of that sheet at its size and position', () => {
    const here = v.pieces.filter((x) => x.placement.sheet === 0);
    expect(rects.length - 1).toBe(here.length);
    here.forEach((x, i) => {
      const r = rects[i + 1]!;
      expect(r[0]).toBeCloseTo(x.placement.x * 1000, 0);
      expect(r[1]).toBeCloseTo(x.placement.y * 1000, 0);
      expect(r[2]).toBeCloseTo(x.placement.w * 1000, 0);
      expect(r[3]).toBeCloseTo(x.placement.h * 1000, 0);
    });
    expect(svg).toContain(`${Math.round(here[0]!.placement.w * 1000)} x ${Math.round(here[0]!.placement.h * 1000)}`);
  });

  it('escapes text', () => {
    const named = { ...roots, bands: roots.bands.map((b, k) => (k === 0 ? b : b)) };
    const v2 = L.computeBuild(named);
    v2.pieces[0]!.label = 'A <b> & "c"';
    const out = X.sheetSvg(v2, named, v2.pieces[0]!.placement.sheet);
    expect(out).toContain('A &lt;b&gt; &amp; &quot;c&quot;');
    expect(out).not.toContain('<b>');
  });
});

describe('baffle SVG', () => {
  it('has the baffle and one circle per hole, in millimetres', () => {
    const b = L.computeBuild(sealed).bands[0]!.cabinets[0]!;
    const svg = X.baffleSvg(b, 'Box');
    expect(svg).toContain(`width="${(Math.round(b.geometry.wO * 10000) / 10).toString()}mm"`);
    expect([...svg.matchAll(/<circle /g)].length).toBe(b.cutouts.length);
    const r = Number(/<circle [^>]*r="([\d.]+)"/.exec(svg)![1]);
    expect(r).toBeCloseTo((b.cutouts[0]!.diameterM / 2) * 1000, 0);
    const ported = L.computeBuild(S.sanitizeProject({ ...S.DEFAULT_PROJECT, bands: [{ design: { ...M.DEFAULT_DESIGN, type: 'ported', volumeL: 100, driverClass: 2 } }] }));
    expect([...X.baffleSvg(ported.bands[0]!.cabinets[0]!, 'Box').matchAll(/<circle /g)].length).toBe(2);
  });
});

describe('sheet DXF', () => {
  const v = L.computeBuild(roots);
  const dxf = X.sheetDxf(v, roots, 0);
  const ents = entities(dxf);
  const lines = ents.filter((e) => e.type === 'LINE');
  const here = v.pieces.filter((x) => x.placement.sheet === 0);

  it('is R12 ASCII in millimetres with the three layers and an EOF', () => {
    const p = pairs(dxf);
    expect(p.some(([c, val]) => c === 1 && val === 'AC1009')).toBe(true);
    expect(p.findIndex(([c, val]) => c === 9 && val === '$INSUNITS')).toBeGreaterThan(0);
    expect(p[p.findIndex(([c, val]) => c === 9 && val === '$INSUNITS') + 1]).toEqual([70, '4']);
    for (const n of ['SHEET', 'CUT', 'LABELS']) expect(p.some(([c, val]) => c === 2 && val === n)).toBe(true);
    expect(p[p.length - 1]).toEqual([0, 'EOF']);
  });

  it('draws the sheet outline and four lines per piece, plus one label per piece', () => {
    expect(lines.filter((e) => e.layer === 'SHEET').length).toBe(4);
    expect(lines.filter((e) => e.layer === 'CUT').length).toBe(4 * here.length);
    expect(ents.filter((e) => e.type === 'TEXT').length).toBe(here.length);
  });

  it('the CUT lines bound each piece at its size, with y up', () => {
    const cut = lines.filter((e) => e.layer === 'CUT');
    here.forEach((x, i) => {
      const four = cut.slice(4 * i, 4 * i + 4);
      const xs = four.flatMap((e) => [Number(e.v[10]), Number(e.v[11])]);
      const ys = four.flatMap((e) => [Number(e.v[20]), Number(e.v[21])]);
      expect(Math.min(...xs)).toBeCloseTo(x.placement.x * 1000, 0);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(x.placement.w * 1000, 0);
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(x.placement.h * 1000, 0);
      // the piece that sat at the top of the sheet is at the top (large y) in the DXF
      expect(Math.min(...ys)).toBeCloseTo(1220 - x.placement.y * 1000 - x.placement.h * 1000, 0);
    });
  });

  it('each piece is a closed loop of four lines', () => {
    const cut = lines.filter((e) => e.layer === 'CUT');
    for (let i = 0; i < cut.length; i += 4) {
      for (let k = 0; k < 4; k++) {
        const a = cut[i + k]!;
        const b = cut[i + ((k + 1) % 4)]!;
        expect([a.v[11], a.v[21]]).toEqual([b.v[10], b.v[20]]);
      }
    }
  });

  it('a label with a line break stays one text value', () => {
    const w = L.computeBuild(roots);
    w.pieces.find((x) => x.placement.sheet === 0)!.label = 'A' + String.fromCharCode(10) + 'B';
    const t = entities(X.sheetDxf(w, roots, 0)).find((e) => e.type === 'TEXT')!;
    expect(t.v[1]).toMatch(/^A B /);
  });

  it('every point lies inside the sheet', () => {
    for (const e of lines) for (const k of [10, 11]) expect(Number(e.v[k])).toBeGreaterThanOrEqual(-0.05);
    for (const e of lines) {
      expect(Number(e.v[10])).toBeLessThanOrEqual(2440.05);
      expect(Number(e.v[20])).toBeLessThanOrEqual(1220.05);
    }
  });

  it('labels carry the size and no line breaks', () => {
    const t = ents.find((e) => e.type === 'TEXT')!;
    expect(t.v[1]).toMatch(/ \d+ x \d+$/);
    expect(t.v[40]).toBe('20');
  });
});

describe('names', () => {
  it('a project name becomes a safe file name', () => {
    expect(X.slug('My Rig #2 / v1')).toBe('my-rig-2-v1');
    expect(X.slug('   ')).toBe('project');
    expect(X.slug('--abc!! ')).toBe('abc');
    expect(S.sanitizeProject({ name: 'x'.repeat(100) }).name.length).toBe(60);
    expect(S.sanitizeProject({ name: 5 }).name).toBe('sound-system');
  });
});

describe('inch exports', () => {
  const inch: S.Project = { ...roots, units: 'in', shop: { thicknessMm: 19.05, sheetLmm: 2438.4, sheetWmm: 1219.2, kerfMm: 3.175 } };
  const v = L.computeBuild(inch);
  const here = v.pieces.filter((x) => x.placement.sheet === 0);

  it('the sheet SVG is drawn in millimetres and sized in inches, with fractions in the labels', () => {
    const svg = X.sheetSvg(v, inch, 0);
    expect(svg).toContain('width="96in" height="48in" viewBox="0 0 2438.4 1219.2"');
    expect(svg).not.toContain('mm"');
    const p = here[0]!.placement;
    expect(svg).toContain(`${U.formatLength(p.w * 1000, 'in')} x ${U.formatLength(p.h * 1000, 'in')}`);
  });

  it('the baffle SVG is sized in inches', () => {
    const c = v.bands[0]!.cabinets[0]!;
    const svg = X.baffleSvg(c, 'Sub', 'in');
    expect(svg).toContain(`width="${Math.round(((Math.round(c.geometry.wO * 1e4) / 10) / 25.4) * 1e4) / 1e4}in"`);
    expect(X.baffleSvg(c, 'Sub')).toContain('mm"');
  });

  it('the DXF says inches and its coordinates are inches', () => {
    const dxf = X.sheetDxf(v, inch, 0);
    const p = pairs(dxf);
    const i = p.findIndex(([c, val]) => c === 9 && val === '$INSUNITS');
    expect(p[i + 1]).toEqual([70, '1']);
    const ents = entities(dxf);
    const sheet = ents.filter((e) => e.type === 'LINE' && e.layer === 'SHEET');
    const xs = sheet.flatMap((e) => [Number(e.v[10]), Number(e.v[11])]);
    const ys = sheet.flatMap((e) => [Number(e.v[20]), Number(e.v[21])]);
    expect(Math.max(...xs)).toBeCloseTo(96, 3);
    expect(Math.max(...ys)).toBeCloseTo(48, 3);
    const cut = ents.filter((e) => e.type === 'LINE' && e.layer === 'CUT');
    here.forEach((x, k) => {
      const four = cut.slice(4 * k, 4 * k + 4);
      const cx = four.flatMap((e) => [Number(e.v[10]), Number(e.v[11])]);
      expect(Math.max(...cx) - Math.min(...cx)).toBeCloseTo((x.placement.w * 1000) / 25.4, 3);
      const cy = four.flatMap((e) => [Number(e.v[20]), Number(e.v[21])]);
      expect(Math.min(...cy)).toBeCloseTo(48 - (x.placement.y * 1000 + x.placement.h * 1000) / 25.4, 3);
    });
    const t = ents.find((e) => e.type === 'TEXT')!;
    expect(t.v[40]).toBe('0.75');
    const ti = ents.findIndex((e) => e.type === 'TEXT');
    const firstCut = cut.slice(0, 4);
    expect(Number(t.v[10]) - Math.min(...firstCut.flatMap((e) => [Number(e.v[10]), Number(e.v[11])]))).toBeCloseTo(0.375, 4);
    expect(ti).toBeGreaterThan(0);
    expect(t.v[1]).toMatch(/ [\d/ ]+ x [\d/ ]+$/);
    expect(dxf).not.toContain('AC1015');
  });

  it('in millimetres the DXF still says millimetres', () => {
    const p = pairs(X.sheetDxf(L.computeBuild(roots), roots, 0));
    const i = p.findIndex(([c, val]) => c === 9 && val === '$INSUNITS');
    expect(p[i + 1]).toEqual([70, '4']);
  });
});
