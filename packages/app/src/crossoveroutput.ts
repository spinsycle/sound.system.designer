// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// What the crossover page hands over: the parts list (every part with its standard value, error and rating), the bill of materials
// (the same parts counted), a CSV of the list and the schematic as an SVG. Pure functions of the page's Computed and XoState.
import * as P from '@soundsystemdesigner/physics';
import type { BomLine } from './buildlist';
import type { ActiveDesign, Section } from '@soundsystemdesigner/physics';
import type { Computed, XoState } from './crossover';
import { slug } from './export';

/** 4.7e-6 as "4.7 µF" and so on, three significant figures at most. */
export function eng(v: number, unit: 'Ω' | 'F' | 'H'): string {
  const table: readonly (readonly [number, string])[] = unit === 'Ω' ? [[1e6, 'MΩ'], [1e3, 'kΩ'], [1, 'Ω']] : unit === 'F' ? [[1, 'F'], [1e-3, 'mF'], [1e-6, 'µF'], [1e-9, 'nF'], [1e-12, 'pF']] : [[1, 'H'], [1e-3, 'mH'], [1e-6, 'µH']];
  const [scale, label] = table.find(([s]) => v >= s * 0.9995) ?? table[table.length - 1]!;
  return `${Number((v / scale).toPrecision(3))} ${label}`;
}

export type PartKind = 'Inductor' | 'Capacitor' | 'Resistor';
export interface PartRow {
  ref: string;
  where: string;
  kind: PartKind;
  unit: 'H' | 'F' | 'Ω';
  /** What the design calls for, SI units. */
  ideal: number;
  /** The standard value to buy (the chosen series, or E24 when the page shows exact values). */
  standard: number;
  /** Standard against ideal, percent. */
  errorPct: number;
  rating: string;
  note: string;
}

const UNIT_OF: Record<PartKind, PartRow['unit']> = { Inductor: 'H', Capacitor: 'F', Resistor: 'Ω' };
const KIND_OF: Record<P.PartType, PartKind> = { L: 'Inductor', C: 'Capacitor', R: 'Resistor' };
const WATTS = [0.5, 1, 2, 5, 10, 25, 50, 100, 200] as const;
const AMPS = [0.5, 1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30] as const;

/** Smallest standard resistor power rating that is at least twice the heat it makes; the largest in the table when none is. */
export const resistorWatts = (heatW: number): number => WATTS.find((w) => w >= 2 * Math.abs(heatW)) ?? WATTS[WATTS.length - 1]!;
/** Smallest standard current rating that is at least 1.5 times the peak of an rms current; Infinity above the table. */
export const inductorAmps = (iRms: number): number => AMPS.find((a) => a >= 1.5 * Math.SQRT2 * iRms) ?? Infinity;

const seriesOf = (s: XoState): P.Series => (s.series === 'none' ? 'E24' : s.series);
const row = (ref: string, where: string, kind: PartKind, ideal: number, standard: number, rating: string, note: string): PartRow => ({ ref, where, kind, unit: UNIT_OF[kind], ideal, standard, errorPct: (standard / ideal - 1) * 100, rating, note });

