// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Driver Probe session: speaks the probe protocol (DriverProbe repo, spec/protocol.md v0.1) over any line transport,
// collects the sweep and refits it as points arrive. No UI and no transport in here, so it is tested without either.
import { type FreeAirFit, type ImpedancePoint, fitFreeAir } from '@soundsystemdesigner/physics';

export type Transport = 'usb' | 'wifi';
export type Phase = 'connecting' | 'ready' | 'sweeping' | 'done' | 'aborted' | 'closed';

/** Hard drive cap the probe enforces; the session refuses to ask for more. */
export const PROBE_VCAP = 1.0;
/** Fewest points before a fit is attempted (the fitter needs 12; a few more makes the first fit meaningful). */
const MIN_FIT_POINTS = 24;

export interface SweepPlan {
  f0: number;
  f1: number;
  n: number;
  vpeak: number;
}

export interface SessionState {
  phase: Phase;
  transport: Transport;
  hello: { fw: string; id: string; proto: string } | null;
  plan: SweepPlan | null;
  points: ImpedancePoint[];
  fit: FreeAirFit | null;
  /** The last probe error, e.g. {code: 'nodriver'}. */
  error: { code: string; msg: string } | null;
}

export class ProbeSession {
  state: SessionState;

  constructor(
    private send: (line: string) => void,
    transport: Transport,
    private onChange: (s: SessionState) => void,
  ) {
    this.state = { phase: 'connecting', transport, hello: null, plan: null, points: [], fit: null, error: null };
  }

  private set(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  hello(): void {
    this.send('{"t":"hello"}');
  }

  /** Throws on a plan the probe would refuse, so the user sees why before anything is sent. */
  start(plan: SweepPlan): void {
    if (this.state.phase !== 'ready' && this.state.phase !== 'done' && this.state.phase !== 'aborted') throw new Error('The probe is not ready for a sweep.');
    if (!(plan.vpeak > 0) || plan.vpeak > PROBE_VCAP) throw new Error(`Drive level must be above 0 and at most ${PROBE_VCAP} V.`);
    if (!(plan.f0 > 0) || !(plan.f1 > plan.f0)) throw new Error('The sweep must go up in frequency.');
    if (!(plan.n >= 12) || plan.n > 2000) throw new Error('A sweep needs 12 to 2000 points.');
    this.set({ plan, points: [], fit: null, error: null });
    this.send(JSON.stringify({ t: 'start', f0: plan.f0, f1: plan.f1, n: plan.n, vpeak: plan.vpeak }));
  }

  stop(): void {
    this.send('{"t":"stop"}');
  }

  /** The probe aborts a sweep if the host is silent for 3 s: call this about once a second while sweeping. */
  keepalive(): void {
    if (this.state.phase === 'sweeping') this.send('{"t":"status"}');
  }

  /** The transport went away. */
  closed(): void {
    this.set({ phase: 'closed' });
  }

  onLine(line: string): void {
    let m: any;
    try {
      m = JSON.parse(line);
    } catch {
      return; // boot messages and noise on the line are not protocol
    }
    if (!m || typeof m.t !== 'string') return;
    switch (m.t) {
      case 'hello':
        if (typeof m.proto !== 'string' || !m.proto.startsWith('0.')) {
          this.set({ error: { code: 'proto', msg: `Unsupported probe protocol ${String(m.proto)}.` } });
          return;
        }
        this.set({ hello: { fw: String(m.fw), id: String(m.id), proto: m.proto }, phase: this.state.phase === 'connecting' ? 'ready' : this.state.phase });
        return;
      case 'status':
        if (m.state === 'sweeping' && this.state.phase !== 'sweeping') this.set({ phase: 'sweeping' });
        else if (m.state === 'idle' && this.state.phase === 'connecting') this.set({ phase: 'ready' });
        else if (m.state === 'aborted') this.set({ phase: 'aborted' });
        return;
      case 'pt': {
        if (this.state.phase !== 'sweeping') this.set({ phase: 'sweeping' });
        const pts = [...this.state.points, { f: m.f, re: m.re, im: m.im }];
        let fit = this.state.fit;
        if (pts.length >= MIN_FIT_POINTS && (pts.length % 6 === 0 || pts.length === this.state.plan?.n)) fit = this.tryFit(pts) ?? fit;
        this.set({ points: pts, fit });
        return;
      }
      case 'done':
        this.set({ phase: 'done', fit: this.tryFit(this.state.points) ?? this.state.fit });
        return;
      case 'err':
        this.set({ error: { code: String(m.code), msg: String(m.msg ?? '') }, phase: m.code === 'busy' || m.code === 'parse' || m.code === 'limit' ? this.state.phase : 'aborted' });
        return;
    }
  }

  private tryFit(pts: ImpedancePoint[]): FreeAirFit | null {
    try {
      return fitFreeAir(pts);
    } catch {
      return null; // a partial curve can be unfittable; the next point may fix it
    }
  }
}

export const ERROR_TEXT: Record<string, string> = {
  limit: 'The probe refused the drive level (above its hard cap).',
  clip: 'The probe stopped the sweep: the signal clipped. Lower the drive level.',
  nodriver: 'The probe stopped the sweep: no driver is connected (impedance far too high).',
  busy: 'A sweep is already running.',
  link: 'The probe stopped the sweep because it lost contact with the app.',
  parse: 'The probe could not read the request.',
  proto: 'This probe speaks a protocol version the app does not understand.',
};
