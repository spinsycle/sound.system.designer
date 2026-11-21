// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The crossover page: choose the ways, the alignment and the frequencies, then either active circuits (parts for every stage) or
// passive networks (parts for every way, with the real driver impedance), and read the summed response, polarity, impedance and
// warnings. Spec: "Crossover filters" to "Crossover optimiser".
import * as P from '@soundsystemdesigner/physics';
import { useMemo, useState } from 'react';
import { Field } from './BoxDesigner';
import { Chart } from './Chart';
import {
  ROLES,
  ROLE_LABEL,
  SERIES,
  WIRINGS,
  XO_RANGES,
  type Role,
  type XoDriver,
  type XoState,
  computeCrossover,
  optimisePassive,
  sanitizeXo,
  startingPoint,
  storeCurve,
  wantedPolarities,
  xoverUsed,
} from './crossover';
import { applyOptions, applyToDesign } from './crossoverapply';
import { applyImport, importFromDesign } from './crossoverimport';
import { bomCsv, bomLines, eng, outputName, partsCsv, partsList, schematicSvg } from './crossoveroutput';
import { openText, saveText } from './desktop';
import { type Project, sanitizeProject } from './system';

const fmt = (v: number, digits = 1): string => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(digits));

const unitOf = (type: P.PartType): 'Ω' | 'F' | 'H' => (type === 'R' ? 'Ω' : type === 'C' ? 'F' : 'H');