/** Every part of the design in order, ready to buy. */
export function partsList(c: Computed, s: XoState): PartRow[] {
  const rows: PartRow[] = [];
  const series = seriesOf(s);
  if (c.passive) {
    c.passive.forEach((w, k) => {
      w.network.forEach((b, i) => {
        const tag = / \((hp|lp)\)$/.exec(b.name)?.[1];
        const base = b.name.replace(/ \((hp|lp)\)$/, '') + (tag ? tag[0] : '');
        const st = w.stress[i]!;
        const dcr = b.groups.length === 2 && b.groups[0]!.length === 1 && b.groups[0]![0]!.type === 'L' && b.groups[1]!.length === 1 && b.groups[1]![0]!.type === 'R' ? b.groups[1]![0]!.value : null;
        const parts = b.groups.flat().filter((p) => !(dcr !== null && p.type === 'R'));
        parts.forEach((p) => {
          const kind = KIND_OF[p.type];
          const ref = `W${k + 1}-${base}${parts.length > 1 ? `-${p.type}` : ''}`;
          const where = `${w.name}, ${w.kind}`;
          const rating = kind === 'Capacitor' ? (P.capacitorVoltageRating(st.vRms) === Infinity ? 'over 630 V' : `${P.capacitorVoltageRating(st.vRms)} V film`) : kind === 'Inductor' ? (inductorAmps(st.iRms) === Infinity ? 'over 30 A' : `${inductorAmps(st.iRms)} A`) : `${resistorWatts(st.powerW)} W`;
          const note = kind === 'Inductor' && dcr !== null ? `air core preferred; resistance about ${eng(dcr, 'Ω')} (estimate, replace with the real one)` : kind === 'Resistor' ? 'wirewound or ceramic power resistor' : '';
          rows.push(row(ref, where, kind, p.value, P.snapToSeries(p.value, series), rating, note));
        });
      });
    });
    return rows;
  }
  for (const a of c.active ?? []) {
    ([['LP', a.lpIdeal, a.lp], ['HP', a.hpIdeal, a.hp]] as const).forEach(([band, ideal, shown]) => {
      ideal.sections.forEach((sec, i) => {
        const real = shown.sections[i]!;
        const where = `Split ${a.split + 1} at ${Math.round(a.fcHz)} Hz, ${band === 'LP' ? 'low-pass' : 'high-pass'}, stage ${i + 1} (${sec.order === 1 ? 'first order' : `second order, Q ${sec.q.toFixed(2)}`}, ${sec.f0.toFixed(0)} Hz)`;
        const names = [...Object.keys(sec.res), ...Object.keys(sec.caps)];
        for (const name of names) {
          const isRes = name in sec.res;
          const iv = isRes ? sec.res[name]! : sec.caps[name]!;
          const sv = s.series === 'none' ? P.snapToSeries(iv, 'E24') : isRes ? real.res[name]! : real.caps[name]!;
          rows.push(row(`S${a.split + 1}-${band}${i + 1}-${name.toUpperCase()}`, where, isRes ? 'Resistor' : 'Capacitor', iv, sv, isRes ? '0.25 W' : '50 V, film or C0G', ''));
        }
      });
    });
  }
  return rows;
}

/** The op-amps the active circuits use: one for each stage, three for a state-variable stage. */
export function opAmpCount(c: Computed): number {
  const per = (sec: Section): number => (sec.order === 2 && sec.topology === 'state-variable' ? 3 : 1);
  return (c.active ?? []).reduce((n, a) => n + [a.lp, a.hp].reduce((m, d: ActiveDesign) => m + d.sections.reduce((k, sec) => k + per(sec), 0), 0), 0);
}

/** The parts counted: identical parts (same kind, standard value and rating) on one line. */
export function bomLines(rows: readonly PartRow[], c: Computed, s: XoState): BomLine[] {
  const map = new Map<string, BomLine>();
  for (const r of rows) {
    const key = `${r.kind}|${r.standard}|${r.rating}`;
    const have = map.get(key);
    if (have) have.qty += 1;
    else map.set(key, { item: `${r.kind} ${eng(r.standard, r.unit)}`, qty: 1, unit: 'pcs', note: [r.rating, s.series === 'E96' ? '1 %' : '5 % or better', r.note.split(';')[0]!].filter(Boolean).join(', ') });
  }
  const out = [...map.values()];
  const ops = opAmpCount(c);
  if (ops > 0) out.push({ item: 'Op-amp, audio grade', qty: ops, unit: 'pcs', note: 'single or dual; a 100 nF decoupling capacitor at each supply pin' });
  return out;
}

