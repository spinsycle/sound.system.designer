// Asserts every shared physics test vector (test-vectors.json, generated in the vault by reference_vectors.py and
// copied here by `npm run sync-vectors`). The last test fails if any vector output was never asserted, so a vector
// added to the spec cannot be silently skipped.
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import * as P from '../src/index';

interface Vector {
  id: string;
  inputs: Record<string, number>;
  outputs: Record<string, number>;
  tol: { rel?: number; abs_db?: number; abs?: number };
}

const file = JSON.parse(readFileSync(new URL('./test-vectors.json', import.meta.url), 'utf8')) as { vectors: Vector[] };
const vectors = new Map(file.vectors.map((v) => [v.id, v]));
const asserted = new Set<string>();

function vec(id: string): Vector {
  const v = vectors.get(id);
  if (!v) throw new Error(`missing vector ${id}`);
  return v;
}

/** Same tolerance rule as the plugin's expectVec: rel, abs_db or abs. */
function expectVec(id: string, key: string, got: number): void {
  const v = vec(id);
  const want = v.outputs[key];
  if (want === undefined) throw new Error(`vector ${id} has no output ${key}`);
  const tol = v.tol.rel !== undefined ? v.tol.rel * Math.max(Math.abs(want), 1e-300) : (v.tol.abs_db ?? v.tol.abs ?? 1e-12);
  asserted.add(`${id}.${key}`);
  expect(Math.abs(got - want), `${id}.${key}: got ${got}, want ${want}, tol ${tol}`).toBeLessThanOrEqual(tol);
}

const magDb = (h: P.Cx): number => P.dB(P.abs(h));
const ids = (prefix: string): string[] => [...vectors.keys()].filter((id) => id.startsWith(prefix));

// the reference driver every displacement and horn vector uses
const dv = vec('driver_derived').inputs;
const spec: P.DriverSpec = { name: 'ref', fs: dv.fs!, qes: dv.qes!, qms: dv.qms!, vasM3: dv.vas_m3!, sd: dv.sd_m2!, re: dv.re!, xmax: 0.01, pe: 100 };
const ref = P.deriveDriver(spec);

