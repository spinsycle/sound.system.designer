import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROBE_VCAP, ProbeSession, type SessionState } from '../src/probe/session';

const mk = () => {
  const sent: string[] = [];
  const states: SessionState[] = [];
  const s = new ProbeSession((l) => sent.push(l), 'usb', (st) => states.push(st));
  return { s, sent, states };
};
const HELLO = '{"t":"hello","fw":"0.1.0","proto":"0.1","id":"dp-0001","caps":["sweep"]}';
const PLAN = { f0: 10, f1: 300, n: 60, vpeak: 0.5 };

describe('ProbeSession', () => {
  it('connecting -> ready on hello, and it records the probe identity', () => {
    const { s } = mk();
    expect(s.state.phase).toBe('connecting');
    s.onLine(HELLO);
    expect(s.state.phase).toBe('ready');
    expect(s.state.hello).toEqual({ fw: '0.1.0', id: 'dp-0001', proto: '0.1' });
  });

  it('ignores boot noise and a protocol it does not know', () => {
    const { s } = mk();
    s.onLine('ets Jun  8 2016 00:22:57');
    s.onLine('{"t":"hello","proto":"9.0","fw":"x","id":"y"}');
    expect(s.state.phase).toBe('connecting');
    expect(s.state.error?.code).toBe('proto');
  });

  it('refuses a plan above the cap, below 12 points, or going down, and sends nothing', () => {
    const { s, sent } = mk();
    s.onLine(HELLO);
    expect(() => s.start({ ...PLAN, vpeak: PROBE_VCAP + 0.01 })).toThrow();
    expect(() => s.start({ ...PLAN, vpeak: 0 })).toThrow();
    expect(() => s.start({ ...PLAN, n: 5 })).toThrow();
    expect(() => s.start({ ...PLAN, f1: 5 })).toThrow();
    expect(sent).toEqual([]);
  });

  it('will not start before the probe has said hello', () => {
    const { s } = mk();
    expect(() => s.start(PLAN)).toThrow();
  });

  it('sends the start line, then keepalive only while sweeping', () => {
    const { s, sent } = mk();
    s.onLine(HELLO);
    s.keepalive();
    expect(sent).toEqual([]);
    s.start(PLAN);
    expect(JSON.parse(sent[0]!)).toEqual({ t: 'start', ...PLAN });
    s.onLine('{"t":"status","state":"sweeping"}');
    s.keepalive();
    expect(sent[1]).toBe('{"t":"status"}');
  });

  it('a probe error aborts the sweep and keeps the code; busy and parse do not', () => {
    const { s } = mk();
    s.onLine(HELLO);
    s.start(PLAN);
    s.onLine('{"t":"status","state":"sweeping"}');
    s.onLine('{"t":"err","code":"busy","msg":"sweep running"}');
    expect(s.state.phase).toBe('sweeping');
    s.onLine('{"t":"err","code":"nodriver","msg":"x"}');
    expect(s.state.phase).toBe('aborted');
    expect(s.state.error?.code).toBe('nodriver');
  });

  it('closing the transport ends the session', () => {
    const { s } = mk();
    s.onLine(HELLO);
    s.closed();
    expect(s.state.phase).toBe('closed');
  });
});

// End to end: the firmware controller (DriverProbe tools/dpsim.exe, a simulated 12 in driver) <-> ProbeSession <-> fitter.
const exe = resolve(__dirname, '../../../../DriverProbe/build/dpsim.exe');
describe.skipIf(!existsSync(exe))('ProbeSession with the firmware controller', () => {
  it('runs a whole sweep, shows a running fit before the end, and lands on the driver', async () => {
    const proc = spawn(exe, ['--re', '3.4', '--fs', '38', '--qms', '5', '--qes', '0.5', '--noise', '0.004', '--seed', '3']);
    const seen: (number | null)[] = [];
    const done = new Promise<SessionState>((res) => {
      const s = new ProbeSession((l) => proc.stdin.write(l + '\n'), 'usb', (st) => {
        seen.push(st.fit ? st.fit.fs : null);
        if (st.phase === 'done') res(st);
      });
      let buf = '';
      proc.stdout.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          s.onLine(buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
      });
      s.hello();
      setTimeout(() => s.start({ f0: 6, f1: 230, n: 120, vpeak: 0.5 }), 50);
    });
    const st = await done;
    proc.kill();
    expect(st.points).toHaveLength(120);
    expect(seen.findIndex((v) => v !== null)).toBeLessThan(seen.length - 3); // a fit existed before the last points
    expect(Math.abs(st.fit!.fs - 38) / 38).toBeLessThan(0.02);
    expect(Math.abs(st.fit!.qes - 0.5) / 0.5).toBeLessThan(0.1);
  });
});
