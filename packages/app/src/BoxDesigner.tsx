// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
import * as P from '@soundsystemdesigner/physics';
// One box or horn: driver, enclosure, plots. Edits a Design it is given; the app shell owns and stores it.
import { useMemo, useState } from 'react';
import { Chart, ProfileChart, niceScale } from './Chart';
import {
  BOX_KINDS,
  BOX_RANGES,
  type BoxField,
  CUSTOM_CLASS,
  CUSTOM_RANGES,
  type Design,
  FLARES,
  HORN_PRESETS,
  HORN_RANGES,
  type HornDesign,
  type HornField,
  PLOT_RANGES,
  type PlotRange,
  type Range,
  compute,
  sanitize,
} from './model';

export const show =(v: number): string => String(Number(v.toPrecision(4)));

/** A number box that accepts any typing and commits a clamped value on blur or Enter, with an optional slider. */
export function Field(p: { range: Range; value: number; onChange: (v: number) => void; slider?: boolean; id?: string; parse?: (text: string) => number | null }) {
  const [text, setText] = useState<string | null>(null);
  const { range: r } = p;
  const commit = (): void => {
    const v = p.parse ? (p.parse(text ?? '') ?? Number.NaN) : Number(text);
    if (text !== null && text.trim() !== '' && Number.isFinite(v)) p.onChange(P.clamp(v, r.min, r.max));
    setText(null);
  };
  const id = p.id ?? `f-${r.label.replace(/\W/g, '')}`;
  // slider position 0..1: linear for ranges that start at zero, logarithmic otherwise
  const toPos = (v: number): number => (r.linear ? (v - r.min) / (r.max - r.min) : Math.log(v / r.min) / Math.log(r.max / r.min));
  const fromPos = (t: number): number => (r.linear ? r.min + t * (r.max - r.min) : r.min * (r.max / r.min) ** t);
  return (
    <div className="field">
      <label htmlFor={id}>{r.label}</label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={text ?? show(p.value)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        title={`${r.min} to ${r.max} ${r.unit}`}
      />
      <span className="unit">{r.unit}</span>
      {p.slider && (
        <input type="range" aria-label={`${r.label} slider`} min={0} max={1} step={0.001} value={toPos(p.value)} onChange={(e) => p.onChange(Number(fromPos(Number(e.target.value)).toPrecision(3)))} />
      )}
    </div>
  );
}

export function BoxDesigner({ design, onChange }: { design: Design; onChange: (d: Design) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const c = useMemo(() => compute(design), [design]);

  const set = (patch: Partial<Design>): void => onChange(sanitize({ ...design, ...patch }));
  const setHorn = (patch: Partial<HornDesign>): void => set({ horn: { ...design.horn, ...patch } });
  const isCustom = design.driverClass === CUSTOM_CLASS;
  const isHorn = design.type === 'horn';
  const flare = design.horn.flare;
  const d = c.driver;
  // the driver in datasheet units, in the Custom fields' order
  const sheet: P.CustomDriverFields = { fsHz: d.fs, qts: c.derived.qts, qms: d.qms, vasL: d.vasM3 * 1000, sdCm2: d.sd * 1e4, reOhm: d.re, xmaxMm: d.xmax * 1000, powerW: d.pe };
  // a rear-loaded horn (scoop) has no sealed rear chamber: the chamber behind the cone is the one that feeds the throat
  const isRear = isHorn && design.horn.loading === 'rear';
  const customKeys = Object.keys(CUSTOM_RANGES) as (keyof P.CustomDriverFields)[];
  const boxFields: BoxField[] = { sealed: ['volumeL'], ported: ['volumeL', 'tuneHz', 'portDiameterCm'], bandpass: ['volumeL', 'frontVolumeL', 'tuneHz', 'portDiameterCm'], horn: isRear ? [] : ['volumeL'] }[design.type] as BoxField[];
  const volumeLabel = { sealed: 'Volume', ported: 'Volume', bandpass: 'Rear volume', horn: 'Rear chamber' }[design.type];
  const hornFields: HornField[] = [...(flare === 'conical' ? [] : (['cutoffHz'] as HornField[])), ...(flare === 'hyperbolic' ? (['t'] as HornField[]) : []), 'throatCm2', 'mouthCm2', ...(flare === 'conical' ? (['lengthM'] as HornField[]) : []), 'throatChamberL'];

  const xmaxMm = d.xmax * 1000;
  const top = (k: 'responseDb' | 'excursionMm' | 'impedanceOhm' | 'groupDelayMs'): number => Math.max(...c.curves[k], ...(c.overlays[k] ?? []).flatMap((o) => o.values));
  const respTop = Math.min(48, Math.max(6, Math.ceil((top('responseDb') + 1) / 6) * 6));
  const exc = niceScale(Math.min(Math.max(top('excursionMm'), xmaxMm * 1.2), xmaxMm * 3));
  const imp = niceScale(top('impedanceOhm'));
  const gd = niceScale(Math.min(Math.max(top('groupDelayMs'), 1), 100));
  const common = { freqs: c.freqs, hover, onHover: setHover, vLines: c.markers };

  return (
      <main>
        <div className="controls">
          <section>
            <h2>Driver</h2>
            <div className="field">
              <label htmlFor="driver-class">Class</label>
              <select id="driver-class" value={design.driverClass} onChange={(e) => set({ driverClass: Number(e.target.value) })}>
                {P.ALL_DRIVER_CLASSES.map((k, i) => (
                  <option key={k.name} value={i}>
                    {k.name}
                  </option>
                ))}
                <option value={CUSTOM_CLASS}>Custom</option>
              </select>
            </div>
            {isCustom ? (
              <div className="grid2">
                {customKeys.map((k) => (
                  <Field key={k} range={CUSTOM_RANGES[k]} value={design.custom[k]} onChange={(v) => set({ custom: { ...design.custom, [k]: v } })} />
                ))}
              </div>
            ) : (
              <>
                <dl className="sheet">
                  {customKeys.map((k) => (
                    <div key={k}>
                      <dt>{CUSTOM_RANGES[k].label}</dt>
                      <dd>
                        {show(sheet[k])} {CUSTOM_RANGES[k].unit}
                      </dd>
                    </div>
                  ))}
                </dl>
                <button type="button" onClick={() => set({ driverClass: CUSTOM_CLASS, custom: sheet })}>
                  Edit as Custom
                </button>
              </>
            )}
            <dl className="sheet derived">
              <div>
                <dt>Qes</dt>
                <dd>{show(d.qes)}</dd>
              </div>
              <div>
                <dt>Bl</dt>
                <dd>{show(c.derived.bl)} T·m</dd>
              </div>
              <div>
                <dt>Mms</dt>
                <dd>{show(c.derived.mms * 1000)} g</dd>
              </div>
              <div>
                <dt>Cms</dt>
                <dd>{show(c.derived.cms * 1000)} mm/N</dd>
              </div>
            </dl>
          </section>

          <section>
            <h2>Box</h2>
            <div className="segmented" role="radiogroup" aria-label="Box type">
              {BOX_KINDS.map((k) => (
                <button key={k.id} type="button" role="radio" aria-checked={design.type === k.id} className={design.type === k.id ? 'on' : ''} onClick={() => set({ type: k.id })}>
                  {k.label}
                </button>
              ))}
            </div>
            {boxFields.map((k) => (
              <Field key={k} slider range={k === 'volumeL' ? { ...BOX_RANGES[k], label: volumeLabel } : BOX_RANGES[k]} value={design[k]} onChange={(v) => set({ [k]: v })} />
            ))}
            <Field slider range={BOX_RANGES.powerW} value={design.powerW} onChange={(v) => set({ powerW: v })} />
            <div className="field">
              <label htmlFor="plot-range">Plot range</label>
              <select id="plot-range" value={design.plotRange} onChange={(e) => set({ plotRange: e.target.value as PlotRange })}>
                {(Object.keys(PLOT_RANGES) as PlotRange[]).map((k) => (
                  <option key={k} value={k}>
                    {PLOT_RANGES[k].label}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {isHorn && (
            <section>
              <h2>Horn</h2>
              <div className="segmented" aria-label="Starting points">
                {HORN_PRESETS.map((s) => (
                  <button key={s.label} type="button" onClick={() => set(s.patch)}>
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="segmented" role="radiogroup" aria-label="Horn loading">
                {(['front', 'rear'] as const).map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={design.horn.loading === k} className={design.horn.loading === k ? 'on' : ''} onClick={() => setHorn({ loading: k })}>
                    {k === 'front' ? 'Front-loaded' : 'Rear-loaded (scoop)'}
                  </button>
                ))}
              </div>
              <div className="field">
                <label htmlFor="flare">Flare</label>
                <select id="flare" value={flare} onChange={(e) => setHorn({ flare: e.target.value as P.FlareKind })}>
                  {FLARES.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              {hornFields.map((k) => (
                <Field key={k} slider range={k === 'throatChamberL' && isRear ? { ...HORN_RANGES[k], label: 'Chamber behind cone' } : HORN_RANGES[k]} value={design.horn[k]} onChange={(v) => setHorn({ [k]: v })} />
              ))}
              {flare !== 'conical' && (
                <button type="button" onClick={() => setHorn({ mouthCm2: Math.ceil(P.hornMinMouthArea(design.horn.cutoffHz) * 1e4) })}>
                  Full-size mouth for the cutoff
                </button>
              )}
            </section>
          )}

          <section>
            <h2>Result</h2>
            <dl className="sheet wide">
              {c.readouts.map((r) => (
                <div key={r.label}>
                  <dt>{r.label}</dt>
                  <dd>{r.value}</dd>
                </div>
              ))}
            </dl>
            {c.warnings.length > 0 && (
              <ul className="warnings">
                {c.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            {c.notes.length > 0 && (
              <ul className="notes">
                {c.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </section>

          {c.horn && (
            <section>
              <h2>Panels</h2>
              <div className="field stacked">
                <label htmlFor="panels">Straight panel lengths along the centreline, cm</label>
                <input id="panels" type="text" className="left" placeholder="e.g. 40, 40, 50, 60 (empty: the ideal curve)" value={design.horn.panelsCm} onChange={(e) => setHorn({ panelsCm: e.target.value })} />
              </div>
              <Field range={HORN_RANGES.widthCm} value={design.horn.widthCm} onChange={(v) => setHorn({ widthCm: v })} />
              <table>
                <caption>{c.horn.built ? 'Areas at the panel joints' : 'The ideal flare at eight stations'}. No bend correction: lengths are along the centreline.</caption>
                <thead>
                  <tr>
                    <th scope="col">From throat, cm</th>
                    <th scope="col">Area, cm²</th>
                    <th scope="col">Height, cm</th>
                  </tr>
                </thead>
                <tbody>
                  {c.horn.table.map((row) => (
                    <tr key={row.xCm}>
                      <td>{row.xCm.toFixed(1)}</td>
                      <td>{row.areaCm2.toFixed(row.areaCm2 < 100 ? 1 : 0)}</td>
                      <td>{row.heightCm.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>

        <div className="charts">
          {c.horn && <ProfileChart lengthM={c.horn.lengthM} ideal={c.horn.ideal} built={c.horn.built} />}
          <Chart {...common} title="Response" unit="dB" values={c.curves.responseDb} overlays={c.overlays.responseDb} yMin={-36} yMax={respTop} yStep={respTop > 24 ? 12 : 6} />
          <Chart {...common} title={`Cone excursion at ${show(design.powerW)} W`} unit="mm peak" values={c.curves.excursionMm} overlays={c.overlays.excursionMm} yMin={0} yMax={exc.max} yStep={exc.step} hLine={{ y: xmaxMm, label: 'Xmax' }} />
          <Chart {...common} title="Impedance" unit="Ω" values={c.curves.impedanceOhm} overlays={c.overlays.impedanceOhm} yMin={0} yMax={imp.max} yStep={imp.step} />
          <Chart {...common} title="Impedance phase" unit="°" values={c.curves.phaseDeg} overlays={c.overlays.phaseDeg} yMin={-90} yMax={90} yStep={30} />
          <Chart {...common} title="Group delay" unit="ms" values={c.curves.groupDelayMs} overlays={c.overlays.groupDelayMs} yMin={0} yMax={gd.max} yStep={gd.step} />
        </div>
      </main>
  );
}
