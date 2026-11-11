import { describe, expect, it } from 'vitest';
import * as P from '../src/index';

describe('loudspeaker cabinets (v0.11)', () => {
  it('a group of one, or of nothing, keeps the whole volume', () => {
    expect(P.groupVolumeM3(0.06, 1)).toBe(0.06);
    expect(P.groupVolumeM3(0.06, 0)).toBe(0.06);
    expect(P.groupVolumeM3(0.06, 3)).toBeCloseTo(0.02, 15);
  });

  it('the baffle step is monotonic: a wider baffle moves the step down, the shelf never gains', () => {
    expect(P.baffleStepCornerHz(0.4)).toBeLessThan(P.baffleStepCornerHz(0.2));
    for (const f of [20, 200, 2000, 20000]) expect(P.abs(P.baffleStepShelf(f, 0.25))).toBeLessThanOrEqual(1 + 1e-12);
    // the corner of a degenerate (zero) width does not blow up
    expect(Number.isFinite(P.baffleStepCornerHz(0))).toBe(true);
  });
});