describe('shared vectors', () => {
  it('drivers', () => {
    for (const k of ['qts', 'cms', 'mms', 'bl', 'rms'] as const) expectVec('driver_derived', k, ref[k]);
  });

  it('sealed', () => {
    const i = vec('sealed_params').inputs;
    const p = P.sealedParams(i.fs!, i.qts!, i.vas!, i.vb!);
    expectVec('sealed_params', 'alpha', p.alpha);
    expectVec('sealed_params', 'fc', p.fc);
    expectVec('sealed_params', 'qtc', p.qtc);
    for (const id of ids('sealed_f3_')) expectVec(id, 'f3', P.sealedF3(vec(id).inputs.fc!, vec(id).inputs.qtc!));
    for (const id of ids('sealed_mag_')) {
      const v = vec(id).inputs;
      expectVec(id, 'db', magDb(P.sealedHP(v.f!, v.fc!, v.qtc!)));
    }
    for (const id of ids('sealed_x_')) expectVec(id, 'x_per_v', P.abs(P.sealedX(vec(id).inputs.f!, spec, ref, vec(id).inputs.vb_m3!)));
  });

  it('ported', () => {
    for (const id of [...ids('vented_b4_mag_'), 'vented_hf_asymptote']) {
      const v = vec(id).inputs;
      expectVec(id, 'db', magDb(P.ventedG(v.f!, v.fs!, v.qts!, v.vas_l! / v.vb_l!, v.fb!)));
    }
    const b4 = vec('vented_b4_f3').inputs;
    expectVec('vented_b4_f3', 'f3', P.ventedF3(b4.fs!, b4.qts!, b4.vas_l! / b4.vb_l!, b4.fb!));
    for (const id of ids('vented_x_')) {
      const v = vec(id).inputs;
      expectVec(id, 'x_per_v', P.abs(P.ventedX(v.f!, spec, ref, v.vas_l! / v.vb_l!, v.fb!)));
    }
    expectVec('vented_x_dc', 'free_air', (ref.bl * ref.cms) / spec.re);
    const pl = vec('port_length').inputs;
    expectVec('port_length', 'length_m', P.portLengthM(pl.vb_m3!, pl.fb!, pl.d_m!));
    const pr = vec('port_length_rect').inputs;
    expectVec('port_length_rect', 'length_m', P.portLengthFromAreaM(pr.vb_m3!, pr.fb!, pr.w_m! * pr.h_m!));
    const pa = vec('port_length_area_round').inputs;
    expectVec('port_length_area_round', 'length_m', P.portLengthFromAreaM(pa.vb_m3!, pa.fb!, pa.area_m2!));
    // a round port's area gives the round form's length
    expect(P.portLengthFromAreaM(pl.vb_m3!, pl.fb!, Math.PI * (pl.d_m! / 2) ** 2)).toBeCloseTo(P.portLengthM(pl.vb_m3!, pl.fb!, pl.d_m!), 12);
  });

  it('folded horn (app only, v0.14)', () => {
    for (const id of ['fold_4legs', 'fold_2legs']) {
      const v = vec(id).inputs;
      const fl: P.Flare = { kind: 'exponential', throatM2: v.st_m2!, mouthM2: v.sm_m2!, cutoffHz: v.fc!, t: 1, lengthM: 0 };
      const f = P.foldHorn(fl, v.width_m!, v.legs!, v.depth_out_m!, v.t!);
      expectVec(id, 'leg_m', f.leg);
      expectVec(id, 'd_o', f.dO);
      expectVec(id, 'h_o', f.hO);
      expectVec(id, 'min_depth_i', f.minDepthI);
      f.heights.forEach((h, k) => expectVec(id, `h${k}`, h));
      f.gaps.forEach((g, k) => expectVec(id, `gap${k}`, g));
      f.septaLength.forEach((l, k) => expectVec(id, `sep_len${k}`, l));
      f.septaTop.forEach((y, k) => expectVec(id, `sep_top${k}`, y));
      if (id === 'fold_4legs') expectVec(id, 'w_o', f.wO);
      expect(f.feasible).toBe(true);
      // the path is the flare's, and no turn is narrower than the legs it joins
      expect(f.ends[f.ends.length - 1]).toBeCloseTo(f.length, 12);
      f.gaps.forEach((g, k) => expect(g).toBeGreaterThanOrEqual(Math.max(f.heights[k]!, f.heights[k + 1]!) - 1e-15));
    }
  });

  it('tapered folded horn (app only, v0.15)', () => {
    for (const id of ['fold_tapered_2legs', 'fold_tapered_4legs']) {
      const v = vec(id).inputs;
      const fl: P.Flare = { kind: 'exponential', throatM2: v.st_m2!, mouthM2: v.sm_m2!, cutoffHz: v.fc!, t: 1, lengthM: 0 };
      const f = P.foldHorn(fl, v.width_m!, v.legs!, v.depth_out_m!, v.t!, 'tapered');
      expectVec(id, 'leg_m', f.leg);
      expectVec(id, 'w_o', f.wO);
      expectVec(id, 'h_o', f.hO);
      expectVec(id, 'd_o', f.dO);
      expectVec(id, 'min_depth_i', f.minDepthI);
      f.heightsFront.forEach((h, k) => expectVec(id, `hf${k}`, h));
      f.heightsBack.forEach((h, k) => expectVec(id, `hb${k}`, h));
      f.gaps.forEach((g, k) => expectVec(id, `gap${k}`, g));
      f.septaFrontTop.forEach((y, k) => expectVec(id, `top_f${k}`, y));
      f.septaBackTop.forEach((y, k) => expectVec(id, `top_b${k}`, y));
      f.septaSlant.forEach((l, k) => expectVec(id, `slant${k}`, l));
      f.septaAngle.forEach((a, k) => expectVec(id, `angle${k}`, a));
      expect(f.feasible).toBe(true);
      expect(f.style).toBe('tapered');
    }
  });

  it('an infeasible fold is finite and flagged (app only, v0.14)', () => {
    const v = vec('fold_infeasible').inputs;
    const fl: P.Flare = { kind: 'exponential', throatM2: v.st_m2!, mouthM2: v.sm_m2!, cutoffHz: v.fc!, t: 1, lengthM: 0 };
    const f = P.foldHorn(fl, v.width_m!, v.legs!, v.depth_out_m!, v.t!);
    expectVec('fold_infeasible', 'leg_m', f.leg);
    expectVec('fold_infeasible', 'feasible', f.feasible ? 1 : 0);
    expectVec('fold_infeasible', 'h0', f.heights[0]!);
    expectVec('fold_infeasible', 'h3', f.heights[3]!);
    expectVec('fold_infeasible', 'h_o', f.hO);
    expectVec('fold_infeasible', 'min_depth_i', f.minDepthI);
  });

  it('thermal', () => {
    expectVec('thermal_gain', 'db', P.thermalGainDb(vec('thermal_gain').inputs.delta_t_k!));
  });

  it('band-pass', () => {
    for (const id of ids('bp_mag_')) {
      const v = vec(id).inputs;
      expectVec(id, 'db', magDb(P.bandpassG(v.f!, v.fs!, v.qts!, v.vas_l! / v.vr_l!, v.vas_l! / v.vf_l!, v.fb!)));
    }
    for (const id of ids('bp_x_')) {
      const v = vec(id).inputs;
      expectVec(id, 'x_per_v', P.abs(P.bandpassX(v.f!, spec, ref, v.vas_l! / v.vr_l!, v.vas_l! / v.vf_l!, v.fb!)));
    }
    const dc = vec('bp_x_dc').inputs;
    expectVec('bp_x_dc', 'sealed_rear', P.abs(P.sealedX(dc.f!, spec, ref, dc.vr_l! / 1000)));
  });

  it('8th-order band-pass', () => {
    const al = (v: Record<string, number>) => [v.vas_l! / v.vr_l!, v.vas_l! / v.v1_l!, v.vas_l! / v.v2_l!] as const;
    for (const id of [...ids('bp8_mag_'), ...ids('bp8_lossy_mag_')]) {
      const v = vec(id).inputs;
      const [ar, a1, a2] = al(v);
      expectVec(id, 'db', magDb(P.bandpass8G(v.f!, v.fs!, v.qts!, ar, a1, a2, v.fr!, v.f1!, v.f2!, v.qlr, v.ql1, v.ql2)));
    }
    // the outer chamber shrunk to nothing, its port mass kept: the 6th-order box (the reference checks it against bp6_G)
    for (const id of ids('bp8_limit6_')) {
      const v = vec(id).inputs;
      const ws = 2 * Math.PI * v.fs!;
      const f2 = 1 / (2 * Math.PI * Math.sqrt((v.m2! * (1 / (ws * ws))) / v.a2!));
      expectVec(id, 'db', magDb(P.bandpass8G(v.f!, v.fs!, v.qts!, v.vas_l! / v.vr_l!, v.vas_l! / v.v1_l!, v.a2!, v.fr!, v.f1!, f2)));
    }
    for (const id of ['bp8_x_null_at_fr']) {
      const v = vec(id).inputs;
      const [ar, a1, a2] = al(v);
      expectVec(id, 'x_per_v', P.abs(P.bandpass8X(v.f!, spec, ref, ar, a1, a2, v.fr!, v.f1!, v.f2!)));
    }
    const dc = vec('bp8_x_dc').inputs;
    const [ar, a1, a2] = al(dc);
    expectVec('bp8_x_dc', 'x_per_v', P.abs(P.bandpass8X(dc.f!, spec, ref, ar, a1, a2, dc.fr!, dc.f1!, dc.f2!)));
    expectVec('bp8_x_dc', 'free_air', (ref.bl * ref.cms) / spec.re);
  });

  it('8th-order band-pass layouts and the internal port', () => {
    const al = (v: Record<string, number>) => [v.vas_l! / v.vr_l!, v.vas_l! / v.v1_l!, v.vas_l! / v.v2_l!] as const;
    for (const id of [...ids('bp8s_mag_'), ...ids('bp8s_lossy_mag_')]) {
      const v = vec(id).inputs;
      const [ar, a1, a2] = al(v);
      expectVec(id, 'db', magDb(P.bandpass8G(v.f!, v.fs!, v.qts!, ar, a1, a2, 50, v.f1!, v.f2!, v.qlr, v.ql1, v.ql2, 'sealed')));
    }
    for (const id of [...ids('bp8c_mag_'), ...ids('bp8c_lossy_mag_')]) {
      const v = vec(id).inputs;
      const [ar, a1, a2] = al(v);
      expectVec(id, 'db', magDb(P.bandpass8G(v.f!, v.fs!, v.qts!, ar, a1, a2, v.fr!, v.f1!, v.f2!, v.qlr, v.ql1, v.ql2, 'chain')));
    }
    // sealed rear with the outer chamber shrunk to nothing, its port mass kept: the 4th-order box (the reference checks it against bp_G)
    for (const id of ids('bp8s_limit4_')) {
      const v = vec(id).inputs;
      const ws = 2 * Math.PI * v.fs!;
      const f2 = 1 / (2 * Math.PI * Math.sqrt((v.m2! * (1 / (ws * ws))) / v.a2!));
      expectVec(id, 'db', magDb(P.bandpass8G(v.f!, v.fs!, v.qts!, v.vas_l! / v.vr_l!, v.vas_l! / v.v1_l!, v.a2!, 50, v.f1!, f2, undefined, undefined, undefined, 'sealed')));
    }
    // rear port into the front chamber with the rear port closed: the sealed layout
    for (const id of ids('bp8c_limit_sealed_')) {
      const v = vec(id).inputs;
      const [ar, a1, a2] = al(v);
      expectVec(id, 'db', magDb(P.bandpass8G(v.f!, v.fs!, v.qts!, ar, a1, a2, v.fr!, v.f1!, v.f2!, undefined, undefined, undefined, 'chain')));
    }
    const sdc = vec('bp8s_x_dc').inputs;
    const [sar, sa1, sa2] = al(sdc);
    expectVec('bp8s_x_dc', 'x_per_v', P.abs(P.bandpass8X(sdc.f!, spec, ref, sar, sa1, sa2, 50, sdc.f1!, sdc.f2!, undefined, undefined, undefined, 'sealed')));
    expectVec('bp8s_x_dc', 'sealed_rear', P.abs(P.sealedX(sdc.f!, spec, ref, sdc.vr_l! / 1000)));
    const cdc = vec('bp8c_x_dc').inputs;
    const [car, ca1, ca2] = al(cdc);
    expectVec('bp8c_x_dc', 'x_per_v', P.abs(P.bandpass8X(cdc.f!, spec, ref, car, ca1, ca2, cdc.fr!, cdc.f1!, cdc.f2!, undefined, undefined, undefined, 'chain')));
    expectVec('bp8c_x_dc', 'free_air', (ref.bl * ref.cms) / spec.re);
    const pl = vec('port_length_internal').inputs;
    expectVec('port_length_internal', 'length_m', P.portLengthInternalM(pl.vb_m3!, pl.fb!, pl.d_m!));
    expectVec('port_length_internal', 'open_air_length_m', P.portLengthM(pl.vb_m3!, pl.fb!, pl.d_m!));
  });

  it('TQWT design and column', () => {
    const di = vec('tqwt_design').inputs;
    const td = P.tqwtDesign({ ...spec, fs: di.fs!, sd: di.sd_m2! });
    expectVec('tqwt_design', 'length_m', td.lengthM);
    expectVec('tqwt_design', 'start_m2', td.startM2);
    expectVec('tqwt_design', 'exit_m2', td.exitM2);
    expectVec('tqwt_design', 'offset', td.offset);
    expectVec('tqwt_design', 'volume_m3', td.volumeM3);
    const ci = vec('tqwt_column').inputs;
    const col = P.tqwtColumn({ lengthM: ci.length_m!, startM2: ci.start_m2!, exitM2: ci.exit_m2!, chamberM3: 0, offset: ci.offset!, stuffing: 'acousta', densityLb: 0.5, stuffedShare: 0.5 }, ci.driver_d_m!, ci.margin_m!);
    expectVec('tqwt_column', 'w_i', col.wI);
    expectVec('tqwt_column', 'depth_top', col.depthTopI);
    expectVec('tqwt_column', 'depth_mouth', col.depthMouthI);
    expectVec('tqwt_column', 'slant_1', col.sections[0]!.slant);
    expectVec('tqwt_column', 'slant_8', col.sections[7]!.slant);
    expectVec('tqwt_column', 'd2_4', col.sections[3]!.d2);
    expectVec('tqwt_column', 'volume_m3', col.volumeM3);
    expectVec('tqwt_column', 'driver_from_top', col.driverFromTop);
  });

  it('6th-order band-pass', () => {
    const a = (v: Record<string, number>) => [v.vas_l! / v.vr_l!, v.vas_l! / v.vf_l!] as const;
    for (const id of [...ids('bp6_mag_'), ...ids('bp6_lossy_mag_'), ...ids('bp6_limit4_')]) {
      const v = vec(id).inputs;
      const [ar, af] = a(v);
      expectVec(id, 'db', magDb(P.bandpass6G(v.f!, v.fs!, v.qts!, ar, af, v.fr!, v.ff!, v.qlr, v.qlf)));
    }
    for (const id of ['bp6_x_null_at_ff', 'bp6_x_null_at_fr']) {
      const v = vec(id).inputs;
      const [ar, af] = a(v);
      expectVec(id, 'x_per_v', P.abs(P.bandpass6X(v.f!, spec, ref, ar, af, v.fr!, v.ff!)));
    }
    const dc = vec('bp6_x_dc').inputs;
    const [ar, af] = a(dc);
    expectVec('bp6_x_dc', 'x_per_v', P.abs(P.bandpass6X(dc.f!, spec, ref, ar, af, dc.fr!, dc.ff!)));
    expectVec('bp6_x_dc', 'free_air', (ref.bl * ref.cms) / spec.re);
  });

  it('horn', () => {
    const model = (id: string): P.HornModel => {
      const v = vec(id).inputs;
      return P.hornModel(spec, ref, v.vr_m3!, v.st_m2!, v.sm_m2!, v.length_m!);
    };
    const h = model('horn_params');
    expectVec('horn_params', 'm_per_m', h.m);
    expectVec('horn_params', 'fc_hz', h.fc);
    expectVec('horn_params', 'r_load', h.rLoad);
    expectVec('horn_params', 'r_tot', h.rTot);
    expectVec('horn_params', 'f_h', h.fh);
    expectVec('horn_params', 'pass_gain_db', P.dB(h.kg / h.rTot));
    for (const id of ids('horn_mag_')) expectVec(id, 'db', magDb(P.hornG(vec(id).inputs.f!, model(id))));
    for (const id of ids('horn_x_')) expectVec(id, 'x_per_v', P.abs(P.hornX(vec(id).inputs.f!, model(id))));

    const g = vec('horn_flare_cutoff').inputs;
    const flare = P.hornFlare(g.st_m2!, g.sm_m2!, g.length_m!);
    expectVec('horn_flare_cutoff', 'm_per_m', flare.m);
    expectVec('horn_flare_cutoff', 'fc_hz', flare.fc);
    expectVec('horn_min_mouth', 'area_m2', P.hornMinMouthArea(vec('horn_min_mouth').inputs.fc!));
  });

  it('crossover', () => {
    for (const id of ids('lr4_')) {
      const v = vec(id);
      const lp = P.lr4Lp(v.inputs.f!, v.inputs.fc!);
      const hp = P.lr4Hp(v.inputs.f!, v.inputs.fc!);
      expectVec(id, 'lp_db', magDb(lp));
      expectVec(id, 'hp_db', magDb(hp));
      if ('sum_db' in v.outputs) expectVec(id, 'sum_db', magDb(P.add(lp, hp)));
    }
    for (const id of [...ids('xover2_'), ...ids('xover3_'), ...ids('xover4_')]) {
      const v = vec(id).inputs;
      const bands = P.crossoverBands(v.f!, [v.x1!, v.x2!, v.x3!].slice(0, v.n_bands! - 1));
      bands.forEach((b, k) => expectVec(id, `band${k + 1}_db`, magDb(b)));
      expectVec(id, 'sum_db', magDb(bands.reduce(P.add)));
    }
    for (const id of ['xover_ordering', 'xover_nyquist_cap']) {
      const v = vec(id).inputs;
      const eff = P.effectiveCrossovers([v.req1!, v.req2!, v.req3!], v.bands!, v.fs!);
      eff.forEach((x, k) => expectVec(id, `x${k + 1}`, x));
    }
  });

  it('room', () => {
    expectVec('distance_gain', 'db', P.distanceGainDb(vec('distance_gain').inputs.r! / vec('distance_gain').inputs.r_ref!));
    expectVec('distance_delay', 'delay_s', P.timeOfFlightS(vec('distance_delay').inputs.r!, vec('distance_delay').inputs.r_ref!));
    for (const id of ids('air_absorb_')) {
      const v = vec(id).inputs;
      expectVec(id, 'db_per_m', P.airAbsorptionDbPerM(v.f!, v.temp_c!, v.rh!));
    }
    for (const id of ids('boundary_gain_')) expectVec(id, 'db', P.boundaryGainDb(vec(id).inputs.n!));
    // the shelf has half its low-frequency gain (in dB) at its corner, whatever the boundary distance
    for (const id of ids('boundary_shelf_mid_'))
      expectVec(id, 'db', magDb(P.boundaryShelf(P.boundaryCornerHz(0.5), vec(id).inputs.n!, 0.5)));
    expectVec('boundary_corner', 'hz', P.boundaryCornerHz(vec('boundary_corner').inputs.d!));
    const cd = vec('critical_distance').inputs;
    expectVec('critical_distance', 'm', P.criticalDistanceM(cd.volume_m3!, cd.t60!));
  });

  it('impedance', () => {
    const check = (id: string, x: P.Cx): void => {
      const z = P.impedanceFromDisplacement(vec(id).inputs.f!, x, ref.bl, spec.re);
      expectVec(id, 'z_ohm', P.abs(z));
      if ('phase_deg' in vec(id).outputs) expectVec(id, 'phase_deg', P.phaseDeg(z));
    };
    for (const id of ids('imp_sealed_')) check(id, P.sealedX(vec(id).inputs.f!, spec, ref, vec(id).inputs.vb_m3!));
    for (const id of ids('imp_vented_')) {
      const v = vec(id).inputs;
      check(id, P.ventedX(v.f!, spec, ref, v.vas_l! / v.vb_l!, v.fb!));
    }
    for (const id of ids('imp_bp_')) {
      const v = vec(id).inputs;
      check(id, P.bandpassX(v.f!, spec, ref, v.vas_l! / v.vr_l!, v.vas_l! / v.vf_l!, v.fb!));
    }
    for (const id of ids('imp_bp8s_')) {
      const v = vec(id).inputs;
      check(id, P.bandpass8X(v.f!, spec, ref, v.vas_l! / v.vr_l!, v.vas_l! / v.v1_l!, v.vas_l! / v.v2_l!, 50, v.f1!, v.f2!, undefined, undefined, undefined, 'sealed'));
    }
    for (const id of ids('imp_bp8c_')) {
      const v = vec(id).inputs;
      check(id, P.bandpass8X(v.f!, spec, ref, v.vas_l! / v.vr_l!, v.vas_l! / v.v1_l!, v.vas_l! / v.v2_l!, v.fr!, v.f1!, v.f2!, undefined, undefined, undefined, 'chain'));
    }
    for (const id of ids('imp_bp8_')) {
      const v = vec(id).inputs;
      check(id, P.bandpass8X(v.f!, spec, ref, v.vas_l! / v.vr_l!, v.vas_l! / v.v1_l!, v.vas_l! / v.v2_l!, v.fr!, v.f1!, v.f2!));
    }
    for (const id of [...ids('imp_bp6_'), 'imp_bp6_at_ff', 'imp_bp6_at_fr']) {
      const v = vec(id).inputs;
      check(id, P.bandpass6X(v.f!, spec, ref, v.vas_l! / v.vr_l!, v.vas_l! / v.vf_l!, v.fr!, v.ff!));
    }
    for (const id of ids('imp_horn_')) {
      const v = vec(id).inputs;
      check(id, P.hornX(v.f!, P.hornModel(spec, ref, v.vr_m3!, v.st_m2!, v.sm_m2!, v.length_m!)));
    }
  });

  it('horn simulation', () => {
    const KINDS: P.FlareKind[] = ['exponential', 'hyperbolic', 'tractrix', 'conical'];
    const flare = (v: Record<string, number>): P.Flare => ({
      kind: KINDS[v.flare!]!,
      throatM2: v.st_m2!,
      mouthM2: v.sm_m2 ?? P.tractrixFullMouth(v.fc!),
      cutoffHz: v.fc ?? 0,
      t: v.t ?? 0.3, // only the hyperbolic vectors carry t; an exponential flare must ignore whatever is here
      lengthM: v.length_m ?? 0,
    });
    const k = (f: number): number => (2 * Math.PI * f) / P.C;

    for (const id of ids('rad_piston_')) {
      const r = P.pistonRadiation(vec(id).inputs.x_2ka!);
      expectVec(id, 'r1', r.r1);
      expectVec(id, 'x1', r.x1);
    }
    const cm = vec('cone_matrix').inputs;
    const m = P.coneMatrix(k(cm.f!), cm.s1_m2!, cm.s2_m2!, cm.length_m!);
    expectVec('cone_matrix', 'a', m.a);
    expectVec('cone_matrix', 'b_im', m.bi);
    expectVec('cone_matrix', 'c_im', m.ci);
    expectVec('cone_matrix', 'd', m.d);

    for (const id of ids('flare_')) {
      const v = vec(id);
      const fl = flare(v.inputs);
      expectVec(id, 'area_m2', P.flareArea(fl, v.inputs.x_m!));
      if ('length_m' in v.outputs) expectVec(id, 'length_m', P.flareLength(fl));
      if ('sm_m2' in v.outputs) expectVec(id, 'sm_m2', fl.mouthM2);
    }
    const hv = vec('horn_volume').inputs;
    expectVec('horn_volume', 'volume_m3', P.hornVolume(P.hornJoints(flare(hv), hv.n!)));

    for (const id of ids('hornsim_zt_')) {
      const v = vec(id).inputs;
      const zt = P.hornThroatImpedance(k(v.f!), P.hornJoints(flare(v), v.n!));
      expectVec(id, 'zt_re', zt.re);
      expectVec(id, 'zt_im', zt.im);
    }
    for (const id of [...ids('hornsim_front_'), ...ids('hornsim_rear_')]) {
      const v = vec(id).inputs;
      // the rear-loaded vectors carry no rear volume: there is no sealed chamber, and the library must not read one
      const rearLoaded = id.startsWith('hornsim_rear_');
      const r = P.hornSystem({ driver: spec, joints: P.hornJoints(flare(v), v.n!), throatChamberM3: v.vtc_m3!, rearVolumeM3: rearLoaded ? Number.NaN : v.vr_m3!, rearLoaded }, v.f!);
      expectVec(id, 'g_re', r.g.re);
      expectVec(id, 'g_im', r.g.im);
      expectVec(id, 'x_per_v', P.abs(r.x));
      expectVec(id, 'z_ohm', P.abs(r.z));
    }
  });

  it('level, driver groups and limits', () => {
    const sv = vec('sens_reference').inputs;
    expectVec('sens_reference', 'eta0', P.efficiency(spec));
    expectVec('sens_reference', 'spl_2v83_db', P.splDb(P.referencePressure(spec, sv.volts!)));
    expectVec('sens_reference', 'spl_1w_db', P.splDb(P.referencePressure(spec, Math.sqrt(spec.re))));
    for (const id of ids('wiring_')) {
      const w = P.wiring(vec(id).inputs.n!, vec(id).inputs.series!);
      expectVec(id, 'load_factor', w.loadFactor);
      expectVec(id, 'volts_factor', w.voltsFactor);
      expectVec(id, 'level_gain_db', w.levelGainDb);
    }
    const th = vec('limit_thermal').inputs;
    expectVec('limit_thermal', 'volts', P.thermalLimitVolts(th.pe!, th.re!, th.series!));
    const ex = vec('limit_excursion').inputs;
    expectVec('limit_excursion', 'volts', P.excursionLimitVolts(ex.xmax_m!, ex.x_per_v!, ex.series!));
    const am = vec('limit_amp').inputs;
    expectVec('limit_amp', 'volts', P.ampVolts(am.power_w!, am.load_ohm!));

    for (const id of ids('system_spl_')) {
      const v = vec(id).inputs;
      const legs = P.crossoverBands(v.f!, [v.xover!]);
      const w = P.wiring(v.sub_n!, v.sub_series!);
      const sub = P.scale(P.mul(legs[0]!, P.sealedG(v.f!, spec.fs, ref.qts, spec.vasM3, v.sub_vb_l! / 1000)), P.referencePressure(spec, v.volts! * w.voltsFactor) * v.sub_n!);
      const top = P.scale(P.mul(legs[1]!, P.sealedG(v.f!, spec.fs, ref.qts, spec.vasM3, v.top_vb_l! / 1000)), -P.referencePressure(spec, v.volts! * 10 ** (v.top_trim_db! / 20)));
      expectVec(id, 'sub_spl_db', P.splDb(P.abs(sub)));
      expectVec(id, 'top_spl_db', P.splDb(P.abs(top)));
      expectVec(id, 'spl_db', P.splDb(P.abs(P.systemPressure(v.f!, [{ pressure: sub, delayS: 0 }, { pressure: top, delayS: v.top_delay_ms! / 1000 }]))));
    }
  });

  it('cabinet, cut list and sheets', () => {
    const braceOf = (n: number): P.Brace => (['none', 'single', 'window'] as const)[n]!;
    for (const id of ids('cab_').filter((i) => !['cab_panels', 'cab_driver_disp'].includes(i))) {
      const v = vec(id).inputs;
      const g = P.solveBox(v.v_net_m3!, v.disp_m3!, v.rw!, v.rh!, v.rd!, v.t!, braceOf(v.brace!), v.divider === 1);
      expectVec(id, 'w_i', g.wI);
      expectVec(id, 'h_i', g.hI);
      expectVec(id, 'd_i', g.dI);
      expectVec(id, 'w_o', g.wO);
      expectVec(id, 'h_o', g.hO);
      expectVec(id, 'd_o', g.dO);
      expectVec(id, 'braces', g.braces);
      expectVec(id, 'net_m3', g.netM3);
      // the box holds what it was asked to
      expect(g.netM3).toBeCloseTo(v.v_net_m3!, 9);
    }
    const dd = vec('cab_driver_disp').inputs;
    expectVec('cab_driver_disp', 'driver_m3', P.driverDisplacement(dd.sd_m2!));
    expectVec('cab_driver_disp', 'port_m3', P.portDisplacement(dd.port_d!, dd.port_l!));
    const md = vec('mount_disp').inputs;
    expectVec('mount_disp', 'magnet_in_m3', P.driverDisplacementMount(md.sd_m2!, false));
    expectVec('mount_disp', 'magnet_out_m3', P.driverDisplacementMount(md.sd_m2!, true));
    expectVec('mount_disp', 'rect_port_m3', P.rectPortDisplacement(md.w_m!, md.h_m!, md.length_m!, md.wall_m!));
    const c = vec('cab_panels').inputs;
    const g = P.solveBox(c.v_net_m3!, P.driverDisplacement(c.sd_m2!), 1, 1.5, c.rd!, c.t!, 'window', false);
    const pan = P.boxPanels(g, c.t!, false);
    expectVec('cab_panels', 'wood_m3', pan.slice(0, 4).reduce((a, p) => a + p.l * p.w * c.t! * p.qty, 0));
    expectVec('cab_panels', 'front_m2', pan[0]!.l * pan[0]!.w);
    expectVec('cab_panels', 'top_m2', pan[2]!.l * pan[2]!.w);
    expectVec('cab_panels', 'side_m2', pan[3]!.l * pan[3]!.w);
    expectVec('cab_panels', 'brace_m2', pan[4]!.l * pan[4]!.w);
    expectVec('cab_panels', 'brace_n', pan[4]!.qty);

    const h = vec('horn_panels_2seg').inputs;
    const hp = P.hornPanels([{ x: h.x0!, h: h.h0! }, { x: h.x1!, h: h.h1! }, { x: h.x2!, h: h.h2! }], h.width!, h.t!);
    expectVec('horn_panels_2seg', 'slant_1', hp[0]!.slant);
    expectVec('horn_panels_2seg', 'side_len_1', hp[0]!.sideLen);
    expectVec('horn_panels_2seg', 'side_h_1', hp[0]!.sideH);
    expectVec('horn_panels_2seg', 'slant_2', hp[1]!.slant);
    expectVec('horn_panels_2seg', 'side_len_2', hp[1]!.sideLen);
    expectVec('horn_panels_2seg', 'side_h_2', hp[1]!.sideH);

    const k = vec('pack_sheets').inputs;
    const pcs = [0, 1, 2, 3, 4, 5].map((i) => ({ l: k[`l${i}`]!, w: k[`w${i}`]! }));
    const pk = P.packSheets(pcs, k.sheet_l!, k.sheet_w!, k.kerf!);
    expectVec('pack_sheets', 'sheets', pk.sheets);
    pk.placements.forEach((p, i) => {
      expectVec('pack_sheets', `s${i}`, p.sheet);
      expectVec('pack_sheets', `x${i}`, p.x);
      expectVec('pack_sheets', `y${i}`, p.y);
    });
  });

  it('loudspeaker cabinets (v0.11)', () => {
    for (const id of ids('baffle_corner_')) expectVec(id, 'hz', P.baffleStepCornerHz(vec(id).inputs.width!));
    for (const id of ids('baffle_step_')) expectVec(id, 'db', magDb(P.baffleStepShelf(vec(id).inputs.f!, vec(id).inputs.width!)));
    for (const id of ids('open_baffle_')) {
      const v = vec(id).inputs;
      expectVec(id, 'db', magDb(P.openBaffleG(v.f!, v.fs!, v.qts!)));
    }
    // two reference drivers sharing one 60 L chamber behave as one driver in 30 L
    const g = vec('group_sealed_shared').inputs;
    const each = P.groupVolumeM3(g.v_total_m3!, g.n!);
    const sp = P.sealedParams(spec.fs, ref.qts, spec.vasM3, each);
    expectVec('group_sealed_shared', 'v_each_m3', each);
    expectVec('group_sealed_shared', 'fc', sp.fc);
    expectVec('group_sealed_shared', 'qtc', sp.qtc);

    const mk = (fs: number, qes: number, qms: number, vas: number, sd: number, re: number): P.DriverSpec => ({ name: 'x', fs, qes, qms, vasM3: vas, sd, re, xmax: 0.005, pe: 50 });
    const woofer = mk(50, 0.5, 4, 0.012, 0.014, 6);
    const dome = mk(900, 1.0, 2.5, 0.0001, 0.0005, 4);
    for (const id of ids('speaker_2way_')) {
      const v = vec(id).inputs;
      const legs = P.crossoverBands(v.f!, [v.xover!]);
      const pw = P.scale(P.mul(legs[0]!, P.sealedG(v.f!, woofer.fs, P.deriveDriver(woofer).qts, woofer.vasM3, v.woofer_vb_l! / 1000)), P.referencePressure(woofer, v.volts!));
      const pt = P.scale(P.mul(legs[1]!, P.sealedG(v.f!, dome.fs, P.deriveDriver(dome).qts, dome.vasM3, v.dome_vb_l! / 1000)), P.referencePressure(dome, v.volts! * 10 ** (v.tweeter_trim_db! / 20)));
      const step = P.baffleStepShelf(v.f!, v.baffle_m!);
      const sum = P.systemPressure(v.f!, [{ pressure: pw, delayS: 0 }, { pressure: pt, delayS: v.tweeter_back_m! / P.C }]);
      expectVec(id, 'woofer_spl_db', P.splDb(P.abs(pw)));
      expectVec(id, 'tweeter_spl_db', P.splDb(P.abs(pt)));
      expectVec(id, 'step_db', magDb(step));
      expectVec(id, 'spl_db', P.splDb(P.abs(P.mul(sum, step))));
    }
  });

  it('car audio (v0.12)', () => {
    for (const id of ids('cabin_')) {
      const v = vec(id).inputs;
      const h = P.cabinShelf(v.f!, v.gain_db!, v.fc!);
      expectVec(id, 'db', magDb(h));
      expectVec(id, 'phase_deg', (Math.atan2(h.im, h.re) * 180) / Math.PI);
    }
    for (const id of ids('dvc_')) {
      const v = vec(id).inputs;
      const d = P.dvcDriver(v.coils!, v.coil_series!);
      expectVec(id, 'load_factor', d.loadFactor);
      expectVec(id, 'level_factor', d.levelFactor);
    }
    for (const id of ids('carwire_')) {
      const v = vec(id).inputs;
      const w = P.carWiring(v.n!, v.series!, v.coils!, v.coil_series!);
      expectVec(id, 'load_factor', w.loadFactor);
      expectVec(id, 'level_gain_db', w.levelGainDb);
    }
    const b = vec('bridged_volts').inputs;
    expectVec('bridged_volts', 'volts', P.bridgedVolts(b.power_w!, b.load_ohm!));
    expectVec('bridged_volts', 'power_same_load_w', P.bridgedVolts(b.power_w!, b.load_ohm!) ** 2 / b.load_ohm!);
    const ac = vec('amp_current').inputs;
    expectVec('amp_current', 'amps', P.ampCurrent(ac.power_w!, ac.efficiency!, ac.volts!));
    for (const id of ids('awg_')) {
      const v = vec(id).inputs;
      expectVec(id, 'area_mm2', P.awgAreaMm2(v.awg!));
      expectVec(id, 'ohm', P.wireResistance(v.awg!, v.length_m!));
    }
    const wd = vec('wire_drop').inputs;
    expectVec('wire_drop', 'volts', P.wireDropVolts(wd.amps!, wd.awg!, wd.length_m!, wd.temp_c!));
    expectVec('wire_drop', 'volts_40c', P.wireDropVolts(wd.amps!, wd.awg!, wd.length_m!, 40));
    for (const id of ids('fuse_')) expectVec(id, 'fuse_a', P.fuseAmps(vec(id).inputs.amps!));
    const ma = vec('min_awg').inputs;
    expectVec('min_awg', 'awg_3m', P.minAwg(ma.amps!, ma.length_a_m!, ma.volts!, ma.max_drop_frac!));
    expectVec('min_awg', 'awg_5m', P.minAwg(ma.amps!, ma.length_b_m!, ma.volts!, ma.max_drop_frac!));
    expectVec('min_awg', 'awg_7m', P.minAwg(ma.amps!, ma.length_c_m!, ma.volts!, ma.max_drop_frac!));
    expectVec('min_awg', 'none', P.minAwg(ma.huge_amps!, ma.length_b_m!, ma.volts!, ma.max_drop_frac!));
    const mc = vec('music_current').inputs;
    expectVec('music_current', 'amps', P.musicCurrent(mc.power_w!, mc.efficiency!, mc.volts!, mc.duty!));
  });

  it('wedge enclosures (v0.12)', () => {
    for (const id of ids('wedge_').filter((i) => i !== 'wedge_panels')) {
      const v = vec(id).inputs;
      const g = P.solveWedge(v.v_net_m3!, v.disp_m3!, v.rw!, v.rh!, v.rd!, v.taper!, v.t!);
      expectVec(id, 'w_i', g.wI);
      expectVec(id, 'h_i', g.hI);
      expectVec(id, 'd_bottom_i', g.dBottomI);
      expectVec(id, 'd_top_i', g.dTopI);
      expectVec(id, 'w_o', g.wO);
      expectVec(id, 'h_o', g.hO);
      expectVec(id, 'slant_o', g.slantO);
      expectVec(id, 'net_m3', g.netM3);
    }
    const v = vec('wedge_panels').inputs;
    const p = P.wedgePanels(P.solveWedge(v.v_net_m3!, v.disp_m3!, v.rw!, v.rh!, v.rd!, v.taper!, v.t!));
    for (const [i, k] of ['back', 'baffle', 'bottom', 'top', 'side'].entries()) {
      expectVec('wedge_panels', `${k}_l`, p[i]!.l);
      expectVec('wedge_panels', `${k}_w`, p[i]!.w);
    }
  });

  afterAll(() => {
    const missing = file.vectors.flatMap((v) => Object.keys(v.outputs).map((k) => `${v.id}.${k}`)).filter((k) => !asserted.has(k));
    expect(missing, 'vector outputs never asserted').toEqual([]);
  });
});
