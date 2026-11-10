// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The Brief panel: describe what you want in words, a local Ollama model proposes three variants, the calculators judge
// them, and you load the one you like. Nothing leaves this machine.
import { useEffect, useRef, useState } from 'react';
import { type BoxMetrics, type BriefMode, FLAVOURS, type Metrics, boxMetricsOf, metricsOf } from './brief';
import type { Design } from './model';
import { type Config, DEFAULT_MODEL, DEFAULT_URL, OllamaError, designVariant, listModels, localOnly } from './ollama';
import type { Project } from './system';
import type { SystemAnswer } from './brief';

const KEY = 'soundsystemdesigner.ollama.v1';

function loadConfig(): Config {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Config> | null;
    if (c && typeof c.baseUrl === 'string' && typeof c.model === 'string') return { baseUrl: c.baseUrl, model: c.model };
  } catch {
    // unreadable storage: use the defaults
  }
  return { baseUrl: DEFAULT_URL, model: DEFAULT_MODEL };
}

type Row =
  | { flavour: string; label: string; state: 'waiting' | 'running' }
  | { flavour: string; label: string; state: 'failed'; errors: string[]; attempts: number }
  | { flavour: string; label: string; state: 'ok'; name: string; note: string; attempts: number; system?: { project: Project; m: Metrics }; box?: { design: Design; m: BoxMetrics } };

const f1 = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : 'none');