function Select<T extends string>({ id, label, value, options, onPick }: { id: string; label: string; value: T; options: readonly { id: T; label: string }[]; onPick: (v: T) => void }) {
  return (
    <div className="field stacked">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onPick(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

const ALIGN_LABEL: Record<P.Alignment, string> = { butterworth: 'Butterworth', 'linkwitz-riley': 'Linkwitz-Riley', bessel: 'Bessel', chebyshev: 'Chebyshev' };
const TOPOLOGY_LABEL: Record<P.Topology, string> = { 'sk-equal': 'Sallen-Key, equal parts', 'sk-unity': 'Sallen-Key, unity gain', mfb: 'Multiple feedback', 'state-variable': 'State-variable' };

export function CrossoverView({ project, onChange, onApply, canUndo, onUndo }: { project: Project; onChange: (p: Project) => void; onApply: (p: Project) => void; canUndo: boolean; onUndo: () => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(0);
  const xo = project.xo;
  const c = useMemo(() => computeCrossover(xo), [xo]);
  const used = xoverUsed(xo);
  const imports = (['system', 'speaker', 'car'] as const).map((kind) => ({ kind, imp: importFromDesign(project, kind) }));

  const setXo = (next: XoState): void => onChange(sanitizeProject({ ...project, xo: sanitizeXo(next) }));
  const set = (patch: Partial<XoState>): void => setXo({ ...xo, ...patch });
  const setDriver = (k: number, patch: Partial<XoDriver>): void => set({ drivers: xo.drivers.map((d, i) => (i === k ? { ...d, ...patch } : d)) });
  const passive = xo.mode === 'passive';

  const loadCurve = (k: number, kind: P.CurveKind): void => {
    void openText(['txt', 'csv', 'zma', 'frd', 'tsv', 'dat']).then((r) => {
      if (!r.ok) return setMsg(r.cancelled ? '' : r.error);
      const parsed = P.parseCurve(r.text, kind);
      if (!parsed.ok) return setMsg(`${r.name}: ${parsed.error}`);
      setDriver(k, kind === 'zma' ? { zma: storeCurve(r.name, parsed.curve) } : { frd: storeCurve(r.name, parsed.curve) });
      setMsg(`${r.name}: ${parsed.curve.freqHz.length} points read${parsed.curve.phaseDeg ? '' : ', no phase column (phase taken as 0)'}.`);
    });
  };

  const levelDown = (): void => {
    const quietest = Math.min(...xo.drivers.slice(0, xo.ways).map((d) => d.sensDb));
    set({ drivers: xo.drivers.map((d, i) => (i < xo.ways ? { ...d, padDb: Math.round((d.sensDb - quietest) * 10) / 10 } : d)) });
  };
  const runOptimise = (): void => {
    const r = optimisePassive(xo);
    if ('error' in r) return setMsg(r.error);
    setXo(r.state);
    setMsg(`Optimised: the shape error went from ${fmt(r.before, 2)} to ${fmt(r.after, 2)} dB rms, the amplifier sees at least ${fmt(r.zMinOhm)} Ω.`);
  };

  const sumMax = Math.ceil((Math.max(...c.sumDb) + 3) / 10) * 10;
  const ways = c.ways.map((w, k) => ({ label: w.name, values: w.levelDb, className: `overlay band-line band-${k}` }));
  const filters = c.ways.map((w, k) => ({ label: w.name, values: w.filterDb, className: `overlay band-line band-${k}` }));
  const vLines = used.map((f, k) => ({ f, label: `x${k + 1}` }));
  const wanted = wantedPolarities(xo);
  const rows = useMemo(() => partsList(c, xo), [c, xo]);
  const bom = useMemo(() => bomLines(rows, c, xo), [rows, c, xo]);
  const svg = useMemo(() => schematicSvg(c, xo, project.name), [c, xo, project.name]);
  const download = (name: string, text: string, mime: string): void => {
    void saveText(name, text, mime).then((r) => setMsg(r.ok ? `Saved ${r.where}` : r.cancelled ? '' : r.error));
  };
  const zMax = c.zAmp ? Math.ceil(Math.max(...c.zAmp) / 5) * 5 : 0;

  return (
    <main>
      <div className="controls">
        <section>
          <h2>Crossover</h2>
          <div className="segmented" role="radiogroup" aria-label="Active or passive">
            {(['active', 'passive'] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={xo.mode === m} className={xo.mode === m ? 'on' : ''} onClick={() => set({ mode: m })}>
                {m === 'active' ? 'Active circuits' : 'Passive networks'}
              </button>
            ))}
          </div>
          <div className="segmented" role="radiogroup" aria-label="Number of ways">
            {[2, 3, 4].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={xo.ways === n} className={xo.ways === n ? 'on' : ''} onClick={() => setXo(startingPoint(xo, n))}>
                {n}-way
              </button>
            ))}
            <button type="button" onClick={() => setXo(startingPoint(xo, 2, true))}>
              Sub split
            </button>
          </div>
          {imports.map(({ kind, imp }) => (
            <button key={kind} type="button" disabled={!imp.ok} title={imp.ok ? '' : imp.reason} onClick={() => imp.ok && (setXo(applyImport(xo, imp)), setMsg(`Drivers and crossover points taken from the ${imp.label}.`))}>
              {imp.ok ? `Start from the ${imp.label}` : `Start from the ${{ system: 'PA system', speaker: 'home speaker', car: 'car fronts' }[kind]} (not available)`}
            </button>
          ))}
          {imports.filter((i) => !i.imp.ok).map(({ kind, imp }) => (
            <p key={kind} className="hint">
              {imp.ok ? '' : imp.reason}
            </p>
          ))}
          <Select id="xo-align" label="Alignment" value={xo.alignment} options={P.ALIGNMENTS.map((a) => ({ id: a, label: ALIGN_LABEL[a] }))} onPick={(alignment) => set({ alignment })} />
          <Field id="xo-order" range={XO_RANGES.order} value={xo.order} onChange={(v) => set({ order: Math.round(v) })} />
          {xo.alignment === 'chebyshev' && <Field id="xo-ripple" range={XO_RANGES.rippleDb} value={xo.rippleDb} onChange={(v) => set({ rippleDb: v })} />}
          {used.map((f, k) => (
            <Field key={k} id={`xo-x${k}`} slider range={{ ...XO_RANGES.xover, label: `Crossover ${k + 1} (${xo.drivers[k]!.name} to ${xo.drivers[k + 1]!.name})` }} value={f} onChange={(v) => set({ xover: xo.xover.map((x, i) => (i === k ? v : x)) })} />
          ))}
          <Select id="xo-series" label="Standard values" value={xo.series} options={SERIES.map((s) => ({ id: s, label: s === 'none' ? 'Exact values' : s }))} onPick={(series) => set({ series })} />
          {!passive ? (
            <>
              <Select id="xo-topo" label="Circuit" value={xo.topology} options={P.TOPOLOGIES.map((t) => ({ id: t, label: TOPOLOGY_LABEL[t] }))} onPick={(topology) => set({ topology })} />
              <Field id="xo-cap" range={XO_RANGES.capNf} value={xo.capNf} onChange={(v) => set({ capNf: v })} />
              <label className="checks">
                <input type="checkbox" checked={xo.alignDelay} onChange={(e) => set({ alignDelay: e.target.checked })} />
                Delay the nearer drivers so every sound arrives together
              </label>
            </>
          ) : (
            <>
              <label className="checks">
                <input type="checkbox" checked={xo.zobel} onChange={(e) => set({ zobel: e.target.checked })} />
                Zobel across each driver
              </label>
              <label className="checks">
                <input type="checkbox" checked={xo.dcr} onChange={(e) => set({ dcr: e.target.checked })} />
                Count the resistance of each inductor
              </label>
              <Field id="xo-amp" range={XO_RANGES.ampPowerW} value={xo.ampPowerW} onChange={(v) => set({ ampPowerW: v })} />
              <Field id="xo-amin" range={XO_RANGES.ampMinLoadOhm} value={xo.ampMinLoadOhm} onChange={(v) => set({ ampMinLoadOhm: v })} />
              <button type="button" onClick={runOptimise}>
                Optimise the parts
              </button>
              <button type="button" disabled={xo.tuned === null} onClick={() => set({ tuned: null })}>
                Back to the textbook values
              </button>
              <p className="hint">Moves each inductor and capacitor (up to 4x either way) so the summed response is flattest, keeping the amplifier above its minimum load, then snaps to the standard values chosen above.</p>
            </>
          )}
          {msg && (
            <p className="hint" role="status">
              {msg}
            </p>
          )}
        </section>

        <section className="no-print">
          <h2>Apply to the design</h2>
          <p className="hint">Writes this alignment, order and crossover frequencies into the page you choose (it never adds a band or a driver, so the number of ways must match).</p>
          {applyOptions(project).map((o) => (
            <div key={o.target}>
              <button
                type="button"
                disabled={!o.ok}
                title={o.hint}
                onClick={() => {
                  const r = applyToDesign(project, o.target);
                  if (!r.ok) return setMsg(r.reason);
                  onApply(r.project);
                  setMsg(r.message);
                }}
              >
                {o.label}
              </button>
              {!o.ok && <p className="hint">{o.hint}</p>}
            </div>
          ))}
          <button type="button" disabled={!canUndo} onClick={onUndo}>
            Undo last load
          </button>
        </section>

        <section>
          <h2>Drivers</h2>
          <button type="button" onClick={levelDown}>
            Level the drivers to the quietest
          </button>
          {xo.drivers.slice(0, xo.ways).map((d, k) => (
            <details key={k} open={open === k} onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && setOpen(k)}>
              <summary>
                <span className={`swatch band-${k}`} /> {d.name} <span className="hint">({ROLE_LABEL[d.role]}, {fmt(d.sensDb)} dB)</span>
              </summary>
              <div className="field stacked">
                <label htmlFor={`d${k}-name`}>Name</label>
                <input id={`d${k}-name`} type="text" value={d.name} maxLength={60} onChange={(e) => setDriver(k, { name: e.target.value })} />
              </div>
              <Select id={`d${k}-role`} label="Kind" value={d.role} options={ROLES.map((r) => ({ id: r, label: ROLE_LABEL[r] }))} onPick={(role: Role) => setDriver(k, { role })} />
              <Field id={`d${k}-nom`} range={XO_RANGES.nomOhm} value={d.nomOhm} onChange={(v) => setDriver(k, { nomOhm: v })} />
              <Field id={`d${k}-re`} range={XO_RANGES.reOhm} value={d.reOhm} onChange={(v) => setDriver(k, { reOhm: v })} />
              <Field id={`d${k}-le`} range={XO_RANGES.leMh} value={d.leMh} onChange={(v) => setDriver(k, { leMh: v })} />
              <button type="button" onClick={() => setDriver(k, { leMh: Math.round(P.estimateLeH({ re: d.reOhm, sd: { sub: 0.08, woofer: 0.05, mid: 0.012, tweeter: 0.0004 }[d.role] }) * 1e6) / 1000 })}>
                Estimate the inductance
              </button>
              <Field id={`d${k}-fs`} range={XO_RANGES.fsHz} value={d.fsHz} onChange={(v) => setDriver(k, { fsHz: v })} />
              <Field id={`d${k}-qts`} range={XO_RANGES.qts} value={d.qts} onChange={(v) => setDriver(k, { qts: v })} />
              <Field id={`d${k}-qms`} range={XO_RANGES.qms} value={d.qms} onChange={(v) => setDriver(k, { qms: v })} />
              <Field id={`d${k}-sens`} range={XO_RANGES.sensDb} value={d.sensDb} onChange={(v) => setDriver(k, { sensDb: v })} />
              <Field id={`d${k}-up`} range={XO_RANGES.upperHz} value={d.upperHz} onChange={(v) => setDriver(k, { upperHz: v })} />
              <Field id={`d${k}-back`} range={XO_RANGES.setBackMm} value={d.setBackMm} onChange={(v) => setDriver(k, { setBackMm: v })} />
              <Field id={`d${k}-pad`} range={XO_RANGES.padDb} value={d.padDb} onChange={(v) => setDriver(k, { padDb: v })} />
              <Select id={`d${k}-wire`} label="Wiring" value={d.wiring} options={WIRINGS.map((w) => ({ id: w, label: w === 'auto' ? `As the alignment wants (${c.polarity[k]! < 0 ? 'reversed' : 'normal'})` : w === 'normal' ? 'Normal' : 'Reversed' }))} onPick={(wiring) => setDriver(k, { wiring })} />
              <h3>Measurements</h3>
              <p className="hint">
                Impedance: {d.zma ? `${d.zma.name}, ${d.zma.freqHz.length} points` : 'the model above'}. Response: {d.frd ? `${d.frd.name}, ${d.frd.freqHz.length} points` : 'the model above'}.
              </p>
              <button type="button" onClick={() => loadCurve(k, 'zma')}>
                Load impedance file
              </button>
              <button type="button" disabled={!d.zma} onClick={() => setDriver(k, { zma: null })}>
                Remove it
              </button>
              <button type="button" onClick={() => loadCurve(k, 'frd')}>
                Load response file
              </button>
              <button type="button" disabled={!d.frd} onClick={() => setDriver(k, { frd: null })}>
                Remove it
              </button>
            </details>
          ))}
        </section>
      </div>

      <div className="charts one">
        <div className="charts one no-print">
        <Chart title="Summed level, with each driver" unit="dB SPL" freqs={c.freqs} values={c.sumDb} overlays={ways} yMin={sumMax - 60} yMax={sumMax} yStep={10} vLines={vLines} hover={hover} onHover={setHover} />
        <Chart title="Each way's filter, and their sum" unit="dB" freqs={c.freqs} values={c.filterSumDb} overlays={filters} yMin={-60} yMax={6} yStep={6} vLines={vLines} hover={hover} onHover={setHover} />
        <div className="charts">
          <Chart title="Summed phase" unit="deg" freqs={c.freqs} values={c.sumPhaseDeg} yMin={-180} yMax={180} yStep={60} vLines={vLines} hover={hover} onHover={setHover} />
          <Chart title="Summed group delay" unit="ms" freqs={c.freqs} values={c.sumDelayMs.map((x) => Math.max(-5, Math.min(20, x)))} yMin={-5} yMax={20} yStep={5} vLines={vLines} hover={hover} onHover={setHover} />
          {c.zAmp && <Chart title="Impedance the amplifier sees" unit="Ω" freqs={c.freqs} values={c.zAmp} yMin={0} yMax={Math.max(zMax, 5)} yStep={Math.max(zMax, 5) / 5} hLine={{ y: xo.ampMinLoadOhm, label: 'amp minimum' }} vLines={vLines} hover={hover} onHover={setHover} />}
        </div>

        </div>

        <section>
          <h2>Polarity and timing</h2>
          <table>
            <thead>
              <tr>
                <th className="left">Driver</th>
                <th className="left">Wired</th>
                <th className="left">Alignment wants</th>
                <th>Delay applied</th>
                <th>Set back</th>
              </tr>
            </thead>
            <tbody>
              {xo.drivers.slice(0, xo.ways).map((d, k) => (
                <tr key={k}>
                  <td className="left">{d.name}</td>
                  <td className="left">{c.polarity[k]! < 0 ? 'reversed' : 'normal'}</td>
                  <td className="left">{wanted[k]! < 0 ? 'reversed' : 'normal'}</td>
                  <td>{fmt(c.delayMs[k]!, 2)} ms</td>
                  <td>{fmt(d.setBackMm, 0)} mm</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">
            {c.advice.map((a) => `${a.upper} ${a.invertUpper ? 'reversed' : 'normal'} relative to ${a.lower}`).join('; ')}. Summed shape error over the crossover region: {fmt(c.rmsFlatDb, 2)} dB rms.
          </p>
        </section>

        {c.active && (
          <section>
            <h2>Circuits</h2>
            {c.active.map((a) => (
              <div key={a.split}>
                <h3>
                  Split {a.split + 1} at {fmt(a.fcHz, 0)} Hz{a.snapped ? ` (${xo.series} values)` : ''}
                </h3>
                {([['Low-pass', a.lp, a.lpError], ['High-pass', a.hp, a.hpError]] as const).map(([label, d, e]) => (
                  <div key={label}>
                    <p className="hint">
                      {label}: {d.inverts ? 'inverts, ' : ''}trim after the stages {fmt(P.dB(d.trim), 2)} dB. {a.snapped ? `Error against the ideal filter: ${fmt(e.maxDb, 2)} dB at worst, ${fmt(e.maxDbTrimmed, 2)} dB once the level is trimmed.` : ''}
                    </p>
                    <table>
                      <tbody>
                        {d.sections.map((s, i) => (
                          <tr key={i}>
                            <th scope="row" className="left">
                              Stage {i + 1}: {s.order === 1 ? 'first order' : `second order, Q ${fmt(s.q, 2)}`}, {fmt(s.f0, 0)} Hz
                            </th>
                            <td className="left">
                              {[...Object.entries(s.res), ...Object.entries(s.caps)].map(([name, v]) => `${name.toUpperCase()} ${eng(v, name.startsWith('r') ? 'Ω' : 'F')}`).join(', ')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            ))}
          </section>
        )}

        {c.passive && (
          <section>
            <h2>Networks</h2>
            {c.passive.map((w, k) => (
              <div key={k}>
                <h3>
                  <span className={`swatch band-${k}`} /> {w.name}: {w.kind}
                </h3>
                <table>
                  <thead>
                    <tr>
                      <th className="left">Part</th>
                      <th className="left">Value</th>
                      <th>Volts rms</th>
                      <th>Amps rms</th>
                      <th>Heat</th>
                      <th>Capacitor rating</th>
                    </tr>
                  </thead>
                  <tbody>
                    {w.network.map((b, i) => (
                      <tr key={i}>
                        <td className="left">
                          {b.name} ({b.kind})
                        </td>
                        <td className="left">{b.groups.flat().map((p) => eng(p.value, unitOf(p.type))).join(' + ')}</td>
                        <td>{fmt(w.stress[i]!.vRms)}</td>
                        <td>{fmt(w.stress[i]!.iRms, 2)}</td>
                        <td>{fmt(w.stress[i]!.powerW, 2)} W</td>
                        <td>{b.groups.flat().some((p) => p.type === 'C') ? (P.capacitorVoltageRating(w.stress[i]!.vRms) === Infinity ? 'too high' : `${P.capacitorVoltageRating(w.stress[i]!.vRms)} V`) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            <p className="hint">Volts, amps and heat are the worst over 20 Hz to 20 kHz at the amplifier's full power into the lowest nominal impedance. Inductors should be rated for 1.5 times the peak current.</p>
          </section>
        )}

        <section>
          <h2>Schematic, parts and bill of materials</h2>
          <div className="actions no-print">
            <button type="button" onClick={() => download(outputName(project.name, 'schematic', 'svg'), svg, 'image/svg+xml')}>
              Download schematic (SVG)
            </button>
            <button type="button" onClick={() => download(outputName(project.name, 'parts', 'csv'), partsCsv(rows), 'text/csv')}>
              Download parts list (CSV)
            </button>
            <button type="button" onClick={() => download(outputName(project.name, 'bom', 'csv'), bomCsv(bom), 'text/csv')}>
              Download bill of materials (CSV)
            </button>
            <button type="button" onClick={() => window.print()}>
              Export PDF (print)
            </button>
          </div>
          {rows.length === 0 ? (
            <p className="hint">There is no design to draw: see the notes below.</p>
          ) : (
            <>
              <div className="schematic" role="img" aria-label="Schematic of the crossover" dangerouslySetInnerHTML={{ __html: svg.replace(/^<\?xml[^>]*>\s*/, '') }} />
              <h3>Bill of materials</h3>
              <table>
                <thead>
                  <tr>
                    <th className="left">Item</th>
                    <th>Qty</th>
                    <th className="left">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {bom.map((l) => (
                    <tr key={l.item + l.note}>
                      <td className="left">{l.item}</td>
                      <td>{l.qty}</td>
                      <td className="left note-cell">{l.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3>Parts list</h3>
              <table>
                <thead>
                  <tr>
                    <th className="left">Ref</th>
                    <th className="left">Part</th>
                    <th>Design</th>
                    <th>Standard</th>
                    <th>Error</th>
                    <th className="left">Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.ref}>
                      <td className="left" title={r.where}>
                        {r.ref}
                      </td>
                      <td className="left">{r.kind}</td>
                      <td>{eng(r.ideal, r.unit)}</td>
                      <td>{eng(r.standard, r.unit)}</td>
                      <td>{r.errorPct.toFixed(1)} %</td>
                      <td className="left">{r.rating}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="hint">Standard values are {xo.series === 'none' ? 'E24 (the page shows exact values)' : xo.series}. Inductor and capacitor ratings are at the amplifier's full power; a real inductor's resistance replaces the estimate. The CSV has every part with its row, its SI value and where it goes.</p>
            </>
          )}
        </section>

        {(c.warnings.length > 0 || c.notes.length > 0) && (
          <section>
            <h2>Check</h2>
            {c.warnings.length > 0 && (
              <ul className="warnings">
                {c.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            <ul className="notes">
              {c.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
