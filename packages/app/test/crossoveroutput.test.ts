// The crossover outputs: parts list, bill of materials, CSV and the schematic.
import * as P from '@soundsystemdesigner/physics';
import { describe, expect, it } from 'vitest';
import * as X from '../src/crossover';
import * as O from '../src/crossoveroutput';

function design(over: Partial<X.XoState> = {}): X.XoState {
  const d = (role: X.Role): X.XoDriver => ({ ...X.driverFor(role), fsHz: 10, qts: 0.707, upperHz: 0, sensDb: 90, leMh: 0, reOhm: 8, nomOhm: 8, qms: 50 });
  return X.sanitizeXo({ ...X.DEFAULT_XO, ways: 2, drivers: [d('woofer'), d('tweeter'), X.driverFor('mid'), X.driverFor('sub')], xover: [2500, 3000, 3500], series: 'E24', ...over });
}
const comp = (s: X.XoState): X.Computed => X.computeCrossover(s);

/** The tags of an SVG are balanced and nothing in it is a raw ampersand or angle bracket inside text. */
function wellFormed(svg: string): void {
  const body = svg.replace(/^<\?xml[^>]*>\s*/, '');
  const stack: string[] = [];
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    if (m[4] === '/') continue;
    if (m[1] === '/') expect(stack.pop()).toBe(m[2]);
    else stack.push(m[2]!);
  }
  expect(stack).toEqual([]);
  expect(body).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/);
}

/** Every coordinate the drawing uses lies inside its own viewBox. */
function inside(svg: string): void {
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)!;
  const w = Number(vb[1]);
  const h = Number(vb[2]);
  expect(w).toBeGreaterThan(200);
  expect(h).toBeGreaterThan(100);
  for (const m of svg.matchAll(/points="([^"]+)"/g)) for (const pt of m[1]!.split(' ')) {
    const [x, y] = pt.split(',').map(Number);
    expect(x!).toBeGreaterThanOrEqual(-1);
    expect(x!).toBeLessThanOrEqual(w + 1);
    expect(y!).toBeGreaterThanOrEqual(-1);
    expect(y!).toBeLessThanOrEqual(h + 1);
  }
  for (const m of svg.matchAll(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
    expect(Number(m[1]) + Number(m[3])).toBeLessThanOrEqual(w + 1);
    expect(Number(m[2]) + Number(m[4])).toBeLessThanOrEqual(h + 1);
  }
}

describe('eng and ratings', () => {
  it('engineering units with three figures', () => {
    expect(O.eng(4.7e-6, 'F')).toBe('4.7 µF');
    expect(O.eng(0.0005093, 'H')).toBe('509 µH');
    expect(O.eng(0.0007203, 'H')).toBe('720 µH');
    expect(O.eng(15915, 'Ω')).toBe('15.9 kΩ');
    expect(O.eng(2.34, 'Ω')).toBe('2.34 Ω');
    expect(O.eng(1e-8, 'F')).toBe('10 nF');
    expect(O.eng(2.2e6, 'Ω')).toBe('2.2 MΩ');
    expect(O.eng(0.0031, 'H')).toBe('3.1 mH');
    expect(O.eng(1, 'H')).toBe('1 H');
    expect(O.eng(5e-13, 'F')).toBe('0.5 pF');
  });

  it('resistor watts: at least twice the heat; inductor amps: at least 1.5 times the peak', () => {
    expect(O.resistorWatts(0.2)).toBe(0.5);
    expect(O.resistorWatts(0.3)).toBe(1);
    expect(O.resistorWatts(4)).toBe(10);
    expect(O.resistorWatts(150)).toBe(200);
    expect(O.resistorWatts(-0.2)).toBe(0.5);
    expect(O.inductorAmps(1)).toBe(3); // 1.5 x 1.414
    expect(O.inductorAmps(0.2)).toBe(0.5);
    expect(O.inductorAmps(5)).toBe(15);
    expect(O.inductorAmps(30)).toBe(Infinity);
  });
});