const csvCell = (v: string | number): string => {
  const t = String(v);
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** The parts list as CSV, SI values in numeric columns so a spreadsheet can sort and add them. */
export function partsCsv(rows: readonly PartRow[]): string {
  const head = ['Ref', 'Where', 'Part', 'Ideal (SI)', 'Standard (SI)', 'Unit', 'Standard', 'Error %', 'Rating', 'Note'];
  const lines = rows.map((r) => [r.ref, r.where, r.kind, r.ideal, r.standard, r.unit, eng(r.standard, r.unit), r.errorPct.toFixed(2), r.rating, r.note].map(csvCell).join(','));
  return [head.join(','), ...lines].join('\r\n') + '\r\n';
}

/** The bill of materials as CSV. */
export function bomCsv(lines: readonly BomLine[]): string {
  return ['Item,Qty,Unit,Note', ...lines.map((l) => [l.item, l.qty, l.unit, l.note].map(csvCell).join(','))].join('\r\n') + '\r\n';
}

export const outputName = (name: string, what: string, ext: string): string => `${slug(name)}-crossover-${what}.${ext}`;

// -- the schematic ---------------------------------------------------------------------------------------------------------

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const INK = 'fill="none" stroke="#111" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
const f = (n: number): string => String(Math.round(n * 10) / 10);

/** A drawing under construction: svg fragments and the extent they reach. */
class Pic {
  parts: string[] = [];
  w = 0;
  h = 0;
  private reach(x: number, y: number): void {
    this.w = Math.max(this.w, x);
    this.h = Math.max(this.h, y);
  }
  wire(...pts: [number, number][]): void {
    pts.forEach(([x, y]) => this.reach(x, y));
    this.parts.push(`<polyline points="${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}" ${INK}/>`);
  }
  box(x: number, y: number, w: number, h: number): void {
    this.reach(x + w, y + h);
    this.parts.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" ${INK}/>`);
  }
  dot(x: number, y: number): void {
    this.parts.push(`<circle cx="${f(x)}" cy="${f(y)}" r="3" fill="#111"/>`);
  }
  text(x: number, y: number, t: string, o: { size?: number; anchor?: 'start' | 'middle' | 'end'; bold?: boolean } = {}): void {
    this.reach(x + (o.anchor === 'start' || !o.anchor ? t.length * 6.5 : 0), y + 4);
    this.parts.push(`<text x="${f(x)}" y="${f(y)}" font-family="sans-serif" font-size="${o.size ?? 12}" text-anchor="${o.anchor ?? 'start'}"${o.bold ? ' font-weight="bold"' : ''} fill="#111">${esc(t)}</text>`);
  }
  ground(x: number, y: number): void {
    this.wire([x, y], [x, y + 8]);
    this.wire([x - 10, y + 8], [x + 10, y + 8]);
    this.wire([x - 6, y + 12], [x + 6, y + 12]);
    this.wire([x - 2, y + 16], [x + 2, y + 16]);
  }
  /** A two-terminal part centred at (x, y), 60 long along its axis ('h' left to right, 'v' top to bottom), name and value beside it. */
  part(type: P.PartType, x: number, y: number, o: 'h' | 'v', name: string, value: string): void {
    const h = o === 'h';
    const at = (a: number, b = 0): [number, number] => (h ? [x + a, y + b] : [x + b, y + a]);
    if (type === 'R') {
      this.wire(at(-30), at(-20), at(-20, -7), at(20, -7), at(20, 7), at(-20, 7), at(-20), at(-20, -7));
      this.wire(at(20), at(30));
    } else if (type === 'C') {
      this.wire(at(-30), at(-4));
      this.wire(at(4), at(30));
      this.wire(at(-4, -12), at(-4, 12));
      this.wire(at(4, -12), at(4, 12));
    } else {
      this.wire(at(-30), at(-20));
      for (let k = 0; k < 4; ++k) {
        const a = -20 + 10 * k;
        const [sx, sy] = at(a);
        const [ex, ey] = at(a + 10);
        this.parts.push(`<path d="M${f(sx)},${f(sy)} A5,5 0 0 ${h ? 1 : 0} ${f(ex)},${f(ey)}" ${INK}/>`);
        this.reach(ex, ey);
      }
      this.wire(at(20), at(30));
    }
    if (h) {
      this.text(x, y - 18, name, { anchor: 'middle', bold: true, size: 12 });
      this.text(x, y + 28, value, { anchor: 'middle', size: 11 });
    } else {
      this.text(x + 16, y - 2, name, { bold: true });
      this.text(x + 16, y + 12, value, { size: 11 });
    }
  }
  /** Op-amp with its left edge at x and centre at y: + above, - below, output at (x + 48, y). */
  opamp(x: number, y: number): void {
    this.parts.push(`<path d="M${f(x)},${f(y - 28)} L${f(x + 48)},${f(y)} L${f(x)},${f(y + 28)} Z" ${INK}/>`);
    this.reach(x + 48, y + 28);
    this.text(x + 5, y - 10, '+', { size: 13 });
    this.text(x + 5, y + 20, '−', { size: 13 });
  }
}

type PartTable = Record<string, { type: P.PartType; value: number }>;
const val = (t: PartTable, name: string): string => (t[name] ? eng(t[name]!.value, t[name]!.type === 'R' ? 'Ω' : t[name]!.type === 'C' ? 'F' : 'H') : '');
const partsOf = (sec: Section): PartTable => {
  const t: PartTable = {};
  for (const [k, v] of Object.entries(sec.res)) t[k] = { type: 'R', value: v };
  for (const [k, v] of Object.entries(sec.caps)) t[k] = { type: 'C', value: v };
  return t;
};

/** One active stage at (ox, oy); returns the stage's width and height. Sallen-Key, multiple feedback and a first-order RC with a buffer are drawn as circuits; the state-variable stage as blocks. */
function drawStage(pic: Pic, sec: Section, ox: number, oy: number): { w: number; h: number } {
  const t = partsOf(sec);
  const lp = sec.band === 'lp';
  const px = (x: number): number => ox + x;
  const py = (y: number): number => oy + y;
  const name = (n: string): string => n.toUpperCase();
  const w = (n: string): string => val(t, n);
  if (sec.order === 1) {
    pic.text(px(0), py(8), 'IN');
    pic.wire([px(0), py(60)], [px(20), py(60)]);
    if (lp) {
      pic.part('R', px(50), py(60), 'h', name('r'), w('r'));
      pic.part('C', px(100), py(110), 'v', name('c'), w('c'));
    } else {
      pic.part('C', px(50), py(60), 'h', name('c'), w('c'));
      pic.part('R', px(100), py(110), 'v', name('r'), w('r'));
    }
    pic.wire([px(80), py(60)], [px(200), py(60)]);
    pic.dot(px(100), py(60));
    pic.ground(px(100), py(140));
    pic.opamp(px(200), py(74));
    pic.wire([px(200), py(88)], [px(180), py(88)], [px(180), py(130)], [px(270), py(130)], [px(270), py(74)]);
    pic.wire([px(248), py(74)], [px(310), py(74)]);
    pic.dot(px(270), py(74));
    pic.text(px(315), py(78), 'OUT', { size: 11 });
    return { w: 360, h: 170 };
  }
  if (sec.topology === 'sk-equal' || sec.topology === 'sk-unity') {
    pic.wire([px(0), py(60)], [px(20), py(60)]);
    pic.text(px(0), py(52), 'IN', { size: 11 });
    const rail1 = lp ? 'r1' : 'c1';
    const rail2 = lp ? 'r2' : 'c2';
    const shunt = lp ? 'c2' : 'r2';
    const top = lp ? 'c1' : 'r1';
    const ty = (n: string): P.PartType => (n.startsWith('r') ? 'R' : 'C');
    pic.part(ty(rail1), px(50), py(60), 'h', name(rail1), w(rail1));
    pic.wire([px(80), py(60)], [px(130), py(60)]);
    pic.dot(px(110), py(60));
    pic.part(ty(rail2), px(160), py(60), 'h', name(rail2), w(rail2));
    pic.wire([px(190), py(60)], [px(330), py(60)]);
    pic.dot(px(220), py(60));
    pic.part(ty(shunt), px(220), py(110), 'v', name(shunt), w(shunt));
    pic.wire([px(220), py(60)], [px(220), py(80)]);
    pic.ground(px(220), py(140));
    pic.wire([px(110), py(60)], [px(110), py(20)], [px(210), py(20)]);
    pic.part(ty(top), px(240), py(20), 'h', name(top), w(top));
    pic.wire([px(270), py(20)], [px(430), py(20)], [px(430), py(74)]);
    pic.opamp(px(330), py(74));
    pic.wire([px(378), py(74)], [px(480), py(74)]);
    pic.dot(px(430), py(74));
    pic.text(px(485), py(78), 'OUT', { size: 11 });
    pic.wire([px(330), py(88)], [px(300), py(88)]);
    if (t.rf && t.rg) {
      pic.dot(px(300), py(88));
      pic.wire([px(300), py(88)], [px(300), py(130)]);
      pic.dot(px(300), py(130));
      pic.part('R', px(300), py(170), 'v', 'RG', w('rg'));
      pic.ground(px(300), py(200));
      pic.wire([px(300), py(130)], [px(335), py(130)]);
      pic.part('R', px(365), py(130), 'h', 'RF', w('rf'));
      pic.wire([px(395), py(130)], [px(430), py(130)], [px(430), py(74)]);
      return { w: 540, h: 230 };
    }
    pic.wire([px(300), py(88)], [px(300), py(150)], [px(430), py(150)], [px(430), py(74)]);
    return { w: 540, h: 170 };
  }
  if (sec.topology === 'mfb') {
    const ty = (n: string): P.PartType => (n.startsWith('r') ? 'R' : 'C');
    const [inEl, midEl, gndEl, fbEl, topEl] = lp ? (['r1', 'r3', 'c1', 'c2', 'r2'] as const) : (['c1', 'c3', 'r1', 'r2', 'c2'] as const);
    pic.text(px(0), py(80), 'IN', { size: 11 });
    pic.wire([px(0), py(88)], [px(20), py(88)]);
    pic.part(ty(inEl), px(50), py(88), 'h', name(inEl), w(inEl));
    pic.wire([px(80), py(88)], [px(135), py(88)]);
    pic.dot(px(110), py(88));
    pic.part(ty(midEl), px(165), py(88), 'h', name(midEl), w(midEl));
    pic.wire([px(195), py(88)], [px(260), py(88)]);
    pic.dot(px(220), py(88));
    pic.part(ty(gndEl), px(110), py(138), 'v', name(gndEl), w(gndEl));
    pic.wire([px(110), py(88)], [px(110), py(108)]);
    pic.ground(px(110), py(168));
    pic.wire([px(110), py(88)], [px(110), py(10)], [px(220), py(10)]);
    pic.part(ty(topEl), px(250), py(10), 'h', name(topEl), w(topEl));
    pic.wire([px(280), py(10)], [px(400), py(10)], [px(400), py(74)]);
    pic.opamp(px(260), py(74));
    pic.wire([px(308), py(74)], [px(470), py(74)]);
    pic.dot(px(400), py(74));
    pic.text(px(475), py(78), 'OUT', { size: 11 });
    pic.wire([px(260), py(60)], [px(240), py(60)]);
    pic.ground(px(240), py(60));
    pic.wire([px(220), py(88)], [px(220), py(128)], [px(255), py(128)]);
    pic.part(ty(fbEl), px(285), py(128), 'h', name(fbEl), w(fbEl));
    pic.wire([px(315), py(128)], [px(400), py(128)], [px(400), py(74)]);
    return { w: 530, h: 200 };
  }
  // state-variable: three blocks
  const boxW = 150;
  const box = (x: number, title: string, lines: string[]): void => {
    pic.box(px(x), py(20), boxW, 110);
    pic.text(px(x + boxW / 2), py(40), title, { anchor: 'middle', bold: true });
    lines.forEach((l, i) => pic.text(px(x + 10), py(62 + 16 * i), l, { size: 11 }));
  };
  pic.text(px(0), py(78), 'IN', { size: 11 });
  pic.wire([px(0), py(80)], [px(30), py(80)]);
  box(30, 'Summing amplifier', [`RS ${w('rs')} (in, LP)`, `RF ${w('rf')}`, `RA ${w('ra')}, RB ${w('rb')}`]);
  box(230, 'Integrator 1', [`R ${w('r')}`, `C ${w('c')}`, 'output: band-pass']);
  box(430, 'Integrator 2', [`R ${w('r')}`, `C ${w('c')}`, 'output: low-pass']);
  pic.wire([px(180), py(60)], [px(230), py(60)]);
  pic.text(px(184), py(54), 'HP', { size: 11, bold: true });
  pic.wire([px(380), py(60)], [px(430), py(60)]);
  pic.text(px(384), py(54), 'BP', { size: 11, bold: true });
  pic.wire([px(580), py(60)], [px(620), py(60)]);
  pic.text(px(584), py(54), 'LP', { size: 11, bold: true });
  if (lp) pic.text(px(625), py(64), 'OUT', { size: 11 });
  else {
    pic.dot(px(205), py(60));
    pic.wire([px(205), py(60)], [px(205), py(10)]);
    pic.text(px(210), py(12), 'OUT', { size: 11 });
  }
  pic.wire([px(600), py(60)], [px(600), py(160)], [px(60), py(160)], [px(60), py(130)]);
  pic.text(px(330), py(176), 'LP back to the summing amplifier; BP back through RA and RB', { anchor: 'middle', size: 11 });
  pic.wire([px(405), py(60)], [px(405), py(145)], [px(105), py(145)], [px(105), py(130)]);
  return { w: 760, h: 190 };
}

/** The whole design as one SVG on white, to scale in pixels: a ladder per way (passive) or the stages of each circuit (active). */
export function schematicSvg(c: Computed, s: XoState, title = 'Crossover'): string {
  const pic = new Pic();
  let y = 30;
  pic.text(10, y, `${title}: ${s.mode === 'passive' ? 'passive networks' : 'active circuits'}, ${s.alignment}, order ${s.order}`, { size: 15, bold: true });
  y += 30;
  if (c.passive) {
    c.passive.forEach((wy, k) => {
      pic.text(10, y, `${wy.name}: ${wy.kind}`, { bold: true });
      const rail = y + 40;
      pic.text(10, rail - 6, 'IN', { size: 11 });
      pic.dot(36, rail);
      pic.wire([36, rail], [60, rail]);
      let x = 60;
      for (const b of wy.network) {
        const parts = b.groups.flat();
        const dcr = b.groups.length === 2 && b.groups[0]![0]!.type === 'L' && b.groups[1]![0]!.type === 'R';
        const label = (p: { type: P.PartType; value: number }): string => eng(p.value, p.type === 'R' ? 'Ω' : p.type === 'C' ? 'F' : 'H');
        if (b.kind === 'series') {
          pic.wire([x, rail], [x + 20, rail]);
          x += 50;
          const main = parts[0]!;
          pic.part(main.type, x, rail, 'h', b.name.replace(/ \((hp|lp)\)$/, ''), label(main) + (dcr ? ` (${eng(parts[1]!.value, 'Ω')})` : ''));
          x += 30;
        } else {
          x += 30;
          pic.wire([x - 30, rail], [x, rail]);
          pic.dot(x, rail);
          let cy = rail + 20;
          const stack = dcr ? [parts[0]!] : parts;
          stack.forEach((p, i) => {
            pic.wire([x, cy], [x, cy + 10]);
            pic.part(p.type, x, cy + 40, 'v', i === 0 ? b.name.replace(/ \((hp|lp)\)$/, '') : '', label(p) + (dcr ? ` (${eng(parts[1]!.value, 'Ω')})` : ''));
            cy += 70;
          });
          pic.wire([x, cy - 10], [x, cy]);
          pic.ground(x, cy);
          x += 20;
        }
      }
      pic.wire([x, rail], [x + 40, rail]);
      x += 40;
      pic.box(x, rail - 30, 90, 60);
      pic.text(x + 45, rail - 4, wy.name.slice(0, 14), { anchor: 'middle', bold: true, size: 11 });
      pic.text(x + 45, rail + 12, `${s.drivers[k]!.reOhm} Ω, ${s.drivers[k]!.leMh} mH`, { anchor: 'middle', size: 10 });
      pic.wire([x + 45, rail + 30], [x + 45, rail + 50]);
      pic.ground(x + 45, rail + 50);
      pic.dot(x + 45, rail + 30);
      pic.dot(x + 45, rail - 30);
      y += 190;
      pic.h = Math.max(pic.h, y);
    });
  } else {
    for (const a of c.active ?? []) {
      for (const [label, d] of [['Low-pass', a.lp], ['High-pass', a.hp]] as const) {
        pic.text(10, y, `Split ${a.split + 1} at ${Math.round(a.fcHz)} Hz, ${label.toLowerCase()}${d.inverts ? ' (the stages invert)' : ''}; trim after the stages ${P.dB(d.trim).toFixed(2)} dB`, { bold: true });
        let rowH = 0;
        let x = 10;
        d.sections.forEach((sec, i) => {
          pic.text(x, y + 20, `Stage ${i + 1}: ${sec.order === 1 ? 'first order' : `second order, Q ${sec.q.toFixed(2)}`}, ${sec.f0.toFixed(0)} Hz`, { size: 11 });
          const sz = drawStage(pic, sec, x, y + 24);
          x += sz.w + 30;
          rowH = Math.max(rowH, sz.h);
        });
        y += rowH + 70;
      }
    }
  }
  const W = Math.max(pic.w + 30, 520);
  const H = Math.max(y, pic.h + 20);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${f(W)}" height="${f(H)}" viewBox="0 0 ${f(W)} ${f(H)}">\n<title>${esc(title)}</title>\n<rect x="0" y="0" width="${f(W)}" height="${f(H)}" fill="#fff"/>\n${pic.parts.join('\n')}\n</svg>\n`;
}
