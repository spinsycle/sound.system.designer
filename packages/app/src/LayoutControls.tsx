// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The controls for how drivers sit in a cabinet (columns, motor in or out, push-pull, facing) and for the port's shape.
// Shared by the PA box page, the home speaker page and the car page: each passes the Design (or layout) it edits.
import { Field } from './BoxDesigner';
import { BOX_RANGES, type Design, type DriverLayout, LAYOUT_RANGES, sanitizeLayout } from './model';

function Segmented<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: readonly { id: T; label: string }[]; onPick: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={value === o.id ? 'on' : ''} onClick={() => onPick(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Port: round (diameter) or rectangular (width, height, horizontal or vertical). `idp` keeps element ids unique per page. */
export function PortControls({ design, onChange, idp }: { design: Design; onChange: (patch: Partial<Design>) => void; idp: string }) {
  return (
    <div className="port-controls">
      <Segmented label="Port shape" value={design.portShape} options={[{ id: 'round', label: 'Round port' }, { id: 'rect', label: 'Rectangular port' }]} onPick={(portShape) => onChange({ portShape })} />
      {design.portShape === 'round' ? (
        <Field id={`${idp}-pd`} slider range={BOX_RANGES.portDiameterCm} value={design.portDiameterCm} onChange={(v) => onChange({ portDiameterCm: v })} />
      ) : (
        <>
          <Field id={`${idp}-pw`} range={BOX_RANGES.portWidthCm} value={design.portWidthCm} onChange={(v) => onChange({ portWidthCm: v })} />
          <Field id={`${idp}-ph`} range={BOX_RANGES.portHeightCm} value={design.portHeightCm} onChange={(v) => onChange({ portHeightCm: v })} />
          <Segmented label="Port direction" value={design.portOrient} options={[{ id: 'horizontal', label: 'Horizontal' }, { id: 'vertical', label: 'Vertical' }]} onPick={(portOrient) => onChange({ portOrient })} />
        </>
      )}
    </div>
  );
}

/**
 * How the cabinet's drivers are placed. `count` is how many drivers share the cabinet (set elsewhere); with push-pull they split over
 * the front and back walls. `pushPullOk` hides push-pull where it is not offered.
 */
export function LayoutControls({ layout, count, onChange, idp, pushPullOk = true, colsOk = true }: { layout: DriverLayout; count: number; onChange: (l: DriverLayout) => void; idp: string; pushPullOk?: boolean; colsOk?: boolean }) {
  const set = (patch: Partial<DriverLayout>): void => onChange(sanitizeLayout({ ...layout, ...patch }));
  const split = layout.pushPull && layout.pushPullStyle === 'walls' && count >= 2;
  const face = split ? Math.ceil(count / 2) : count;
  const cols = layout.cols > 0 ? Math.min(layout.cols, Math.max(face, 1)) : face;
  const rows = Math.ceil(face / Math.max(cols, 1));
  return (
    <div className="layout-controls">
      {colsOk && (
        <>
          <Field id={`${idp}-cols`} range={{ ...LAYOUT_RANGES.cols, label: 'Columns (0 = automatic)' }} value={layout.cols} onChange={(v) => set({ cols: Math.round(v) })} />
          <p className="hint">
            {face} driver{face === 1 ? '' : 's'} on the {layout.facing === 'down' ? 'bottom' : 'front'}: {layout.cols === 0 ? 'automatic layout' : `${cols} column${cols === 1 ? '' : 's'} x ${rows} row${rows === 1 ? '' : 's'}`}
            {split ? `, and ${count - face} on the back wall` : ''}.
          </p>
        </>
      )}
      <Segmented label="Magnet" value={layout.mount} options={[{ id: 'in', label: 'Magnet inside' }, { id: 'out', label: 'Magnet outside' }]} onPick={(mount) => set({ mount })} />
      <Segmented label="Facing" value={layout.facing} options={[{ id: 'front', label: 'Facing front' }, { id: 'down', label: 'Facing down' }]} onPick={(facing) => set({ facing })} />
      {layout.facing === 'down' && <Field id={`${idp}-clr`} range={LAYOUT_RANGES.clearanceCm} value={layout.clearanceCm} onChange={(v) => set({ clearanceCm: v })} />}
      {pushPullOk && (
        <div className="field">
          <label htmlFor={`${idp}-pp`}>Push-pull</label>
          <input id={`${idp}-pp`} type="checkbox" checked={layout.pushPull} onChange={(e) => set({ pushPull: e.target.checked })} />
          <span className="unit">{layout.pushPull ? (count >= 2 ? (layout.pushPullStyle === 'side' ? 'side by side, one magnet in and one out, opposite polarity' : 'pairs on opposite walls, opposite polarity') : 'needs two or more drivers') : 'off'}</span>
        </div>
      )}
      {pushPullOk && layout.pushPull && <Segmented label="Push-pull style" value={layout.pushPullStyle} options={[{ id: 'walls', label: 'Opposite walls' }, { id: 'side', label: 'Side by side, magnet in and out' }]} onPick={(pushPullStyle) => set({ pushPullStyle })} />}
    </div>
  );
}
