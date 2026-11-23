// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// "Compare box types": the same driver in other kinds of box, drawn over this one, with the plain figures of each in a table and a
// button to make one of them the design. Nothing here changes the design until a "Use this" is pressed.
import { useMemo, useState } from 'react';
import { Chart, niceScale } from './Chart';
import { type CompareMetrics, type CompareMode, COMPARE_KINDS, candidateFor, metricsOf } from './compare';
import { BOX_KINDS, type BoxKind, type Design, compute } from './model';

const label = (k: BoxKind): string => BOX_KINDS.find((b) => b.id === k)!.label;
const f0 = (v: number): string => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));
export const fmtHz = (m: CompareMetrics): string => (m.f3Hz === null ? 'below the plot' : m.hiHz === null ? `${f0(m.f3Hz)} Hz` : `${f0(m.f3Hz)} to ${f0(m.hiHz)} Hz`);

export function ComparePanel(p: { design: Design; wallM?: number; onUse: (d: Design) => void }) {
  const [mode, setMode] = useState<CompareMode>('alignment');
  const [picked, setPicked] = useState<BoxKind[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const kinds = COMPARE_KINDS.filter((k) => k !== p.design.type);
  const shown = picked.filter((k) => k !== p.design.type);

  const rows = useMemo(() => {
    const own = compute(p.design, p.wallM);
    const list = [{ key: 'this', name: 'This box', design: p.design, note: '', c: own, m: metricsOf(own, p.design) }];
    for (const k of shown) {
      const cand = candidateFor(p.design, k, mode);
      const c = compute(cand.design, p.wallM);
      list.push({ key: k, name: label(k), design: cand.design, note: cand.note, c, m: metricsOf(c, cand.design) });
    }
    return list;
  }, [p.design, p.wallM, mode, shown.join(',')]);

  const toggle = (k: BoxKind): void => setPicked(picked.includes(k) ? picked.filter((x) => x !== k) : [...picked, k]);
  const first = rows[0]!;
  const others = rows.slice(1).map((r, i) => ({ label: r.name, values: r.c.curves.responseDb, className: `overlay cmp cmp-${i + 1}` }));
  const over = (key: 'excursionMm' | 'impedanceOhm' | 'groupDelayMs') => rows.slice(1).map((r, i) => ({ label: r.name, values: r.c.curves[key], className: `overlay cmp cmp-${i + 1}` }));
  const top = (key: 'responseDb' | 'excursionMm' | 'impedanceOhm' | 'groupDelayMs'): number => Math.max(...rows.flatMap((r) => r.c.curves[key]));
  const respTop = Math.min(48, Math.max(6, Math.ceil((top('responseDb') + 1) / 6) * 6));
  const xmaxMm = first.m.xmaxMm;
  const exc = niceScale(Math.min(Math.max(top('excursionMm'), xmaxMm * 1.2), xmaxMm * 3));
  const imp = niceScale(top('impedanceOhm'));
  const gd = niceScale(Math.min(Math.max(top('groupDelayMs'), 1), 100));
  const common = { freqs: first.c.freqs, hover, onHover: setHover };

  return (
    <section className="comparepanel" aria-label="Compare box types">
      <h2>Compare box types</h2>
      <p className="hint">The same driver in other boxes, drawn over this one (the amber curve is this box). <b>Cookbook alignment</b> sizes each box for this driver; <b>Same air</b> keeps this box's air and only changes the type. The -3 dB edges are measured from each response's own peak. Nothing changes in your design until you press Use this.</p>
      <div className="actions">
        <div className="segmented" role="radiogroup" aria-label="How the other boxes are sized">
          <button type="button" role="radio" aria-checked={mode === 'alignment'} className={mode === 'alignment' ? 'on' : ''} onClick={() => setMode('alignment')}>
            Cookbook alignment
          </button>
          <button type="button" role="radio" aria-checked={mode === 'same-air'} className={mode === 'same-air' ? 'on' : ''} onClick={() => setMode('same-air')}>
            Same air
          </button>
        </div>
        {kinds.map((k) => (
          <label key={k}>
            <input type="checkbox" checked={picked.includes(k)} onChange={() => toggle(k)} /> {label(k)}
          </label>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="hint">Tick one or more box types to compare them with this {label(p.design.type).toLowerCase()} box.</p>
      ) : (
        <>
          <div className="charts">
            <Chart {...common} title="Response" unit="dB" values={first.c.curves.responseDb} overlays={others} yMin={-36} yMax={respTop} yStep={respTop > 24 ? 12 : 6} />
            <Chart {...common} title={`Cone excursion at ${f0(p.design.powerW)} W`} unit="mm peak" values={first.c.curves.excursionMm} overlays={over('excursionMm')} yMin={0} yMax={exc.max} yStep={exc.step} hLine={{ y: xmaxMm, label: 'Xmax' }} />
            <Chart {...common} title="Impedance" unit="Ω" values={first.c.curves.impedanceOhm} overlays={over('impedanceOhm')} yMin={0} yMax={imp.max} yStep={imp.step} />
            <Chart {...common} title="Group delay" unit="ms" values={first.c.curves.groupDelayMs} overlays={over('groupDelayMs')} yMin={0} yMax={gd.max} yStep={gd.step} />
          </div>
          <table className="comparetable">
            <thead>
              <tr>
                <th scope="col" className="left">Box</th>
                <th scope="col">Air L</th>
                <th scope="col">Tuning Hz</th>
                <th scope="col">-3 dB</th>
                <th scope="col">Ripple dB</th>
                <th scope="col">Peak cone mm</th>
                <th scope="col">of Xmax</th>
                <th scope="col">Peak delay ms</th>
                <th scope="col">Warnings</th>
                <th scope="col" className="left"><span className="sr-only">Use</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key} className={i === 0 ? 'this' : `cmp-row cmp-${i}`}>
                  <th scope="row" className="left">{r.name}</th>
                  <td>{f0(r.m.volumeL)}</td>
                  <td>{r.design.type === 'sealed' ? '-' : f0(r.design.tuneHz)}</td>
                  <td>{fmtHz(r.m)}</td>
                  <td>{r.m.rippleDb.toFixed(1)}</td>
                  <td>{f0(r.m.excursionMm)}</td>
                  <td>{Math.round(r.m.excursionRatio * 100)} %</td>
                  <td>{f0(r.m.groupDelayPeakMs)}</td>
                  <td>{r.m.warnings}</td>
                  <td className="left">{i > 0 && <button type="button" onClick={() => p.onUse(r.design)}>Use this</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.filter((r) => r.note).map((r) => (
            <p key={r.key} className="hint">
              {r.name}: {r.note}
            </p>
          ))}
        </>
      )}
    </section>
  );
}
