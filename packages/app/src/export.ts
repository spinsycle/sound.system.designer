// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// File exports as plain strings: SVG of a sheet layout or a baffle, ASCII DXF (R12) of a sheet layout. Millimetres or inches, as the project's units say.
// No dependencies; the page turns the strings into downloads.
import type * as P from '@soundsystemdesigner/physics';
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
      const shape = x.placement.poly ? `<polygon points="${x.placement.poly.map(([a, b]) => `${mm(a)},${mm(b)}`).join(' ')}" ${STYLE}/>` : `<rect x="${mm(px)}" y="${mm(py)}" width="${mm(w)}" height="${mm(h)}" ${STYLE}/>`;
      return `${shape}<text x="${mm(px) + 10}" y="${mm(py) + 30}" font-size="24" font-family="sans-serif">${label}</text>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${physical(L, p.units)}" height="${physical(W, p.units)}" viewBox="0 0 ${L} ${W}">\n<rect x="0" y="0" width="${L}" height="${W}" ${STYLE} stroke-dasharray="20 10"/>\n${body}\n</svg>\n`;
}

/** Height of a cabinet's baffle: the box height, or the depth when the drivers fire at the floor from the bottom panel. */
export const baffleHeight = (c: Cabinet): number => (c.facing === 'down' ? c.geometry.dO : c.geometry.hO);

/** A baffle to scale with its driver and port holes: the front, or (rear) the back wall of a push-pull box. */
export function baffleSvg(c: Cabinet, title: string, u: Units = 'mm', rear = false): string {
  const g = c.geometry;
  const holes = holePositions(c, rear)
    .map((h) => (h.shape === 'rect' ? `<rect x="${mm(h.cx - h.w / 2)}" y="${mm(h.cy - h.h / 2)}" width="${mm(h.w)}" height="${mm(h.h)}" ${STYLE}/>` : `<circle cx="${mm(h.cx)}" cy="${mm(h.cy)}" r="${mm(h.r)}" ${STYLE}/>`))
    .join('\n');
  // the back wall of a plan trapezoid is its narrow end; a tower's baffle and back are trapezoids, narrow at the top; every other one is a rectangle
  const W = mm(rear && c.taper?.axis === 'plan' ? c.taper.narrowO : g.wO);
  const H = mm(baffleHeight(c));
  const tower = c.taper?.axis === 'height' ? c.taper : null;
  const outline = tower
    ? `<polygon points="${mm((tower.wideO - tower.narrowO) / 2)},0 ${mm((tower.wideO + tower.narrowO) / 2)},0 ${W},${H} 0,${H}" ${STYLE}/>`
    : `<rect x="0" y="0" width="${W}" height="${H}" ${STYLE}/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${physical(W, u)}" height="${physical(H, u)}" viewBox="0 0 ${W} ${H}">
<title>${esc(title)}</title>
${outline}
${holes}
</svg>
`;
}

/**
 * A folded horn's side view to scale (front on the right): the box, each septum, the leg numbers, the throat at the top front and
 * the mouth at the bottom front. Dimensions are the layout's, in millimetres in the file.
 */
