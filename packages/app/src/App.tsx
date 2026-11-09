// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
import * as P from '@soundsystemdesigner/physics';
import { useEffect, useMemo, useState } from 'react';
import { Chart, niceScale } from './Chart';
import { BOX_KINDS, BOX_RANGES, type BoxField, CUSTOM_CLASS, CUSTOM_RANGES, type Design, type Range, compute, sanitize } from './model';

const STORAGE_KEY = 'soundsystemdesigner.design.v1';

function load(): Design {
  try {
    return sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return sanitize(null);
  }
}

const show = (v: number): string => String(Number(v.toPrecision(4)));

/** A number box that accepts any typing and commits a clamped value on blur or Enter, with an optional log slider. */
function Field(p: { range: Range; value: number; onChange: (v: number) => void; slider?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const { range: r } = p;
  const commit = (): void => {
    const v = Number(text);
    if (text !== null && text.trim() !== '' && Number.isFinite(v)) p.onChange(P.clamp(v, r.min, r.max));
    setText(null);
  };
  const id = `f-${r.label.replace(/\W/g, '')}`;
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
        <input
          type="range"
          aria-label={`${r.label} slider`}
          min={0}
          max={1}
          step={0.001}
          value={Math.log(p.value / r.min) / Math.log(r.max / r.min)}
          onChange={(e) => p.onChange(Number((r.min * (r.max / r.min) ** Number(e.target.value)).toPrecision(3)))}
        />
      )}
    </div>
  );
}

export function App() {
  const [design, setDesign] = useState<Design>(load);
  const [hover, setHover] = useState<number | null>(null);
  const c = useMemo(() => compute(design), [design]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(design));
    } catch {
      // storage unavailable (private window): the design simply is not remembered
    }
  }, [design]);

  const set = (patch: Partial<Design>): void => setDesign((d) => sanitize({ ...d, ...patch }));
  const isCustom = design.driverClass === CUSTOM_CLASS;
  const d = c.driver;
  // the driver in datasheet units, in the Custom fields' order
  const sheet: P.CustomDriverFields = { fsHz: d.fs, qts: c.derived.qts, qms: d.qms, vasL: d.vasM3 * 1000, sdCm2: d.sd * 1e4, reOhm: d.re, xmaxMm: d.xmax * 1000, powerW: d.pe };
  const customKeys = Object.keys(CUSTOM_RANGES) as (keyof P.CustomDriverFields)[];
  const boxFields: BoxField[] = design.type === 'sealed' ? ['volumeL'] : design.type === 'ported' ? ['volumeL', 'tuneHz', 'portDiameterCm'] : ['volumeL', 'frontVolumeL', 'tuneHz', 'portDiameterCm'];

  const xmaxMm = d.xmax * 1000;
  const respTop = Math.max(6, Math.ceil((Math.max(...c.curves.responseDb) + 1) / 6) * 6);
  const exc = niceScale(Math.min(Math.max(...c.curves.excursionMm, xmaxMm * 1.2), xmaxMm * 3));
  const imp = niceScale(Math.max(...c.curves.impedanceOhm));
  const gd = niceScale(Math.min(Math.max(...c.curves.groupDelayMs), 100));
  const common = { freqs: c.freqs, hover, onHover: setHover, vLines: c.markers };

  return (
    <div className="app">
      <header>
        <h1>Sound System Designer</h1>
        <p>Direct-radiator box designer. Lossless Thiele-Small models; generic driver classes are invented values, not products.</p>
      </header>

      <main>
        <div className="controls">
          <section>
            <h2>Driver</h2>
            <div className="field">
              <label htmlFor="driver-class">Class</label>
              <select id="driver-class" value={design.driverClass} onChange={(e) => set({ driverClass: Number(e.target.value) })}>
                {P.DRIVER_CLASSES.map((k, i) => (
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
              <Field
                key={k}
                slider
                range={k === 'volumeL' && design.type === 'bandpass' ? { ...BOX_RANGES[k], label: 'Rear volume' } : BOX_RANGES[k]}
                value={design[k]}
                onChange={(v) => set({ [k]: v })}
              />
            ))}
            <Field slider range={BOX_RANGES.powerW} value={design.powerW} onChange={(v) => set({ powerW: v })} />
          </section>

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
          </section>
        </div>

        <div className="charts">
          <Chart {...common} title="Response" unit="dB" values={c.curves.responseDb} yMin={-36} yMax={respTop} yStep={6} />
          <Chart {...common} title={`Cone excursion at ${show(design.powerW)} W`} unit="mm peak" values={c.curves.excursionMm} yMin={0} yMax={exc.max} yStep={exc.step} hLine={{ y: xmaxMm, label: 'Xmax' }} />
          <Chart {...common} title="Impedance" unit="Ω" values={c.curves.impedanceOhm} yMin={0} yMax={imp.max} yStep={imp.step} />
          <Chart {...common} title="Impedance phase" unit="°" values={c.curves.phaseDeg} yMin={-90} yMax={90} yStep={30} />
          <Chart {...common} title="Group delay" unit="ms" values={c.curves.groupDelayMs} yMin={0} yMax={gd.max} yStep={gd.step} />
        </div>
      </main>
    </div>
  );
}