describe('parts list, passive', () => {
  const s = design({ mode: 'passive', dcr: true, series: 'E24' });
  const c = comp(s);
  const rows = O.partsList(c, s);

  it('one row per reactive part, in order, with refs, kinds and the network values', () => {
    expect(rows.map((r) => r.ref)).toEqual(['W1-L1', 'W1-C2', 'W1-L3', 'W1-C4', 'W2-C1', 'W2-L2', 'W2-C3', 'W2-L4']);
    expect(rows.map((r) => r.kind)).toEqual(['Inductor', 'Capacitor', 'Inductor', 'Capacitor', 'Capacitor', 'Inductor', 'Capacitor', 'Inductor']);
    const want = c.passive!.flatMap((w) => P.networkValues(w.network).map((v) => v.value));
    expect(rows.map((r) => r.ideal)).toEqual(want);
    expect(rows.every((r) => r.where.includes('low-pass') || r.where.includes('high-pass'))).toBe(true);
  });

  it('standard values come from the series; the error is standard over ideal', () => {
    for (const r of rows) {
      expect(r.standard).toBeCloseTo(P.snapToSeries(r.ideal, 'E24'), 15);
      expect(r.errorPct).toBeCloseTo((r.standard / r.ideal - 1) * 100, 9);
      expect(Math.abs(r.errorPct)).toBeLessThan(8);
    }
    const e96 = O.partsList(comp(design({ mode: 'passive', series: 'E96' })), design({ mode: 'passive', series: 'E96' }));
    for (const r of e96) expect(r.standard).toBeCloseTo(P.snapToSeries(r.ideal, 'E96'), 15);
    const exact = design({ mode: 'passive', series: 'none' });
    for (const r of O.partsList(comp(exact), exact)) expect(r.standard).toBeCloseTo(P.snapToSeries(r.ideal, 'E24'), 15); // exact values still buy E24
  });

  it('ratings: capacitor volts, inductor amps with the resistance note, none of the resistance as its own row', () => {
    const cap = rows.find((r) => r.kind === 'Capacitor')!;
    const w = c.passive![0]!;
    const st = w.stress[w.network.findIndex((b) => b.name === 'C2')]!;
    expect(rows[1]!.rating).toBe(`${P.capacitorVoltageRating(st.vRms)} V film`);
    expect(cap.rating).toMatch(/ V film$/);
    const ind = rows.find((r) => r.kind === 'Inductor')!;
    expect(ind.rating).toMatch(/^\d+(\.\d+)? A$/);
    expect(ind.note).toMatch(/resistance about .* Ω/);
    expect(rows.some((r) => r.kind === 'Resistor')).toBe(false);
    const plain = design({ mode: 'passive', dcr: false });
    expect(O.partsList(comp(plain), plain).find((r) => r.kind === 'Inductor')!.note).toBe('');
  });

  it('Zobel and pad parts, and a band-pass way, have their own refs', () => {
    const z = design({ mode: 'passive', zobel: true, dcr: false });
    z.drivers[0] = { ...z.drivers[0]!, leMh: 0.9, padDb: 3 };
    const r = O.partsList(comp(z), z).map((x) => x.ref);
    expect(r).toContain('W1-Zobel-R');
    expect(r).toContain('W1-Zobel-C');
    expect(r).toContain('W1-Rs');
    expect(r).toContain('W1-Rp');
    const res = O.partsList(comp(z), z).filter((x) => x.kind === 'Resistor');
    expect(res).toHaveLength(3);
    const net = comp(z).passive![0]!;
    for (const x of res) {
      const i = net.network.findIndex((b) => x.ref.endsWith(`-${b.name}`) || x.ref.includes(`-${b.name}-`));
      expect(x.rating).toBe(`${O.resistorWatts(net.stress[i]!.powerW)} W`);
    }
    const three = X.startingPoint(design({ mode: 'passive', dcr: false }), 3);
    const refs = O.partsList(comp(three), three).map((x) => x.ref);
    expect(refs).toContain('W2-C1h');
    expect(refs).toContain('W2-L1l');
    expect(refs.filter((x) => x.startsWith('W2-'))).toHaveLength(8); // a 4th-order high-pass and a 4th-order low-pass
  });

  it('a voltage no capacitor takes is said so', () => {
    const hot = design({ mode: 'passive', ampPowerW: 20000 });
    hot.drivers[0] = { ...hot.drivers[0]!, nomOhm: 64 };
    expect(O.partsList(comp(hot), hot).some((r) => r.rating === 'over 630 V')).toBe(true);
  });
});

