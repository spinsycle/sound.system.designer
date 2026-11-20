// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Turns finished sweeps into a saved driver: keep a free-air sweep, optionally an added-mass sweep, enter what a sweep
// cannot measure (Sd, Xmax, Pe, or a datasheet Vas), then save to the library, export a file, or use it in the design.
// The library also lists imported files. Nothing here talks to the probe.
import type { CustomDriverFields, FreeAirFit, ImpedancePoint } from '@soundsystemdesigner/physics';
import { useMemo, useState } from 'react';
import { openText, saveText } from '../desktop';
import { CSV_TEMPLATE, parseDriverCsv } from './csvimport';
import { loadLibrary, remove, saveLibrary, upsert } from './library';
import { type DriverRecord, RECORD_EXTENSION, bandProblems, buildRecord, parseRecord, recordFileName, serializeRecord, toCustomFields } from './record';

interface Kept {
  fit: FreeAirFit;
  points: ImpedancePoint[];
}
const today = (): string => new Date().toISOString().slice(0, 10);
const missing = (r: DriverRecord): string[] => [!r.sd && 'Sd', !r.xmax && 'Xmax', !r.pe && 'Pe', !r.vasM3 && 'Vas'].filter(Boolean) as string[];
const posNum = (s: string): number | undefined => {
  const n = Number(s);
  return s.trim() !== '' && Number.isFinite(n) && n > 0 ? n : undefined;
};

