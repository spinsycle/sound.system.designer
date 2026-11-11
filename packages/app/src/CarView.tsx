// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The car page: one or more subwoofers in one enclosure (box or wedge), the amplifier and its wiring, the cabin, the vehicle space,
// and the in-car response with the limits.
import * as P from '@soundsystemdesigner/physics';
import { useMemo, useState } from 'react';
import { Field } from './BoxDesigner';
import { BRACES, BUILD_RANGES } from './build';
import { computeBuild } from './buildlist';
import {
  AMP_EFFICIENCY,
  CABLE_AWGS,
  CAR_AMP_LOADS,
  CAR_AMP_MIN_LOADS,
  CAR_COUNT_RANGE,
  CAR_RANGES,
  MAX_DROP_FRAC,
  MUSIC_DUTIES,
  type CarSub,
  SPACES,
  SPACE_RANGES,
  computeCarElectric,
  carPortedDefaults,
  computeCarSub,
  computeCarSystem,
  levelFront,
  sanitizeCar,
  spaceOf,
} from './carsub';
import { CAR_TEMPLATES, applyCarTemplate } from './cartemplates';
import { Chart } from './Chart';
import {
  FRONT_COAX_CLASSES,
  FRONT_COMPONENT_CLASSES,
  FRONT_RANGES,
  FRONT_TWEETER_CLASSES,
  type CarFront,
  type FrontMount,
  MOUNT_DEFAULTS,
  applyFront,
} from './carfront';
import { BOX_RANGES, CUSTOM_CLASS, CUSTOM_RANGES, type Design } from './model';
import { type Project, sanitizeProject } from './system';

const CAUSES = { amp: 'the amp', heat: 'driver power', excursion: 'cone excursion' } as const;
const divisors = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1).filter((s) => n % s === 0);
const fmt = (v: number, digits = 1): string => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(digits));
/** First class that is a car sub: the picker lists these before the others. */
const FIRST_CAR_CLASS = P.ALL_DRIVER_CLASSES.findIndex((d) => d.name.includes('car sub'));

