// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// One log-frequency line chart as plain SVG (no chart library; the same markup can go into the SVG/PDF export later).
import type { MouseEvent } from 'react';

const W = 480;
const H = 240;
const M = { l: 46, r: 12, t: 12, b: 26 };
const F_TICKS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

/** A comparison curve is styled by its name ("ideal flare" -> overlay-ideal-flare), so it looks the same on every chart. */
const overlayClass = (label: string): string => `overlay overlay-${label.replace(/\W+/g, '-')}`;

/** A 1-2-5 axis that covers 0..v in at most five steps. */
export function niceScale(v: number): { max: number; step: number } {
  const raw = Math.max(v, 1e-9) / 5;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  return { max: Math.ceil(Math.max(v, 1e-9) / step - 1e-9) * step, step };
}

export interface ChartProps {
  title: string;
  unit: string;
  freqs: readonly number[];
  values: readonly number[];
  yMin: number;
  yMax: number;
  yStep: number;
  /** Up to two comparison curves, drawn dashed behind the main one and named in a legend. */
  overlays?: readonly { label: string; values: readonly number[]; className?: string }[];
  hLine?: { y: number; label: string };
  vLines?: readonly { f: number; label: string }[];
  /** Index into freqs under the pointer, shared by every chart; null when the pointer is elsewhere. */
  hover: number | null;
  onHover: (index: number | null) => void;
}

