// Mutation check: breaks one thing at a time and requires `npm run gate` to fail, then restores the file.
// A surviving mutation means the tests do not cover that formula. Usage: npm run mutation
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = (f) => `packages/physics/src/${f}`;
const test = (f) => `packages/physics/test/${f}`;

// [file, find (first occurrence), replace]
const mutations = [
  // the gate itself
  [src('constants.ts'), 'export const C = 343.0;', 'export const C: string = 343.0 as never;'], // type check step
  [test('vectors.test.ts'), "expectVec('thermal_gain', 'db', P.thermalGainDb(vec('thermal_gain').inputs.delta_t_k!));", 'void 0;'], // coverage check
  // constants
  [src('constants.ts'), 'C = 343.0', 'C = 344.0'],
  [src('constants.ts'), 'RHO = 1.18', 'RHO = 1.2'],
  [src('constants.ts'), '0.00393', '0.004'],
  // drivers
  [src('drivers.ts'), '1 / (1 / d.qes + 1 / d.qms)', '1 / (1 / d.qes)'],
  [src('drivers.ts'), '(RHO * C * C * d.sd * d.sd)', '(RHO * C * d.sd * d.sd)'],
  [src('drivers.ts'), '1 / (ws * ws * cms)', '1 / (ws * cms)'],
  [src('drivers.ts'), '(ws * mms * d.re) / d.qes', '(ws * mms * d.re) / d.qms'],
  [src('drivers.ts'), '(ws * mms) / d.qms', '(ws * mms) / d.qes'],
  [src('drivers.ts'), "name: '15 in', fs: 32", "name: '15 in', fs: 33"],
  [src('drivers.ts'), 'xmax: 0.012, pe: 900', 'xmax: 0.012, pe: 800'],
  [src('drivers.ts'), 'qts * 1.05', 'qts * 1.5'],
  [src('drivers.ts'), '(qms - qts)', '(qms + qts)'],
  [src('drivers.ts'), 'clamp(c.qts, 0.05, 3.0)', 'clamp(c.qts, 0.15, 1.5)'],
  [src('drivers.ts'), 'clamp(c.qms, 0.5, 50.0)', 'clamp(c.qms, 1.0, 20.0)'],
  [src('drivers.ts'), 'clamp(c.fsHz, 5.0, 500.0)', 'clamp(c.fsHz, 10.0, 300.0)'],
  [src('drivers.ts'), 'clamp(c.vasL, 0.1, 5000.0) * 1e-3', 'clamp(c.vasL, 1.0, 2000.0) * 1e-3'],
  [src('drivers.ts'), 'clamp(c.sdCm2, 1.0, 5000.0) * 1e-4', 'clamp(c.sdCm2, 1.0, 5000.0) * 1e-3'],
  [src('drivers.ts'), 'clamp(c.reOhm, 0.5, 64.0)', 'clamp(c.reOhm, 1.0, 32.0)'],
  [src('drivers.ts'), 'clamp(c.xmaxMm, 0.1, 60.0)', 'clamp(c.xmaxMm, 0.2, 40.0)'],
  [src('drivers.ts'), 'clamp(c.powerW, 1.0, 10000.0)', 'clamp(c.powerW, 5.0, 5000.0)'],
  // sealed
  [src('sealed.ts'), 'fc: fs * Math.sqrt(1 + alpha)', 'fc: fs * Math.sqrt(alpha)'],
  [src('sealed.ts'), 'qtc: qts * Math.sqrt(1 + alpha)', 'qtc: qts * (1 + alpha)'],
  [src('sealed.ts'), 'wc / qtc', 'wc * qtc'],
  [src('sealed.ts'), '1 / (qtc * qtc) - 2', '1 / (qtc * qtc) - 1'],
  [src('sealed.ts'), 'k * k + 4', 'k * k + 2'],
  [src('sealed.ts'), '(RHO * C * C * sd * sd)', '(RHO * C * C * sd)'],
  [src('sealed.ts'), 'r.rms + (r.bl * r.bl) / d.re, 1 / cmt', '(r.bl * r.bl) / d.re, 1 / cmt'],
  [src('sealed.ts'), '(r.cms * cmb) / (r.cms + cmb)', 'cmb'],
  // ported
  [src('ported.ts'), '(alpha + 1) * tb * tb + ts * ts', 'alpha * tb * tb + ts * ts'],
  [src('ported.ts'), '(tb * tb * ts) / qts', '(tb * ts * ts) / qts'],
  [src('ported.ts'), 'ts / qts, 1]', 'tb / qts, 1]'],
  [src('ported.ts'), 'poly([tb * tb * ts * ts, 0, 0, 0, 0], s)', 'poly([tb * tb * ts * ts, 0, 0, 0], s)'],
  [src('ported.ts'), '(r.bl / (d.re * r.mms)) * ts * ts', '(r.bl / (d.re * r.mms)) * ts'],
  [src('ported.ts'), 'poly([tb * tb, 0, 1], s)', 'poly([tb * tb, 0, 2], s)'],
  [src('ported.ts'), '>= -3;', '>= -6;'],
  [src('ported.ts'), '0.732', '0.85'],
  [src('ported.ts'), '4 * Math.PI * Math.PI * fb * fb * vbM3', '4 * Math.PI * fb * fb * vbM3'],
  // band-pass
  [src('bandpass.ts'), '(1 + ar + af)', '(1 + af)'],
  [src('bandpass.ts'), 'ts / qts, 1 + ar]', 'ts / qts, 1]'],
  [src('bandpass.ts'), 'poly([ts * ts, 0, 0], s)', 'poly([ts, 0, 0], s)'],
  [src('bandpass.ts'), '(r.bl * r.cms) / d.re', 'r.bl / d.re'],
  [src('bandpass.ts'), 'poly([tb * tb, 0, 1], s)', 'poly([tb, 0, 1], s)'],
  // horn
  [src('horn.ts'), '(m * C) / (4 * Math.PI)', '(m * C) / (2 * Math.PI)'],
  [src('horn.ts'), 'Math.log(smM2 / stM2) / lengthM', 'Math.log(smM2 / stM2)'],
  [src('horn.ts'), 'C / (2 * Math.PI * fc)', 'C / (Math.PI * fc)'],
  [src('horn.ts'), '(RHO * C * d.sd * d.sd) / stM2', '(RHO * C * d.sd * d.sd) / smM2'],
  [src('horn.ts'), 'const r0 = r.rms + (r.bl * r.bl) / d.re;', 'const r0 = (r.bl * r.bl) / d.re;'],
  [src('horn.ts'), 'const rTot = r0 + rLoad;', 'const rTot = rLoad;'],
  [src('horn.ts'), 'fh: rTot / (2 * Math.PI * r.mms)', 'fh: rTot / (Math.PI * r.mms)'],
  [src('horn.ts'), '(2 * Math.PI * C * rLoad)', '(Math.PI * C * rLoad)'],
  [src('horn.ts'), 'cmt: (r.cms * cmb) / (r.cms + cmb)', 'cmt: r.cms'],
  [src('horn.ts'), 'Math.SQRT2 * h.wc', '2 * h.wc'],
  [src('horn.ts'), 'poly([h.rLoad, 0, 0, 0], s)', 'poly([h.rLoad, 0, 0], s)'],
  [src('horn.ts'), 'poly([h.kg, 0, 0, 0], s)', 'poly([h.kg, 0, 0], s)'],
  [src('horn.ts'), 'h.bl / h.re', 'h.bl'],
  // power
  [src('power.ts'), '-20 * Math.log10(1 + ALPHA_CU', '-10 * Math.log10(1 + ALPHA_CU'],
  [src('power.ts'), 'Math.tanh(u) / u', 'Math.tanh(u)'],
  [src('power.ts'), '1 - (u * u) / 3', '1 - u / 3'],
  // crossover
  [src('crossover.ts'), 'Math.tan((Math.PI * f) / sampleRate)', 'Math.tan((2 * Math.PI * f) / sampleRate)'],
  [src('crossover.ts'), ': f / fc;', ': fc / f;'],
  [src('crossover.ts'), 'poly([1, Math.SQRT2, 1], s)', 'poly([1, 2, 1], s)'],
  [src('crossover.ts'), 'return mul(h, h);', 'return h;'],
  [src('crossover.ts'), 'rest = mul(rest, lr4Hp(', 'rest = mul(rest, lr4Lp('],
  [src('crossover.ts'), 'for (let s = k + 1; s < n - 1; ++s)', 'for (let s = k + 2; s < n - 1; ++s)'],
  [src('crossover.ts'), 'prev * 1.2', 'prev * 1.1'],
  [src('crossover.ts'), ': 20;', ': 10;'],
  [src('crossover.ts'), '0.45 * sampleRate', '0.5 * sampleRate'],
  [src('crossover.ts'), 'Math.max(bands - 1, 0)', 'Math.max(bands, 0)'],
  // box clamps and wiring
  [src('box.ts'), 'Math.max(p.volumeL, 0.01)', 'Math.max(p.volumeL, 0.1)'],
  [src('box.ts'), 'Math.max(p.tuneHz, 1)', 'Math.max(p.tuneHz, 2)'],
  [src('box.ts'), 'Math.max(p.frontVolumeL, 0.01)', 'Math.max(p.frontVolumeL, 0.1)'],
  [src('box.ts'), 'Math.max(p.hornThroatCm2, 0.5)', 'Math.max(p.hornThroatCm2, 0.05)'],
  [src('box.ts'), 'p.hornThroatCm2 * 1.01', 'p.hornThroatCm2 * 1.1'],
  [src('box.ts'), 'Math.max(p.hornLengthM, 0.05)', 'Math.max(p.hornLengthM, 0.01)'],
  [src('box.ts'), 'const ar = d.vasM3 / vb;', 'const ar = vb / d.vasM3;'],
  // system
  [src('system.ts'), 'b >= p.bands || p.band[b]!.mute', 'b >= p.bands'],
  [src('system.ts'), '!anySolo || p.band[b]!.solo', '!anySolo'],
  [src('system.ts'), 'p.band.slice(0, p.bands)', 'p.band'],
  [src('system.ts'), 's.trimDb / 20', 's.trimDb / 10'],
  [src('system.ts'), 'MAX_DELAY_SAMPLES = 4095', 'MAX_DELAY_SAMPLES = 8191'],
  [src('system.ts'), 'Math.round(s.delayMs * 1e-3 * sampleRate), 0,', 'Math.round(s.delayMs * 1e-3 * sampleRate), -9999,'],
  [src('system.ts'), 'Math.round(s.delayMs * 1e-3 * sampleRate)', '(s.delayMs * 1e-3 * sampleRate)'],
  [src('system.ts'), ': Math.max(s.delayMs, 0) * 1e-3', ': Math.max(s.delayMs, 0) * 1e-2'],
  [src('system.ts'), 'const phase = -2 * Math.PI', 'const phase = 2 * Math.PI'],
  [src('system.ts'), 'if (p.align)', 'if (!p.align)'],
  [src('system.ts'), 'boxResponse(s.box, f)', 'boxResponse(p.band[0]!.box, f)'],
  // room
  [src('room.ts'), '8.686 *', '8.68 *'],
  [src('room.ts'), '1.84e-11', '1.85e-11'],
  [src('room.ts'), '0.01275', '0.0128'],
  [src('room.ts'), '0.1068', '0.107'],
  [src('room.ts'), '4.04e4', '4.05e4'],
  [src('room.ts'), '-4.17 *', '-4.2 *'],
  [src('room.ts'), '1.261', '1.27'],
  [src('room.ts'), '=> -20 * Math.log10(Math.max(r, 1e-9)', '=> -10 * Math.log10(Math.max(r, 1e-9)'],
  [src('room.ts'), '=> r / C;', '=> (r - 1) / C;'],
  [src('room.ts'), '20 * Math.log10(2 ** n)', '10 * Math.log10(2 ** n)'],
  [src('room.ts'), '0.057 *', '0.06 *'],
  [src('room.ts'), 'C / (4 * Math.max(distM, 0.01))', 'C / (2 * Math.max(distM, 0.01))'],
  [src('room.ts'), 'Math.max(distM, 0.01)', 'Math.max(distM, 0.001)'],
  [src('room.ts'), 'warp(fc) / Math.sqrt(g)', 'warp(fc) / g'],
  [src('room.ts'), 'return div(cx(g * w0, w), cx(w0, w));', 'return div(cx(g * w0, w), cx(w0, 2 * w));'],
  [src('room.ts'), '2 * sampleRate * Math.tan((Math.PI * x) / sampleRate)', '2 * Math.PI * x'],
  [src('room.ts'), 'AIR_STAGES = 12', 'AIR_STAGES = 11'],
  [src('room.ts'), 'AIR_MATCH_HZ = 9000.0', 'AIR_MATCH_HZ = 8000.0'],
  [src('room.ts'), 'MAX_TAIL_GAIN = 16.0', 'MAX_TAIL_GAIN = 8.0'],
  [src('room.ts'), 'Math.max(r - REF_DISTANCE_M, 0)', 'Math.max(r, 0)'],
  [src('room.ts'), '(p.held ? 1 : REF_DISTANCE_M / clampDistance(p.distanceM))', '(REF_DISTANCE_M / clampDistance(p.distanceM))'],
  [src('room.ts'), 'if (!p.indoor) return 0;', ''],
  [src('room.ts'), 'Math.max(p.volumeM3, 1)', 'Math.max(p.volumeM3, 10)'],
  [src('room.ts'), 'Math.max(p.rt60, 0.05)', 'Math.max(p.rt60, 0.2)'],
  [src('room.ts'), '(p.held ? clampDistance(p.distanceM) : 1) / rc', '1 / rc'],
  [src('room.ts'), 'MAX_DISTANCE_M = 200.0', 'MAX_DISTANCE_M = 400.0'],
  [src('room.ts'), 'clamp(r, REF_DISTANCE_M, MAX_DISTANCE_M)', 'Math.min(r, MAX_DISTANCE_M)'],
  [src('room.ts'), 'airAbsorptionDbPerM(f) * (r - REF_DISTANCE_M)', 'airAbsorptionDbPerM(f) * r'],
  // impedance
  [src('impedance.ts'), 'cx(1 - blSx.re, -blSx.im)', 'cx(1 + blSx.re, blSx.im)'],
  [src('impedance.ts'), 'scale(mul(jw(f), x), bl)', 'scale(x, bl)'],
  [src('impedance.ts'), 'div(cx(re),', 'div(cx(1),'],
  [src('impedance.ts'), 'deriveDriver(p.driver).bl, p.driver.re', 'deriveDriver(p.driver).bl, 1'],
  [src('impedance.ts'), 'boxDisplacement(p, f), deriveDriver(p.driver).bl', 'boxDisplacement(p, f), 1'],
  [src('impedance.ts'), '* 180) / Math.PI', '* 90) / Math.PI'],
];

const gate = () => spawnSync('npm run gate', { cwd: root, shell: true, encoding: 'utf8' }).status;

if (gate() !== 0) {
  console.error('baseline gate fails: fix that first');
  process.exit(2);
}

const survivors = [];
for (const [file, find, replace] of mutations) {
  const path = root + file;
  const original = readFileSync(path, 'utf8');
  if (!original.includes(find)) {
    survivors.push(`${file}: "${find}" not found (stale mutation)`);
    continue;
  }
  writeFileSync(path, original.replace(find, () => replace));
  try {
    if (gate() === 0) survivors.push(`${file}: ${find}  ->  ${replace}`);
  } finally {
    writeFileSync(path, original);
  }
  process.stdout.write('.');
}

console.log(`\n${mutations.length - survivors.length} of ${mutations.length} mutations caught`);
if (survivors.length) {
  console.error('SURVIVED:\n  ' + survivors.join('\n  '));
  process.exit(1);
}
if (gate() !== 0) {
  console.error('gate fails after restoring: a file was not restored');
  process.exit(2);
}