describe('parts list, active', () => {
  const s = design({ mode: 'active', series: 'E24', topology: 'sk-equal' });
  const c = comp(s);

  it('every stage part, with the design value and the snapped value', () => {
    const rows = O.partsList(c, s);
    expect(rows.map((r) => r.ref).slice(0, 6)).toEqual(['S1-LP1-R1', 'S1-LP1-R2', 'S1-LP1-RG', 'S1-LP1-RF', 'S1-LP1-C1', 'S1-LP1-C2']);
    expect(rows.every((r) => r.rating === (r.kind === 'Resistor' ? '0.25 W' : '50 V, film or C0G'))).toBe(true);
    const a = c.active![0]!;
    const sec = a.lpIdeal.sections[0]!;
    expect(rows[0]!.ideal).toBe(sec.res.r1);
    expect(rows[0]!.standard).toBe(a.lp.sections[0]!.res.r1);
    expect(rows.filter((r) => r.where.includes('high-pass')).length).toBe(rows.length / 2);
    expect(rows.every((r) => Math.abs(r.errorPct) < 8)).toBe(true);
  });

  it('exact values still buy E24; the snapped design buys what it computed', () => {
    const exact = design({ mode: 'active', series: 'none' });
    for (const r of O.partsList(comp(exact), exact)) expect(r.standard).toBeCloseTo(P.snapToSeries(r.ideal, 'E24'), 15);
    const e96 = design({ mode: 'active', series: 'E96' });
    for (const r of O.partsList(comp(e96), e96)) expect(P.snapToSeries(r.standard, 'E96')).toBeCloseTo(r.standard, 12);
  });

  it('op-amps: one per stage, three for a state-variable stage', () => {
    expect(O.opAmpCount(c)).toBe(4);
    expect(O.opAmpCount(comp(design({ mode: 'active', topology: 'state-variable' })))).toBe(12);
    expect(O.opAmpCount(comp(design({ mode: 'active', alignment: 'butterworth', order: 3, topology: 'mfb' })))).toBe(4);
    expect(O.opAmpCount(comp(design({ mode: 'active', alignment: 'butterworth', order: 3, topology: 'state-variable' })))).toBe(8);
    expect(O.opAmpCount(comp(design({ mode: 'passive' })))).toBe(0);
  });
});

describe('bill of materials', () => {
  it('identical parts share a line and the quantities add up to the list', () => {
    const s = design({ mode: 'active', series: 'E24' });
    const c = comp(s);
    const rows = O.partsList(c, s);
    const bom = O.bomLines(rows, c, s);
    const parts = bom.filter((l) => !l.item.startsWith('Op-amp'));
    expect(parts.reduce((n, l) => n + l.qty, 0)).toBe(rows.length);
    expect(parts.length).toBeLessThan(rows.length);
    expect(new Set(parts.map((l) => l.item + l.note)).size).toBe(parts.length);
    const ops = bom.find((l) => l.item.startsWith('Op-amp'))!;
    expect(ops.qty).toBe(4);
    expect(ops.unit).toBe('pcs');
    expect(parts[0]!.note).toMatch(/5 % or better/);
    const e96 = design({ mode: 'active', series: 'E96' });
    expect(O.bomLines(O.partsList(comp(e96), e96), comp(e96), e96)[0]!.note).toMatch(/1 %/);
  });

  it('the same value with a different rating is a different line', () => {
    const s = design({ mode: 'passive' });
    const c = comp(s);
    const base = { ref: 'a', where: 'w', kind: 'Capacitor' as const, unit: 'F' as const, ideal: 1e-5, standard: 1e-5, errorPct: 0, note: '' };
    const lines = O.bomLines([{ ...base, rating: '63 V film' }, { ...base, ref: 'b', rating: '100 V film' }, { ...base, ref: 'c', rating: '63 V film' }], c, s);
    expect(lines.map((l) => l.qty).sort()).toEqual([1, 2]);
    expect(lines).toHaveLength(2);
  });

  it('passive: ratings split lines, no op-amp line', () => {
    const s = design({ mode: 'passive', dcr: true });
    const c = comp(s);
    const bom = O.bomLines(O.partsList(c, s), c, s);
    expect(bom.some((l) => l.item.startsWith('Op-amp'))).toBe(false);
    expect(bom.some((l) => /air core preferred/.test(l.note))).toBe(true);
    expect(bom.some((l) => / V film/.test(l.note))).toBe(true);
    expect(bom.reduce((n, l) => n + l.qty, 0)).toBe(8);
    const w = design({ mode: 'passive' });
    w.drivers[1] = { ...w.drivers[1]!, nomOhm: 4 };
    expect(O.bomLines(O.partsList(comp(w), w), comp(w), w).length).toBeGreaterThan(0);
  });
});