export function BriefPanel(props: { mode: BriefMode; onLoadSystem: (p: Project) => void; onLoadBox: (d: Design) => void; canUndo: boolean; onUndo: () => void }) {
  const { mode } = props;
  const [cfg, setCfg] = useState<Config>(loadConfig);
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  /** The result of the last check of the server: shown in the plain, not as a warning, when it is fine. */
  const [info, setInfo] = useState('');
  const [brief, setBrief] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  /** Only the newest check of the server may change the page: a slow older one is ignored. */
  const checks = useRef(0);

  const save = (c: Config): void => {
    setCfg(c);
    try {
      localStorage.setItem(KEY, JSON.stringify(c));
    } catch {
      // not remembered
    }
  };

  const refresh = async (url: string, keep: string): Promise<void> => {
    const mine = ++checks.current;
    setInfo('Checking Ollama…');
    setStatus('');
    const bad = localOnly(url);
    if (bad) {
      setInfo('');
      setModels([]);
      setStatus(bad);
      return;
    }
    try {
      const names = await listModels(url);
      if (mine !== checks.current) return;
      setModels(names);
      setInfo(names.length > 0 ? `Ollama is running at ${new URL(url).origin}: ${names.length} ${names.length === 1 ? 'model' : 'models'} available.` : '');
      setStatus(names.length === 0 ? 'Ollama is running but has no models. Pull one (for example "ollama pull llama3.1:8b").' : '');
      if (names.length > 0 && !names.includes(keep)) save({ baseUrl: url, model: names.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : names[0]! });
    } catch (e) {
      if (mine !== checks.current) return;
      setInfo('');
      setModels([]);
      setStatus(e instanceof OllamaError ? e.message : 'Could not reach Ollama.');
    }
  };

  useEffect(() => {
    void refresh(cfg.baseUrl, cfg.model);
    return () => abort.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (): Promise<void> => {
    if (brief.trim() === '' || busy) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    let next: Row[] = FLAVOURS.map((f) => ({ flavour: f.id, label: f.label, state: 'waiting' as const }));
    setRows(next);
    const put = (i: number, r: Row): void => {
      next = next.map((x, k) => (k === i ? r : x));
      setRows(next);
    };
    try {
      for (let i = 0; i < FLAVOURS.length; i++) {
        const f = FLAVOURS[i]!;
        put(i, { flavour: f.id, label: f.label, state: 'running' });
        const r = await designVariant(mode, brief, f, cfg, fetch, ctl.signal);
        if (!r.ok) {
          put(i, { flavour: f.id, label: f.label, state: 'failed', errors: r.errors, attempts: r.attempts });
          continue;
        }
        if (mode === 'system') {
          const v = r.value as SystemAnswer;
          put(i, { flavour: f.id, label: f.label, state: 'ok', name: v.label, note: v.note, attempts: r.attempts, system: { project: v.project, m: metricsOf(v.project) } });
        } else {
          const v = r.value as Design & { label?: string; note?: string };
          put(i, { flavour: f.id, label: f.label, state: 'ok', name: v.label ?? f.label, note: v.note ?? '', attempts: r.attempts, box: { design: v, m: boxMetricsOf(v) } });
        }
      }
      setStatus('');
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setStatus(e instanceof OllamaError ? e.message : 'Something went wrong talking to Ollama.');
      setRows((rs) => rs.map((x) => (x.state === 'running' || x.state === 'waiting' ? { flavour: x.flavour, label: x.label, state: 'failed', errors: ['stopped'], attempts: 0 } : x)));
    } finally {
      setBusy(false);
    }
  };

  const ok = rows.filter((r): r is Extract<Row, { state: 'ok' }> => r.state === 'ok');

  return (
    <section className="brief">
      <h2>Brief</h2>
      <p className="hint">
        {mode === 'system' ? 'Describe the system you want.' : 'Describe the box you want.'} A model on this computer proposes three variants; the same calculators as the rest of the app judge them. It only names parts and sizes, so check anything you rely on.
      </p>
      <div className="field stacked">
        <label htmlFor="brief-text">What do you need?</label>
        <textarea id="brief-text" rows={3} value={brief} placeholder={mode === 'system' ? 'A two-way PA for a 200-person room: an 18 in ported sub and 12 in tops' : 'A sealed 12 in box for a studio monitor wedge'} onChange={(e) => setBrief(e.target.value)} />
      </div>
      <div className="actions">
        <button type="button" onClick={() => void run()} disabled={busy || brief.trim() === '' || models.length === 0}>
          {busy ? 'Working…' : 'Design 3 variants'}
        </button>
        {busy && (
          <button type="button" onClick={() => abort.current?.abort()}>
            Stop
          </button>
        )}
        {props.canUndo && (
          <button type="button" onClick={props.onUndo}>
            Undo last load
          </button>
        )}
      </div>
      <details>
        <summary>Ollama settings</summary>
        <div className="field">
          <label htmlFor="ollama-url">Address</label>
          <input id="ollama-url" type="text" className="left" value={cfg.baseUrl} onChange={(e) => save({ ...cfg, baseUrl: e.target.value })} onBlur={() => void refresh(cfg.baseUrl, cfg.model)} />
        </div>
        <div className="field">
          <label htmlFor="ollama-model">Model</label>
          <select id="ollama-model" value={cfg.model} onChange={(e) => save({ ...cfg, model: e.target.value })}>
            {(models.includes(cfg.model) ? models : [cfg.model, ...models]).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <button type="button" onClick={() => void refresh(cfg.baseUrl, cfg.model)}>
          Check Ollama
        </button>
      </details>
      {info && <p className="ok-line" role="status">{info}</p>}
      {status && <p className="warnings-line" role="alert">{status}</p>}

      {rows.length > 0 && (
        <>
          <table>
            <thead>
              <tr>
                <th scope="col" className="left">
                  Variant
                </th>
                {mode === 'system' ? (
                  <>
                    <th scope="col">Bands</th>
                    <th scope="col">Level, dB</th>
                    <th scope="col">Headroom, dB</th>
                    <th scope="col">Lowest, Hz</th>
                  </>
                ) : (
                  <>
                    <th scope="col" className="left pad">
                      Readouts
                    </th>
                    <th scope="col">Volume, L</th>
                  </>
                )}
                <th scope="col">Sheets</th>
                <th scope="col">Warnings</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.flavour}>
                  <th scope="row" className="left">
                    {r.label}
                    {r.state === 'ok' ? `: ${r.name}` : ''}
                  </th>
                  {r.state === 'ok' && r.system && (
                    <>
                      <td>{r.system.m.bands}</td>
                      <td>{f1(r.system.m.levelDb)}</td>
                      <td>{f1(r.system.m.headroomDb)}</td>
                      <td>{r.system.m.lowestHz.toFixed(0)}</td>
                      <td>{r.system.m.sheets}</td>
                      <td>{r.system.m.warnings}</td>
                      <td>
                        <button type="button" onClick={() => props.onLoadSystem(r.system!.project)}>
                          Load
                        </button>
                      </td>
                    </>
                  )}
                  {r.state === 'ok' && r.box && (
                    <>
                      <td className="left pad">{r.box.m.readouts.join('; ')}</td>
                      <td>{f1(r.box.m.volumeL)}</td>
                      <td>{r.box.m.sheets}</td>
                      <td>{r.box.m.warnings}</td>
                      <td>
                        <button type="button" onClick={() => props.onLoadBox(r.box!.design)}>
                          Load
                        </button>
                      </td>
                    </>
                  )}
                  {r.state !== 'ok' && (
                    <td colSpan={mode === 'system' ? 7 : 5} className="left pad">
                      {r.state === 'failed' && r.errors[0] === 'stopped' ? 'Stopped' : r.state === 'failed' ? `Refused after ${r.attempts} ${r.attempts === 1 ? 'answer' : 'answers'}: ${r.errors.slice(0, 3).join('; ')}` : r.state === 'running' ? 'Asking the model…' : 'Waiting'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <caption>Level is the average from the lowest frequency played at the listening distance. Loading replaces your current {mode === 'system' ? 'system' : 'box'}; Undo brings it back.</caption>
          </table>
          {ok.length > 0 && (
            <ul className="notes">
              {ok.map((r) => (
                <li key={r.flavour}>
                  <strong>{r.label}:</strong> {r.note}
                  {r.attempts > 1 ? ' (needed a second try)' : ''}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
