// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The Build page: wall material and sheets, box shape and bracing per band, the cut list, baffle drawings, sheet layouts
// and the bill of materials.
import { useMemo, useState } from 'react';
import { Field } from './BoxDesigner';
import { BRACES, BUILD_RANGES, MATERIALS, SHOP_RANGES } from './build';
import { type Cabinet, type BuildView as Build, computeBuild, holePositions } from './buildlist';
import { saveText } from './desktop';
import { baffleSvg, sheetDxf, sheetSvg, slug } from './export';
import { layout3d } from './layout3d';
import { Scene3D } from './Scene3D';
import type { Band, Project } from './system';
import { sanitizeProject } from './system';

const mm = (m: number): string => (m * 1000).toFixed(0);

function csv(v: Build): string {
  const q = (s: string): string => `"${s.replace(/"/g, '""')}"`;
  const lines = ['Cut list', 'Band,Part,Length mm,Width mm,Qty,Note', ...v.cutList.map((r) => [q(r.band), q(r.part), r.l, r.w, r.qty, q(r.note)].join(',')), '', 'Bill of materials', 'Item,Qty,Unit,Note', ...v.bom.map((b) => [q(b.item), b.qty, b.unit, q(b.note)].join(','))];
  return lines.join('\n');
}

/** Front baffle to scale: the driver hole and port hole stacked in the middle. */
function Baffle({ c }: { c: Cabinet }) {
  const g = c.geometry;
  const holes = c.cutouts;
  const pad = 0.03;
  return (
    <figure className="baffle">
      <svg viewBox={`${-pad} ${-pad} ${g.wO + 2 * pad} ${g.hO + 2 * pad}`} role="img" aria-label={`${c.title} front baffle, ${mm(g.wO)} by ${mm(g.hO)} millimetres`}>
        <rect x={0} y={0} width={g.wO} height={g.hO} className="piece" />
        {holePositions(c).map((h, i) => (
          <circle key={i} cx={h.cx} cy={h.cy} r={h.r} className={h.kind === 'port' ? 'hole port-hole' : 'hole'} />
        ))}
      </svg>
      <figcaption>
        {c.title}: {mm(g.wO)} x {mm(g.hO)} x {mm(g.dO)} mm outside. {holes.map((h) => `${h.kind === 'port' ? 'Port' : 'Driver'} hole ${mm(h.diameterM)} mm`).join(', ')}.
      </figcaption>
    </figure>
  );
}

function Sheet({ v, sheet, p }: { v: Build; sheet: number; p: Project }) {
  const L = p.shop.sheetLmm;
  const W = p.shop.sheetWmm;
  const here = v.pieces.filter((x) => x.placement.sheet === sheet);
  return (
    <figure className="sheet">
      <svg viewBox={`0 0 ${L} ${W}`} role="img" aria-label={`Sheet ${sheet + 1} layout, ${here.length} pieces`}>
        <rect x={0} y={0} width={L} height={W} className="stock" />
        {here.map((x, i) => (
          <g key={i} className={`band-${x.band}`}>
            <rect x={x.placement.x * 1000} y={x.placement.y * 1000} width={x.placement.w * 1000} height={x.placement.h * 1000} className="cut" />
            <text x={x.placement.x * 1000 + 12} y={x.placement.y * 1000 + 40} className="cut-label">
              {Math.round(x.placement.w * 1000)} x {Math.round(x.placement.h * 1000)}
            </text>
          </g>
        ))}
      </svg>
      <figcaption>
        Sheet {sheet + 1} of {v.sheets}: {here.length} pieces, {p.shop.sheetLmm} x {p.shop.sheetWmm} mm.
      </figcaption>
    </figure>
  );
}

