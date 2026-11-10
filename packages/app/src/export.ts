// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// File exports as plain strings: SVG of a sheet layout or a baffle, ASCII DXF (R12) of a sheet layout. Millimetres.
// No dependencies; the page turns the strings into downloads.
import { type BuildView, type Cabinet, holePositions } from './buildlist';
import type { Project } from './system';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Metres to millimetres at 0.1 mm. */
const mm = (m: number): number => Math.round(m * 10000) / 10;

/** A file-name-safe version of a project name. */
export const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';

const STYLE = 'fill="none" stroke="#000" stroke-width="2"';

/** One sheet of the layout, to scale: the sheet outline, every piece with its label and size. */
export function sheetSvg(v: BuildView, p: Project, sheet: number): string {
  const L = p.shop.sheetLmm;
  const W = p.shop.sheetWmm;
  const here = v.pieces.filter((x) => x.placement.sheet === sheet);
  const body = here
    .map((x) => {
      const { x: px, y: py, w, h } = x.placement;
      const label = `${esc(x.label)} ${Math.round(w * 1000)} x ${Math.round(h * 1000)}`;
      return `<rect x="${mm(px)}" y="${mm(py)}" width="${mm(w)}" height="${mm(h)}" ${STYLE}/><text x="${mm(px) + 10}" y="${mm(py) + 30}" font-size="24" font-family="sans-serif">${label}</text>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${L}mm" height="${W}mm" viewBox="0 0 ${L} ${W}">\n<rect x="0" y="0" width="${L}" height="${W}" ${STYLE} stroke-dasharray="20 10"/>\n${body}\n</svg>\n`;
}

/** A front baffle to scale with its driver and port holes. */
export function baffleSvg(c: Cabinet, title: string): string {
  const g = c.geometry;
  const holes = holePositions(c)
    .map((h) => `<circle cx="${mm(h.cx)}" cy="${mm(h.cy)}" r="${mm(h.r)}" ${STYLE}/>`)
    .join('\n');
  const W = mm(g.wO);
  const H = mm(g.hO);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">\n<title>${esc(title)}</title>\n<rect x="0" y="0" width="${W}" height="${H}" ${STYLE}/>\n${holes}\n</svg>\n`;
}

const pair = (code: number, value: string | number): string => `${code}\n${value}\n`;
const line = (layer: string, x1: number, y1: number, x2: number, y2: number): string => pair(0, 'LINE') + pair(8, layer) + pair(10, x1) + pair(20, y1) + pair(30, 0) + pair(11, x2) + pair(21, y2) + pair(31, 0);
const rect = (layer: string, x: number, y: number, w: number, h: number): string => line(layer, x, y, x + w, y) + line(layer, x + w, y, x + w, y + h) + line(layer, x + w, y + h, x, y + h) + line(layer, x, y + h, x, y);

/**
 * One sheet as ASCII DXF R12, millimetres, y up: the sheet outline on layer SHEET, each piece as four LINE entities on
 * layer CUT, its label as TEXT on layer LABELS.
 */
export function sheetDxf(v: BuildView, p: Project, sheet: number): string {
  const L = p.shop.sheetLmm;
  const W = p.shop.sheetWmm;
  const layers = ['SHEET', 'CUT', 'LABELS'].map((n) => pair(0, 'LAYER') + pair(2, n) + pair(70, 0) + pair(62, 7) + pair(6, 'CONTINUOUS')).join('');
  const entities = [rect('SHEET', 0, 0, L, W)];
  for (const x of v.pieces.filter((q) => q.placement.sheet === sheet)) {
    const { x: px, y: py, w, h } = x.placement;
    // sheet coordinates run down the page; DXF runs up
    const x0 = mm(px);
    const y0 = W - mm(py) - mm(h);
    entities.push(rect('CUT', x0, y0, mm(w), mm(h)));
    entities.push(pair(0, 'TEXT') + pair(8, 'LABELS') + pair(10, x0 + 10) + pair(20, y0 + 10) + pair(30, 0) + pair(40, 20) + pair(1, `${x.label} ${Math.round(w * 1000)} x ${Math.round(h * 1000)}`.replace(/[\r\n]/g, ' ')));
  }
  return (
    pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$ACADVER') + pair(1, 'AC1009') + pair(9, '$INSUNITS') + pair(70, 4) + pair(0, 'ENDSEC') +
    pair(0, 'SECTION') + pair(2, 'TABLES') + pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, 3) + layers + pair(0, 'ENDTAB') + pair(0, 'ENDSEC') +
    pair(0, 'SECTION') + pair(2, 'ENTITIES') + entities.join('') + pair(0, 'ENDSEC') + pair(0, 'EOF')
  );
}
