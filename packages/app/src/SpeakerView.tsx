// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The speaker page: one cabinet with several drivers (2-way, MTM, WTW, TMM, 3-way, 2.5-way): arrangement, baffle, crossovers,
// each driver slot, and the summed response with the baffle step.
import * as P from '@soundsystemdesigner/physics';
import { useMemo, useState } from 'react';
import { DriverPicker } from './drivers/DriverPicker';
import { type DriverDb, emptyDb } from './drivers/library';
import { Field } from './BoxDesigner';
import { LayoutControls, PortControls } from './LayoutControls';
import { BRACES } from './build';
import { Chart } from './Chart';
import { ShapeControls } from './ShapeControls';
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
  PORT_OFFSET_RANGE,
  type PortPlace,
  sanitizeLoudspeaker,
  slotLabel,
} from './loudspeaker';
import { BOX_RANGES, CUSTOM_CLASS, CUSTOM_RANGES, type Design, PR_RANGES, type PassiveDesign, passiveDefaults } from './model';
import { type Project, sanitizeProject } from './system';

/** The box kinds a speaker slot is built as. */
const SLOT_BOXES = [
  { id: 'sealed', label: 'Sealed' },
  { id: 'ported', label: 'Ported' },
  { id: 'passive', label: 'Passive radiator' },
] as const;

export function SpeakerView({ project, onChange, db = emptyDb() }: { project: Project; onChange: (p: Project) => void; db?: DriverDb }) {
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
          <ShapeControls idp="sp" shape={sp.shape} onChange={(shape) => set({ shape })} />
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
          {arr.slots.some((_, k) => sp.slots[k]!.design.type === 'ported' && !sp.slots[k]!.open) && (
            <>
              <h3>Port position</h3>
              <div className="field">
                <label htmlFor="port-place">Port on the cabinet</label>
                <select id="port-place" value={sp.portPos.place} onChange={(e) => set({ portPos: { ...sp.portPos, place: e.target.value as PortPlace } })}>
                  <option value="below">Under the drivers</option>
                  <option value="top-right">Beside the top driver, to its right</option>
                  <option value="top-left">Beside the top driver, to its left</option>
                  <option value="bottom-right">Beside the lowest driver, to its right</option>
                  <option value="bottom-left">Beside the lowest driver, to its left</option>
                  <option value="rear">On the back wall</option>
                </select>
              </div>
              <Field id="port-dx" range={PORT_OFFSET_RANGE.dxCm} value={sp.portPos.dxCm} onChange={(v) => set({ portPos: { ...sp.portPos, dxCm: v } })} />
              <Field id="port-dy" range={PORT_OFFSET_RANGE.dyCm} value={sp.portPos.dyCm} onChange={(v) => set({ portPos: { ...sp.portPos, dyCm: v } })} />
              <p className="hint">Moves the hole in the cut list, the baffle drawing and the 3D view; the response and the port's length do not change. The offsets nudge the port from the chosen spot (a rear port is measured as seen from behind).</p>
            </>
          )}
          <h3>Driver layout</h3>
          <LayoutControls
            layout={sp.slots[0]!.design.layout}
            count={arr.layout.length}
            idp="sp"
            pushPullOk={false}
            onChange={(layout) => set({ slots: sp.slots.map((s) => ({ ...s, design: { ...s.design, layout } })) })}
          />
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
          const isCustom = d.driverClass === CUSTOM_CLASS && !d.libDriver;
          return (
            <section key={k} className={`band band-${k}`}>
              <h2>
                <span className="swatch" aria-hidden="true" />
                {c.slots[k]!.name}
              </h2>
              <p className="hint">{c.slots[k]!.summary}</p>
              <DriverPicker id={`sp-class-${k}`} design={d} db={db} onChange={(patch) => setDesign(k, patch)} />
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
                    <select id={`sp-box-${k}`} value={d.type === 'ported' || d.type === 'passive' ? d.type : 'sealed'} onChange={(e) => setDesign(k, e.target.value === 'ported' ? { type: 'ported', ...portedDefaults(d, spec.count) } : e.target.value === 'passive' ? { type: 'passive', ...passiveDefaults(d, spec.count) } : { type: 'sealed' })}>
                      {SLOT_BOXES.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Field id={`sp-vol-${k}`} slider range={{ ...BOX_RANGES.volumeL, label: spec.count > 1 ? `Air for all ${spec.count}` : 'Air' }} value={d.volumeL} onChange={(v) => setDesign(k, { volumeL: v })} />
                  {d.type === 'ported' && <Field id={`sp-tune-${k}`} slider range={BOX_RANGES.tuneHz} value={d.tuneHz} onChange={(v) => setDesign(k, { tuneHz: v })} />}
                  {d.type === 'ported' && <PortControls design={d} onChange={(patch) => setDesign(k, patch)} idp={`sp-${k}`} />}
                  {d.type === 'passive' && <Field id={`sp-tune-${k}`} slider range={{ ...BOX_RANGES.tuneHz, label: 'Box tuning fB' }} value={d.tuneHz} onChange={(v) => setDesign(k, { tuneHz: v })} />}
                  {d.type === 'passive' &&
                    (['sdpCm2', 'vapL', 'massG', 'xmaxMm'] as (keyof PassiveDesign)[]).map((f) => <Field key={f} id={`sp-pr-${k}-${f}`} range={PR_RANGES[f]} value={d.pr[f]} onChange={(v) => setDesign(k, { pr: { ...d.pr, [f]: v } })} />)}
                  {d.type === 'passive' && <p className="hint">One radiator for each driver of the slot; a field at 0 copies the driver's cone. Add the mass the cut list gives to tune the box.</p>}
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