export function BuildView({ project, onChange }: { project: Project; onChange: (p: Project) => void }) {
  const v = useMemo(() => computeBuild(project), [project]);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState('');
  /** Save a file, and say where it went (or why not). */
  const download = (name: string, text: string, mime: string): void => {
    void saveText(name, text, mime).then((r) => setSaved(r.ok ? `Saved ${r.where}` : r.cancelled ? '' : r.error));
  };
  const [explode, setExplode] = useState(0);
  const [transparent, setTransparent] = useState(false);
  const layout = useMemo(() => layout3d(v, project), [v, project]);
  const base = slug(project.name);
  const set = (patch: Partial<Project>): void => onChange(sanitizeProject({ ...project, ...patch }));
  const setShop = (patch: Partial<Project['shop']>): void => set({ shop: { ...project.shop, ...patch } });
  const setBuild = (k: number, patch: Partial<Band['build']>): void => set({ bands: project.bands.map((b, i) => (i === k ? { ...b, build: { ...b.build, ...patch } } : b)) });
  const copy = (): void => {
    navigator.clipboard.writeText(csv(v)).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <main>
      <div className="controls">
        <section>
          <h2>Walls and sheets</h2>
          <div className="segmented" role="radiogroup" aria-label="Wall material">
            {MATERIALS.map((m) => (
              <button key={m.label} type="button" role="radio" aria-checked={project.shop.thicknessMm === m.thicknessMm} className={project.shop.thicknessMm === m.thicknessMm ? 'on' : ''} onClick={() => setShop({ thicknessMm: m.thicknessMm })}>
                {m.label}
              </button>
            ))}
          </div>
          <Field id="shop-t" range={SHOP_RANGES.thicknessMm} value={project.shop.thicknessMm} onChange={(x) => setShop({ thicknessMm: x })} />
          <Field id="shop-l" range={SHOP_RANGES.sheetLmm} value={project.shop.sheetLmm} onChange={(x) => setShop({ sheetLmm: x })} />
          <Field id="shop-w" range={SHOP_RANGES.sheetWmm} value={project.shop.sheetWmm} onChange={(x) => setShop({ sheetWmm: x })} />
          <Field id="shop-k" range={SHOP_RANGES.kerfMm} value={project.shop.kerfMm} onChange={(x) => setShop({ kerfMm: x })} />
          <div className="field">
            <label htmlFor="project-name">Project name</label>
            <input id="project-name" type="text" className="left" value={project.name} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <p className="hint">Metric for now. The project name is used in exported file names.</p>
        </section>
        {project.bands.slice(0, project.nBands).map((band, k) => (
          <section key={k}>
            <h2>{v.bands[k]!.name}</h2>
            <p className="hint">{v.bands[k]!.summary}</p>
            <h3>Box shape and bracing</h3>
            <Field id={`rw-${k}`} range={BUILD_RANGES.rw} value={band.build.rw} onChange={(x) => setBuild(k, { rw: x })} />
            <Field id={`rh-${k}`} range={BUILD_RANGES.rh} value={band.build.rh} onChange={(x) => setBuild(k, { rh: x })} />
            <Field id={`rd-${k}`} range={BUILD_RANGES.rd} value={band.build.rd} onChange={(x) => setBuild(k, { rd: x })} />
            <div className="field">
              <label htmlFor={`brace-${k}`}>Bracing</label>
              <select id={`brace-${k}`} value={band.build.brace} onChange={(e) => setBuild(k, { brace: e.target.value as Band['build']['brace'] })}>
                {BRACES.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="hint">
              Proportions of the inside, width : height : depth. {v.bands[k]!.cabinets.map((c) => `${c.title}: ${mm(c.geometry.wI)} x ${mm(c.geometry.hI)} x ${mm(c.geometry.dI)} mm inside`).join('; ') || 'Horn sections only.'}
            </p>
          </section>
        ))}
      </div>

      <div className="charts one">
        <section>
          <h2>Cut list</h2>
          <table>
            <thead>
              <tr>
                <th scope="col" className="left">
                  Band
                </th>
                <th scope="col" className="left pad">
                  Part
                </th>
                <th scope="col">Length, mm</th>
                <th scope="col">Width, mm</th>
                <th scope="col">Qty</th>
                <th scope="col" className="left pad">
                  Note
                </th>
              </tr>
            </thead>
            <tbody>
              {v.cutList.map((r, i) => (
                <tr key={i}>
                  <th scope="row" className="left">
                    {r.band}
                  </th>
                  <td className="left pad">{r.part}</td>
                  <td>{r.l}</td>
                  <td>{r.w}</td>
                  <td>{r.qty}</td>
                  <td className="left pad">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="actions">
            <button type="button" onClick={copy}>
              Copy cut list and parts as CSV
            </button>
            <button type="button" onClick={() => download(`${base}-cut-list.csv`, csv(v), 'text/csv')}>
              Save as CSV file
            </button>
            <button type="button" onClick={() => window.print()}>
              Export PDF (print)
            </button>
            {copied && <span className="hint"> Copied.</span>}
          </div>
          {saved && <p className="hint" role="status">{saved}</p>}
        </section>

        <section className="no-print">
          <h2>3D preview</h2>
          <div className="actions">
            <label htmlFor="explode">Explode</label>
            <input id="explode" type="range" min={0} max={1} step={0.05} value={explode} onChange={(e) => setExplode(Number(e.target.value))} />
            <button type="button" aria-pressed={transparent} className={transparent ? 'on' : ''} onClick={() => setTransparent(!transparent)}>
              See through
            </button>
          </div>
          <Scene3D layout={layout} explode={explode} transparent={transparent} />
          <p className="hint">Drag to orbit, scroll or pinch to zoom. One cabinet per band is drawn; braces and dividers show when see-through or exploded. The driver hole is amber, the port blue.</p>
        </section>

        <section>
          <h2>Baffles</h2>
          <div className="drawings">
            {v.bands.flatMap((b) =>
              b.cabinets.map((c, i) => (
                <div key={`${b.name}-${i}`}>
                  <Baffle c={{ ...c, title: `${b.name}: ${c.title}` }} />
                  <button type="button" className="no-print" onClick={() => download(`${base}-${slug(b.name)}-${slug(c.title)}-baffle.svg`, baffleSvg(c, `${b.name}: ${c.title}`), 'image/svg+xml')}>
                    Download SVG
                  </button>
                </div>
              )),
            )}
          </div>
        </section>

        <section>
          <h2>Sheets</h2>
          <p className="hint">
            {v.sheets} {v.sheets === 1 ? 'sheet' : 'sheets'}, {(v.waste * 100).toFixed(0)} % waste. Pieces lie long side along the sheet.
          </p>
          <div className="drawings">
            {Array.from({ length: v.sheets }, (_, s) => (
              <div key={s} className="sheet-block">
                <Sheet v={v} sheet={s} p={project} />
                <div className="actions no-print">
                  <button type="button" onClick={() => download(`${base}-sheet-${s + 1}.svg`, sheetSvg(v, project, s), 'image/svg+xml')}>
                    Download SVG
                  </button>
                  <button type="button" onClick={() => download(`${base}-sheet-${s + 1}.dxf`, sheetDxf(v, project, s), 'application/dxf')}>
                    Download DXF
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2>Bill of materials</h2>
          <table>
            <thead>
              <tr>
                <th scope="col" className="left">
                  Item
                </th>
                <th scope="col">Qty</th>
                <th scope="col" className="left pad">
                  Unit
                </th>
                <th scope="col" className="left pad">
                  Note
                </th>
              </tr>
            </thead>
            <tbody>
              {v.bom.map((b, i) => (
                <tr key={i}>
                  <th scope="row" className="left">
                    {b.item}
                  </th>
                  <td>{b.qty}</td>
                  <td className="left pad">{b.unit}</td>
                  <td className="left pad">{b.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {v.warnings.length > 0 && (
            <ul className="warnings">
              {v.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <ul className="notes">
            {v.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
