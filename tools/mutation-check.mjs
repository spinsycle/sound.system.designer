// Mutation check: breaks one thing at a time and requires `npm run gate` to fail, then restores the file.
// A surviving mutation means the tests do not cover that formula. Usage: npm run mutation
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = (f) => `packages/physics/src/${f}`;
const test = (f) => `packages/physics/test/${f}`;
const app = (f) => `packages/app/src/${f}`;
const sys = app('system.ts');

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
  // A1 physics additions
  [src('power.ts'), 'Math.sqrt(2 * powerW * re)', 'Math.sqrt(powerW * re)'],
  [src('complex.ts'), 'return -dPhase / (2 * Math.PI * 2 * df);', 'return -dPhase / (2 * Math.PI * df);'],
  [src('complex.ts'), 'Math.atan2(b.im * a.re - b.re * a.im,', 'Math.atan2(b.re * a.im - b.im * a.re,'],
  // app model
  [app('model.ts'), 'P.peakVoltsForPower(d.powerW, driverOf(d).re) * 1000', 'P.peakVoltsForPower(d.powerW, driverOf(d).re) * 100'],
  [app('model.ts'), 'x: P.boxDisplacement(box, f)', 'x: P.boxResponse(box, f)'],
  [app('model.ts'), 'responseDb: P.dB(P.abs(r.g))', 'responseDb: P.abs(r.g)'],
  [app('model.ts'), 'impedanceOhm: P.abs(r.z)', 'impedanceOhm: r.z.re'],
  [app('model.ts'), 'phaseDeg: P.phaseDeg(r.z)', 'phaseDeg: -P.phaseDeg(r.z)'],
  [app('model.ts'), 'P.portLengthM(chamberL / 1000, d.tuneHz, d.portDiameterCm / 100) * 100', 'P.portLengthM(chamberL / 1000, d.tuneHz, d.portDiameterCm / 100) * 10'],
  [app('model.ts'), 'port(d.frontVolumeL);', 'port(d.volumeL);'],
  [app('model.ts'), 'if (lengthCm <= 0)', 'if (lengthCm <= -1e9)'],
  [app('model.ts'), 'if (x > xmaxMm) over = k;', 'if (x > xmaxMm * 1e6) over = k;'],
  [app('model.ts'), 'if (d.powerW > driver.pe)', 'if (d.powerW > driver.pe * 1e6)'],
  [app('model.ts'), 'd.custom.qms < d.custom.qts * 1.05)', 'd.custom.qms < 0)'],
  [app('model.ts'), 'const target = db[k]! - 3;', 'const target = db[k]! - 6;'],
  [app('model.ts'), 'P.sealedParams(driver.fs, derived.qts, driver.vasM3, vb)', 'P.sealedParams(driver.fs, derived.qts, driver.vasM3, d.volumeL)'],
  [app('model.ts'), 'P.ventedF3(driver.fs, derived.qts, driver.vasM3 / vb, d.tuneHz)', 'P.ventedF3(driver.fs, derived.qts, driver.vasM3 / d.volumeL, d.tuneHz)'],
  [app('model.ts'), 'P.clamp(v, r.min, r.max) : fallback', 'v : fallback'],
  [app('model.ts'), 'groupDelayMs: P.groupDelayS((x) => raw(x).g, f) * 1000', 'groupDelayMs: P.groupDelayS((x) => raw(x).g, f)'],
  // A2 horn simulation: Bessel and Struve
  [src('hornsim.ts'), 'return (-2 * tail) / x;', 'return -tail / x;'],
  [src('hornsim.ts'), '((m + 1) * (m + 2))', '((m + 1) * (m + 1))'],
  [src('hornsim.ts'), '(h * h * 8) / (3 * Math.PI)', '(h * h * 4) / (3 * Math.PI)'],
  [src('hornsim.ts'), '((m + 1.5) * (m + 2.5))', '((m + 1.5) * (m + 1.5))'],
  [src('hornsim.ts'), '0.1171875 / x ** 2', '0.12 / x ** 2'],
  [src('hornsim.ts'), '0.375 / x', '0.38 / x'],
  [src('hornsim.ts'), '+ 0.2775764465332031 / x ** 5', ''],
  [src('hornsim.ts'), 'x - 0.75 * Math.PI', 'x - 0.25 * Math.PI'],
  [src('hornsim.ts'), '(1 + 1 / x ** 2 - 3 / x ** 4', '(1 - 1 / x ** 2 - 3 / x ** 4'],
  [src('hornsim.ts'), '45 / x ** 6', '15 / x ** 6'],
  [src('hornsim.ts'), 'BESSEL_SWITCH = 20', 'BESSEL_SWITCH = 10'],
  [src('hornsim.ts'), 'SERIES_TERMS = 60', 'SERIES_TERMS = 30'],
  [src('hornsim.ts'), 'pistonRadiation(2 * k * Math.sqrt(areaM2 / Math.PI))', 'pistonRadiation(k * Math.sqrt(areaM2 / Math.PI))'],
  [src('hornsim.ts'), 'scale(cx(r1, x1), (RHO * C) / areaM2)', 'scale(cx(r1, x1), RHO / areaM2)'],
  // flares
  [src('hornsim.ts'), 'return a * Math.log((a + q) / r) - q;', 'return a * Math.log((a + q) / r) + q;'],
  [src('hornsim.ts'), 'Math.PI * (C / (2 * Math.PI * cutoffHz)) ** 2', 'Math.PI * (C / (Math.PI * cutoffHz)) ** 2'],
  [src('hornsim.ts'), 'const x0 = C / (2 * Math.PI * fl.cutoffHz);', 'const x0 = C / (Math.PI * fl.cutoffHz);'],
  [src('hornsim.ts'), "const t = fl.kind === 'exponential' ? 1 : fl.t;\n  const ratio", 'const t = fl.t;\n  const ratio'],
  [src('hornsim.ts'), 'ratio * ratio - (1 - t * t)', 'ratio * ratio - (1 - t)'],
  [src('hornsim.ts'), '/ (1 + t));', '/ 2);'],
  [src('hornsim.ts'), '* x) / fl.lengthM) ** 2', '* x)) ** 2'],
  [src('hornsim.ts'), 'for (let i = 0; i < 60; ++i)', 'for (let i = 0; i < 20; ++i)'],
  [src('hornsim.ts'), 'if (fromThroat - tractrixXm(x0, mid) < x) lo = mid;', 'if (fromThroat - tractrixXm(x0, mid) > x) lo = mid;'],
  [src('hornsim.ts'), "const t = fl.kind === 'exponential' ? 1 : fl.t;\n  return fl.throatM2", 'const t = fl.t;\n  return fl.throatM2'],
  [src('hornsim.ts'), 'Math.cosh(x / x0) + t * Math.sinh(x / x0)', 'Math.cosh(x / x0) + t * Math.cosh(x / x0)'],
  [src('hornsim.ts'), '((b.x - a.x) / 3)', '((b.x - a.x) / 2)'],
  [src('hornsim.ts'), 'a.area + b.area + Math.sqrt(a.area * b.area)', 'a.area + b.area + a.area'],
  // segment matrices
  [src('hornsim.ts'), '<= 1e-9 * r1)', '<= 1e-1 * r1)'],
  [src('hornsim.ts'), 'const x1 = (length * r1) / (r2 - r1);', 'const x1 = (length * r2) / (r2 - r1);'],
  [src('hornsim.ts'), 'a: (x2 / x1) * cs - sn / (k * x1),', 'a: (x2 / x1) * cs + sn / (k * x1),'],
  [src('hornsim.ts'), 'bi: ((RHO * C) / s2) * (x2 / x1) * sn,', 'bi: ((RHO * C) / s1) * (x2 / x1) * sn,'],
  [src('hornsim.ts'), '(x2 / x1 + 1 / (k * x1) ** 2) * sn', '(x2 / x1 + 1 / (k * x1)) * sn'],
  [src('hornsim.ts'), '- ((length / x1) * cs) / (k * x1)),', '),'],
  [src('hornsim.ts'), 'd: (x1 / x2) * cs + sn / (k * x2),', 'd: (x1 / x2) * cs - sn / (k * x2),'],
  [src('hornsim.ts'), 'a: m.a * s.a - m.bi * s.ci,', 'a: m.a * s.a + m.bi * s.ci,'],
  [src('hornsim.ts'), 'd: m.d * s.d - m.ci * s.bi }', 'd: m.d * s.d + m.ci * s.bi }'],
  [src('hornsim.ts'), 'bi: m.a * s.bi + m.bi * s.d,', 'bi: m.a * s.bi + m.bi * s.a,'],
  [src('hornsim.ts'), 'ci: m.ci * s.a + m.d * s.ci,', 'ci: m.ci * s.d + m.d * s.ci,'],
  [src('hornsim.ts'), 'add(scale(zl, m.a), cx(0, m.bi))', 'add(scale(zl, m.a), cx(m.bi))'],
  // driver coupling
  [src('hornsim.ts'), 'sys.throatChamberM3 > 0 ?', 'sys.throatChamberM3 < 0 ?'],
  [src('hornsim.ts'), 'scale(s, v / (RHO * C * C))', 'scale(s, v / (RHO * C))'],
  [src('hornsim.ts'), 'cx(r.rms, w * r.mms - 1 / (w * r.cms))', 'cx(r.rms, w * r.mms)'],
  [src('hornsim.ts'), 'add(cx(r.rms, w * r.mms - 1 / (w * r.cms)), scale(zf, sd2))', 'add(cx(r.rms, w * r.mms - 1 / (w * r.cms)), zf)'],
  [src('hornsim.ts'), 'div(cx(1), compliance(sys.rearVolumeM3))', 'compliance(sys.rearVolumeM3)'],
  [src('hornsim.ts'), 'add(zm, cx(r.bl * blRe))', 'zm'],
  [src('hornsim.ts'), 'Math.sqrt(8 * pistonRadiation(xm).r1) / xm', '1'],
  [src('hornsim.ts'), '(d.re * r.mms) / (d.sd * r.bl)', 'd.re / (d.sd * r.bl)'],
  [src('hornsim.ts'), 'x: div(v, s),', 'x: v,'],
  [src('hornsim.ts'), 'z: add(cx(d.re), div(cx(r.bl * r.bl), zm)),', 'z: div(cx(r.bl * r.bl), zm),'],
  // app horn model
  [app('model.ts'), 'throat = Math.min(throat, 0.5 * full);', ''],
  [app('model.ts'), 'mouth = Math.min(mouth, full);', ''],
  [app('model.ts'), 'Math.max(mouth, throat * 1.05)', 'mouth'],
  [app('model.ts'), 'IDEAL_SEGMENTS = 100', 'IDEAL_SEGMENTS = 50'],
  [app('model.ts'), 'throatChamberM3: d.horn.throatChamberL / 1000', 'throatChamberM3: d.horn.throatChamberL'],
  [app('model.ts'), 'rearVolumeM3: d.volumeL / 1000', 'rearVolumeM3: d.volumeL'],
  [app('model.ts'), 'if (at >= 0.99 * lengthCm) break;', 'if (at >= 0.9 * lengthCm) break;'],
  [app('model.ts'), 'curves = sim(g.built ?? g.ideal);', 'curves = sim(g.ideal);'],
  [app('model.ts'), 'P.hornModel(driver, derived, vb,', 'P.hornModel(driver, derived, d.volumeL,'],
  [app('model.ts'), 'P.hornJoints(g.flare, 8)', 'P.hornJoints(g.flare, 4)'],
  [app('model.ts'), 'heightCm: (j.area * 1e4) / d.horn.widthCm', 'heightCm: j.area * 1e4'],
  [app('model.ts'), 'if (pct < 99.5)', 'if (pct < 0)'],
  [app('model.ts'), 'if (pct < 99.5) warnings', 'if (pct < 1e9) warnings'],
  [app('model.ts'), 'P.hornVolume(g.built ?? g.ideal) * 1000', 'P.hornVolume(g.built ?? g.ideal)'],
  [app('model.ts'), '(driver.sd / g.flare.throatM2).toFixed(2)', '(g.flare.throatM2 / driver.sd).toFixed(2)'],
  [app('model.ts'), '> 0.01 * g.lengthM * 100) warnings', '> 1e9) warnings'],
  [app('model.ts'), "? 'cut short' : 'stretched'", "? 'stretched' : 'cut short'"],
  [app('model.ts'), 'P.C / (2 * Math.PI * Math.sqrt(g.flare.mouthM2 / Math.PI))', 'P.C / (Math.PI * Math.sqrt(g.flare.mouthM2 / Math.PI))'],
  [app('model.ts'), 'd.driverClass === CUSTOM_CLASS - 1', 'd.driverClass === CUSTOM_CLASS'],
  // A2c rear-loaded horn
  [src('hornsim.ts'), 'sys.rearLoaded ? pistonImpedance(k, d.sd) : div(cx(1), compliance(sys.rearVolumeM3))', 'div(cx(1), compliance(sys.rearVolumeM3))'],
  [src('hornsim.ts'), 'sys.rearLoaded ? pistonImpedance(k, d.sd) :', 'sys.rearLoaded ? cx(0) :'],
  [src('hornsim.ts'), 'sys.rearLoaded ? add(uc, scale(um, -1)) : um', 'sys.rearLoaded ? add(uc, um) : um'],
  [src('hornsim.ts'), 'sys.rearLoaded ? add(uc, scale(um, -1)) : um;', 'sys.rearLoaded ? scale(um, -1) : um;'],
  [app('model.ts'), "rearLoaded: d.horn.loading === 'rear' };", 'rearLoaded: false };'],
  [app('model.ts'), "loading: h.loading === 'rear' ? 'rear' : 'front',", "loading: 'front',"],
  [app('model.ts'), 'if (rear) {', 'if (!rear) {'],
  // A3 level, driver groups, limits
  [src('level.ts'), '(RHO * d.sd * m.bl * volts)', '(d.sd * m.bl * volts)'],
  [src('level.ts'), '(2 * Math.PI * r * d.re * m.mms)', '(4 * Math.PI * r * d.re * m.mms)'],
  [src('level.ts'), '20 * Math.log10(Math.abs(pressurePa) / P_REF)', '10 * Math.log10(Math.abs(pressurePa) / P_REF)'],
  [src('level.ts'), 'P_REF = 20e-6', 'P_REF = 2e-6'],
  [src('level.ts'), '(2 * Math.PI * C * m.mms * m.mms * d.re)', '(2 * Math.PI * C * m.mms * d.re)'],
  [src('level.ts'), 'loadFactor: series / parallel', 'loadFactor: parallel / series'],
  [src('level.ts'), 'voltsFactor: 1 / series', 'voltsFactor: 1'],
  [src('level.ts'), '20 * Math.log10(n / series)', '20 * Math.log10(n)'],
  [src('level.ts'), 'series * Math.sqrt(pe * re)', 'Math.sqrt(pe * re)'],
  [src('level.ts'), 'series * Math.sqrt(pe * re)', 'series * Math.sqrt(pe / re)'],
  [src('level.ts'), '(series * xmax) / (Math.SQRT2 * xPerVolt)', 'xmax / (Math.SQRT2 * xPerVolt)'],
  [src('level.ts'), '(Math.SQRT2 * xPerVolt)', 'xPerVolt'],
  [src('level.ts'), 'Math.sqrt(powerW * loadOhm)', 'Math.sqrt(powerW / loadOhm)'],
  [src('level.ts'), 'const phase = -2 * Math.PI * f * b.delayS;', 'const phase = 2 * Math.PI * f * b.delayS;'],
  // A3 system model
  [sys, 'REF_VOLTS * P.wiring(b.count, b.series).voltsFactor) * b.count;', 'REF_VOLTS * P.wiring(b.count, b.series).voltsFactor);'],
  [sys, 'REF_VOLTS * P.wiring(b.count, b.series).voltsFactor)', 'REF_VOLTS)'],
  [sys, '10 ** (b.trimDb / 20)', '10 ** (b.trimDb / 10)'],
  [sys, '(b.invert ? -1 : 1)', '1'],
  [sys, 'audible: !b.mute && (!anySolo || b.solo)', 'audible: !b.mute'],
  [sys, 'audible: !b.mute && (!anySolo || b.solo)', 'audible: !anySolo || b.solo'],
  [sys, 'delayS: x.b.delayMs / 1000', 'delayS: x.b.delayMs'],
  [sys, 'loHz: k === 0 ? p.lowestHz : xover[k - 1]!', 'loHz: k === 0 ? 20 : xover[k - 1]!'],
  [sys, 'TOP_HZ = 12000', 'TOP_HZ = 16000'],
  [sys, 'gain * P.abs(P.roomDirectResponse(room, f))', 'gain'],
  [sys, 'P.crossoverBands(f, xover)[k]!', 'P.crossoverBands(f, xover)[0]!'],
  [sys, 'if (short > 6)', 'if (short > 60)'],
  [sys, 'if (short > 6)', 'if (short > -60)'],
  [sys, 'if (!lower.audible || !upper.audible) return;', ''],
  [sys, 'Math.abs(fx - p.xover[k]!) > 1e-9', 'Math.abs(fx - p.xover[k]!) > 1e9'],
  [sys, 'Math.min(...native.filter(Number.isFinite))', 'Math.max(...native.filter(Number.isFinite))'],
  [sys, 'Number.isFinite(v) ? Math.round((target - v) * 10) / 10 + 0 : 0', 'Math.round((target - v) * 10) / 10 + 0'],
  [sys, 'n % series === 0 ? series : 1', 'n % series === 0 || true ? series : 1'],
  [sys, 'trimDb: trims[k] ?? 0', 'trimDb: 0'],
  [sys, '(4 * Math.PI * lengthM)', '(2 * Math.PI * lengthM)'],
  [sys, "{ loading: 'rear', throatChamberL: chamberL }", '{ throatChamberL: chamberL }'],
  [sys, 'P.clamp(i.nBands, 1, MAX_BANDS)', 'i.nBands'],
  [sys, 'P.clamp(i.selected, 0, nBands - 1)', 'i.selected'],
  [sys, 'if (anySolo) notes.push', 'if (!anySolo) notes.push'],
];

// `check` is the gate without the production build, which no mutation here can affect
const gate = () => spawnSync('npm run check', { cwd: root, shell: true, encoding: 'utf8' }).status;

if (gate() !== 0) {
  console.error('baseline gate fails: fix that first');
  process.exit(2);
}

// optional arguments: run only the mutations in files whose path contains one of them (e.g. `npm run mutation -- hornsim model`)
const only = process.argv.slice(2);
const selected = mutations.filter(([file]) => only.length === 0 || only.some((o) => file.includes(o)));
if (selected.length === 0) {
  console.error(`no mutation matches ${only.join(', ')}`);
  process.exit(2);
}

const survivors = [];
for (const [file, find, replace] of selected) {
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

console.log(`\n${selected.length - survivors.length} of ${selected.length} mutations caught${only.length ? ` (files matching: ${only.join(', ')}; ${mutations.length} in the full list)` : ''}`);
if (survivors.length) {
  console.error('SURVIVED:\n  ' + survivors.join('\n  '));
  process.exit(1);
}
if (gate() !== 0) {
  console.error('gate fails after restoring: a file was not restored');
  process.exit(2);
}
