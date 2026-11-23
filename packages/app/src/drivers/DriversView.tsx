// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The Drivers page: the searchable, filterable list of every driver (generic and your own), a form for all the Thiele-Small
// numbers, favourites (shown green), and import and export. The page holds no driver data of its own: it edits the database it is
// handed and reports each change through onDb.
import { useMemo, useState } from 'react';
import { openText, saveText } from '../desktop';
import { parseRecord } from '../probe/record';
import { DB_CSV_TEMPLATE, parseDriverCsvEntries } from './csv';
import { DRIVER_KINDS, DRIVER_SOURCES, type DriverEntry, type DriverSnapshot, buildEntry, entryFromRecord, isGeneric, isUsable, missingFields, snapshotOf } from './entry';
import { FIELDS, type FormState, blankForm, formFromEntry, inputFromForm, shown } from './fields';
import { type DriverFilter, NO_FILTER, type Range, type SortKey, coneIn, filterDrivers, manufacturers, sortDrivers } from './filter';
import { type Target } from './pick';
import { type DriverDb, allDrivers, exportDb, importDb, mergeImported, newId, removeEntry, toggleFavourite, upsertEntry } from './library';

const today = (): string => new Date().toISOString().slice(0, 10);
const rangeNum = (s: string): number | undefined => {
  const n = Number(s.trim().replace(',', '.'));
  return s.trim() !== '' && Number.isFinite(n) ? n : undefined;
};

interface Editing {
  /** The entry being changed; absent for a new driver. */
  base?: DriverEntry;
  /** A copy of a generic or another driver: saved as a new entry. */
  copy: boolean;
  form: FormState;
}

function RangeInputs(p: { label: string; value: Range; onChange: (r: Range) => void }) {
  const [lo, setLo] = useState(p.value.min?.toString() ?? '');
  const [hi, setHi] = useState(p.value.max?.toString() ?? '');
  const push = (a: string, b: string): void => p.onChange({ min: rangeNum(a), max: rangeNum(b) });
  return (
    <label className="rangefilter">
      {p.label}{' '}
      <input type="text" className="left" size={5} inputMode="decimal" placeholder="min" aria-label={`${p.label} minimum`} value={lo} onChange={(e) => { setLo(e.target.value); push(e.target.value, hi); }} />
      {' to '}
      <input type="text" className="left" size={5} inputMode="decimal" placeholder="max" aria-label={`${p.label} maximum`} value={hi} onChange={(e) => { setHi(e.target.value); push(lo, e.target.value); }} />
    </label>
  );
}

