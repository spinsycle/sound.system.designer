// Passive crossover checks that are not shared vectors: the guide's textbook values, every alignment against its ideal filter,
// refusals, element naming, energy balance, ratings.
import { describe, expect, it } from 'vitest';
import * as P from '../src/index';

const freqs = [20, 63, 150, 400, 900, 2500, 4000, 9000, 20000];
const db = (h: P.Cx): number => P.dB(P.abs(h));

function value(net: P.Network, name: string): number {
  const v = P.networkValues(net).find((x) => x.name === name);
  if (!v) throw new Error(`no ${name}`);
  return v.value;
}

describe('passive crossover networks', () => {
  it("the guide's 2.5 kHz, 8 ohm examples", () => {
    const lp1 = P.designPassive({ alignment: 'butterworth', order: 1 }, 'lp', 2500, 8);
    expect(value(lp1, 'L1')).toBeCloseTo(0.509e-3, 6);
    expect(value(P.designPassive({ alignment: 'butterworth', order: 1 }, 'hp', 2500, 8), 'C1')).toBeCloseTo(7.96e-6, 8);
    const lp2 = P.designPassive({ alignment: 'butterworth', order: 2 }, 'lp', 2500, 8);
    expect(value(lp2, 'L1')).toBeCloseTo(0.72e-3, 6);
    expect(value(lp2, 'C2')).toBeCloseTo(5.63e-6, 8);
    const hp2 = P.designPassive({ alignment: 'butterworth', order: 2 }, 'hp', 2500, 8);
    expect(value(hp2, 'C1')).toBeCloseTo(5.63e-6, 8);
    expect(value(hp2, 'L2')).toBeCloseTo(0.72e-3, 6);
    const lr2 = P.designPassive({ alignment: 'linkwitz-riley', order: 2 }, 'lp', 2500, 8);
    expect(value(lr2, 'L1')).toBeCloseTo(8 / (Math.PI * 2500), 12); // R/(pi fc)
    expect(value(lr2, 'C2')).toBeCloseTo(1 / (4 * Math.PI * 2500 * 8), 15); // 1/(4 pi fc R)
  });

  it('ladder g values: Butterworth 2 and 3, Linkwitz-Riley 2', () => {
    const g = (a: P.Alignment, n: number): number[] => P.ladderG(P.xoFilter({ alignment: a, order: n }).poles);
    const bw2 = g('butterworth', 2);
    expect(bw2[0]).toBeCloseTo(Math.SQRT2, 12);
    expect(bw2[1]).toBeCloseTo(Math.SQRT1_2, 12);
    const bw3 = g('butterworth', 3);
    [1.5, 4 / 3, 0.5].forEach((x, i) => expect(bw3[i]).toBeCloseTo(x, 12));
    const lr2 = g('linkwitz-riley', 2);
    expect(lr2[0]).toBeCloseTo(2, 12);
    expect(lr2[1]).toBeCloseTo(0.5, 12);
  });

  it('every alignment, order and band realises its ideal filter into a resistive load', () => {
    let count = 0;
    for (const alignment of P.ALIGNMENTS)
      for (let order = 1; order <= P.MAX_PASSIVE_ORDER; ++order) {
        if (!P.isValidOrder(alignment, order) || (alignment === 'chebyshev' && order % 2 === 0)) continue;
        const spec: P.FilterSpec = { alignment, order, rippleDb: 1 };
        const f = P.xoFilter(spec);
        for (const [band, r] of [['lp', 4], ['hp', 16]] as const) {
          const net = P.designPassive(spec, band, 1800, r);
          for (const hz of freqs) {
            const got = P.networkGain(net, hz, P.resistiveLoad(r));
            const want = band === 'lp' ? f.lp(hz, 1800) : f.hp(hz, 1800);
            expect(Math.hypot(got.re - want.re, got.im - want.im), `${alignment} ${order} ${band} at ${hz}`).toBeLessThan(1e-9);
          }
          ++count;
        }
      }
    expect(count).toBe(12 * 2); // Butterworth 1-4, Linkwitz-Riley 2 and 4, Bessel 1-4, Chebyshev 1 and 3, each low-pass and high-pass
  });

  it('refuses what a lossless ladder cannot do', () => {
    expect(() => P.designPassive({ alignment: 'butterworth', order: 5 }, 'lp', 1000, 8)).toThrow(RangeError);
    expect(() => P.designPassive({ alignment: 'linkwitz-riley', order: 3 }, 'lp', 1000, 8)).toThrow(RangeError);
    expect(() => P.designPassive({ alignment: 'linkwitz-riley', order: 6 }, 'lp', 1000, 8)).toThrow(RangeError);
    expect(() => P.designPassive({ alignment: 'chebyshev', order: 4 }, 'lp', 1000, 8)).toThrow(/odd order/);
    expect(() => P.designPassive({ alignment: 'chebyshev', order: 3 }, 'lp', 1000, 8)).not.toThrow();
    expect(() => P.designPassive({ alignment: 'butterworth', order: 4 }, 'hp', 1000, 8)).not.toThrow();
  });

  it('names and kinds: low-pass starts with a series inductor, high-pass with a series capacitor', () => {
    const lp = P.designPassive({ alignment: 'butterworth', order: 4 }, 'lp', 1000, 8);
    expect(lp.map((b) => `${b.kind}:${b.name}`)).toEqual(['series:L1', 'shunt:C2', 'series:L3', 'shunt:C4']);
    const hp = P.designPassive({ alignment: 'butterworth', order: 3 }, 'hp', 1000, 8);
    expect(hp.map((b) => `${b.kind}:${b.name}`)).toEqual(['series:C1', 'shunt:L2', 'series:C3']);
    const bp = P.designPassiveBand({ alignment: 'butterworth', order: 2 }, 500, 3000, 8);
    expect(bp.map((b) => b.name)).toEqual(['C1 (hp)', 'L2 (hp)', 'L1 (lp)', 'C2 (lp)']);
    expect(P.networkValues(lp)).toHaveLength(4);
  });

  it('values scale: doubling R doubles inductors and halves capacitors, doubling fc halves them all', () => {
    const a = P.designPassive({ alignment: 'bessel', order: 4 }, 'lp', 1000, 4);
    const b = P.designPassive({ alignment: 'bessel', order: 4 }, 'lp', 1000, 8);
    const c = P.designPassive({ alignment: 'bessel', order: 4 }, 'lp', 2000, 4);
    for (const name of ['L1', 'L3']) {
      expect(value(b, name) / value(a, name)).toBeCloseTo(2, 12);
      expect(value(c, name) / value(a, name)).toBeCloseTo(0.5, 12);
    }
    for (const name of ['C2', 'C4']) {
      expect(value(b, name) / value(a, name)).toBeCloseTo(0.5, 12);
      expect(value(c, name) / value(a, name)).toBeCloseTo(0.5, 12);
    }
  });

  it('a Linkwitz-Riley 4 pair sums to unit magnitude at the load terminals', () => {
    const spec: P.FilterSpec = { alignment: 'linkwitz-riley', order: 4 };
    const lp = P.designPassive(spec, 'lp', 2000, 8);
    const hp = P.designPassive(spec, 'hp', 2000, 8);
    for (const hz of freqs) {
      const s = P.add(P.networkGain(lp, hz, P.resistiveLoad(8)), P.networkGain(hp, hz, P.resistiveLoad(8)));
      expect(Math.abs(db(s))).toBeLessThan(1e-9);
    }
  });

  it('a lossless ladder delivers all the power it takes in; inductor resistance does not', () => {
    const spec: P.FilterSpec = { alignment: 'bessel', order: 3 };
    for (const dcr of [false, true]) {
      const net = P.designPassive(spec, 'lp', 1500, 8, { dcr });
      for (const hz of [100, 1500, 6000]) {
        const zin = P.networkInputZ(net, hz, P.resistiveLoad(8));
        const pin = 1 / zin.re * (zin.re * zin.re) / (zin.re * zin.re + zin.im * zin.im); // Re(1 V x conj(I)) = Re(1/conj(Z))
        const g = P.networkGain(net, hz, P.resistiveLoad(8));
        const pout = (g.re * g.re + g.im * g.im) / 8;
        if (dcr) expect(pout).toBeLessThan(pin * (1 - 1e-6));
        else expect(pout / pin).toBeCloseTo(1, 12);
      }
    }
  });

  it('inductor resistance: present only with the option, in series, and a small loss in the passband', () => {
    const plain = P.designPassive({ alignment: 'butterworth', order: 2 }, 'lp', 800, 8);
    const lossy = P.designPassive({ alignment: 'butterworth', order: 2 }, 'lp', 800, 8, { dcr: true });
    expect(plain[0]!.groups).toHaveLength(1);
    expect(lossy[0]!.groups).toHaveLength(2);
    const l = value(lossy, 'L1');
    expect(lossy[0]!.groups[1]![0]!.value).toBeCloseTo(P.estimateDcrOhm(l), 12);
    const loss = db(P.networkGain(lossy, 50, P.resistiveLoad(8))) - db(P.networkGain(plain, 50, P.resistiveLoad(8)));
    expect(loss).toBeLessThan(0);
    expect(loss).toBeGreaterThan(-1);
    expect(P.estimateDcrOhm(1e-3)).toBeCloseTo(0.1, 12);
    expect(P.estimateDcrOhm(1e-2) / P.estimateDcrOhm(1e-3)).toBeCloseTo(10 ** 0.6, 9);
  });

  it('a real driver load (Re and Le) moves the response and the impedance away from the resistive design; a Zobel pulls the impedance back', () => {
    const spec: P.FilterSpec = { alignment: 'butterworth', order: 2 };
    const net = P.designPassive(spec, 'lp', 2500, 6);
    const drv = P.seriesLoad(6, 0.0008);
    const plain = db(P.networkGain(net, 5000, P.resistiveLoad(6)));
    const real = db(P.networkGain(net, 5000, drv));
    expect(Math.abs(real - plain)).toBeGreaterThan(1);
    const withZobel: P.Network = [...net, P.zobel(6, 0.0008)];
    const zobelLoad = (f: number): P.Cx => P.parallelZ([drv(f), P.branchZ(P.zobel(6, 0.0008), f)]);
    for (const hz of [100, 1000, 10000]) expect(P.abs(zobelLoad(hz))).toBeCloseTo(6, 9);
    expect(withZobel).toHaveLength(3);
    expect(Math.abs(db(P.networkGain(net, 5000, zobelLoad)) - plain)).toBeLessThan(1e-9);
  });

  it('an L-pad keeps the input impedance and attenuates by the stated amount into a resistive load', () => {
    for (const att of [1, 3, 6, 10]) {
      const pad = P.lPad(att, 8);
      for (const hz of [100, 5000]) {
        const z = P.networkInputZ(pad, hz, P.resistiveLoad(8));
        expect(z.re).toBeCloseTo(8, 9);
        expect(z.im).toBeCloseTo(0, 9);
        expect(db(P.networkGain(pad, hz, P.resistiveLoad(8)))).toBeCloseTo(-att, 9);
      }
    }
  });

  it('the notch trap is a short of value R at resonance, capacitive below, inductive above', () => {
    const t = P.notchTrap(1000, 2, 8);
    expect(P.branchZ(t, 1000).re).toBeCloseTo(8, 9);
    expect(P.branchZ(t, 1000).im).toBeCloseTo(0, 9);
    expect(P.branchZ(t, 500).im).toBeLessThan(0);
    expect(P.branchZ(t, 2000).im).toBeGreaterThan(0);
    const q = Math.sqrt(t.groups[1]![0]!.value / t.groups[2]![0]!.value) / 8; // Q = sqrt(L/C)/R
    expect(q).toBeCloseTo(2, 9);
  });

  it('the baffle-step shelf is flat below, depth dB down above, half the depth at the step frequency', () => {
    for (const depth of [2, 4, 6]) {
      const bs = P.baffleStep(depth, 400, 8);
      expect(db(P.networkGain([bs], 1, P.resistiveLoad(8)))).toBeCloseTo(0, 3);
      expect(db(P.networkGain([bs], 400, P.resistiveLoad(8)))).toBeCloseTo(-depth / 2, 9);
      expect(db(P.networkGain([bs], 1e7, P.resistiveLoad(8)))).toBeCloseTo(-depth, 5);
    }
  });

  it('stress: the series inductor carries the input current, the shunt capacitor sees the load voltage, and currents add up', () => {
    const net = P.designPassive({ alignment: 'butterworth', order: 3 }, 'lp', 2000, 8);
    const load = P.resistiveLoad(8);
    for (const hz of [300, 2000, 5000]) {
      const s = P.networkStress(net, hz, load, 10);
      const iin = 10 / P.abs(P.networkInputZ(net, hz, load));
      expect(s[0]!.iRms).toBeCloseTo(iin, 9);
      const vload = 10 * P.abs(P.networkGain(net, hz, load));
      expect(s[2]!.iRms).toBeCloseTo(vload / 8, 9); // the last series element carries the load current
      expect(s[1]!.vRms).toBeGreaterThan(0);
    }
    expect(P.networkStress(net, 1000, load, 20)[1]!.vRms).toBeCloseTo(2 * P.networkStress(net, 1000, load, 10)[1]!.vRms, 9); // linear in the drive
  });

  it('heat: the branch powers and the load power add up to the power taken from the source; lossless parts dissipate nothing', () => {
    const spec: P.FilterSpec = { alignment: 'butterworth', order: 3 };
    for (const dcr of [false, true]) {
      const net = P.designPassive(spec, 'lp', 1200, 8, { dcr });
      for (const hz of [60, 1200, 5000]) {
        const s = P.networkStress(net, hz, P.resistiveLoad(8), 25);
        const zin = P.networkInputZ(net, hz, P.resistiveLoad(8));
        const pin = (25 * 25 * zin.re) / (zin.re * zin.re + zin.im * zin.im);
        const g = 25 * P.abs(P.networkGain(net, hz, P.resistiveLoad(8)));
        const heat = s.reduce((a, x) => a + x.powerW, 0);
        expect(heat + (g * g) / 8).toBeCloseTo(pin, 9);
        if (!dcr) s.forEach((x) => expect(Math.abs(x.powerW)).toBeLessThan(1e-9));
        else expect(s[0]!.powerW).toBeGreaterThan(0); // the first inductor's resistance
      }
    }
    // a resistor: I^2 R
    const [rs] = P.networkStress(P.lPad(3, 8), 1000, P.resistiveLoad(8), 20);
    expect(rs!.powerW).toBeCloseTo(rs!.iRms * rs!.iRms * P.lPad(3, 8)[0]!.groups[0]![0]!.value, 9);
  });

  it('worst stress is the largest over the frequencies', () => {
    const net = P.designPassive({ alignment: 'chebyshev', order: 3, rippleDb: 1 }, 'lp', 1000, 8);
    const w = P.worstStress(net, P.STRESS_FREQS, P.resistiveLoad(8), 20);
    let vmax = 0;
    for (const f of P.STRESS_FREQS) vmax = Math.max(vmax, P.networkStress(net, f, P.resistiveLoad(8), 20)[1]!.vRms);
    expect(w[1]!.vRms).toBeCloseTo(vmax, 12);
    let imax = 0;
    for (const f of P.STRESS_FREQS) imax = Math.max(imax, P.networkStress(net, f, P.resistiveLoad(8), 20)[0]!.iRms);
    expect(w[0]!.iRms).toBeCloseTo(imax, 12);
    expect(w[0]!.iRms).toBeGreaterThan(P.networkStress(net, 20000, P.resistiveLoad(8), 20)[0]!.iRms);
    expect(P.STRESS_FREQS).toHaveLength(61);
    expect(P.STRESS_FREQS[0]).toBeCloseTo(20, 9);
    expect(P.STRESS_FREQS[60]).toBeCloseTo(20000, 6);
    expect(w[1]!.vRms).toBeGreaterThan(20); // a Chebyshev's shunt capacitor rings above the drive voltage
  });

  it('worst heat is the largest over the frequencies', () => {
    const net = P.designPassive({ alignment: 'butterworth', order: 2 }, 'lp', 1000, 8, { dcr: true });
    const w = P.worstStress(net, P.STRESS_FREQS, P.resistiveLoad(8), 20);
    let pmax = 0;
    for (const f of P.STRESS_FREQS) pmax = Math.max(pmax, P.networkStress(net, f, P.resistiveLoad(8), 20)[0]!.powerW);
    expect(w[0]!.powerW).toBeCloseTo(pmax, 12);
    expect(pmax).toBeGreaterThan(P.networkStress(net, 20000, P.resistiveLoad(8), 20)[0]!.powerW);
  });

  it('capacitor voltage rating: 50 % over the peak, next standard value; amplifier volts from power', () => {
    expect(P.capacitorVoltageRating(11)).toBe(25);
    expect(P.capacitorVoltageRating(16)).toBe(35);
    expect(P.capacitorVoltageRating(20)).toBe(50);
    expect(P.capacitorVoltageRating(100)).toBe(250);
    expect(P.capacitorVoltageRating(300)).toBe(Infinity);
    expect(P.capacitorVoltageRating(0)).toBe(16);
    expect(P.ampVoltsRms(100, 4)).toBeCloseTo(20, 12);
  });

  it('parallelZ and seriesLoad', () => {
    expect(P.parallelZ([P.cx(8), P.cx(8)]).re).toBeCloseTo(4, 12);
    expect(P.parallelZ([P.cx(0, 1), P.cx(0, 1)]).im).toBeCloseTo(0.5, 12);
    const z = P.seriesLoad(6, 0.001, () => P.cx(2, -3))(1000);
    expect(z.re).toBeCloseTo(8, 12);
    expect(z.im).toBeCloseTo(2 * Math.PI * 1000 * 0.001 - 3, 9);
    expect(P.seriesLoad(6, 0)(100).im).toBe(0);
  });
});
