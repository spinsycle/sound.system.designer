// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// 8th-order band-pass box (spec: "8th-order band-pass", app only, v0.18, layouts v0.19): the driver between a rear chamber and a front made of
// two chambers in series, all vented. The inner front chamber (next to the driver) opens through port 1 into the outer front chamber,
// which opens through port 2 to the room. Three layouts of the rear chamber:
//   'vented': its own port opens to the room (the rear port output is added, opposite the cone): driver plus three vented resonators, 8th order.
//   'chain':  its port opens into the inner front chamber, so rear, inner and outer chambers form a chain to the room and port 2 alone is the output:
//             driver plus three vented resonators, 8th order.
//   'sealed': no rear port: 6th order by pole count (driver with a sealed rear, and two vented resonators), the tidy relative of the 4th-order box.
// a1 = Vas/V1 and f1 are the inner chamber and port 1, a2 = Vas/V2 and f2 the outer chamber and port 2, ar = Vas/Vrear and fr the rear chamber and its
// port (fr is unused when sealed: the sealed chamber's leakage is referenced to the driver's Fs); each chamber has its own leakage QL. 0 dB is the direct-radiator reference. With the outer chamber shrunk to
// nothing the two front ports are one port: 'vented' is then the 6th-order box of bandpass6.ts and 'sealed' the 4th-order box of bandpass.ts; 'chain'
// with the rear port closed is 'sealed'. The vectors check each of these.
import { type Cx, add, cx, div, jw, mul, poly, scale } from './complex';
import type { DriverDerived, DriverSpec } from './drivers';

export type Bp8Layout = 'vented' | 'sealed' | 'chain';

const omega = (f: number): number => 2 * Math.PI * f;

interface Elements {
  ws: number;
  c1: number;
  c2: number;
  cr: number;
  m1: number;
  m2: number;
  mr: number;
  g1: number;
  g2: number;
  gr: number;
}

/** Acoustic elements in units where the cone's acoustic mass is 1 (every response here is a ratio, so the unit cancels). */
function elements(fs: number, ar: number, a1: number, a2: number, fr: number, f1: number, f2: number, qlr?: number, ql1?: number, ql2?: number): Elements {
  const ws = omega(fs);
  const cas = 1 / (ws * ws);
  const c1 = cas / a1;
  const c2 = cas / a2;
  const cr = cas / ar;
  const leak = (c: number, f: number, q?: number): number => (q === undefined ? 0 : (c * omega(f)) / q);
  return { ws, c1, c2, cr, m1: 1 / (omega(f1) ** 2 * c1), m2: 1 / (omega(f2) ** 2 * c2), mr: 1 / (omega(fr) ** 2 * cr), g1: leak(c1, f1, ql1), g2: leak(c2, f2, ql2), gr: leak(cr, fr, qlr) };
}

/**
 * The front ladder cleared of denominators, so it is finite at every resonance: D2 = s^2 m2 c2 + s m2 g2 + 1, Dr likewise, N1 = m1 D2 + m2,
 * E1 = (s^2 c1 + s g1) N1 + D2, P = s^2 + s ws/Qts + ws^2.
 */
function terms(s: Cx, el: Elements, qts: number): { n1: Cx; e1: Cx; dr: Cx; p: Cx } {
  const d2 = poly([el.m2 * el.c2, el.m2 * el.g2, 1], s);
  const dr = poly([el.mr * el.cr, el.mr * el.gr, 1], s);
  const n1 = add(scale(d2, el.m1), cx(el.m2));
  const e1 = add(mul(poly([el.c1, el.g1, 0], s), n1), d2);
  const p = poly([1, el.ws / qts, el.ws * el.ws], s);
  return { n1, e1, dr, p };
}

/**
 * The response numerator and the shared denominator of the displacement, by layout:
 *   vented: G = s^2 (Dr - E1) / Q,  x ~ E1 Dr / Q,  Q = P E1 Dr + s^2 N1 Dr + s^2 mr E1
 *   sealed: G = s^2 Yr / Q,         x ~ E1 Yr / Q,   Q = Yr (P E1 + s^2 N1) + s E1,  Yr = s cr + gr
 *   chain:  G = s^3 Kr mr / Q,      x ~ Theta / Q,   Q = P Theta + s^2 mr (E1 + s N1 Kr),  Theta = Dr E1 + s N1 Kr,  Kr = s cr + gr
 */
function solve(s: Cx, el: Elements, qts: number, layout: Bp8Layout): { g: Cx; xNum: Cx; q: Cx } {
  const { n1, e1, dr, p } = terms(s, el, qts);
  const s2 = mul(s, s);
  if (layout === 'sealed') {
    const yr = poly([el.cr, el.gr], s);
    const q = add(mul(yr, add(mul(p, e1), mul(s2, n1))), mul(s, e1));
    return { g: div(mul(s2, yr), q), xNum: mul(e1, yr), q };
  }
  if (layout === 'chain') {
    const kr = poly([el.cr, el.gr], s);
    const theta = add(mul(dr, e1), mul(mul(s, n1), kr));
    const q = add(mul(p, theta), mul(scale(s2, el.mr), add(e1, mul(mul(s, n1), kr))));
    return { g: div(scale(mul(mul(s2, s), kr), el.mr), q), xNum: theta, q };
  }
  const q = add(add(mul(mul(p, e1), dr), mul(mul(s2, n1), dr)), mul(s2, scale(e1, el.mr)));
  return { g: div(mul(s2, add(dr, scale(e1, -1))), q), xNum: mul(e1, dr), q };
}

/** Response: the outputs of the layout over the direct radiator's passband. */
export function bandpass8G(f: number, fs: number, qts: number, ar: number, a1: number, a2: number, fr: number, f1: number, f2: number, qlr?: number, ql1?: number, ql2?: number, layout: Bp8Layout = 'vented'): Cx {
  return solve(jw(f), elements(fs, ar, a1, a2, layout === 'sealed' ? fs : fr, f1, f2, qlr, ql1, ql2), qts, layout).g;
}

/**
 * Cone displacement per volt, m/V. At DC every port is open (free-air Bl Cms / Re) except the sealed rear chamber's stiffness; 'vented' is zero at the
 * rear tuning when lossless ('chain' keeps moving there: the rear port feeds the front chamber).
 */
export function bandpass8X(f: number, d: DriverSpec, r: DriverDerived, ar: number, a1: number, a2: number, fr: number, f1: number, f2: number, qlr?: number, ql1?: number, ql2?: number, layout: Bp8Layout = 'vented'): Cx {
  const { xNum, q } = solve(jw(f), elements(d.fs, ar, a1, a2, layout === 'sealed' ? d.fs : fr, f1, f2, qlr, ql1, ql2), r.qts, layout);
  const ws = omega(d.fs);
  return scale(div(xNum, q), (r.bl * r.cms * ws * ws) / d.re);
}
