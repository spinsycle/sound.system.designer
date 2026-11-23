// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// "Find drivers for this box": every usable driver in the database run through this box, best first, with the figures that make the
// score. It runs when you press Find (a few dozen designs is quick, but it is not redone on every keystroke) and says when the box has
// changed since. Use puts a driver into the box; Show draws its response over the current one.
import { useMemo, useState } from 'react';
import { Chart } from './Chart';
import { type RankRow, rankDrivers } from './compare';
import { fmtHz } from './ComparePanel';
import { DRIVER_KINDS, type DriverKind } from './drivers/entry';
import { type DriverDb, allDrivers } from './drivers/library';
import { type Design, compute } from './model';

const f0 = (v: number): string => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));
const MAX_ROWS = 15;

export function DriverFinder(p: { design: Design; db: DriverDb; wallM?: number; onUse: (d: Design) => void }) {
  const [favOnly, setFavOnly] = useState(false);
  const [kind, setKind] = useState<DriverKind | 'any'>('any');
  const current = useMemo(() => compute(p.design, p.wallM), [p.design, p.wallM]);
  const [target, setTarget] = useState('');
  const [found, setFound] = useState<{ rows: RankRow[]; key: string; shown: string[] } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const key = JSON.stringify(p.design);
  const targetHz = Number(target.replace(',', '.'));
  const targetOk = target.trim() !== '' && Number.isFinite(targetHz) && targetHz >= 10 && targetHz <= 500;
  const autoTarget = Math.round(current.curves.responseDb.length ? (current.freqs.find((f, i) => current.curves.responseDb[i]! >= Math.max(...current.curves.responseDb) - 3) ?? 40) : 40);

  const find = (): void => {
    const pool = allDrivers(p.db).filter((e) => (!favOnly || e.favourite) && (kind === 'any' || e.kind === kind));
    const rows = rankDrivers(p.design, pool, targetOk ? targetHz : autoTarget, p.wallM).slice(0, MAX_ROWS);
    setFound({ rows, key, shown: rows.slice(0, 3).map((r) => r.entry.id) });
  };
  const toggle = (id: string): void => void (found && setFound({ ...found, shown: found.shown.includes(id) ? found.shown.filter((x) => x !== id) : [...found.shown, id] }));
  const overlays = found ? found.rows.filter((r) => found.shown.includes(r.entry.id)).map((r, i) => ({ label: r.entry.name, values: r.responseDb, className: `overlay cmp cmp-${(i % 7) + 1}` })) : [];
  const stale = found !== null && found.key !== key;

  return (
    <section className="driverfinder" aria-label="Find drivers for this box">
      <h2>Find drivers for this box</h2>
      <p className="hint">
        Every usable driver in your database (and the generic classes), each put in this box with its box, tuning and chosen power kept, ranked 0 to 100: 40 % for reaching the low end you want, 30 % for a flat passband, 30 % for staying inside Xmax, and 10 off for each warning. It is a rule of thumb to sort a list: look at the numbers and the curves before you buy anything.
      </p>
      <div className="actions">
        <label>
          Wanted -3 dB point (Hz){' '}
          <input type="text" inputMode="decimal" size={6} placeholder={String(autoTarget)} value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Wanted low end in hertz" />
        </label>
        <label>
          Kind{' '}
          <select value={kind} onChange={(e) => setKind(e.target.value as DriverKind | 'any')}>
            <option value="any">Any</option>
            {DRIVER_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={favOnly} onChange={(e) => setFavOnly(e.target.checked)} /> Favourites only
        </label>
        <button type="button" onClick={find}>
          Find drivers
        </button>
      </div>
      {target.trim() !== '' && !targetOk && <p role="alert" className="error">The wanted low end must be a number from 10 to 500 Hz; {autoTarget} Hz (this box's own) is used.</p>}
      {found && (
        <>
          {stale && <p className="hint" role="status">The box or its driver changed since this list was made. Press Find drivers again.</p>}
          {found.rows.length === 0 ? (
            <p className="hint">No driver matches. Add drivers on the Drivers page, or clear the kind and favourites filters.</p>
          ) : (
            <>
              <p className="hint">Best {found.rows.length} shown. Tick Show to draw a driver over the current response (the amber curve).</p>
              <Chart freqs={current.freqs} hover={hover} onHover={setHover} title="Response" unit="dB" values={current.curves.responseDb} overlays={overlays} yMin={-36} yMax={Math.min(48, Math.max(6, Math.ceil((Math.max(...current.curves.responseDb, ...found.rows.flatMap((r) => (found.shown.includes(r.entry.id) ? r.responseDb : []))) + 1) / 6) * 6))} yStep={6} />
              <table className="driverranking">
                <thead>
                  <tr>
                    <th scope="col">Show</th>
                    <th scope="col" className="left">Driver</th>
                    <th scope="col" className="left">Kind</th>
                    <th scope="col">fs Hz</th>
                    <th scope="col">Qts</th>
                    <th scope="col">Vas L</th>
                    <th scope="col">-3 dB</th>
                    <th scope="col">Ripple dB</th>
                    <th scope="col">of Xmax</th>
                    <th scope="col">Warnings</th>
                    <th scope="col">Score</th>
                    <th scope="col" className="left"><span className="sr-only">Use</span></th>
                  </tr>
                </thead>
                <tbody>
                  {found.rows.map((r) => (
                    <tr key={r.entry.id} className={r.entry.favourite ? 'fav' : undefined}>
                      <td>
                        <input type="checkbox" aria-label={`Show ${r.entry.name}`} checked={found.shown.includes(r.entry.id)} onChange={() => toggle(r.entry.id)} />
                      </td>
                      <th scope="row" className="left">{r.entry.name}</th>
                      <td className="left">{r.entry.kind}</td>
                      <td>{f0(r.entry.fs)}</td>
                      <td>{r.entry.qts.toFixed(2)}</td>
                      <td>{r.entry.vasM3 === undefined ? '-' : f0(r.entry.vasM3 * 1000)}</td>
                      <td>{fmtHz(r.metrics)}</td>
                      <td>{r.metrics.rippleDb.toFixed(1)}</td>
                      <td>{Math.round(r.metrics.excursionRatio * 100)} %</td>
                      <td>{r.metrics.warnings}</td>
                      <td><b>{r.score.score}</b></td>
                      <td className="left">
                        <button type="button" onClick={() => p.onUse(r.design)}>Use</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </section>
  );
}