describe('CSV', () => {
  const parse = (text: string): string[][] => {
    const out: string[][] = [];
    let cur: string[] = [];
    let cell = '';
    let q = false;
    for (let i = 0; i < text.length; ++i) {
      const ch = text[i]!;
      if (q) {
        if (ch === '"' && text[i + 1] === '"') {
          cell += '"';
          ++i;
        } else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') {
        cur.push(cell);
        cell = '';
      } else if (ch === '\r') {
        // skip: the \n ends the row
      } else if (ch === '\n') {
        cur.push(cell);
        out.push(cur);
        cur = [];
        cell = '';
      } else cell += ch;
    }
    return out;
  };

  it('the parts list round-trips, with SI numbers a spreadsheet can read and commas quoted', () => {
    const s = design({ mode: 'passive' });
    const c = comp(s);
    const rows = O.partsList(c, s);
    const csv = O.partsCsv(rows);
    expect(csv.endsWith('\r\n')).toBe(true);
    const t = parse(csv);
    expect(t[0]).toEqual(['Ref', 'Where', 'Part', 'Ideal (SI)', 'Standard (SI)', 'Unit', 'Standard', 'Error %', 'Rating', 'Note']);
    expect(t).toHaveLength(rows.length + 1);
    t.slice(1).forEach((line, i) => {
      expect(line).toHaveLength(10);
      expect(line[0]).toBe(rows[i]!.ref);
      expect(line[1]).toBe(rows[i]!.where); // contains commas: it was quoted
      expect(Number(line[3])).toBe(rows[i]!.ideal);
      expect(Number(line[4])).toBe(rows[i]!.standard);
      expect(line[5]).toBe(rows[i]!.unit);
      expect(line[6]).toBe(O.eng(rows[i]!.standard, rows[i]!.unit));
      expect(Number(line[7])).toBeCloseTo(rows[i]!.errorPct, 2);
    });
    expect(csv).toContain('"');
  });

  it('quotes embedded quotes and line breaks; the bill of materials round-trips', () => {
    const line = (O.bomCsv([{ item: 'Say "hi", ok', qty: 2, unit: 'pcs', note: 'a\nb' }]));
    expect(parse(line)[1]).toEqual(['Say "hi", ok', '2', 'pcs', 'a\nb']);
    expect(parse(O.bomCsv([]))).toEqual([['Item', 'Qty', 'Unit', 'Note']]);
  });

  it('file names are slugged', () => {
    expect(O.outputName('My Rig #2', 'parts', 'csv')).toBe('my-rig-2-crossover-parts.csv');
    expect(O.outputName('', 'schematic', 'svg')).toBe('project-crossover-schematic.svg');
  });
});

