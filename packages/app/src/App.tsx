// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The shell: owns the project, stores it in the browser, and shows either the system or one band's box.
import { useEffect, useState } from 'react';
import { BoxDesigner } from './BoxDesigner';
import { SystemView } from './SystemView';
import { sanitize } from './model';
import { DEFAULT_PROJECT, type Project, bandName, sanitizeProject } from './system';

const PROJECT_KEY = 'soundsystemdesigner.project.v1';
/** The single box design the app stored before it had systems; it becomes band 1 once. */
const OLD_DESIGN_KEY = 'soundsystemdesigner.design.v1';

function load(): Project {
  try {
    const stored = localStorage.getItem(PROJECT_KEY);
    if (stored) return sanitizeProject(JSON.parse(stored));
    const old = localStorage.getItem(OLD_DESIGN_KEY);
    if (old) return sanitizeProject({ ...DEFAULT_PROJECT, bands: [{ design: sanitize(JSON.parse(old)) }], view: 'box' });
  } catch {
    // unreadable or unavailable storage: start fresh
  }
  return DEFAULT_PROJECT;
}

export function App() {
  const [project, setProject] = useState<Project>(load);

  useEffect(() => {
    try {
      localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
    } catch {
      // storage unavailable (private window): the project simply is not remembered
    }
  }, [project]);

  const set = (patch: Partial<Project>): void => setProject((p) => sanitizeProject({ ...p, ...patch }));
  const box = project.view === 'box';

  return (
    <div className="app">
      <header>
        <h1>Sound System Designer</h1>
        <p>Boxes, horns and whole systems. Lossless models; generic driver classes are invented values, not products.</p>
        <nav aria-label="View">
          <button type="button" className={box ? '' : 'on'} aria-current={box ? undefined : 'page'} onClick={() => set({ view: 'system' })}>
            System
          </button>
          {project.bands.slice(0, project.nBands).map((_, k) => (
            <button key={k} type="button" className={box && project.selected === k ? 'on' : ''} aria-current={box && project.selected === k ? 'page' : undefined} onClick={() => set({ view: 'box', selected: k })}>
              {project.nBands === 1 ? 'Box' : `${bandName(project.nBands, k)} box`}
            </button>
          ))}
        </nav>
      </header>

      {box ? (
        <BoxDesigner design={project.bands[project.selected]!.design} onChange={(design) => set({ bands: project.bands.map((b, k) => (k === project.selected ? { ...b, design } : b)) })} />
      ) : (
        <SystemView project={project} onChange={setProject} />
      )}
    </div>
  );
}