export function DriverPanel(p: { sweepDone: boolean; fit: FreeAirFit | null; points: ImpedancePoint[]; probe?: { id: string; fw: string }; canUse: boolean; onUse: (f: CustomDriverFields, name: string) => void }) {
  const [base, setBase] = useState<Kept | null>(null);
  const [loaded, setLoaded] = useState<Kept | null>(null);
  const [name, setName] = useState('');
  const [massG, setMassG] = useState('');
  const [sd, setSd] = useState('');
  const [xmax, setXmax] = useState('');
  const [pe, setPe] = useState('');
  const [vas, setVas] = useState('');
  const [lib, setLib] = useState<DriverRecord[]>(() => loadLibrary());
  const [msg, setMsg] = useState('');

  const built = useMemo((): { rec: DriverRecord } | { error: string } | null => {
    if (!base) return null;
    try {
      const m = posNum(massG);
      return {
        rec: buildRecord({
          name,
          date: today(),
          probe: p.probe,
          base,
          ...(loaded && m ? { loaded: { ...loaded, massKg: m / 1000, massBand: 0.01 } } : {}),
          sdM2: posNum(sd) && posNum(sd)! / 1e4,
          xmaxM: posNum(xmax) && posNum(xmax)! / 1000,
          peW: posNum(pe),
          vasEnteredM3: posNum(vas) && posNum(vas)! / 1000,
        }),
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [base, loaded, name, massG, sd, xmax, pe, vas, p.probe]);

  const rec = built && 'rec' in built ? built.rec : null;
  const problems = rec ? bandProblems(rec) : [];
  const store = (list: DriverRecord[]): void => {
    setLib(list);
    if (!saveLibrary(list)) setMsg('The driver could not be remembered: browser storage is unavailable or full. Export it as a file instead.');
  };
  const exportRec = async (r: DriverRecord): Promise<void> => {
    const res = await saveText(recordFileName(r), serializeRecord(r), 'application/json');
    setMsg(res.ok ? `Saved ${res.where}` : res.cancelled ? '' : res.error);
  };
  const importRec = async (): Promise<void> => {
    const res = await openText(['json']);
    if (!res.ok) return setMsg(res.cancelled ? '' : res.error);
    const r = parseRecord(res.text);
    if (!r.ok) return setMsg(`${res.name}: ${r.error}`);
    store(upsert(lib, r.record));
    setMsg(`Imported ${r.record.name}${r.record.incomplete ? ' (incomplete: ' + missing(r.record).join(', ') + ' still to enter)' : ''}.`);
  };
  const importCsv = async (): Promise<void> => {
    const res = await openText(['csv', 'tsv', 'txt']);
    if (!res.ok) return setMsg(res.cancelled ? '' : res.error);
    const { records, errors } = parseDriverCsv(res.text, today());
    if (records.length) store(records.reduce(upsert, lib));
    setMsg(`${res.name}: imported ${records.length} driver${records.length === 1 ? '' : 's'} (a name already in the library is replaced).${errors.length ? ' Skipped: ' + errors.join(' ') : ''}`);
  };
  const use = (r: DriverRecord): void => {
    const f = toCustomFields(r);
    if (f) p.onUse(f, r.name);
  };

  return (
    <section aria-label="Measured driver" className="driverpanel">
      <h3>Measured driver</h3>
      <div className="actions">
        <button type="button" disabled={!p.sweepDone || !p.fit} onClick={() => { setBase({ fit: p.fit!, points: p.points }); setMsg(''); }}>
          Keep this sweep as the free-air measurement
        </button>
        <label>
          Added mass (g){' '}
          <input value={massG} onChange={(e) => setMassG(e.target.value)} inputMode="decimal" size={6} aria-label="Added mass in grams" />
        </label>
        <button type="button" disabled={!p.sweepDone || !p.fit || !base || !posNum(massG)} onClick={() => setLoaded({ fit: p.fit!, points: p.points })}>
          Keep this sweep as the added-mass measurement
        </button>
      </div>
      <p className="hint">
        Free-air: {base ? `kept (fs ${base.fit.fs.toFixed(1)} Hz)` : 'not kept yet'}. Added mass: {loaded ? `kept (fs ${loaded.fit.fs.toFixed(1)} Hz)` : 'not kept (optional; gives Mms, Cms, Bl and, with Sd, Vas)'}. Stick the mass to the dust cap or cone centre, weigh it to 0.01 g, keep it small enough that fs drops by 10 to 30 %.
      </p>

      {built && 'error' in built && <p role="alert" className="error">{built.error}</p>}
      {rec && (
        <>
          <div className="actions">
            <label>Name <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Salvaged 15 in" /></label>
            <label>Sd (cm&sup2;) <input value={sd} onChange={(e) => setSd(e.target.value)} inputMode="decimal" size={6} /></label>
            <label>Xmax (mm) <input value={xmax} onChange={(e) => setXmax(e.target.value)} inputMode="decimal" size={5} /></label>
            <label>Pe (W) <input value={pe} onChange={(e) => setPe(e.target.value)} inputMode="decimal" size={5} /></label>
            <label>Vas (L), only if known <input value={vas} onChange={(e) => setVas(e.target.value)} inputMode="decimal" size={6} /></label>
          </div>
          <p className="hint">
            {rec.mms ? `Mms ${(rec.mms.v * 1000).toFixed(1)} g, Cms ${(rec.cms!.v * 1000).toFixed(2)} mm/N, Bl ${rec.bl!.v.toFixed(1)} T m. ` : ''}
            {rec.vasM3 ? `Vas ${(rec.vasM3.v * 1000).toFixed(1)} L (${rec.vasSource}). ` : ''}
            {rec.incomplete ? `Incomplete: still needs ${missing(rec).join(', ')}.` : 'Complete.'}
          </p>
          {problems.map((t) => (
            <p key={t} role="alert" className="error">{t}</p>
          ))}
          <div className="actions">
            <button type="button" disabled={problems.length > 0} onClick={() => { store(upsert(lib, rec)); setMsg(`Saved ${rec.name} to the library.`); }}>
              Save to library
            </button>
            <button type="button" disabled={problems.length > 0} onClick={() => exportRec(rec)}>
              Export file (.{RECORD_EXTENSION})
            </button>
          </div>
        </>
      )}
      {msg && <p className="hint" role="status">{msg}</p>}

      <h3>Saved drivers</h3>
      <div className="actions">
        <button type="button" onClick={importRec}>
          Import a driver file
        </button>
        <button type="button" onClick={importCsv}>
          Import drivers from CSV
        </button>
        <button type="button" onClick={async () => { const r = await saveText('drivers-template.csv', CSV_TEMPLATE, 'text/csv'); setMsg(r.ok ? `Saved ${r.where}` : r.cancelled ? '' : r.error); }}>
          Download CSV template
        </button>
      </div>
      <p className="hint">CSV columns: name, fs_hz, qts, qes, qms, re_ohm, vas_l, sd_cm2, xmax_mm, pe_w, le_mh. Needs name, fs, re and two of the three Q values; Sd, Xmax, Pe and Vas are needed before a driver can be used in a design. Imported numbers are typed values, not measurements.</p>
      {lib.length === 0 ? (
        <p className="hint">No measured drivers saved yet.</p>
      ) : (
        <table>
          <tbody>
            {lib.map((r) => (
              <tr key={r.name}>
                <th scope="row" className="left">{r.name}</th>
                <td>
                  fs {r.fs.v.toFixed(1)} Hz, Qts {r.qts.v.toFixed(2)}, Re {r.re.v.toFixed(1)} ohm <span className="hint">{r.measuredAt}</span>
                  {r.incomplete && <span className="hint"> incomplete: needs {missing(r).join(', ')}</span>}
                </td>
                <td>
                  <button type="button" disabled={r.incomplete || !p.canUse || bandProblems(r).length > 0} title={p.canUse ? '' : 'Use in design works on PA system boxes'} onClick={() => use(r)}>
                    Use in design
                  </button>{' '}
                  <button type="button" disabled={bandProblems(r).length > 0} onClick={() => exportRec(r)}>
                    Export
                  </button>{' '}
                  <button type="button" onClick={() => store(remove(lib, r.name))}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
