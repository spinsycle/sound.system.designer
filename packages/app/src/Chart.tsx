// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// One log-frequency line chart as plain SVG (no chart library; the same markup can go into the SVG/PDF export later).
import type { MouseEvent } from 'react';

const W = 480;
const H = 240;
const M = { l: 46, r: 12, t: 12, b: 26 };
const F_TICKS = [10, 20, 50, 100, 200, 500, 1000, 2000];

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
  const path = p.values.map((v, k) => `${k ? 'L' : 'M'}${x(p.freqs[k]!).toFixed(1)},${y(Math.min(Math.max(v, p.yMin - span), p.yMax + span)).toFixed(1)}`).join('');
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
          <path className="curve" d={path} />
          {hv && <line className="cursor" x1={x(hv.f)} x2={x(hv.f)} y1={M.t} y2={H - M.b} />}
        </g>
        <rect className="frame" x={M.l} y={M.t} width={W - M.l - M.r} height={H - M.t - M.b} />
      </svg>
    </figure>
  );
}