export function DriversView(p: { db: DriverDb; onDb: (db: DriverDb) => void; targets: Target[]; firstTarget?: string; onUse: (s: DriverSnapshot, targetId: string) => void; onClose: () => void }) {
  const [filter, setFilter] = useState<DriverFilter>(NO_FILTER);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'favourite', dir: 'asc' });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  /** Bumped by Clear filters so the range boxes forget what was typed. */
  const [reset, setReset] = useState(0);
  /** Where Use in design puts a driver. */
  const [target, setTarget] = useState(p.firstTarget ?? p.targets[0]?.id ?? '');
  const canUse = p.targets.length > 0;
  const targetId = p.targets.some((t) => t.id === target) ? target : (p.firstTarget ?? p.targets[0]?.id ?? '');

  const all = useMemo(() => allDrivers(p.db), [p.db]);
  const shownList = useMemo(() => sortDrivers(filterDrivers(all, filter), sort.key, sort.dir), [all, filter, sort]);
  const makers = useMemo(() => manufacturers(all), [all]);
  const set = (patch: Partial<DriverFilter>): void => setFilter({ ...filter, ...patch });
  const sortBy = (key: SortKey): void => setSort(sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  const arrow = (key: SortKey): string => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');

  // the form is checked as it is typed: what is wrong, and what will be worked out
  const built = useMemo(() => {
    if (!editing) return null;
    const { input, errors } = inputFromForm(editing.form, editing.copy ? undefined : editing.base);
    if (errors.length) return { ok: false as const, errors };
    return buildEntry(input, editing.copy || !editing.base ? newId() : editing.base.id, today());
  }, [editing]);

  const startNew = (): void => setEditing({ copy: false, form: blankForm() });
  const startEdit = (e: DriverEntry): void => setEditing({ base: e, copy: false, form: formFromEntry(e) });
  const startCopy = (e: DriverEntry): void => setEditing({ base: e, copy: true, form: { ...formFromEntry(e), name: `${e.name} copy` } });
  const field = (k: keyof FormState, v: string): void => void (editing && setEditing({ ...editing, form: { ...editing.form, [k]: v } }));
  const save = (): void => {
    if (!editing || !built?.ok) return;
    const e = { ...built.entry, favourite: editing.copy ? false : (editing.base?.favourite ?? false) };
    p.onDb(upsertEntry(p.db, e));
    setMsg(`Saved ${e.name}.`);
    setEditing(null);
  };

  const exportAll = async (): Promise<void> => {
    const r = await saveText('drivers.ssd-drivers.json', exportDb(p.db), 'application/json');
    setMsg(r.ok ? `Saved ${r.where}` : r.cancelled ? '' : r.error);
  };
  const importLib = async (): Promise<void> => {
    const f = await openText(['json']);
    if (!f.ok) return setMsg(f.cancelled ? '' : f.error);
    const r = importDb(p.db, f.text, today());
    if (!r.ok) return setMsg(`${f.name}: ${r.error}`);
    p.onDb(r.db);
    setMsg(`${f.name}: added ${r.added}, replaced ${r.replaced}${r.skipped ? `, skipped ${r.skipped} unreadable` : ''}.`);
  };
  const importCsv = async (): Promise<void> => {
    const f = await openText(['csv', 'tsv', 'txt']);
    if (!f.ok) return setMsg(f.cancelled ? '' : f.error);
    const r = parseDriverCsvEntries(f.text, today(), newId);
    const m = mergeImported(p.db, r.entries);
    if (r.entries.length) p.onDb(m.db);
    setMsg(`${f.name}: added ${m.added}, replaced ${m.replaced} (same manufacturer, series and model, or the same name).${r.errors.length ? ' Skipped: ' + r.errors.join(' ') : ''}`);
  };
  const importRecord = async (): Promise<void> => {
    const f = await openText(['json']);
    if (!f.ok) return setMsg(f.cancelled ? '' : f.error);
    const rec = parseRecord(f.text);
    if (!rec.ok) return setMsg(`${f.name}: ${rec.error}`);
    const e = entryFromRecord(rec.record, newId(), today());
    if (!e.ok) return setMsg(`${f.name}: ${e.errors.join(' ')}`);
    const m = mergeImported(p.db, [e.entry]);
    p.onDb(m.db);
    setMsg(`${m.added ? 'Added' : 'Replaced'} ${e.entry.name}${isUsable(e.entry) ? '.' : ` (still to enter: ${missingFields(e.entry).join(', ')}).`}`);
  };
  const csvTemplate = async (): Promise<void> => {
    const r = await saveText('drivers-template.csv', DB_CSV_TEMPLATE, 'text/csv');
    setMsg(r.ok ? `Saved ${r.where}` : r.cancelled ? '' : r.error);
  };

  const th = (key: SortKey, label: string) => (
    <th scope="col" className={key === 'name' || key === 'manufacturer' || key === 'kind' || key === 'favourite' ? 'left' : undefined} aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="linkish" onClick={() => sortBy(key)}>
        {label}
        {arrow(key)}
      </button>
    </th>
  );

  return (
    <section aria-label="Drivers" className="driversview">
      <div className="actions">
        <h2>Drivers</h2>
        <button type="button" onClick={p.onClose}>
          Back to the design
        </button>
      </div>
      <p className="hint">
        {shownList.length} of {all.length} drivers. The generic classes are invented values, not products, and cannot be edited: copy one to change it. Manufacturer, series and model are yours to fill in; leave them as Generic when unknown. Star the ones you like.
      </p>

      <div className="actions filters">
        <label>
          Search{' '}
          <input type="text" className="left" size={22} placeholder="name, maker, series, model, notes" aria-label="Search drivers" value={filter.text} onChange={(e) => set({ text: e.target.value })} />
        </label>
        <label>
          <input type="checkbox" checked={filter.favouritesOnly} onChange={(e) => set({ favouritesOnly: e.target.checked })} /> Favourites only
        </label>
        <label>
          <input type="checkbox" checked={filter.usableOnly} onChange={(e) => set({ usableOnly: e.target.checked })} /> Ready to use only
        </label>
        <label>
          Kind{' '}
          <select value={filter.kind} onChange={(e) => set({ kind: e.target.value as DriverFilter['kind'] })}>
            <option value="all">All</option>
            {DRIVER_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label>
          Maker{' '}
          <select value={filter.manufacturer} onChange={(e) => set({ manufacturer: e.target.value })}>
            <option value="all">All</option>
            {makers.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          Source{' '}
          <select value={filter.source} onChange={(e) => set({ source: e.target.value as DriverFilter['source'] })}>
            <option value="all">All</option>
            {DRIVER_SOURCES.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <RangeInputs key={`fs-${reset}`} label="fs (Hz)" value={filter.fs} onChange={(fs) => set({ fs })} />
        <RangeInputs key={`qts-${reset}`} label="Qts" value={filter.qts} onChange={(qts) => set({ qts })} />
        <RangeInputs key={`vasL-${reset}`} label="Vas (L)" value={filter.vasL} onChange={(vasL) => set({ vasL })} />
        <RangeInputs key={`c-${reset}`} label="Cone diameter (in)" value={filter.coneIn} onChange={(c) => set({ coneIn: c })} />
        <button type="button" onClick={() => { setFilter(NO_FILTER); setReset(reset + 1); }} disabled={filter === NO_FILTER}>
          Clear filters
        </button>
      </div>

      {canUse && p.targets.length > 1 && (
        <div className="actions">
          <label>
            Use in design goes to{' '}
            <select value={targetId} onChange={(e) => setTarget(e.target.value)}>
              {p.targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="actions">
        <button type="button" onClick={startNew}>
          Add a driver
        </button>
        <button type="button" onClick={importCsv}>
          Import CSV
        </button>
        <button type="button" onClick={csvTemplate}>
          CSV template
        </button>
        <button type="button" onClick={importRecord}>
          Import a Driver Probe file
        </button>
        <button type="button" onClick={importLib}>
          Import library
        </button>
        <button type="button" onClick={exportAll}>
          Export library
        </button>
      </div>
      {msg && (
        <p className="hint" role="status">
          {msg}
        </p>
      )}

      <table className="driverlist">
        <thead>
          <tr>
            {th('favourite', '★')}
            {th('name', 'Name')}
            {th('manufacturer', 'Maker')}
            <th scope="col" className="left">Series / model</th>
            {th('kind', 'Kind')}
            {th('fs', 'fs Hz')}
            {th('qts', 'Qts')}
            {th('vas', 'Vas L')}
            {th('sd', 'Sd cm²')}
            {th('xmax', 'Xmax mm')}
            {th('pe', 'Pe W')}
            <th scope="col" className="left">Status</th>
            <th scope="col" className="left">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {shownList.length === 0 && (
            <tr>
              <td colSpan={13} className="left">
                No driver matches. Clear a filter or add one.
              </td>
            </tr>
          )}
          {shownList.map((e) => {
            const snap = snapshotOf(e);
            return (
              <tr key={e.id} className={e.favourite ? 'fav' : undefined}>
                <td className="left">
                  <button type="button" className="linkish star" aria-pressed={e.favourite} aria-label={`${e.favourite ? 'Remove from' : 'Add to'} favourites: ${e.name}`} onClick={() => p.onDb(toggleFavourite(p.db, e.id))}>
                    {e.favourite ? '★' : '☆'}
                  </button>
                </td>
                <th scope="row" className="left">{e.name}</th>
                <td className="left">{e.manufacturer}</td>
                <td className="left">{[e.series, e.model].filter((s) => s !== 'Generic').join(' / ') || 'Generic'}</td>
                <td className="left">{e.kind}</td>
                <td>{shown(FIELDS[0]!, e.fs)}</td>
                <td>{e.qts.toFixed(2)}</td>
                <td>{e.vasM3 === undefined ? '-' : shown(FIELDS[5]!, e.vasM3)}</td>
                <td>{e.sd === undefined ? '-' : shown(FIELDS[6]!, e.sd)}</td>
                <td>{e.xmax === undefined ? '-' : shown(FIELDS[7]!, e.xmax)}</td>
                <td>{e.pe ?? '-'}</td>
                <td className="left">
                  {isGeneric(e) ? 'generic' : isUsable(e) ? 'ready' : `needs ${missingFields(e).join(', ')}`}
                  {coneIn(e) !== undefined && <span className="hint"> {coneIn(e)!.toFixed(1)} in cone</span>}
                </td>
                <td className="left">
                  <button type="button" disabled={!canUse || !snap} title={canUse ? (snap ? '' : 'Enter Vas, Sd, Xmax and Pe first') : 'Open the Drivers page from a PA system, home speaker or car subwoofer design to use a driver'} onClick={() => snap && p.onUse(snap, targetId)}>
                    Use in design
                  </button>{' '}
                  {isGeneric(e) ? (
                    <button type="button" onClick={() => startCopy(e)}>
                      Copy
                    </button>
                  ) : (
                    <>
                      <button type="button" onClick={() => startEdit(e)}>
                        Edit
                      </button>{' '}
                      <button type="button" onClick={() => startCopy(e)}>
                        Copy
                      </button>{' '}
                      {confirmDel === e.id ? (
                        <>
                          Delete {e.name}?{' '}
                          <button type="button" onClick={() => { p.onDb(removeEntry(p.db, e.id)); setConfirmDel(null); setMsg(`Deleted ${e.name}.`); }}>
                            Yes, delete
                          </button>{' '}
                          <button type="button" onClick={() => setConfirmDel(null)}>
                            No
                          </button>
                        </>
                      ) : (
                        <button type="button" onClick={() => setConfirmDel(e.id)}>
                          Delete
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {editing && (
        <form className="driverform" aria-label={editing.base && !editing.copy ? 'Edit driver' : 'New driver'} onSubmit={(ev) => { ev.preventDefault(); save(); }}>
          <h3>{editing.base && !editing.copy ? `Edit ${editing.base.name}` : editing.copy ? 'New driver (a copy)' : 'New driver'}</h3>
          <div className="actions">
            {(['manufacturer', 'series', 'model'] as const).map((k) => (
              <label key={k}>
                {k[0]!.toUpperCase() + k.slice(1)}{' '}
                <input type="text" className="left" size={16} placeholder="Generic" value={editing.form[k]} onChange={(ev) => field(k, ev.target.value)} />
              </label>
            ))}
            <label>
              Name (optional){' '}
              <input type="text" className="left" size={18} placeholder="from the three above" value={editing.form.name} onChange={(ev) => field('name', ev.target.value)} />
            </label>
            <label>
              Kind{' '}
              <select value={editing.form.kind} onChange={(ev) => field('kind', ev.target.value)}>
                <option value="">worked out from the numbers</option>
                {DRIVER_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="hint">Needed: fs, Re and two of Qts, Qes, Qms (the third is worked out). Vas, Sd, Xmax and Pe are needed before the driver can be used in a design. Anything else you leave empty is worked out when it can be.</p>
          <div className="actions fieldgrid">
            {FIELDS.map((f) => {
              const derived = built?.ok ? built.entry.derived.includes(f.key) && built.entry[f.key] !== undefined : false;
              return (
                <label key={f.key}>
                  {f.label}
                  {f.unit ? ` (${f.unit})` : ''}{' '}
                  <input
                    type="text"
                    size={9}
                    inputMode="decimal"
                    value={editing.form[f.key]}
                    placeholder={derived ? shown(f, built?.ok ? (built.entry[f.key] as number) : 0) : ''}
                    aria-describedby={derived ? `d-${f.key}` : undefined}
                    onChange={(ev) => field(f.key, ev.target.value)}
                  />
                  {derived && (
                    <span id={`d-${f.key}`} className="hint">
                      {' '}worked out
                    </span>
                  )}
                </label>
              );
            })}
          </div>
          <label className="notes">
            Notes{' '}
            <input type="text" className="left" size={60} value={editing.form.notes} onChange={(ev) => field('notes', ev.target.value)} />
          </label>
          {built && !built.ok && (
            <ul role="alert" className="error">
              {built.errors.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
          {built?.ok && !isUsable(built.entry) && <p className="hint">Saved as incomplete: still to enter {missingFields(built.entry).join(', ')}.</p>}
          <div className="actions">
            <button type="submit" disabled={!built?.ok}>
              Save driver
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
