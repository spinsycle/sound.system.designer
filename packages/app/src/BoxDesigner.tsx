// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
import * as P from '@soundsystemdesigner/physics';
// One box or horn: driver, enclosure, plots. Edits a Design it is given; the app shell owns and stores it.
import { useMemo, useState } from 'react';
import { Chart, ProfileChart, niceScale } from './Chart';
import { foldSvg } from './export';
import { LayoutControls, PortControls } from './LayoutControls';
import {
  BOX_KINDS,
  BOX_RANGES,
  BP6_RANGES,
  BP8_LAYOUTS,
  BP8_RANGES,
  type BoxField,
  type Bp6Design,
  type Bp8Design,
  CUSTOM_CLASS,
  CUSTOM_RANGES,
  DEFAULT_WALL_M,
  type Design,
  EXTRA_RANGES,
  FLARES,
  HORN_PRESETS,
  HORN_RANGES,
  type HornDesign,
  type HornField,
  PLOT_RANGES,
  type PlotRange,
  PR_RANGES,
  type PassiveDesign,
  type Range,
  STUFFINGS,
  type TlDesign,
  TL_RANGES,
  compute,
  driverOf,
  portDiameterCmFor,
  prOf,
  sanitize,
  tlSettingsFor,
  tqwtSettingsFor,
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

export function BoxDesigner({ design, onChange, count = 1, perBox = 1, onPerBox, wallM }: { design: Design; onChange: (d: Design) => void; count?: number; perBox?: number; onPerBox?: (n: number) => void; wallM?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const c = useMemo(() => compute(design, wallM), [design, wallM]);

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
  const boxFields: BoxField[] = { sealed: ['volumeL'], ported: ['volumeL', 'tuneHz'], passive: ['volumeL', 'tuneHz'], bandpass: ['volumeL', 'frontVolumeL', 'tuneHz'], bandpass6: ['volumeL', 'frontVolumeL', 'tuneHz'], bandpass8: ['volumeL', 'frontVolumeL', 'tuneHz'], tline: [], tqwt: [], horn: isRear ? [] : ['volumeL'] }[design.type] as BoxField[];
  const volumeLabel = { sealed: 'Volume', ported: 'Volume', passive: 'Volume', bandpass: 'Rear volume', bandpass6: 'Rear volume (vented)', bandpass8: 'Rear volume (vented)', tline: '', tqwt: '', horn: 'Rear chamber' }[design.type];
  const tuneLabel = design.type === 'passive' ? 'Box tuning fB' : design.type === 'bandpass6' ? 'Front tuning' : design.type === 'bandpass8' ? 'Outer front tuning (port 2)' : undefined;
  const setPr = (patch: Partial<PassiveDesign>): void => set({ pr: { ...design.pr, ...patch } });
  const setTl = (patch: Partial<TlDesign>): void => set({ tl: { ...design.tl, ...patch } });
  const qts = c.derived.qts;
  const hasQl = design.type === 'ported' || design.type === 'bandpass' || design.type === 'bandpass6' || design.type === 'bandpass8' || design.type === 'passive';
  const pickType = (type: Design['type']): void => {
    // a new Cookbook type starts the way the book designs it: QL 7, and a line or radiator sized from the driver
    const patch: Partial<Design> = { type };
    if (type === 'passive' || type === 'bandpass' || type === 'bandpass6' || type === 'bandpass8') {
      if (design.qL === 0) patch.qL = 7;
    }
    if (type === 'tline') patch.tl = tlSettingsFor(driverOf(design), design.tl.kind, design.tl.table, design.tl.stuffing);
    if (type === 'tqwt') patch.tl = tqwtSettingsFor(driverOf(design), design.tl.stuffing);
    set(patch);
  };
  /** Design helpers: set the box from the Cookbook's alignments (vented, passive radiator, closed Qtc, band-pass ripple). */
  const [align, setAlign] = useState<P.VentedAlignment>('QB3');
  const [qtcTarget, setQtcTarget] = useState(0.707);
  const [ripple, setRipple] = useState(0.7);
  const ql7 = design.qL > 0 ? design.qL : 7;
  const applyVented = (): void => {
    const s = P.solveVented(qts, align, ql7);
    set({ qL: ql7, volumeL: Number(((d.vasM3 * 1000) / s.alpha).toPrecision(4)), tuneHz: Number((s.h * d.fs).toPrecision(4)) });
  };
  const applyPassive = (): void => {
    const alpha = P.recommendedPassiveAlpha(qts);
    const s = P.solvePassiveTuning(qts, alpha, ql7);
    if (s) set({ qL: ql7, volumeL: Number(((d.vasM3 * 1000) / alpha).toPrecision(4)), tuneHz: Number((s.h * d.fs).toPrecision(4)), pr: { ...design.pr, sdpCm2: 0, vapL: 0, massG: 0 } });
  };
  const applySealed = (): void => {
    if (qtcTarget > qts) set({ volumeL: Number(((d.vasM3 * 1000) / ((qtcTarget / qts) ** 2 - 1)).toPrecision(4)) });
  };
  const applyBandpass = (): void => {
    const qbp = Math.max(qts * 2.18, qts * 1.2);
    const b = P.bandpassDesign(d, qts, ripple, qbp);
    set({ qL: ql7, volumeL: Number((b.vrM3 * 1000).toPrecision(4)), frontVolumeL: Number((b.vfM3 * 1000).toPrecision(4)), tuneHz: Number(b.fbHz.toPrecision(4)) });
  };
  const setBp6 = (patch: Partial<Bp6Design>): void => set({ bp6: { ...design.bp6, ...patch } });
  const applyBandpass6 = (): void => {
    const a = P.bandpass6Design(d, design.bp6.loHz, design.bp6.hiHz, ql7);
    const t = (v: number): number => Number(v.toPrecision(4));
    // the ports have to be wide enough to tune their chamber: round, at least 8 cm long and not under the Cookbook's minimum vent
    set({
      qL: ql7,
      volumeL: t(a.rearL),
      frontVolumeL: t(a.frontL),
      tuneHz: t(a.frontHz),
      portShape: 'round',
      portDiameterCm: portDiameterCmFor(d, t(a.frontL), t(a.frontHz)),
      bp6: { ...design.bp6, rearTuneHz: t(a.rearHz), rearPortDiameterCm: portDiameterCmFor(d, t(a.rearL), t(a.rearHz)) },
    });
  };
  const setBp8 = (patch: Partial<Bp8Design>): void => set({ bp8: { ...design.bp8, ...patch } });
  const applyBandpass8 = (): void => {
    const a = P.bandpass8Design(d, design.bp6.loHz, design.bp6.hiHz, ql7, design.bp8.layout);
    const t = (v: number): number => Number(v.toPrecision(4));
    // the ports have to be wide enough to tune their chamber: round, at least 8 cm long and not under the Cookbook's minimum vent
    set({
      qL: ql7,
      volumeL: t(a.rearL),
      frontVolumeL: t(a.outerL),
      tuneHz: t(a.outerHz),
      portShape: 'round',
      portDiameterCm: portDiameterCmFor(d, t(a.outerL), t(a.outerHz)),
      bp6: { ...design.bp6, rearTuneHz: t(a.rearHz), rearPortDiameterCm: portDiameterCmFor(d, t(a.rearL), t(a.rearHz), 8, design.bp8.layout === 'chain') },
      // port 1 joins two chambers: its own end correction (the room-port length rule is not used for it)
      bp8: { ...design.bp8, innerVolumeL: t(a.innerL), innerTuneHz: t(a.innerHz), innerPortDiameterCm: portDiameterCmFor(d, t(a.innerL), t(a.innerHz), 8, true) },
    });
  };
  const prInfo = design.type === 'passive' ? prOf(design) : null;
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
                <button key={k.id} type="button" role="radio" aria-checked={design.type === k.id} className={design.type === k.id ? 'on' : ''} onClick={() => pickType(k.id)}>
                  {k.label}
                </button>
              ))}
            </div>
            {boxFields.map((k) => (
              <Field key={k} slider range={k === 'volumeL' ? { ...BOX_RANGES[k], label: volumeLabel } : k === 'tuneHz' && tuneLabel ? { ...BOX_RANGES[k], label: tuneLabel } : k === 'frontVolumeL' && design.type === 'bandpass8' ? { ...BOX_RANGES[k], label: 'Outer front volume' } : BOX_RANGES[k]} value={design[k]} onChange={(v) => set({ [k]: v })} />
            ))}
            {(design.type === 'ported' || design.type === 'bandpass' || design.type === 'bandpass6' || design.type === 'bandpass8') && <PortControls design={design} onChange={set} idp="box" />}
            {design.type === 'bandpass8' && (
              <div className="segmented" role="radiogroup" aria-label="8th-order layout">
                {BP8_LAYOUTS.map((l) => (
                  <button key={l.id} type="button" role="radio" aria-checked={design.bp8.layout === l.id} className={design.bp8.layout === l.id ? 'on' : ''} onClick={() => setBp8({ layout: l.id })}>
                    {l.label}
                  </button>
                ))}
              </div>
            )}
            {design.type === 'bandpass8' && (
              <>
                <Field id="bp8-innerVol" slider range={BP8_RANGES.innerVolumeL} value={design.bp8.innerVolumeL} onChange={(v) => setBp8({ innerVolumeL: v })} />
                <Field id="bp8-innerTune" slider range={BP8_RANGES.innerTuneHz} value={design.bp8.innerTuneHz} onChange={(v) => setBp8({ innerTuneHz: v })} />
                <Field id="bp8-innerPort" range={BP8_RANGES.innerPortDiameterCm} value={design.bp8.innerPortDiameterCm} onChange={(v) => setBp8({ innerPortDiameterCm: v })} />
              </>
            )}
            {(design.type === 'bandpass6' || (design.type === 'bandpass8' && design.bp8.layout !== 'sealed')) && (
              <>
                <Field id="bp6-rearTune" slider range={BP6_RANGES.rearTuneHz} value={design.bp6.rearTuneHz} onChange={(v) => setBp6({ rearTuneHz: v })} />
                <Field id="bp6-rearPort" range={BP6_RANGES.rearPortDiameterCm} value={design.bp6.rearPortDiameterCm} onChange={(v) => setBp6({ rearPortDiameterCm: v })} />
              </>
            )}
            {hasQl && <Field slider range={EXTRA_RANGES.qL} value={design.qL} onChange={(v) => set({ qL: v })} />}
            {design.type === 'sealed' && <Field slider range={EXTRA_RANGES.fillPct} value={design.fillPct} onChange={(v) => set({ fillPct: v })} />}
            {hasQl && (
              <div className="segmented" aria-label="Box losses presets">
                {[0, 3, 7, 15].map((q) => (
                  <button key={q} type="button" className={design.qL === q ? 'on' : ''} onClick={() => set({ qL: q })}>
                    {q === 0 ? 'Lossless' : `QL ${q}`}
                  </button>
                ))}
              </div>
            )}
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

          {(design.type === 'sealed' || design.type === 'ported' || design.type === 'passive' || design.type === 'bandpass') && (
            <section>
              <h2>Design from the Cookbook</h2>
              {design.type === 'sealed' && (
                <>
                  <div className="field">
                    <label htmlFor="qtc-target">Target Qtc</label>
                    <select id="qtc-target" value={qtcTarget} onChange={(e) => setQtcTarget(Number(e.target.value))}>
                      {[0.5, 0.577, 0.707, 0.8, 1.0, 1.2].map((q) => (
                        <option key={q} value={q}>
                          {q}
                          {q === 0.577 ? ' (Bessel)' : q === 0.707 ? ' (Butterworth)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button type="button" disabled={qtcTarget <= qts} onClick={applySealed}>
                    Set the volume for this Qtc
                  </button>
                  <p className="hint">Vb = Vas / ((Qtc / Qts)² − 1). Qtc must be above the driver's Qts ({show(qts)}).</p>
                </>
              )}
              {design.type === 'ported' && (
                <>
                  <div className="field">
                    <label htmlFor="alignment">Alignment</label>
                    <select id="alignment" value={align} onChange={(e) => setAlign(e.target.value as P.VentedAlignment)}>
                      <option value="QB3">QB3 (quasi-third-order, the usual)</option>
                      <option value="B4">B4 (maximally flat)</option>
                      <option value="BE4">BE4 (Bessel, best transients)</option>
                      <option value="C4">C4 (Chebyshev, 0.5 dB ripple)</option>
                    </select>
                  </div>
                  <button type="button" onClick={applyVented}>
                    Set volume and tuning for this alignment (QL {show(ql7)})
                  </button>
                  <p className="hint">Fits the box to the alignment's response shape for this driver's Qts. B4 at QL 7 reproduces the book's Table 2.10 (Qts 0.4048: Vas/Vb 1.06, tuned to Fs).</p>
                </>
              )}
              {design.type === 'passive' && (
                <>
                  <button type="button" onClick={applyPassive}>
                    Set the box and tuning for this driver (QL {show(ql7)})
                  </button>
                  <p className="hint">Box volume about Vas × Qts / 1.13, tuned for the lowest f3 within 0.5 dB, with a radiator that copies the driver's cone (Table 3.1's case). Then add the mass shown in the results.</p>
                </>
              )}
              {design.type === 'bandpass' && (
                <>
                  <div className="field">
                    <label htmlFor="ripple">Ripple factor S</label>
                    <select id="ripple" value={ripple} onChange={(e) => setRipple(Number(e.target.value))}>
                      <option value={0.7}>0.7 (flat, best transients)</option>
                      <option value={0.6}>0.6 (0.35 dB ripple)</option>
                      <option value={0.5}>0.5 (1.25 dB ripple)</option>
                    </select>
                  </div>
                  <button type="button" onClick={applyBandpass}>
                    Set both chambers and the tuning
                  </button>
                  <p className="hint">Front chamber (2 S Qts)² Vas, rear chamber Vas / ((Qbp / Qts)² − 1), tuned to Qbp Fs / Qts (Cookbook section 1.300; Qbp about 2.2 Qts). The 8 in example in the book (Qts 0.328, S 0.7) gives its 43 to 115 Hz passband.</p>
                </>
              )}
            </section>
          )}

          {design.type === 'bandpass8' && (
            <section>
              <h2>Design an 8th-order band-pass</h2>
              <div className="grid2">
                <Field id="bp8-lo" range={BP6_RANGES.loHz} value={design.bp6.loHz} onChange={(v) => setBp6({ loHz: v })} />
                <Field id="bp8-hi" range={BP6_RANGES.hiHz} value={design.bp6.hiHz} onChange={(v) => setBp6({ hiHz: v })} />
              </div>
              <button type="button" onClick={applyBandpass8}>
                Find chambers and tunings for this passband (QL {show(ql7)})
              </button>
              <p className="hint">Not from the Cookbook: a search for the flattest, loudest passband between these two frequencies, with the skirts an octave outside held 12 dB down, for the layout chosen above. The front is two chambers in series: the inner one next to the driver opens through port 1 into the outer one, which opens through port 2 to the room. The rear chamber vents to the room, vents into the inner front chamber, or is sealed (6th order by pole count). A starting point: refine it on the plots.</p>
            </section>
          )}

          {design.type === 'bandpass6' && (
            <section>
              <h2>Design a 6th-order band-pass</h2>
              <div className="grid2">
                <Field id="bp6-lo" range={BP6_RANGES.loHz} value={design.bp6.loHz} onChange={(v) => setBp6({ loHz: v })} />
                <Field id="bp6-hi" range={BP6_RANGES.hiHz} value={design.bp6.hiHz} onChange={(v) => setBp6({ hiHz: v })} />
              </div>
              <button type="button" onClick={applyBandpass6}>
                Find chambers and tunings for this passband (QL {show(ql7)})
              </button>
              <p className="hint">Not from the Cookbook, which has no 6th-order equations: a search for the flattest, loudest passband between these two frequencies, with the skirts an octave outside held 12 dB down. Both ports radiate. A starting point: refine it on the plots.</p>
            </section>
          )}

          {design.type === 'passive' && prInfo && (
            <section>
              <h2>Passive radiator</h2>
              <p className="hint">Leave a field at 0 and the radiator copies the driver's cone, the book's standard case. The mass to add tunes the box to the tuning above.</p>
              {(['sdpCm2', 'vapL', 'massG', 'xmaxMm'] as (keyof PassiveDesign)[]).map((k) => (
                <Field key={k} id={`pr-${k}`} range={PR_RANGES[k]} value={design.pr[k]} onChange={(v) => setPr({ [k]: v })} />
              ))}
            </section>
          )}

          {design.type === 'tqwt' && (
            <section>
              <h2>Tapered quarter-wave tube</h2>
              <div className="field">
                <label htmlFor="tl-stuff">Stuffing</label>
                <select id="tl-stuff" value={design.tl.stuffing} onChange={(e) => setTl({ stuffing: e.target.value as P.Stuffing })}>
                  {STUFFINGS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" className="on" onClick={() => set({ tl: tqwtSettingsFor(driverOf(design), design.tl.stuffing) })}>
                Set a TQWT for this driver
              </button>
              {(['lengthCm', 'startCm2', 'exitCm2', 'offsetPct', 'densityLb', 'stuffedPct'] as const).map((k) => (
                <Field key={k} slider id={`tl-${k}`} range={TL_RANGES[k]} value={design.tl[k]} onChange={(v) => setTl({ [k]: v })} />
              ))}
              <p className="hint">Length c / 4 Fs, mouth the area of the cone, closed end four times that, the driver a third of the way up from the closed end, light stuffing over the closed half. These are common rules of thumb, not the Cookbook's tables: the response is the same stuffed-line simulation as the transmission line, so read it as a guide and adjust length and stuffing on the plots.</p>
            </section>
          )}

          {design.type === 'tline' && (
            <section>
              <h2>Transmission line</h2>
              <div className="field">
                <label htmlFor="tl-kind">Line type</label>
                <select id="tl-kind" value={design.tl.kind} onChange={(e) => setTl({ kind: e.target.value as P.TlKind })}>
                  <option value="taper">Tapered 1:4 (standard)</option>
                  <option value="chamber">Coupled chamber</option>
                  <option value="offset">Offset driver</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="tl-table">Table</label>
                <select id="tl-table" value={design.tl.table} onChange={(e) => setTl({ table: e.target.value as P.TlTable })}>
                  <option value="extended">Extended bass (Table 4.3)</option>
                  <option value="standard">Standard (Table 4.2)</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="tl-stuff">Stuffing</label>
                <select id="tl-stuff" value={design.tl.stuffing} onChange={(e) => setTl({ stuffing: e.target.value as P.Stuffing })}>
                  {STUFFINGS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" className="on" onClick={() => set({ tl: tlSettingsFor(driverOf(design), design.tl.kind, design.tl.table, design.tl.stuffing) })}>
                Size the line from the tables for this driver
              </button>
              {(Object.keys(TL_RANGES) as (keyof typeof TL_RANGES)[])
                .filter((k) => (k !== 'chamberL' || design.tl.kind === 'chamber') && (k !== 'offsetPct' || design.tl.kind === 'offset'))
                .map((k) => (
                  <Field key={k} slider id={`tl-${k}`} range={TL_RANGES[k]} value={design.tl[k]} onChange={(v) => setTl({ [k]: v })} />
                ))}
              <p className="hint">Line length is c / 4 fp; the tables fix fp from Fs and the volume from Vas. The stuffing density is the book's Table 4.1 value for this length; the line is simulated as a stuffed tube.</p>
            </section>
          )}

          {!isHorn && (
            <section>
              <h2>Driver layout</h2>
              {onPerBox && (design.type === 'sealed' || design.type === 'ported') && (
                <div className="field">
                  <label htmlFor="per-box">Drivers per box</label>
                  <select id="per-box" value={perBox} onChange={(e) => onPerBox(Number(e.target.value))}>
                    {Array.from({ length: count }, (_, i) => i + 1)
                      .filter((n) => count % n === 0)
                      .map((n) => (
                        <option key={n} value={n}>
                          {n === 1 ? '1 (one driver in each box)' : `${n} (share one box)`}
                        </option>
                      ))}
                  </select>
                  <span className="unit">of {count} drivers; each keeps its own volume of air</span>
                </div>
              )}
              <LayoutControls layout={design.layout} count={design.type === 'sealed' || design.type === 'ported' ? perBox : 1} onChange={(layout) => set({ layout })} idp="box" />
            </section>
          )}

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
              <div className="field">
                <label htmlFor="fold-on">Fold the horn into the box</label>
                <input id="fold-on" type="checkbox" checked={design.horn.fold} onChange={(e) => setHorn({ fold: e.target.checked })} />
                <span className="unit">{design.horn.fold ? 'folded' : 'straight'}</span>
              </div>
              {design.horn.fold && (
                <>
                  <div className="segmented" role="radiogroup" aria-label="Fold style">
                    {(['stepped', 'tapered'] as const).map((k) => (
                      <button key={k} type="button" role="radio" aria-checked={design.horn.foldStyle === k} className={design.horn.foldStyle === k ? 'on' : ''} onClick={() => setHorn({ foldStyle: k })}>
                        {k === 'stepped' ? 'Stepped legs' : 'Tapered legs (scoop)'}
                      </button>
                    ))}
                  </div>
                  <Field id="fold-legs" range={HORN_RANGES.legs} value={design.horn.legs} onChange={(v) => setHorn({ legs: Math.round(v) })} />
                  <Field id="fold-depth" range={HORN_RANGES.depthCm} value={design.horn.depthCm} onChange={(v) => setHorn({ depthCm: v })} />
                  {c.horn?.suggest && (
                    <button type="button" className="on" onClick={() => setHorn({ legs: c.horn!.suggest!.legs, widthCm: Math.round(c.horn!.suggest!.widthM * 1000) / 10, depthCm: Math.round(c.horn!.suggest!.depthOutM * 1000) / 10 })}>
                      Use the recommended fold: {c.horn.suggest.legs} legs, {show(c.horn.suggest.widthM * 100)} cm wide, {show(c.horn.suggest.depthOutM * 100)} cm deep
                    </button>
                  )}
                  {c.horn?.maxMouthCm2 != null && c.horn.suggestAtMax && (
                    <button
                      type="button"
                      className="on"
                      onClick={() => setHorn({ mouthCm2: c.horn!.maxMouthCm2!, legs: c.horn!.suggestAtMax!.legs, widthCm: Math.round(c.horn!.suggestAtMax!.widthM * 1000) / 10, depthCm: Math.round(c.horn!.suggestAtMax!.depthOutM * 1000) / 10 })}
                    >
                      Shrink the mouth to {show(c.horn.maxMouthCm2)} cm² and use the recommended fold ({c.horn.suggestAtMax.legs} legs, {show(c.horn.suggestAtMax.widthM * 100)} cm wide, {show(c.horn.suggestAtMax.depthOutM * 100)} cm deep)
                    </button>
                  )}
                  <button type="button" onClick={() => c.horn?.fold && setHorn({ depthCm: Math.min(1000, Math.ceil((c.horn.fold.minDepthI + 2 * (wallM ?? DEFAULT_WALL_M)) * 100)) })}>
                    Use the depth the folds need
                  </button>
                  <p className="hint">Horn width above is the inside width of the box. Use an even number of legs so the mouth is on the front. The box height follows from the flare.</p>
                  {c.horn?.fold && <div className="fold-drawing" aria-label="Fold drawing, side view" dangerouslySetInnerHTML={{ __html: foldSvg(c.horn.fold, wallM ?? DEFAULT_WALL_M, 'Folded horn') }} />}
                </>
              )}
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
              {[...c.readouts, ...c.extras].map((r) => (
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