describe('schematic', () => {
  it('passive: every way, its parts and its driver are drawn, well formed and inside the canvas', () => {
    const s = design({ mode: 'passive', dcr: true });
    s.drivers[0] = { ...s.drivers[0]!, name: 'Woofer & <sub>' };
    const c = comp(s);
    const svg = O.schematicSvg(c, s, 'My "rig"');
    wellFormed(svg);
    inside(svg);
    expect(svg).toContain('<title>My &quot;rig&quot;</title>');
    expect(svg).toContain('passive networks');
    expect(svg).toContain('Woofer &amp; &lt;sub&gt;');
    for (const w of c.passive!) for (const b of w.network) expect(svg).toContain(`>${b.name}</text>`);
    for (const w of c.passive!) for (const v of P.networkValues(w.network)) expect(svg).toContain(O.eng(v.value, v.type === 'C' ? 'F' : 'H'));
    expect(svg).toContain('8 Ω, 0 mH');
  });

  it('passive: a band-pass, a Zobel and a pad are all drawn', () => {
    const three = X.startingPoint(design({ mode: 'passive', zobel: true, dcr: false }), 3);
    three.drivers = three.drivers.map((d) => ({ ...d, leMh: 0.5, padDb: 2 }));
    const svg = O.schematicSvg(comp(three), three);
    wellFormed(svg);
    inside(svg);
    for (const n of ['Zobel', 'Rs', 'Rp']) expect(svg).toContain(`>${n}</text>`);
    expect((svg.match(/<text [^>]*>IN<\/text>/g) ?? []).length).toBe(3);
  });

  for (const topology of P.TOPOLOGIES)
    it(`active ${topology}: every stage of every split is drawn with its parts`, () => {
      const s = design({ mode: 'active', alignment: 'butterworth', order: 3, topology, series: 'E24' });
      const c = comp(s);
      const svg = O.schematicSvg(c, s);
      wellFormed(svg);
      inside(svg);
      expect(svg).toContain('active circuits');
      const a = c.active![0]!;
      for (const d of [a.lp, a.hp]) {
        d.sections.forEach((sec, i) => {
          expect(svg).toContain(`Stage ${i + 1}: ${sec.order === 1 ? 'first order' : 'second order'}`);
          if (sec.topology === 'state-variable' && sec.order === 2) {
            expect(svg).toContain('Summing amplifier');
            expect(svg).toContain(`R ${O.eng(sec.res.r!, 'Ω')}`);
            return;
          }
          for (const [name, v] of Object.entries({ ...sec.res, ...sec.caps }))
            expect(svg, `${name} of stage ${i + 1}`).toContain(`>${O.eng(v, name.startsWith('r') ? 'Ω' : 'F')}</text>`);
        });
      }
      expect(svg).toContain('>OUT</text>');
      expect(svg).toContain('Split 1 at 2500 Hz, low-pass');
      expect(svg).toContain('Split 1 at 2500 Hz, high-pass');
    });

  it('active: the gain-setting resistors of a Sallen-Key stage appear only when it has gain', () => {
    const eq = design({ mode: 'active', topology: 'sk-equal' });
    const un = design({ mode: 'active', topology: 'sk-unity' });
    expect(O.schematicSvg(comp(eq), eq)).toContain('>RF</text>');
    expect(O.schematicSvg(comp(un), un)).not.toContain('>RF</text>');
  });

  it('state-variable: the output is taken from the low-pass for a low-pass and from the high-pass for a high-pass', () => {
    const s = design({ mode: 'active', topology: 'state-variable', alignment: 'butterworth', order: 2 });
    const svg = O.schematicSvg(comp(s), s);
    expect((svg.match(/>OUT<\/text>/g) ?? []).length).toBe(2);
    expect(svg).toContain('LP back to the summing amplifier');
  });

  it('state-variable: the output tap sits at the low-pass end of a low-pass row and at the high-pass node of a high-pass row', () => {
    const s = design({ mode: 'active', topology: 'state-variable', alignment: 'butterworth', order: 2 });
    const svg = O.schematicSvg(comp(s), s);
    const texts = [...svg.matchAll(/<text x="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({ x: Number(m[1]), t: m[2]! }));
    const summing = texts.filter((x) => x.t === 'Summing amplifier').map((x) => x.x);
    const outs = texts.filter((x) => x.t === 'OUT').map((x) => x.x);
    expect(summing).toHaveLength(2);
    expect(outs).toHaveLength(2);
    expect(outs[0]! - summing[0]!).toBeGreaterThan(400); // low-pass row: after the second integrator
    expect(outs[1]! - summing[1]!).toBeLessThan(200); // high-pass row: at the summing amplifier's output
  });

  it('an inductor with its resistance is one symbol with the resistance in brackets, not a second part', () => {
    const s = design({ mode: 'passive', dcr: true });
    const svg = O.schematicSvg(comp(s), s);
    expect(svg).not.toMatch(/>[\d.]+ [mkM]?Ω \(/);
    expect(svg).toMatch(/>[\d.]+ [mµ]H \([\d.]+ [mkM]?Ω\)</);
    expect((svg.match(/\(\d/g) ?? []).length).toBe(comp(s).passive!.flatMap((w) => P.networkValues(w.network).filter((v) => v.type === 'L')).length);
  });

  it('the size follows the content: more ways, a taller drawing', () => {
    const two = O.schematicSvg(comp(design({ mode: 'passive' })), design({ mode: 'passive' }));
    const s3 = X.startingPoint(design({ mode: 'passive' }), 3);
    const three = O.schematicSvg(comp(s3), s3);
    const h = (svg: string): number => Number(/height="([\d.]+)"/.exec(svg)![1]);
    expect(h(three)).toBeGreaterThan(h(two));
    expect(two.startsWith('<?xml')).toBe(true);
    expect(two.endsWith('</svg>\n')).toBe(true);
  });
});
