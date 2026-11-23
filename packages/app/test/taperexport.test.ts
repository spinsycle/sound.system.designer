// 1.14: the drawings of tapered boxes: a tower's trapezoid baffle and the outline of every angled panel with its edge lengths and bevel.
import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import { computeBuild } from '../src/buildlist';
import { baffleSvg, panelSvg } from '../src/export';
import * as M from '../src/model';
import * as S from '../src/system';

const proj = (build: Record<string, unknown>): S.Project =>
  S.sanitizeProject({ ...S.DEFAULT_PROJECT, nBands: 1, bands: [{ design: M.sanitize({ ...M.DEFAULT_DESIGN, driverClass: 1, type: 'sealed', volumeL: 60 }), build }] });
const cab = (build: Record<string, unknown>) => computeBuild(proj(build)).bands[0]!.cabinets[0]!;
const mm = (m: number): number => Math.round(m * 10000) / 10;

describe('baffleSvg', () => {
  it('a tower baffle is a trapezoid, narrow at the top, with the same holes', () => {
    const c = cab({ shape: 'tower', taper: 0.6 });
    const g = c.taper!;
    const svg = baffleSvg(c, 'Tower');
    const m = /<polygon points="([^"]+)"/.exec(svg);
    expect(m).not.toBeNull();
    const pts = m![1]!.split(' ').map((q) => q.split(',').map(Number));
    expect(pts).toEqual([[mm((g.wideO - g.narrowO) / 2), 0], [mm((g.wideO + g.narrowO) / 2), 0], [mm(g.wideO), mm(g.hO)], [0, mm(g.hO)]]);
    expect(svg).not.toContain('<rect x="0" y="0"');
    expect(svg).toContain('<circle');
  });
  it('a trapezoid (plan) front and a plain box are rectangles', () => {
    for (const build of [{ shape: 'trapezoid', taper: 0.6 }, {}]) {
      const svg = baffleSvg(cab(build), 'Front');
      expect(svg).toContain('<rect x="0" y="0"');
      expect(svg).not.toContain('<polygon');
    }
  });
  it('the back of a tower (rear drawing) is not the trapezoid', () => {
    expect(baffleSvg(cab({ shape: 'tower' }), 'Back', 'mm', true)).not.toContain('<polygon');
  });
});

describe('panelSvg', () => {
  const panels = (build: Record<string, unknown>) => cab(build).panels;
  it('a rectangle has no drawing', () => {
    expect(panelSvg(panels({})[0]!, 'x')).toBeNull();
    expect(panelSvg(panels({ shape: 'trapezoid' })[0]!, 'x')).toBeNull();
  });
  it('a trapezoid panel is its outline, y up in the panel and down on the page', () => {
    const g = cab({ shape: 'tower', taper: 0.6 }).taper!;
    const pn = panels({ shape: 'tower', taper: 0.6 })[0]!;
    const svg = panelSvg(pn, 'Front')!;
    expect(svg).toContain('<title>Front</title>');
    const pts = /<polygon points="([^"]+)"/.exec(svg)![1]!.split(' ').map((q) => q.split(',').map(Number));
    expect(pts).toHaveLength(4);
    // the bottom edge is the wide one, at the bottom of the page (y = height)
    expect(pts[0]).toEqual([0, mm(g.hO)]);
    expect(pts[1]).toEqual([mm(g.wideO), mm(g.hO)]);
    expect(pts[2]![1]).toBe(0);
    expect(pts[2]![0] - pts[3]![0]).toBe(mm(g.narrowO));
  });
  it('every edge is labelled with its length, in the unit asked for', () => {
    const pn = panels({ shape: 'trapezoid', taper: 0.6 })[2]!; // top and bottom
    const mmSvg = panelSvg(pn, 'Top', 'mm')!;
    expect(mmSvg.match(/<text /g)).toHaveLength(4);
    expect(mmSvg).toMatch(/\d+ mm<\/text>/);
    const inSvg = panelSvg(pn, 'Top', 'in')!;
    expect(inSvg).toMatch(/in<\/text>/);
    expect(inSvg).toContain('in"'); // width and height attributes in inches
    expect(mmSvg).toContain('mm"');
    // the slanted edges are longer than the depth between the parallel ones
    const lens = [...mmSvg.matchAll(/>(\d+(?:\.\d+)?) mm<\/text>/g)].map((m) => Number(m[1]));
    expect(lens).toHaveLength(4);
    expect(Math.max(...lens)).toBeCloseTo(Math.round(pn.l * 1000), 0);
    // the slanted edges are as long as the side walls they join
    const g = cab({ shape: 'trapezoid', taper: 0.6 }).taper!;
    expect(lens.filter((x) => Math.abs(x - g.slantI * 1000) < 1)).toHaveLength(2);
    expect(lens.filter((x) => Math.abs(x - g.narrowO * 1000) < 1)).toHaveLength(1);
  });
  it('a panel with a bevel names it', () => {
    const pn: P.Panel = { name: 'x', l: 0.5, w: 0.3, qty: 1, poly: [[0, 0], [0.5, 0], [0.4, 0.3], [0.1, 0.3]], bevelDeg: 7.123, bevelEdges: 'the two long edges' };
    expect(panelSvg(pn, 'x')).toContain('bevel 7.1 degrees on the two long edges');
    expect(panelSvg({ ...pn, bevelDeg: undefined }, 'x')).not.toContain('bevel');
    expect(panelSvg({ ...pn, bevelEdges: undefined }, 'x')).toContain('on its ends');
  });
  it('escapes the title', () => {
    const pn: P.Panel = { name: 'x', l: 0.5, w: 0.3, qty: 1, poly: [[0, 0], [0.5, 0], [0.4, 0.3], [0.1, 0.3]] };
    expect(panelSvg(pn, 'a<b&c')).toContain('<title>a&lt;b&amp;c</title>');
  });
});
