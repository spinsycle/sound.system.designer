import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as P from '../src/index';

// Driver Probe cross-check (P2): the firmware's own controller, on a simulated driver, speaks the protocol; the
// Designer's fitter must recover the driver from the points it sends. Needs the firmware built first
// (DriverProbe: tools/check.ps1 makes build/dpsim.exe); without it these tests skip and say why.
const exe = resolve(__dirname, '../../../../DriverProbe/build/dpsim.exe');
const have = existsSync(exe);

function sweepVia(args: string[], start: string): { pts: P.ImpedancePoint[]; lines: any[] } {
  const r = spawnSync(exe, args, { input: `{"t":"hello"}\n${start}\n`, encoding: 'utf8' });
  const lines = r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const pts = lines.filter((l) => l.t === 'pt').map((l) => ({ f: l.f, re: l.re, im: l.im }));
  return { pts, lines };
}
const START = '{"t":"start","f0":6,"f1":230,"n":120,"vpeak":0.5}';
const near = (got: number, want: number, rel: number) => Math.abs(got - want) <= rel * Math.abs(want);

describe.skipIf(!have)('firmware sweep -> Designer fitter', () => {
  it('a clean simulated sweep recovers the driver to 0.1 %, and the firmware sent hello and done', () => {
    const { pts, lines } = sweepVia(['--re', '3.4', '--fs', '38', '--qms', '5', '--qes', '0.5'], START);
    expect(lines[0]).toMatchObject({ t: 'hello', proto: '0.1' });
    expect(lines.filter((l) => l.t === 'done')).toHaveLength(1);
    expect(pts).toHaveLength(120);
    const fit = P.fitFreeAir(pts);
    expect(near(fit.re, 3.4, 1e-3)).toBe(true);
    expect(near(fit.fs, 38, 1e-3)).toBe(true);
    expect(near(fit.qms, 5, 1e-3)).toBe(true);
    expect(near(fit.qes, 0.5, 1e-3)).toBe(true);
  });

  it('a noisy sweep with coil inductance still lands within its own reported bands', () => {
    const { pts } = sweepVia(['--re', '5.8', '--fs', '52', '--qms', '3.2', '--qes', '0.7', '--le', '0.8', '--noise', '0.01', '--seed', '9'], '{"t":"start","f0":8,"f1":312,"n":150,"vpeak":0.5}');
    const fit = P.fitFreeAir(pts);
    expect(near(fit.fs, 52, Math.max(fit.bands.fs, 1e-9) * 1.5)).toBe(true);
    expect(near(fit.re, 5.8, fit.bands.re * 1.5)).toBe(true);
    expect(near(fit.qes, 0.7, fit.bands.qes * 1.5)).toBe(true);
    expect(near(fit.leMH, 0.8, 0.3)).toBe(true);
  });
});
