// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// File exports as plain strings: SVG of a sheet layout or a baffle, ASCII DXF (R12) of a sheet layout. Millimetres or inches, as the project's units say.
// No dependencies; the page turns the strings into downloads.
import { type BuildView, type Cabinet, holePositions } from './buildlist';
import { type FrontRing, RING_SCREW_CM, ringScrews } from './carfront';
import type { Project } from './system';
import { MM_PER_IN, type Units, formatLength } from './units';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Metres to millimetres at 0.1 mm. */
const mm = (m: number): number => Math.round(m * 10000) / 10;
/** Metres to the file's unit: millimetres at 0.1, or inches at 0.0001. */
const out = (m: number, u: Units): number => (u === 'in' ? Math.round(((m * 1000) / MM_PER_IN) * 1e4) / 1e4 : mm(m));
/** A size in millimetres as the width or height attribute: the drawing is in millimetres, its real size is in the unit. */
const physical = (sizeMm: number, u: Units): string => (u === 'in' ? `${Math.round((sizeMm / MM_PER_IN) * 1e4) / 1e4}in` : `${sizeMm}mm`);

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
      const label = `${esc(x.label)} ${formatLength(w * 1000, p.units)} x ${formatLength(h * 1000, p.units)}`;
      return `<rect x="${mm(px)}" y="${mm(py)}" width="${mm(w)}" height="${mm(h)}" ${STYLE}/><text x="${mm(px) + 10}" y="${mm(py) + 30}" font-size="24" font-family="sans-serif">${label}</text>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${physical(L, p.units)}" height="${physical(W, p.units)}" viewBox="0 0 ${L} ${W}">\n<rect x="0" y="0" width="${L}" height="${W}" ${STYLE} stroke-dasharray="20 10"/>\n${body}\n</svg>\n`;
}

/** A front baffle to scale with its driver and port holes. */
export function baffleSvg(c: Cabinet, title: string, u: Units = 'mm'): string {
  const g = c.geometry;
  const holes = holePositions(c)
    .map((h) => `<circle cx="${mm(h.cx)}" cy="${mm(h.cy)}" r="${mm(h.r)}" ${STYLE}/>`)
    .join('\n');
  const W = mm(g.wO);
  const H = mm(g.hO);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${physical(W, u)}" height="${physical(H, u)}" viewBox="0 0 ${W} ${H}">\n<title>${esc(title)}</title>\n<rect x="0" y="0" width="${W}" height="${H}" ${STYLE}/>\n${holes}\n</svg>\n`;
}

/** An adapter ring to scale, millimetres: the outside, the cut-out for the driver and four screw holes. Round, or oval for a 6x9. */
export function ringSvg(r: FrontRing, u: Units = 'mm'): string {
  const W = mm(r.outer.wCm / 100);
  const H = mm(r.outer.hCm / 100);
  const cx = W / 2;
  const cy = H / 2;
  const shape = (kind: 'round' | 'oval', w: number, h: number): string => (kind === 'round' ? `<circle cx="${cx}" cy="${cy}" r="${w / 2}" ${STYLE}/>` : `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" ${STYLE}/>`);
  const screws = ringScrews(r)
    .map((s) => `<circle cx="${(cx + mm(s.x / 100)).toFixed(1)}" cy="${(cy + mm(s.y / 100)).toFixed(1)}" r="${mm(RING_SCREW_CM / 200).toFixed(2)}" ${STYLE}/>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${physical(W, u)}" height="${physical(H, u)}" viewBox="0 0 ${W} ${H}">\n<title>${esc(r.title)}</title>\n${shape(r.outer.kind, W, H)}\n${shape(r.inner.kind, mm(r.inner.wCm / 100), mm(r.inner.hCm / 100))}\n${screws}\n</svg>\n`;
}

const pair = (code: number, value: string | number): string => `${code}\n${value}\n`;
const line = (layer: string, x1: number, y1: number, x2: number, y2: number): string => pair(0, 'LINE') + pair(8, layer) + pair(10, x1) + pair(20, y1) + pair(30, 0) + pair(11, x2) + pair(21, y2) + pair(31, 0);
const rect = (layer: string, x: number, y: number, w: number, h: number): string => line(layer, x, y, x + w, y) + line(layer, x + w, y, x + w, y + h) + line(layer, x + w, y + h, x, y + h) + line(layer, x, y + h, x, y);

/**
 * One sheet as ASCII DXF R12, in the project's unit (millimetres, or inches with $INSUNITS 1), y up: the sheet outline on layer SHEET, each piece as four LINE entities on
 * layer CUT, its label as TEXT on layer LABELS.
 */
export function sheetDxf(v: BuildView, p: Project, sheet: number): string {
  const u = p.units;
  const L = u === 'in' ? Math.round((p.shop.sheetLmm / MM_PER_IN) * 1e4) / 1e4 : p.shop.sheetLmm;
  const W = u === 'in' ? Math.round((p.shop.sheetWmm / MM_PER_IN) * 1e4) / 1e4 : p.shop.sheetWmm;
  const textHeight = u === 'in' ? 0.75 : 20;
  const inset = u === 'in' ? 0.375 : 10;
  const layers = ['SHEET', 'CUT', 'LABELS'].map((n) => pair(0, 'LAYER') + pair(2, n) + pair(70, 0) + pair(62, 7) + pair(6, 'CONTINUOUS')).join('');
  const entities = [rect('SHEET', 0, 0, L, W)];
  for (const x of v.pieces.filter((q) => q.placement.sheet === sheet)) {
    const { x: px, y: py, w, h } = x.placement;
    // sheet coordinates run down the page; DXF runs up
    const x0 = out(px, u);
    const y0 = Math.round((W - out(py, u) - out(h, u)) * 1e4) / 1e4;
    entities.push(rect('CUT', x0, y0, out(w, u), out(h, u)));
    entities.push(pair(0, 'TEXT') + pair(8, 'LABELS') + pair(10, x0 + inset) + pair(20, y0 + inset) + pair(30, 0) + pair(40, textHeight) + pair(1, `${x.label} ${formatLength(w * 1000, u)} x ${formatLength(h * 1000, u)}`.replace(/[\r\n]/g, ' ')));
  }
  return (
    pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$ACADVER') + pair(1, 'AC1009') + pair(9, '$INSUNITS') + pair(70, u === 'in' ? 1 : 4) + pair(0, 'ENDSEC') +
    pair(0, 'SECTION') + pair(2, 'TABLES') + pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, 3) + layers + pair(0, 'ENDTAB') + pair(0, 'ENDSEC') +
    pair(0, 'SECTION') + pair(2, 'ENTITIES') + entities.join('') + pair(0, 'ENDSEC') + pair(0, 'EOF')
  );
}