export function CarView({ project, onChange }: { project: Project; onChange: (p: Project) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const [template, setTemplate] = useState(0);
  const c = project.car;
  const d = c.design;
  const v = useMemo(() => computeCarSub(c), [c]);
  const el = useMemo(() => computeCarElectric(c, v.limits), [c, v]);
  const sys = useMemo(() => computeCarSystem(c), [c]);
  const fr = c.front;
  const setFront = (patch: Partial<CarFront>): void => setCar({ ...c, front: applyFront(fr, patch) });
  const build = useMemo(() => computeBuild(project).bands[0]!, [project]);

  const setCar = (next: CarSub): void => onChange(sanitizeProject({ ...project, car: sanitizeCar(next) }));
  const set = (patch: Partial<CarSub>): void => setCar({ ...c, ...patch });
  const setDesign = (patch: Partial<Design>): void => set({ design: { ...d, ...patch } });
  const setBuildOpts = (patch: Partial<CarSub['build']>): void => set({ build: { ...c.build, ...patch } });
  const driverName = P.ALL_DRIVER_CLASSES[d.driverClass]?.name ?? 'Custom';
  const dual = c.coils === 2;
  const isCustom = d.driverClass === CUSTOM_CLASS;
  const t = project.shop.thicknessMm / 10; // cm

  /** Proportions of the inside of the space, so the box fills it as far as the air allows. */
  const fitToSpace = (): void => {
    const s = c.space;
    if (s.id === 'none') return;
    const w = Math.max(s.wCm - 2 * t, 1);
    const h = Math.max(s.hCm - 2 * t, 1);
    const dep = Math.max(s.dCm - 2 * t, 1);
    const m = Math.max(w, h, dep);
    setBuildOpts({ rw: w / m, rh: h / m, rd: dep / m });
  };

  const peak = Math.max(...v.levelDb, ...v.freeDb);
  const yMax = Math.ceil((peak + 3) / 10) * 10;
  const sysMax = Math.ceil((Math.max(...sys.totalDb) + 3) / 10) * 10;
  const lowLoad = v.limits.minLoadOhm < v.limits.amplifierMinLoadOhm;
  const fit = build.fit;

  return (
    <main>
      <div className="controls">
        <section>
          <h2>Install</h2>
          <div className="field stacked">
            <label htmlFor="car-template">Starting point</label>
            <select id="car-template" value={template} onChange={(e) => setTemplate(Number(e.target.value))}>
              {CAR_TEMPLATES.map((t, i) => (
                <option key={t.label} value={i}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <p className="hint">{CAR_TEMPLATES[template]!.description}</p>
          <button type="button" onClick={() => setCar(applyCarTemplate(c, template))}>
            Load it (replaces the install, keeps your 12 V settings)
          </button>
          <div className="field">
            <label htmlFor="car-cabin">Cabin</label>
            <select id="car-cabin" value={c.cabin} onChange={(e) => set({ cabin: e.target.value as P.CabinId })}>
              {P.CABIN_TYPES.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          <p className="hint">
            {P.cabinOf(c.cabin).gainDb > 0 ? `Adds ${P.cabinOf(c.cabin).gainDb} dB below ${P.cabinOf(c.cabin).cornerHz} Hz (a generic rule of thumb, not a measurement of your car).` : 'No cabin gain: the free-field response.'}
          </p>
          <Field id="car-count" range={CAR_COUNT_RANGE} value={c.count} onChange={(x) => set({ count: Math.round(x) })} />
          {c.count > 1 && (
            <div className="field">
              <label htmlFor="car-series">Subs wired</label>
              <select id="car-series" value={c.series} onChange={(e) => set({ series: Number(e.target.value) })}>
                {divisors(c.count).map((s) => (
                  <option key={s} value={s}>
                    {s === 1 ? 'All in parallel' : s === c.count ? 'All in series' : `${s} in series, ${c.count / s} strings in parallel`}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="segmented" role="radiogroup" aria-label="Voice coils">
            {[1, 2].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={c.coils === n} className={c.coils === n ? 'on' : ''} onClick={() => set({ coils: n, coilSeries: 1 })}>
                {n === 1 ? 'Single coil' : 'Dual coil'}
              </button>
            ))}
          </div>
          {dual && (
            <div className="segmented" role="radiogroup" aria-label="Coil wiring">
              {[1, 2].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={c.coilSeries === n} className={c.coilSeries === n ? 'on' : ''} onClick={() => set({ coilSeries: n })}>
                  {n === 1 ? 'Coils in parallel' : 'Coils in series'}
                </button>
              ))}
            </div>
          )}
          <p className={lowLoad ? 'hint warn' : 'hint'}>
            The amp sees {fmt(v.loadOhm)} {'Ω'} nominal (lowest over the band {fmt(v.limits.minLoadOhm)} {'Ω'}).
          </p>
          <h3>Amplifier</h3>
          <Field id="car-amp" range={CAR_RANGES.ampPowerW} value={c.ampPowerW} onChange={(x) => set({ ampPowerW: x })} />
          <div className="field">
            <label htmlFor="car-amp-load">Power is rated into</label>
            <select id="car-amp-load" value={c.ampLoadOhm} onChange={(e) => set({ ampLoadOhm: Number(e.target.value) })}>
              {CAR_AMP_LOADS.map((r) => (
                <option key={r} value={r}>
                  {r} {'Ω'}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="car-amp-min">Lowest load it accepts</label>
            <select id="car-amp-min" value={c.ampMinLoadOhm} onChange={(e) => set({ ampMinLoadOhm: Number(e.target.value) })}>
              {CAR_AMP_MIN_LOADS.map((r) => (
                <option key={r} value={r}>
                  {r} {'Ω'}
                </option>
              ))}
            </select>
          </div>
          <div className="checks">
            <label>
              <input type="checkbox" checked={c.bridged} onChange={(e) => set({ bridged: e.target.checked })} />
              Two channels bridged (the rating is per channel)
            </label>
          </div>
          <Field id="car-subsonic" slider range={CAR_RANGES.subsonicHz} value={c.subsonicHz} onChange={(x) => set({ subsonicHz: x })} />
        </section>

        <section>
          <h2>Subwoofer</h2>
          <p className="hint">{`${c.count > 1 ? `${c.count} x ` : ''}${driverName}`}</p>
          <div className="field">
            <label htmlFor="car-class">Driver</label>
            <select id="car-class" value={d.driverClass} onChange={(e) => setDesign({ driverClass: Number(e.target.value) })}>
              <optgroup label="Car subs">
                {P.ALL_DRIVER_CLASSES.map((k, i) => (i >= FIRST_CAR_CLASS ? <option key={k.name} value={i}>{k.name}</option> : null))}
              </optgroup>
              <optgroup label="Other classes">
                {P.ALL_DRIVER_CLASSES.map((k, i) => (i < FIRST_CAR_CLASS ? <option key={k.name} value={i}>{k.name}</option> : null))}
                <option value={CUSTOM_CLASS}>Custom</option>
              </optgroup>
            </select>
          </div>
          {isCustom &&
            (Object.keys(CUSTOM_RANGES) as (keyof P.CustomDriverFields)[]).map((f) => (
              <Field key={f} id={`car-custom-${f}`} range={CUSTOM_RANGES[f]} value={d.custom[f]} onChange={(x) => setDesign({ custom: { ...d.custom, [f]: x } })} />
            ))}
          <p className="hint">Re is per voice coil. Xmax and power are for the whole driver.</p>
          <div className="segmented" role="radiogroup" aria-label="Box type">
            {(['sealed', 'ported', 'bandpass'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={d.type === k}
                className={d.type === k ? 'on' : ''}
                onClick={() => setDesign(k === 'ported' ? { type: k, ...carPortedDefaults(d, c.count) } : { type: k })}
              >
                {{ sealed: 'Sealed', ported: 'Ported', bandpass: 'Band-pass' }[k]}
              </button>
            ))}
          </div>
          <Field id="car-vol" slider range={{ ...BOX_RANGES.volumeL, label: c.count > 1 ? `Air for all ${c.count}` : d.type === 'bandpass' ? 'Rear air' : 'Air' }} value={d.volumeL} onChange={(x) => setDesign({ volumeL: x })} />
          {d.type !== 'sealed' && <Field id="car-tune" slider range={BOX_RANGES.tuneHz} value={d.tuneHz} onChange={(x) => setDesign({ tuneHz: x })} />}
          {d.type !== 'sealed' && <Field id="car-port" range={BOX_RANGES.portDiameterCm} value={d.portDiameterCm} onChange={(x) => setDesign({ portDiameterCm: x })} />}
          {d.type === 'bandpass' && <Field id="car-front" range={BOX_RANGES.frontVolumeL} value={d.frontVolumeL} onChange={(x) => setDesign({ frontVolumeL: x })} />}
        </section>

        <section>
          <h2>Enclosure</h2>
          <div className="segmented" role="radiogroup" aria-label="Shape">
            {(['box', 'wedge'] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={c.shape === k} className={c.shape === k ? 'on' : ''} onClick={() => set({ shape: k })}>
                {k === 'box' ? 'Rectangular box' : 'Wedge'}
              </button>
            ))}
          </div>
          {c.shape === 'wedge' && <Field id="car-taper" slider range={CAR_RANGES.taper} value={c.taper} onChange={(x) => set({ taper: x })} />}
          {c.shape === 'wedge' && <p className="hint">The baffle slopes from the front of the bottom up to the front of the top. A taper of 1 is a plain box.</p>}
          <Field id="car-rw" range={BUILD_RANGES.rw} value={c.build.rw} onChange={(x) => setBuildOpts({ rw: x })} />
          <Field id="car-rh" range={BUILD_RANGES.rh} value={c.build.rh} onChange={(x) => setBuildOpts({ rh: x })} />
          <Field id="car-rd" range={{ ...BUILD_RANGES.rd, label: c.shape === 'wedge' ? 'Bottom depth' : 'Depth' }} value={c.build.rd} onChange={(x) => setBuildOpts({ rd: x })} />
          {c.shape === 'box' && (
            <div className="field">
              <label htmlFor="car-brace">Bracing</label>
              <select id="car-brace" value={c.build.brace} onChange={(e) => setBuildOpts({ brace: e.target.value as CarSub['build']['brace'] })}>
                {BRACES.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <h3>Vehicle space</h3>
          <div className="field">
            <label htmlFor="car-space">Space</label>
            <select id="car-space" value={c.space.id} onChange={(e) => set({ space: { ...spaceOf(e.target.value) } })}>
              {SPACES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          {c.space.id === 'custom' &&
            (['wCm', 'hCm', 'dCm'] as const).map((k) => <Field key={k} id={`car-space-${k}`} range={SPACE_RANGES[k]} value={c.space[k]} onChange={(x) => set({ space: { ...c.space, [k]: x } })} />)}
          {c.space.id !== 'none' && (
            <p className="hint">
              Largest outside size {fmt(c.space.wCm, 0)} x {fmt(c.space.hCm, 0)} x {fmt(c.space.dCm, 0)} cm (width, height, depth). Generic starting sizes: set Custom to your own.
            </p>
          )}
          {fit?.space && (
            <p className={fit.fits ? 'hint' : 'hint warn'} role="status">
              {fit.fits ? 'The box fits the space: ' : 'The box does not fit the space: '}
              {fmt(fit.outside[0] * 100)} x {fmt(fit.outside[1] * 100)} x {fmt(fit.outside[2] * 100)} cm outside.
            </p>
          )}
          <button type="button" onClick={fitToSpace} disabled={c.space.id === 'none'}>
            Fit to the space
          </button>
          <button type="button" onClick={() => onChange(sanitizeProject({ ...project, view: 'build' }))}>
            Cut list and drawings
          </button>
        </section>

        <section>
          <h2>12 V supply</h2>
          <div className="segmented" role="radiogroup" aria-label="Amplifier class">
            {(['d', 'ab'] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={c.ampClass === k} className={c.ampClass === k ? 'on' : ''} onClick={() => set({ ampClass: k })}>
                {k === 'd' ? 'Class D' : 'Class AB'}
              </button>
            ))}
          </div>
          <p className="hint">Efficiency {AMP_EFFICIENCY[c.ampClass]} (a rule of thumb: class D about 0.85, class AB about 0.6).</p>
          <Field id="car-supply" range={CAR_RANGES.supplyV} value={c.supplyV} onChange={(x) => set({ supplyV: x })} />
          <div className="field">
            <label htmlFor="car-awg">Cable gauge</label>
            <select id="car-awg" value={c.cableAwg} onChange={(e) => set({ cableAwg: Number(e.target.value) })}>
              {CABLE_AWGS.map((a) => (
                <option key={a} value={a}>
                  {a === 0 ? '0 AWG (1/0)' : `${a} AWG`}
                </option>
              ))}
            </select>
          </div>
          <Field id="car-cable" range={CAR_RANGES.cableM} value={c.cableM} onChange={(x) => set({ cableM: x })} />
          <div className="field stacked">
            <label htmlFor="car-duty">On music the amp averages</label>
            <select id="car-duty" value={c.duty} onChange={(e) => set({ duty: Number(e.target.value) })}>
              {MUSIC_DUTIES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <Field id="car-alt" range={CAR_RANGES.alternatorA} value={c.alternatorA} onChange={(x) => set({ alternatorA: x })} />
          <Field id="car-other" range={CAR_RANGES.otherLoadsA} value={c.otherLoadsA} onChange={(x) => set({ otherLoadsA: x })} />
          <p className="hint">The cable is the power run from the battery; the ground return is taken as the same gauge and length.</p>
        </section>

        <section>
          <h2>Front speakers</h2>
          <div className="checks">
            <label>
              <input type="checkbox" checked={fr.enabled} onChange={(e) => setFront({ enabled: e.target.checked })} />
              Add front speakers (a pair) to the system
            </label>
          </div>
          {fr.enabled && (
            <>
              <div className="segmented" role="radiogroup" aria-label="Front type">
                {(['component', 'coaxial'] as const).map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={fr.type === k} className={fr.type === k ? 'on' : ''} onClick={() => setFront({ type: k })}>
                    {k === 'component' ? 'Component set' : 'Coaxial'}
                  </button>
                ))}
              </div>
              <div className="segmented" role="radiogroup" aria-label="Mounting place">
                {(Object.keys(MOUNT_DEFAULTS) as FrontMount[]).map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={fr.mount === k} className={fr.mount === k ? 'on' : ''} onClick={() => setFront({ mount: k })}>
                    {MOUNT_DEFAULTS[k].label}
                  </button>
                ))}
              </div>
              <div className="field">
                <label htmlFor="front-class">{fr.type === 'coaxial' ? 'Coaxial' : 'Woofer'}</label>
                <select id="front-class" value={fr.wooferClass} onChange={(e) => setFront({ wooferClass: Number(e.target.value) })}>
                  {(fr.type === 'coaxial' ? FRONT_COAX_CLASSES : FRONT_COMPONENT_CLASSES).map((n) => (
                    <option key={n} value={P.ALL_DRIVER_CLASSES.findIndex((d) => d.name === n)}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              {fr.type === 'component' && (
                <div className="field">
                  <label htmlFor="front-tweeter">Tweeter</label>
                  <select id="front-tweeter" value={fr.tweeterClass} onChange={(e) => setFront({ tweeterClass: Number(e.target.value) })}>
                    {FRONT_TWEETER_CLASSES.map((n) => (
                      <option key={n} value={P.ALL_DRIVER_CLASSES.findIndex((d) => d.name === n)}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <Field id="front-air" slider range={FRONT_RANGES.airL} value={fr.airL} onChange={(x) => setFront({ airL: x })} />
              <Field id="front-xsub" slider range={FRONT_RANGES.xoverSubHz} value={fr.xoverSubHz} onChange={(x) => setFront({ xoverSubHz: x })} />
              {fr.type === 'component' && <Field id="front-xtw" slider range={FRONT_RANGES.xoverTweeterHz} value={fr.xoverTweeterHz} onChange={(x) => setFront({ xoverTweeterHz: x })} />}
              <Field id="front-trim" slider range={FRONT_RANGES.trimDb} value={fr.trimDb} onChange={(x) => setFront({ trimDb: x })} />
              {fr.type === 'component' && <Field id="front-twtrim" slider range={FRONT_RANGES.tweeterTrimDb} value={fr.tweeterTrimDb} onChange={(x) => setFront({ tweeterTrimDb: x })} />}
              <button type="button" onClick={() => setCar(levelFront(c))}>
                Level the fronts to the sub
              </button>
              <h3>Fit</h3>
              <Field id="front-depth" range={FRONT_RANGES.depthCm} value={fr.depthCm} onChange={(x) => setFront({ depthCm: x })} />
              <Field id="front-opening" range={FRONT_RANGES.openingCm} value={fr.openingCm} onChange={(x) => setFront({ openingCm: x })} />
              <Field id="front-ring" range={FRONT_RANGES.ringCm} value={fr.ringCm} onChange={(x) => setFront({ ringCm: x })} />
              <p className="hint">The air, depth and opening start at generic values for the place you chose: set your own. Levels are for one speaker. A door is leaky, so its air is a rough guess.</p>
            </>
          )}
        </section>
      </div>

      <div className="charts one">
        {fr.enabled ? (
          <Chart
            title="In-car level, sub and fronts"
            unit="dB SPL"
            freqs={sys.freqs}
            values={sys.totalDb}
            overlays={[
              { label: 'Sub', values: sys.subDb, className: 'overlay band-line band-0' },
              { label: fr.type === 'coaxial' ? 'Coaxial' : 'Front woofer', values: sys.wooferDb, className: 'overlay band-line band-1' },
              ...(sys.tweeterDb ? [{ label: 'Tweeter', values: sys.tweeterDb, className: 'overlay band-line band-2' }] : []),
            ]}
            yMin={sysMax - 60}
            yMax={sysMax}
            yStep={10}
            vLines={sys.xover.map((f, k) => ({ f, label: `x${k + 1}` }))}
            hover={hover}
            onHover={setHover}
          />
        ) : (
        <Chart
          title="In-car level"
          unit="dB SPL"
          freqs={v.freqs}
          values={v.levelDb}
          overlays={[{ label: 'Without cabin gain', values: v.freeDb, className: 'overlay band-line band-1' }]}
          yMin={yMax - 50}
          yMax={yMax}
          yStep={10}
          vLines={[{ f: c.subsonicHz, label: 'subsonic' }, ...(d.type === 'sealed' ? [] : [{ f: d.tuneHz, label: 'tuned' }])]}
          hover={hover}
          onHover={setHover}
        />
        )}
        <section>
          <h2>How loud it goes</h2>
          <table>
            <tbody>
              <tr>
                <th scope="row" className="left">
                  Average level, 25 to 120 Hz
                </th>
                <td>{fmt(v.averageDb)} dB SPL at {fmt(2.83, 2)} V, 1 m, with the cabin gain</td>
              </tr>
              <tr>
                <th scope="row" className="left">
                  Load on the amp
                </th>
                <td className={lowLoad ? 'warn' : ''}>
                  {fmt(v.loadOhm)} {'Ω'} nominal, {fmt(v.limits.minLoadOhm)} {'Ω'} lowest, amp accepts {fmt(v.limits.amplifierMinLoadOhm)} {'Ω'}
                </td>
              </tr>
              <tr>
                <th scope="row" className="left">
                  Amp output
                </th>
                <td>
                  {fmt(v.limits.ampV)} V, {fmt(v.limits.ampIntoLoadW, 0)} W into this load
                </td>
              </tr>
              <tr>
                <th scope="row" className="left">
                  Stops at
                </th>
                <td>
                  {fmt(v.limits.limitV)} V, stopped by {CAUSES[v.limits.cause]}
                </td>
              </tr>
              <tr>
                <th scope="row" className="left">
                  Supply current
                </th>
                <td>
                  {fmt(el.peakA, 0)} A at full power ({fmt(el.powerW, 0)} W out), about {fmt(el.musicA)} A on music
                </td>
              </tr>
              <tr>
                <th scope="row" className="left">
                  Cable
                </th>
                <td className={el.dropFrac > MAX_DROP_FRAC ? 'warn' : ''}>
                  {c.cableAwg} AWG, {fmt(c.cableM)} m: loses {fmt(el.dropV, 2)} V ({fmt(el.dropFrac * 100)} %); {el.minAwg >= 0 ? `${el.minAwg} AWG is the thinnest within ${fmt(MAX_DROP_FRAC * 100, 0)} %` : 'no gauge holds it within the budget'}
                </td>
              </tr>
              <tr>
                <th scope="row" className="left">
                  Fuse at the battery
                </th>
                <td>{el.fuseA} A</td>
              </tr>
              <tr>
                <th scope="row" className="left">
                  Alternator
                </th>
                <td className={el.alternatorMarginA < 0 ? 'warn' : ''}>
                  {fmt(el.alternatorMarginA, 0)} A spare after the car and the amp on music ({fmt(c.alternatorA, 0)} A rated)
                </td>
              </tr>
              <tr>
                <th scope="row" className="left">
                  Headroom, maximum level
                </th>
                <td>
                  {fmt(v.limits.headroomDb)} dB above the reference input, about {fmt(v.limits.maxDb, 0)} dB SPL average
                </td>
              </tr>
            </tbody>
          </table>
          {(v.warnings.length > 0 || build.warnings.length > 0 || el.warnings.length > 0 || sys.warnings.length > 0) && (
            <ul className="warnings">
              {[...new Set([...v.warnings, ...el.warnings, ...sys.warnings, ...build.warnings])].map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <ul className="notes">
            {v.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
