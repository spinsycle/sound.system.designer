// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The speaker page: one cabinet with several drivers (2-way, MTM, WTW, TMM, 3-way, 2.5-way): arrangement, baffle, crossovers,
// each driver slot, and the summed response with the baffle step.
import * as P from '@soundsystemdesigner/physics';
import { useMemo, useState } from 'react';
import { Field } from './BoxDesigner';
import { BRACES } from './build';
import { Chart } from './Chart';
import {
  ARRANGEMENTS,
  SPEAKER_TEMPLATES,
  applySpeakerTemplate,
  levelSpeaker,
  portedDefaults,
  type ArrangementId,
  type Loudspeaker,
  QUANTITY_RANGE,
  SLOT_RANGES,
  SPEAKER_RANGES,
  SPEAKER_XOVER_RANGE,
  type Slot,
  applyArrangement,
  arrangementOf,
  computeLoudspeaker,
  sanitizeLoudspeaker,
  slotLabel,
} from './loudspeaker';
import { BOX_RANGES, CUSTOM_CLASS, CUSTOM_RANGES, type Design } from './model';
import { type Project, sanitizeProject } from './system';

/** The box kinds a speaker slot is built as. */
const SLOT_BOXES = [
  { id: 'sealed', label: 'Sealed' },
  { id: 'ported', label: 'Ported' },
] as const;

