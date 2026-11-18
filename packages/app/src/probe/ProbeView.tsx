// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The Driver Probe page: find the probe over USB or WiFi, run a sweep, watch the impedance curve and the running
// Thiele-Small fit. Saving the result as a driver is the next step (P5); this page measures and shows.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Chart, niceScale } from '../Chart';
import { isDesktop } from '../desktop';
import { type Link, WIFI_DEFAULT_HOST, detectUsb, openWs } from './link';
import type { CustomDriverFields } from '@soundsystemdesigner/physics';
import { DriverPanel } from './DriverPanel';
import { ERROR_TEXT, PROBE_VCAP, ProbeSession, type SessionState } from './session';

const pct = (b: number): string => `±${(b * 100).toPrecision(2)} %`;

export function ProbeView({ onClose, canUse, onUse }: { onClose: () => void; canUse: boolean; onUse: (f: CustomDriverFields, name: string) => void }) {
  const [st, setSt] = useState<SessionState | null>(null);
  const [where, setWhere] = useState('');
  const [msg, setMsg] = useState('');
  const [host, setHost] = useState(WIFI_DEFAULT_HOST);
  const [plan, setPlan] = useState({ f0: 10, f1: 500, n: 120, vpeak: 0.5 });
  const [hover, setHover] = useState<number | null>(null);
  const session = useRef<ProbeSession | null>(null);
  const link = useRef<Link | null>(null);

  const disconnect = (): void => {
    link.current?.close();
    link.current = null;
    session.current = null;
    setSt(null);
    setWhere('');
  };
  useEffect(() => () => link.current?.close(), []);

  // The probe aborts a sweep after 3 s of silence from us, so say something every second while one runs.
  useEffect(() => {
    const t = setInterval(() => session.current?.keepalive(), 1000);
    return () => clearInterval(t);
  }, []);

  const begin = (transport: 'usb' | 'wifi'): ProbeSession => {
    disconnect();
    const s = new ProbeSession((l) => link.current?.send(l), transport, setSt);
    session.current = s;
    return s;
  };

  const findUsb = async (): Promise<void> => {
    setMsg('Looking for a probe on the USB serial ports (a board that just reset needs a few seconds)...');
    const s = begin('usb');
    const hit = await detectUsb((l) => s.onLine(l), () => s.closed());
    if (!hit) {
      disconnect();
      setMsg('No probe answered on any USB serial port.');
      return;
    }
    link.current = hit.link;
    setWhere(`USB, ${hit.port}`);
    setMsg('');
  };

  const connectWifi = async (): Promise<void> => {
    setMsg(`Connecting to ${host}...`);
    const s = begin('wifi');
    try {
      link.current = await openWs(host, (l) => s.onLine(l), () => s.closed());
      setWhere(`WiFi, ${host}`);
      setMsg('');
      s.hello();
    } catch (e) {
      disconnect();
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const run = (): void => {
    try {
      session.current?.start(plan);
      setMsg('');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const phase = st?.phase;
  const idle = phase === 'ready' || phase === 'done' || phase === 'aborted';
  const mags = useMemo(() => st?.points.map((p) => Math.hypot(p.re, p.im)) ?? [], [st?.points]);
  const fit = st?.fit ?? null;
  const num = (k: keyof typeof plan) => (e: { target: { value: string } }) => setPlan({ ...plan, [k]: Number(e.target.value) });
  const y = niceScale(Math.max(...mags, 1));

  return (
    <main className="probe">
      <header>
        <h2>Driver Probe</h2>
        <button type="button" onClick={onClose}>
          Back to the design
        </button>
      </header>

      <section aria-label="Connection">
        <h3>Connection</h3>
        <p role="status">
          {st && phase !== 'closed' && st.hello ? (
            <strong>
              Connected over {where}: probe {st.hello.id}, firmware {st.hello.fw}
            </strong>
          ) : phase === 'closed' ? (
            'The connection was lost.'
          ) : st ? (
            `Waiting for the probe to answer (${where || st.transport})...`
          ) : (
            'Not connected.'
          )}
        </p>
        <div className="actions">
          {isDesktop() ? (
            <button type="button" onClick={findUsb}>
              Find probe on USB
            </button>
          ) : (
            <span className="hint">USB needs the desktop app. WiFi works in a browser too.</span>
          )}
          <label>
            Probe address{' '}
            <input value={host} onChange={(e) => setHost(e.target.value.trim())} aria-label="Probe address" size={18} />
          </label>
          <button type="button" onClick={connectWifi}>
            Connect over WiFi
          </button>
          {st && (
            <button type="button" onClick={disconnect}>
              Disconnect
            </button>
          )}
        </div>
        {msg && <p className="hint">{msg}</p>}
      </section>

      <section aria-label="Sweep">
        <h3>Sweep</h3>
        <div className="actions">
          <label>
            From (Hz) <input type="number" value={plan.f0} onChange={num('f0')} min={1} />
          </label>
          <label>
            To (Hz) <input type="number" value={plan.f1} onChange={num('f1')} min={2} />
          </label>
          <label>
            Points <input type="number" value={plan.n} onChange={num('n')} min={12} max={2000} />
          </label>
          <label>
            Drive (V peak, max {PROBE_VCAP}) <input type="number" value={plan.vpeak} onChange={num('vpeak')} step={0.05} min={0.05} max={PROBE_VCAP} />
          </label>
          <button type="button" disabled={!idle} onClick={run}>
            Start sweep
          </button>
          <button type="button" disabled={phase !== 'sweeping'} onClick={() => session.current?.stop()}>
            Stop
          </button>
        </div>
        <p className="hint">
          Keep the first sweep at a few hundred millivolts. A sweep through the driver's resonance moves the cone the most.
          {st && phase === 'sweeping' && ` Measuring: ${st.points.length} of ${st.plan?.n} points.`}
          {phase === 'done' && ' Sweep finished.'}
        </p>
        {st?.error && (
          <p role="alert" className="error">
            {ERROR_TEXT[st.error.code] ?? st.error.msg}
          </p>
        )}
      </section>

      {st && st.points.length >= 2 && st.plan && (
        <div className="charts one">
          <Chart
            title="Impedance magnitude"
            unit="ohm"
            freqs={st.points.map((p) => p.f)}
            values={mags}
            yMin={0}
            yMax={y.max}
            yStep={y.step}
            fMin={st.plan.f0}
            fMax={st.plan.f1}
            vLines={fit ? [{ f: fit.fs, label: 'fs' }] : []}
            hover={hover}
            onHover={setHover}
          />
          <section aria-label="Fit">
            <h3>Fit {phase === 'sweeping' ? '(updating)' : ''}</h3>
            {fit ? (
              <table>
                <tbody>
                  {(
                    [
                      ['Re', fit.re, 'ohm', fit.bands.re, 3],
                      ['fs', fit.fs, 'Hz', fit.bands.fs, 2],
                      ['Qms', fit.qms, '', fit.bands.qms, 2],
                      ['Qes', fit.qes, '', fit.bands.qes, 3],
                      ['Qts', fit.qts, '', fit.bands.qts, 3],
                    ] as const
                  ).map(([name, v, unit, band, d]) => (
                    <tr key={name}>
                      <th scope="row" className="left">
                        {name}
                      </th>
                      <td>
                        {v.toFixed(d)} {unit} <span className="hint">{pct(band)}</span>
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <th scope="row" className="left">
                      Le
                    </th>
                    <td>{fit.leMH.toFixed(2)} mH</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <p className="hint">The fit starts once 24 points are in.</p>
            )}
            <p className="hint">Bands are 95 % ranges. Sd, Xmax and Pe cannot be measured this way; they are entered by hand when the driver is saved.</p>
          </section>
        </div>
      )}

      <DriverPanel sweepDone={phase === 'done'} fit={fit} points={st?.points ?? []} probe={st?.hello ? { id: st.hello.id, fw: st.hello.fw } : undefined} canUse={canUse} onUse={onUse} />
    </main>
  );
}
