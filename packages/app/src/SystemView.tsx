// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The whole system: bands, crossover points, trims, and the summed response in dB SPL.
import { useMemo, useState } from 'react';
import { Field } from './BoxDesigner';
import { Chart } from './Chart';
import { AMP_LOADS, BAND_RANGES, type Band, COUNT_RANGE, DISTANCE_RANGE, LOWEST_RANGE, MAX_BANDS, type Project, TEMPLATES, XOVER_RANGE, applyTemplate, bandName, computeSystem, levelTrims, sanitizeProject } from './system';

const divisors = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1).filter((s) => n % s === 0);
const wiringLabel = (n: number, s: number): string => (n === 1 ? 'One driver' : s === 1 ? 'All in parallel' : s === n ? 'All in series' : `${s} in series, ${n / s} strings in parallel`);
const CAUSES = { amp: 'the amp', heat: 'driver power', excursion: 'cone excursion' } as const;

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

              <h3>Drivers and amp</h3>
              <Field id={`count-${k}`} range={COUNT_RANGE} value={band.count} onChange={(v) => setBand(k, { count: Math.round(v) })} />
              <div className="field">
                <label htmlFor={`wiring-${k}`}>Wiring</label>
                <select id={`wiring-${k}`} value={band.series} onChange={(e) => setBand(k, { series: Number(e.target.value) })}>
                  {divisors(band.count).map((s) => (
                    <option key={s} value={s}>
                      {wiringLabel(band.count, s)}
                    </option>
                  ))}
                </select>
              </div>
              <Field id={`amp-${k}`} range={BAND_RANGES.ampPowerW} value={band.ampPowerW} onChange={(v) => setBand(k, { ampPowerW: v })} />
              <div className="field">
                <label htmlFor={`ampload-${k}`}>Amp power is rated into</label>
                <select id={`ampload-${k}`} value={band.ampLoadOhm} onChange={(e) => setBand(k, { ampLoadOhm: Number(e.target.value) })}>
                  {AMP_LOADS.map((r) => (
                    <option key={r} value={r}>
                      {r} Ω
                    </option>
                  ))}
                </select>
              </div>
              <Field id={`ampmin-${k}`} range={BAND_RANGES.ampMinLoadOhm} value={band.ampMinLoadOhm} onChange={(v) => setBand(k, { ampMinLoadOhm: v })} />
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

          <h3>How loud it goes</h3>
          <table>
            <thead>
              <tr>
                <th scope="col" className="left">
                  Band
                </th>
                <th scope="col">Lowest load, Ω</th>
                <th scope="col">Amp, V</th>
                <th scope="col">Stops at, V</th>
                <th scope="col" className="left pad">
                  Stopped by
                </th>
                <th scope="col">Max level, dB</th>
                <th scope="col">Headroom, dB</th>
              </tr>
            </thead>
            <tbody>
              {c.bands.map((b, k) => (
                <tr key={k} className={b.audible ? (c.limits.limitingBand === k ? 'first' : '') : 'off'}>
                  <th scope="row" className="left">
                    {b.name}
                  </th>
                  <td>{b.limits.minLoadOhm.toFixed(1)}</td>
                  <td>{b.limits.ampV.toFixed(1)}</td>
                  <td>{b.limits.limitV.toFixed(1)}</td>
                  <td className="left pad">{CAUSES[b.limits.cause]}</td>
                  <td>{Number.isFinite(b.limits.maxDb) ? b.limits.maxDb.toFixed(1) : 'none'}</td>
                  <td>{b.limits.headroomDb.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
            <caption>
              {c.limits.limitingBand >= 0
                ? `The system can be raised ${c.limits.headroomDb.toFixed(1)} dB above the reference input before ${c.bands[c.limits.limitingBand]!.name} stops (${CAUSES[c.bands[c.limits.limitingBand]!.limits.cause]}): about ${(c.limits.referenceDb + c.limits.headroomDb).toFixed(0)} dB SPL average at ${project.distanceM.toFixed(project.distanceM < 10 ? 1 : 0)} m. `
                : 'No band is audible. '}
              Max level is each band's own passband level at 1 m, at the voltage where it stops.
            </caption>
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