export function Chart(p: ChartProps) {
  const fMin = p.freqs[0]!;
  const fMax = p.freqs[p.freqs.length - 1]!;
  const x = (f: number): number => M.l + ((W - M.l - M.r) * Math.log(f / fMin)) / Math.log(fMax / fMin);
  const y = (v: number): number => H - M.b - ((H - M.t - M.b) * (v - p.yMin)) / (p.yMax - p.yMin);
  // values far outside the axis are pulled in so the path stays finite; the clip rectangle hides the excess
  const span = p.yMax - p.yMin;
  const pathOf = (values: readonly number[]): string =>
    values.map((v, k) => `${k ? 'L' : 'M'}${x(p.freqs[k]!).toFixed(1)},${y(Math.min(Math.max(v, p.yMin - span), p.yMax + span)).toFixed(1)}`).join('');
  const path = pathOf(p.values);
  const yTicks: number[] = [];
  for (let v = p.yMin; v <= p.yMax + 1e-9; v += p.yStep) yTicks.push(v);
  const clip = `clip-${p.title.replace(/\W/g, '')}`;
  const digits = p.yStep < 1 ? 1 : 0;

  const move = (e: MouseEvent<SVGSVGElement>): void => {
    const box = e.currentTarget.getBoundingClientRect();
    const t = (((e.clientX - box.left) / box.width) * W - M.l) / (W - M.l - M.r);
    p.onHover(t < 0 || t > 1 ? null : Math.round(t * (p.freqs.length - 1)));
  };

  const hv = p.hover === null ? null : { f: p.freqs[p.hover]!, v: p.values[p.hover]! };

  return (
    <figure className="chart">
      <figcaption>
        <span>{p.title}</span>
        <span className="chart-readout">{hv ? `${hv.f < 100 ? hv.f.toFixed(1) : hv.f.toFixed(0)} Hz: ${hv.v.toFixed(Math.abs(hv.v) < 100 ? 2 : 0)} ${p.unit}` : p.unit}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${p.title} against frequency`} onMouseMove={move} onMouseLeave={() => p.onHover(null)}>
        <clipPath id={clip}>
          <rect x={M.l} y={M.t} width={W - M.l - M.r} height={H - M.t - M.b} />
        </clipPath>
        {yTicks.map((v) => (
          <g key={v}>
            <line className={Math.abs(v) < 1e-9 && p.yMin < 0 ? 'grid zero' : 'grid'} x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} />
            <text className="tick" x={M.l - 6} y={y(v) + 3.5} textAnchor="end">
              {v.toFixed(digits)}
            </text>
          </g>
        ))}
        {F_TICKS.filter((f) => f >= fMin && f <= fMax).map((f) => (
          <g key={f}>
            <line className="grid" x1={x(f)} x2={x(f)} y1={M.t} y2={H - M.b} />
            <text className="tick" x={x(f)} y={H - 8} textAnchor="middle">
              {f >= 1000 ? `${f / 1000}k` : f}
            </text>
          </g>
        ))}
        <g clipPath={`url(#${clip})`}>
          {p.vLines?.map((m) => (
            <g key={m.label}>
              <line className="marker" x1={x(m.f)} x2={x(m.f)} y1={M.t} y2={H - M.b} />
              <text className="marker-label" x={x(m.f) + 4} y={M.t + 11}>
                {m.label}
              </text>
            </g>
          ))}
          {p.hLine && p.hLine.y <= p.yMax && (
            <g>
              <line className="limit" x1={M.l} x2={W - M.r} y1={y(p.hLine.y)} y2={y(p.hLine.y)} />
              <text className="limit-label" x={W - M.r - 4} y={y(p.hLine.y) - 4} textAnchor="end">
                {p.hLine.label}
              </text>
            </g>
          )}
          {p.overlays?.map((o) => <path key={o.label} className={o.className ?? overlayClass(o.label)} d={pathOf(o.values)} />)}
          <path className="curve" d={path} />
          {hv && <line className="cursor" x1={x(hv.f)} x2={x(hv.f)} y1={M.t} y2={H - M.b} />}
        </g>
        <rect className="frame" x={M.l} y={M.t} width={W - M.l - M.r} height={H - M.t - M.b} />
      </svg>
      {p.overlays && p.overlays.length > 0 && (
        <ul className="legend">
          {p.overlays.map((o) => (
            <li key={o.label}>
              <svg viewBox="0 0 26 6" aria-hidden="true">
                <line className={o.className ?? overlayClass(o.label)} x1="0" x2="26" y1="3" y2="3" />
              </svg>
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

/** The horn drawn to scale as a round section: the ideal flare, and the straight panels when the builder gave them. */
export function ProfileChart(p: { lengthM: number; ideal: readonly { x: number; area: number }[]; built: readonly { x: number; area: number }[] | null }) {
  const r = (area: number): number => Math.sqrt(area / Math.PI);
  const rMax = r(p.ideal[p.ideal.length - 1]!.area);
  const pad = 14;
  const scale = Math.min((W - 2 * pad) / p.lengthM, (H - 2 * pad - 14) / (2 * rMax));
  const x0 = (W - p.lengthM * scale) / 2;
  const yc = (H - 14) / 2;
  const outline = (pts: readonly { x: number; area: number }[], sign: 1 | -1): string =>
    pts.map((j, k) => `${k ? 'L' : 'M'}${(x0 + j.x * scale).toFixed(1)},${(yc + sign * r(j.area) * scale).toFixed(1)}`).join('');
  const main = p.built ?? p.ideal;
  const cm = (m: number): string => (m * 100).toFixed(m < 0.1 ? 1 : 0);
  return (
    <figure className="chart">
      <figcaption>
        <span>Horn profile (equivalent round section, to scale)</span>
        <span className="chart-readout">
          throat ⌀ {cm(2 * r(p.ideal[0]!.area))} cm, mouth ⌀ {cm(2 * rMax)} cm, length {cm(p.lengthM)} cm
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Horn profile from throat to mouth">
        <line className="grid" x1={x0} x2={x0 + p.lengthM * scale} y1={yc} y2={yc} />
        {p.built && (
          <>
            <path className="overlay overlay-ideal-flare" d={outline(p.ideal, 1)} />
            <path className="overlay overlay-ideal-flare" d={outline(p.ideal, -1)} />
            {p.built.map((j) => (
              <line key={j.x} className="marker" x1={x0 + j.x * scale} x2={x0 + j.x * scale} y1={yc - r(j.area) * scale} y2={yc + r(j.area) * scale} />
            ))}
          </>
        )}
        <path className="curve" d={outline(main, 1)} />
        <path className="curve" d={outline(main, -1)} />
        <text className="tick" x={x0} y={H - 4} textAnchor="middle">
          throat
        </text>
        <text className="tick" x={x0 + p.lengthM * scale} y={H - 4} textAnchor="middle">
          mouth
        </text>
      </svg>
      {p.built && (
        <ul className="legend">
          <li>
            <svg viewBox="0 0 26 6" aria-hidden="true">
              <line className="overlay overlay-ideal-flare" x1="0" x2="26" y1="3" y2="3" />
            </svg>
            ideal flare
          </li>
        </ul>
      )}
    </figure>
  );
}
