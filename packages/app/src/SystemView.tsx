// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The whole system: bands, crossover points, trims, and the summed response in dB SPL.
import { useMemo, useState } from 'react';
import { Field } from './BoxDesigner';
import { Chart } from './Chart';
import { BAND_RANGES, type Band, DISTANCE_RANGE, LOWEST_RANGE, MAX_BANDS, type Project, TEMPLATES, XOVER_RANGE, applyTemplate, bandName, computeSystem, levelTrims, sanitizeProject } from './system';

export function SystemView({ project, onChange }: { project: Project; onChange: (p: Project) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const [template, setTemplate] = useState(0);
  const c = useMemo(() => computeSystem(project), [project]);

  const set = (patch: Partial<Project>): void => onChange(sanitizeProject({ ...project, ...patch }));
  const setBand = (k: number, patch: Partial<Band>): void => set({ bands: project.bands.map((b, i) => (i === k ? { ...b, ...patch } : b)) });
  const level = (): void => {
    const trims = levelTrims({ ...project, bands: project.bands.map((b) => ({ ...b, trimDb: 0 })) });
    set({ bands: project.bands.map((b, k) => (k < trims.length ? { ...b, trimDb: trims[k]! } : b)) });
  };

  const audible = c.bands.map((b, k) => ({ b, k })).filter((x) => x.b.audible);
  const peak = Math.max(...c.levelDb, ...audible.flatMap((x) => x.b.levelDb));
  const yMax = Math.ceil((peak + 3) / 10) * 10;

  return (
    <main>
      <div className="controls">
        <section>
          <h2>System</h2>
          <div className="field stacked">
            <label htmlFor="template">Starting point</label>
            <select id="template" value={template} onChange={(e) => setTemplate(Number(e.target.value))}>
              {TEMPLATES.map((t, i) => (
                <option key={t.label} value={i}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <p className="hint">{TEMPLATES[template]!.description}</p>
          <button type="button" onClick={() => onChange(applyTemplate(project, template))}>
            Load it (replaces every band)
          </button>

          <h3>Bands</h3>
          <div className="segmented" role="radiogroup" aria-label="Number of bands">
            {Array.from({ length: MAX_BANDS }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" role="radio" aria-checked={project.nBands === n} className={project.nBands === n ? 'on' : ''} onClick={() => set({ nBands: n })}>
                {n}
              </button>
            ))}
          </div>
          {c.xover.map((_, k) => (
            <Field
              key={k}
              id={`xover-${k}`}
              slider
              range={{ ...XOVER_RANGE, label: `${bandName(project.nBands, k)} / ${bandName(project.nBands, k + 1)}` }}
              value={project.xover[k]!}
              onChange={(v) => set({ xover: project.xover.map((x, i) => (i === k ? v : x)) })}
            />
          ))}
          <Field id="lowest" range={LOWEST_RANGE} value={project.lowestHz} onChange={(v) => set({ lowestHz: v })} />
          <Field id="distance" range={DISTANCE_RANGE} value={project.distanceM} onChange={(v) => set({ distanceM: v })} />
          {project.nBands > 1 && (
            <button type="button" onClick={level}>
              Level the bands
            </button>
          )}
        </section>

        {c.bands.map((b, k) => {
          const band = project.bands[k]!;
          return (
            <section key={k} className={`band band-${k}`}>
              <h2>
                <span className="swatch" aria-hidden="true" />
                {b.name}
              </h2>
              <p className="hint">{b.summary}</p>
              <Field id={`trim-${k}`} slider range={BAND_RANGES.trimDb} value={band.trimDb} onChange={(v) => setBand(k, { trimDb: v })} />
              <Field id={`delay-${k}`} slider range={BAND_RANGES.delayMs} value={band.delayMs} onChange={(v) => setBand(k, { delayMs: v })} />
              <div className="checks">
                {(['invert', 'solo', 'mute'] as const).map((key) => (
                  <label key={key}>
                    <input type="checkbox" checked={band[key]} onChange={(e) => setBand(k, { [key]: e.target.checked })} />
                    {key[0]!.toUpperCase() + key.slice(1)}
                  </label>
                ))}
              </div>
              <button type="button" onClick={() => set({ selected: k, view: 'box' })}>
                Edit this box
              </button>
            </section>
          );
        })}
      </div>

      <div className="charts one">
        <Chart
          title="System level"
          unit="dB SPL"
          freqs={c.freqs}
          values={c.levelDb}
          overlays={audible.map((x) => ({ label: x.b.name, values: x.b.levelDb, className: `overlay band-line band-${x.k}` }))}
          yMin={yMax - 60}
          yMax={yMax}
          yStep={10}
          vLines={c.xover.map((f, k) => ({ f, label: `x${k + 1}` }))}
          hover={hover}
          onHover={setHover}
        />
        <section>
          <h2>Bands</h2>
          <table>
            <thead>
              <tr>
                <th scope="col" className="left">
                  Band
                </th>
                <th scope="col">Passband, Hz</th>
                <th scope="col">Own level, dB</th>
                <th scope="col">Trim, dB</th>
                <th scope="col">Plays at, dB</th>
              </tr>
            </thead>
            <tbody>
              {c.bands.map((b, k) => (
                <tr key={k} className={b.audible ? '' : 'off'}>
                  <th scope="row" className="left">
                    {b.name}
                  </th>
                  <td>
                    {b.loHz.toFixed(0)} to {b.hiHz.toFixed(0)}
                  </td>
                  <td>{Number.isFinite(b.nativeDb) ? b.nativeDb.toFixed(1) : 'none'}</td>
                  <td>{project.bands[k]!.trimDb.toFixed(1)}</td>
                  <td>{Number.isFinite(b.nativeDb) ? (b.nativeDb + project.bands[k]!.trimDb).toFixed(1) : 'none'}</td>
                </tr>
              ))}
            </tbody>
            <caption>Own level: the band's boxes averaged over its passband at 0 dB trim and 1 m, before the crossover.</caption>
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