export function SpeakerView({ project, onChange }: { project: Project; onChange: (p: Project) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const [template, setTemplate] = useState(1);
  const sp = project.speaker;
  const arr = arrangementOf(sp.arrangement);
  const c = useMemo(() => computeLoudspeaker(sp), [sp]);

  const setSpeaker = (next: Loudspeaker): void => onChange(sanitizeProject({ ...project, speaker: sanitizeLoudspeaker(next) }));
  const set = (patch: Partial<Loudspeaker>): void => setSpeaker({ ...sp, ...patch });
  const setSlot = (k: number, patch: Partial<Slot>): void => set({ slots: sp.slots.map((s, i) => (i === k ? { ...s, ...patch } : s)) });
  const setDesign = (k: number, patch: Partial<Design>): void => setSlot(k, { design: { ...sp.slots[k]!.design, ...patch } });

  const peak = Math.max(...c.levelDb, ...c.slots.flatMap((s) => s.levelDb));
  const yMax = Math.ceil((peak + 3) / 10) * 10;
  const multi = arr.slots.some((s) => s.count > 1);
  const nCross = arr.slots.length - 1;

  return (
    <main>
      <div className="controls">
        <section>
          <h2>Speaker</h2>
          <div className="field stacked">
            <label htmlFor="sp-template">Starting point</label>
            <select id="sp-template" value={template} onChange={(e) => setTemplate(Number(e.target.value))}>
              {SPEAKER_TEMPLATES.map((t, i) => (
                <option key={t.label} value={i}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <p className="hint">{SPEAKER_TEMPLATES[template]!.description}</p>
          <button type="button" onClick={() => setSpeaker(applySpeakerTemplate(sp, template))}>
            Load it (replaces the drivers and the baffle)
          </button>
          <div className="field stacked">
            <label htmlFor="arrangement">Arrangement</label>
            <select id="arrangement" value={sp.arrangement} onChange={(e) => setSpeaker(applyArrangement(sp, e.target.value as ArrangementId))}>
              {ARRANGEMENTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <p className="hint">{arr.description}</p>
          <button type="button" onClick={() => setSpeaker(levelSpeaker(sp))}>
            Level the drivers
          </button>
          <Field id="baffle-w" range={SPEAKER_RANGES.baffleWidthCm} value={sp.baffleWidthCm} onChange={(v) => set({ baffleWidthCm: v })} />
          <Field id="baffle-h" range={SPEAKER_RANGES.baffleHeightCm} value={sp.baffleHeightCm} onChange={(v) => set({ baffleHeightCm: v })} />
          <div className="checks">
            <label>
              <input type="checkbox" checked={sp.baffleStep} onChange={(e) => set({ baffleStep: e.target.checked })} />
              Baffle step (free-standing box)
            </label>
          </div>
          {Array.from({ length: nCross }, (_, k) => (
            <Field
              key={k}
              id={`sp-xover-${k}`}
              slider
              range={{ ...SPEAKER_XOVER_RANGE, label: arr.kind === 'assist' ? (k === 0 ? 'Bass woofer stops' : 'Main woofer / tweeter') : `${slotLabel(arr, k)} / ${slotLabel(arr, k + 1)}` }}
              value={sp.xover[k]!}
              onChange={(v) => set({ xover: sp.xover.map((x, i) => (i === k ? v : x)) })}
            />
          ))}
          {multi && (
            <div className="field">
              <label htmlFor="chambers">Woofer chambers</label>
              <select id="chambers" value={sp.chambers} onChange={(e) => set({ chambers: e.target.value as Loudspeaker['chambers'] })}>
                <option value="shared">One shared chamber</option>
                <option value="separate">One chamber per driver</option>
              </select>
            </div>
          )}
          {multi && <p className="hint">Shared or separate, the response is the same: each driver sees its share of the air. Separate chambers add partitions to the cut list.</p>}
          <h3>Build</h3>
          <Field id="quantity" range={QUANTITY_RANGE} value={sp.quantity} onChange={(v) => set({ quantity: Math.round(v) })} />
          <div className="field">
            <label htmlFor="sp-brace">Bracing</label>
            <select id="sp-brace" value={sp.brace} onChange={(e) => set({ brace: e.target.value as Loudspeaker['brace'] })}>
              {BRACES.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
          <button type="button" onClick={() => onChange(sanitizeProject({ ...project, view: 'build' }))}>
            Cut list and drawings
          </button>
        </section>

        {arr.slots.map((spec, k) => {
          const s = sp.slots[k]!;
          const d = s.design;
          const isCustom = d.driverClass === CUSTOM_CLASS;
          return (
            <section key={k} className={`band band-${k}`}>
              <h2>
                <span className="swatch" aria-hidden="true" />
                {c.slots[k]!.name}
              </h2>
              <p className="hint">{c.slots[k]!.summary}</p>
              <div className="field">
                <label htmlFor={`sp-class-${k}`}>Driver</label>
                <select id={`sp-class-${k}`} value={d.driverClass} onChange={(e) => setDesign(k, { driverClass: Number(e.target.value) })}>
                  {P.ALL_DRIVER_CLASSES.map((cl, i) => (
                    <option key={cl.name} value={i}>
                      {cl.name}
                    </option>
                  ))}
                  <option value={CUSTOM_CLASS}>Custom</option>
                </select>
              </div>
              {isCustom &&
                (Object.keys(CUSTOM_RANGES) as (keyof P.CustomDriverFields)[]).map((f) => (
                  <Field key={f} id={`sp-custom-${k}-${f}`} range={CUSTOM_RANGES[f]} value={d.custom[f]} onChange={(v) => setDesign(k, { custom: { ...d.custom, [f]: v } })} />
                ))}
              <div className="checks">
                <label>
                  <input type="checkbox" checked={s.open} onChange={(e) => setSlot(k, { open: e.target.checked })} />
                  No box (open baffle: planar or ribbon)
                </label>
              </div>
              {!s.open && (
                <>
                  <div className="field">
                    <label htmlFor={`sp-box-${k}`}>Box</label>
                    <select id={`sp-box-${k}`} value={d.type === 'ported' ? 'ported' : 'sealed'} onChange={(e) => setDesign(k, e.target.value === 'ported' ? { type: 'ported', ...portedDefaults(d, spec.count) } : { type: 'sealed' })}>
                      {SLOT_BOXES.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Field id={`sp-vol-${k}`} slider range={{ ...BOX_RANGES.volumeL, label: spec.count > 1 ? `Air for all ${spec.count}` : 'Air' }} value={d.volumeL} onChange={(v) => setDesign(k, { volumeL: v })} />
                  {d.type === 'ported' && <Field id={`sp-tune-${k}`} slider range={BOX_RANGES.tuneHz} value={d.tuneHz} onChange={(v) => setDesign(k, { tuneHz: v })} />}
                  {d.type === 'ported' && <Field id={`sp-port-${k}`} range={BOX_RANGES.portDiameterCm} value={d.portDiameterCm} onChange={(v) => setDesign(k, { portDiameterCm: v })} />}
                </>
              )}
              <Field id={`sp-trim-${k}`} slider range={SLOT_RANGES.trimDb} value={s.trimDb} onChange={(v) => setSlot(k, { trimDb: v })} />
              <Field id={`sp-back-${k}`} range={SLOT_RANGES.backCm} value={s.backCm} onChange={(v) => setSlot(k, { backCm: v })} />
              <div className="checks">
                <label>
                  <input type="checkbox" checked={s.invert} onChange={(e) => setSlot(k, { invert: e.target.checked })} />
                  Invert
                </label>
              </div>
            </section>
          );
        })}
      </div>

      <div className="charts one">
        <Chart
          title="Speaker level"
          unit="dB SPL"
          freqs={c.freqs}
          values={c.levelDb}
          overlays={c.slots.map((s, k) => ({ label: s.name, values: s.levelDb, className: `overlay band-line band-${k}` }))}
          yMin={yMax - 60}
          yMax={yMax}
          yStep={10}
          vLines={[...c.xover.slice(0, nCross).map((f, k) => ({ f, label: `x${k + 1}` })), ...(c.stepHz > 0 ? [{ f: c.stepHz, label: 'step' }] : [])]}
          hover={hover}
          onHover={setHover}
        />
        <section>
          <h2>Readouts</h2>
          <table>
            <tbody>
              <tr>
                <th scope="row" className="left">
                  Sensitivity, 300 Hz to 3 kHz
                </th>
                <td>{c.sensitivityDb.toFixed(1)} dB SPL at 2.83 V per driver, 1 m</td>
              </tr>
              <tr>
                <th scope="row" className="left">
                  Baffle step
                </th>
                <td>{c.stepHz > 0 ? `-6 dB below about ${c.stepHz.toFixed(0)} Hz` : 'off'}</td>
              </tr>
              {c.slots.map((s, k) => (
                <tr key={k}>
                  <th scope="row" className="left">
                    {s.name}
                  </th>
                  <td>{s.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
      </div>
    </main>
  );
}
