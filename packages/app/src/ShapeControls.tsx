// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The alignment and order of a page's crossover points: shared by the PA system, home speaker and car pages.
import * as P from '@soundsystemdesigner/physics';
import { Field } from './BoxDesigner';
import { XO_RANGES, type XoShape, sanitizeShape } from './crossover';

const LABEL: Record<P.Alignment, string> = { butterworth: 'Butterworth', 'linkwitz-riley': 'Linkwitz-Riley', bessel: 'Bessel', chebyshev: 'Chebyshev' };

/** `idp` keeps element ids unique per page. */
export function ShapeControls({ shape, onChange, idp }: { shape: XoShape; onChange: (s: XoShape) => void; idp: string }) {
  const set = (patch: Partial<XoShape>): void => onChange(sanitizeShape({ ...shape, ...patch }));
  return (
    <>
      <div className="field stacked">
        <label htmlFor={`${idp}-align`}>Crossover alignment</label>
        <select id={`${idp}-align`} value={shape.alignment} onChange={(e) => set({ alignment: e.target.value as P.Alignment })}>
          {P.ALIGNMENTS.map((a) => (
            <option key={a} value={a}>
              {LABEL[a]}
            </option>
          ))}
        </select>
      </div>
      <Field id={`${idp}-order`} range={{ ...XO_RANGES.order, label: 'Crossover order' }} value={shape.order} onChange={(v) => set({ order: Math.round(v) })} />
      {shape.alignment === 'chebyshev' && <Field id={`${idp}-ripple`} range={XO_RANGES.rippleDb} value={shape.rippleDb} onChange={(v) => set({ rippleDb: v })} />}
    </>
  );
}