export function foldSvg(f: P.FoldLayout, t: number, title: string, u: Units = 'mm', chamber?: { heightM: number; depthM: number }): string {
  const W = mm(f.dO);
  // the driver's chamber sits above the legs, on a shelf: everything of the legs moves down by its height and the shelf
  const dy = chamber ? mm(chamber.heightM + t) : 0;
  const H = mm(f.hO) + dy;
  const font = Math.max(14, Math.round(Math.min(W, H) / 28));
  const tapered = f.style === 'tapered';
  const X = (d: number): number => mm(f.dO - t - d); // front on the right
  const topAt = (k: number, d: number): number => t + f.septaFrontTop[k]! + ((f.septaBackTop[k]! - f.septaFrontTop[k]!) * d) / f.dI;
  const septa = f.septaLength
    .map((len, k) => {
      if (tapered) {
        // a sloped plate: four corners from its top at one end to its top at the other
        const front = f.septaAnchor[k] === 'front';
        const d0 = front ? 0 : f.dI - len;
        const d1 = front ? len : f.dI;
        return `<polygon points="${X(d0)},${mm(topAt(k, d0))} ${X(d1)},${mm(topAt(k, d1))} ${X(d1)},${mm(topAt(k, d1) + t)} ${X(d0)},${mm(topAt(k, d0) + t)}" ${STYLE}/>`;
      }
      const y = mm(t + f.septaTop[k]!);
      const x = f.septaAnchor[k] === 'front' ? mm(f.dO - t - len) : mm(t);
      return `<rect x="${x}" y="${y}" width="${mm(len)}" height="${Math.max(mm(t), 2)}" ${STYLE}/>`;
    })
    .join('\n');
  const labels = f.heights
    .map((h, k) => {
      let y = t + f.heights.slice(0, k).reduce((a, b) => a + b + t, 0) + h / 2;
      let size = `${mm(h)} mm`;
      if (tapered) {
        // the leg's middle, between the plates above and below it at mid depth
        const top = k === 0 ? t : topAt(k - 1, f.dI / 2) + t;
        const bottom = k === f.heights.length - 1 ? f.hO - t : topAt(k, f.dI / 2);
        y = (top + bottom) / 2;
        size = `${mm(f.heightsFront[k]!)} front, ${mm(f.heightsBack[k]!)} back mm`;
      }
      return `<text x="${mm(f.dO / 2)}" y="${mm(y) + Math.round(font / 3)}" font-size="${font}" text-anchor="middle" font-family="sans-serif">leg ${k + 1} (${size})</text>`;
    })
    .join('\n');
  const ends = `<text x="${W - font / 2}" y="${dy + mm(t) + font}" font-size="${font}" text-anchor="end" font-family="sans-serif">${chamber ? 'opening from the chamber' : 'throat, front'}</text>` + (f.mouthAtFront ? `\n<text x="${W - font / 2}" y="${H - mm(t) - Math.round(font / 2)}" font-size="${font}" text-anchor="end" font-family="sans-serif">mouth</text>` : '');
  // the shelf under the chamber, and its back wall when the chamber is shallower than the box (front on the right)
  const chamberSvg = chamber
    ? `<rect x="${mm(t)}" y="${dy - mm(t)}" width="${W - 2 * mm(t)}" height="${Math.max(mm(t), 2)}" ${STYLE}/>\n` +
      (chamber.depthM < f.dI - 1e-9 ? `<rect x="${mm(f.dO - t - chamber.depthM - t)}" y="${mm(t)}" width="${Math.max(mm(t), 2)}" height="${mm(chamber.heightM)}" ${STYLE}/>\n` : '') +
      `<text x="${mm(f.dO - t - chamber.depthM / 2)}" y="${mm(t + chamber.heightM / 2) + Math.round(font / 3)}" font-size="${font}" text-anchor="middle" font-family="sans-serif">driver chamber</text>\n`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${physical(W, u)}" height="${physical(H, u)}" viewBox="0 0 ${W} ${H}">\n<title>${esc(title)}</title>\n<rect x="0" y="0" width="${W}" height="${H}" ${STYLE}/>\n${chamberSvg}<g transform="translate(0 ${dy})">\n${septa}\n${labels}\n</g>\n${ends}\n</svg>\n`;
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
 * A panel that is not a rectangle, to scale: its outline with the length of every edge, and the bevel to cut if it has one. The outline is
 * the panel's own flat shape (poly); bevelDeg and bevelEdges say how the edges are cut. Returns null for a rectangle.
 */
export function panelSvg(pn: P.Panel, title: string, u: Units = 'mm'): string | null {
  if (!pn.poly) return null;
  // the outline's own extent: for a wedge side the listed length and width are the other way round
  const H = Math.max(...pn.poly.map((q) => q[1]));
  const pts = pn.poly.map(([x, y]) => [mm(x), mm(H - y)] as const);
  const W = mm(Math.max(...pn.poly.map((q) => q[0])));
  const Hh = mm(H);
  const margin = 80;
  const edge = (a: readonly [number, number], b: readonly [number, number], dx: number, dy: number): string => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) / 1000;
    const label = `${formatLength(len * 1000, u)} ${u}`;
    return `<text x="${(a[0] + b[0]) / 2 + dx}" y="${(a[1] + b[1]) / 2 + dy}" font-size="28" font-family="sans-serif" text-anchor="middle">${label}</text>`;
  };
  const labels = pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length]!;
    const horizontal = Math.abs(b[1] - a[1]) < Math.abs(b[0] - a[0]);
    const above = (a[1] + b[1]) / 2 < Hh / 2;
    return edge(a, b, horizontal ? 0 : (a[0] + b[0]) / 2 < W / 2 ? -50 : 50, horizontal ? (above ? -14 : 36) : 0);
  });
  const note = pn.bevelDeg !== undefined ? `<text x="${W / 2}" y="${Hh / 2}" font-size="28" font-family="sans-serif" text-anchor="middle">bevel ${(Math.round(pn.bevelDeg * 10) / 10).toString()} degrees on ${esc(pn.bevelEdges ?? 'its ends')}</text>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${physical(W + 2 * margin, u)}" height="${physical(Hh + 2 * margin, u)}" viewBox="${-margin} ${-margin} ${W + 2 * margin} ${Hh + 2 * margin}">
<title>${esc(title)}</title>
<polygon points="${pts.map((q) => q.join(',')).join(' ')}" ${STYLE}/>
${labels.join('\n')}
${note}
</svg>
`;
}

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
    if (x.placement.poly) {
      const pts = x.placement.poly.map(([a, b]) => [out(a, u), Math.round((W - out(b, u)) * 1e4) / 1e4] as const);
      pts.forEach((pt, k) => entities.push(line('CUT', pt[0], pt[1], pts[(k + 1) % pts.length]![0], pts[(k + 1) % pts.length]![1])));
    } else entities.push(rect('CUT', x0, y0, out(w, u), out(h, u)));
    entities.push(pair(0, 'TEXT') + pair(8, 'LABELS') + pair(10, x0 + inset) + pair(20, y0 + inset) + pair(30, 0) + pair(40, textHeight) + pair(1, `${x.label} ${formatLength(w * 1000, u)} x ${formatLength(h * 1000, u)}`.replace(/[\r\n]/g, ' ')));
  }
  return (
    pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$ACADVER') + pair(1, 'AC1009') + pair(9, '$INSUNITS') + pair(70, u === 'in' ? 1 : 4) + pair(0, 'ENDSEC') +
    pair(0, 'SECTION') + pair(2, 'TABLES') + pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, 3) + layers + pair(0, 'ENDTAB') + pair(0, 'ENDSEC') +
    pair(0, 'SECTION') + pair(2, 'ENTITIES') + entities.join('') + pair(0, 'ENDSEC') + pair(0, 'EOF')
  );
}
