// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// "Compare crossovers": the current drivers and crossover points through other orders, other alignments or the other kind of network,
// drawn over the current one, with a table of plain figures and a button to take one. Nothing changes until Use this is pressed.
import * as P from '@soundsystemdesigner/physics';
import { useMemo, useState } from 'react';
import { Chart } from './Chart';
import type { XoState } from './crossover';
import { ALIGN_NAME, type Variant, type VariantSpec, type XoMode, computeVariant, presetSpecs, specKey, specOf, validOrders, variantProblem } from './xocompare';

const MAX_VARIANTS = 4;
const f1 = (v: number): string => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));
const dash = '-';

export function XoComparePanel(p: { xo: XoState; onUse: (s: XoState) => void }) {
  const [extra, setExtra] = useState<VariantSpec[]>([]);
  const [mode, setMode] = useState<XoMode>('passive');
  const [alignment, setAlignment] = useState<P.Alignment>('butterworth');
  const [order, setOrder] = useState(3);
  const [msg, setMsg] = useState('');
  const [hover, setHover] = useState<number | null>(null);
  const curKey = specKey(specOf(p.xo));
  const shown = extra.filter((v) => specKey(v) !== curKey);

  const rows: Variant[] = useMemo(() => [computeVariant(p.xo, specOf(p.xo)), ...shown.map((v) => computeVariant(p.xo, v))], [p.xo, shown.map(specKey).join(',')]);
  const first = rows[0]!;
  const orders = validOrders(mode, alignment);

  const add = (): void => {
    const v = { mode, alignment, order };
    const problem = variantProblem(v);
    if (problem) return setMsg(problem);
    if (specKey(v) === curKey) return setMsg('That is the crossover on the page already.');
    if (extra.some((x) => specKey(x) === specKey(v))) return setMsg('That variant is already in the list.');
    if (shown.length >= MAX_VARIANTS) return setMsg(`Up to ${MAX_VARIANTS} variants at a time: remove one first.`);
    setMsg('');
    setExtra([...extra, v]);
  };
  const preset = (kind: 'orders' | 'alignments' | 'modes'): void => {
    const list = presetSpecs(p.xo, kind).slice(0, MAX_VARIANTS);
    setMsg(list.length === 0 ? 'Nothing else to compare for these settings.' : '');
    setExtra(list);
  };
  const pickMode = (m: XoMode): void => {
    setMode(m);
    const o = validOrders(m, alignment);
    if (!o.includes(order)) setOrder(o[o.length > 2 ? 2 : o.length - 1] ?? 1);
  };
  const pickAlignment = (a: P.Alignment): void => {
    setAlignment(a);
    const o = validOrders(mode, a);
    if (!o.includes(order)) setOrder(o[o.length > 2 ? 2 : o.length - 1] ?? 1);
  };

  const cls = (i: number) => `overlay cmp cmp-${i}`;
  const over = (get: (v: Variant) => number[] | null) => rows.slice(1).flatMap((r, i) => (get(r) ? [{ label: r.label, values: get(r)!, className: cls(i + 1) }] : []));
  const sumTop = Math.ceil((Math.max(...rows.flatMap((r) => r.c.sumDb)) + 3) / 10) * 10;
  const clampMs = (a: readonly number[]): number[] => a.map((x) => Math.max(-5, Math.min(20, x)));
  const zRows = p.xo.mode === 'passive' ? rows.filter((r, i) => i === 0 || r.c.zAmp) : [];
  const zMax = Math.max(5, ...zRows.flatMap((r) => r.c.zAmp ?? []));
  const common = { freqs: first.c.freqs, hover, onHover: setHover };
  const best = Math.min(...rows.filter((r) => !r.m.error).map((r) => r.m.rmsFlatDb));

  return (
    <section className="comparepanel xocompare no-print" aria-label="Compare crossovers">
      <h2>Compare crossovers</h2>
      <p className="hint">
        Your drivers and crossover points through other orders, other alignments, or the other kind of network, drawn over this crossover (the amber curve). Add variants, or use a preset. Passive variants use the simple driver model (voice-coil resistance and inductance plus a resonance) unless you loaded measured files in the Drivers section. Nothing changes until you press Use this.
      </p>
      <div className="actions">
        <button type="button" onClick={() => preset('orders')}>Orders 1 to 4</button>
        <button type="button" onClick={() => preset('alignments')}>Every alignment at this order</button>
        <button type="button" onClick={() => preset('modes')}>Active against passive</button>
        <button type="button" onClick={() => { setExtra([]); setMsg(''); }} disabled={extra.length === 0}>Clear</button>
      </div>
      <div className="actions">
        <label>
          Network{' '}
          <select value={mode} onChange={(e) => pickMode(e.target.value as XoMode)}>
            <option value="active">Active</option>
            <option value="passive">Passive</option>
          </select>
        </label>
        <label>
          Alignment{' '}
          <select value={alignment} onChange={(e) => pickAlignment(e.target.value as P.Alignment)}>
            {P.ALIGNMENTS.map((a) => (
              <option key={a} value={a}>
                {ALIGN_NAME[a]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Order{' '}
          <select value={order} onChange={(e) => setOrder(Number(e.target.value))}>
            {orders.map((o) => (
              <option key={o} value={o}>
                {o} ({6 * o} dB/oct)
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={add}>Add variant</button>
      </div>
      {msg && <p className="hint" role="status">{msg}</p>}
      {shown.length === 0 ? (
        <p className="hint">Pick a preset or add a variant to compare it with this crossover ({first.label}).</p>
      ) : (
        <>
          <div className="charts">
            <Chart {...common} title="Summed level" unit="dB SPL" values={first.c.sumDb} overlays={over((r) => r.c.sumDb)} yMin={sumTop - 60} yMax={sumTop} yStep={10} />
            <Chart {...common} title="Summed phase" unit="deg" values={first.c.sumPhaseDeg} overlays={over((r) => r.c.sumPhaseDeg)} yMin={-180} yMax={180} yStep={60} />
            <Chart {...common} title="Summed group delay" unit="ms" values={clampMs(first.c.sumDelayMs)} overlays={over((r) => clampMs(r.c.sumDelayMs))} yMin={-5} yMax={20} yStep={5} />
            {first.c.zAmp && zRows.length > 0 && (
              <Chart {...common} title="Impedance the amplifier sees" unit="Ω" values={first.c.zAmp} overlays={over((r) => r.c.zAmp)} yMin={0} yMax={zMax} yStep={zMax / 5} hLine={{ y: p.xo.ampMinLoadOhm, label: 'amp minimum' }} />
            )}
          </div>
          <table className="comparetable">
            <thead>
              <tr>
                <th scope="col" className="left">Crossover</th>
                <th scope="col">Sum flatness dB rms</th>
                <th scope="col">Filter sum off 0 dB</th>
                <th scope="col">Upper driver</th>
                <th scope="col">Peak delay ms</th>
                <th scope="col">Stages / parts</th>
                <th scope="col">Passband loss dB</th>
                <th scope="col">Amp min Ω</th>
                <th scope="col">Hottest part W</th>
                <th scope="col">Warnings</th>
                <th scope="col" className="left"><span className="sr-only">Use</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key} className={i === 0 ? 'this' : `cmp-row cmp-${i}`}>
                  <th scope="row" className="left">{i === 0 ? `This: ${r.label}` : r.label}</th>
                  {r.m.error ? (
                    <td colSpan={8} className="left">{r.m.error}</td>
                  ) : (
                    <>
                      <td className={r.m.rmsFlatDb === best ? 'best' : undefined}>{r.m.rmsFlatDb.toFixed(2)}</td>
                      <td>{r.m.filterDevDb.toFixed(2)}</td>
                      <td>{r.m.reversed ? 'reversed' : 'normal'}</td>
                      <td>{f1(r.m.groupDelayPeakMs)}</td>
                      <td>{r.m.stages !== null ? `${r.m.stages} stages` : r.m.parts !== null ? `${r.m.parts} parts` : dash}</td>
                      <td>{r.spec.mode === 'passive' ? r.m.passbandLossDb.toFixed(2) : dash}</td>
                      <td>{r.m.ampMinOhm !== null ? f1(r.m.ampMinOhm) : dash}</td>
                      <td>{r.m.hottestPartW !== null ? r.m.hottestPartW.toFixed(2) : dash}</td>
                      <td>{r.m.warnings}</td>
                    </>
                  )}
                  <td className="left">{i > 0 && !r.m.error && <button type="button" onClick={() => p.onUse(r.state)}>Use this</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">Sum flatness is the shape error of the summed level over the crossover region (lower is flatter). Filter sum off 0 dB is how far the filters alone sum from 0 dB within an octave of a crossover. A variant that cannot be built says why in its row.</p>
        </>
      )}
    </section>
  );
}
