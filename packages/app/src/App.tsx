// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The shell: owns the project, stores it in the browser, and shows either the system or one band's box.
import { useEffect, useState } from 'react';
import { BoxDesigner } from './BoxDesigner';
import { APP_NAME, APP_VERSION, LICENCE, SOURCE_URL } from './about';
import { BriefPanel } from './BriefPanel';
import { openText, saveText } from './desktop';
import { FILE_EXTENSION, parseProjectFile, serializeProject, suggestedName } from './projectfile';
import { BuildView } from './BuildView';
import { CarView } from './CarView';
import { SpeakerView } from './SpeakerView';
import { SystemView } from './SystemView';
import { type Design, sanitize } from './model';
import { migrateDesignV1, migrateProjectV1 } from './migrate';
import type { Loudspeaker } from './loudspeaker';
import type { CarSub } from './carsub';
import { DEFAULT_PROJECT, type Project, bandName, sanitizeProject } from './system';

const PROJECT_KEY = 'soundsystemdesigner.project.v2';
/** Version 1 stored the Custom driver as class 8; it is read once and migrated, never overwritten. */
const PROJECT_KEY_V1 = 'soundsystemdesigner.project.v1';
/** The single box design the app stored before it had systems; it becomes band 1 once. */
const OLD_DESIGN_KEY = 'soundsystemdesigner.design.v1';

function load(): Project {
  try {
    const stored = localStorage.getItem(PROJECT_KEY);
    if (stored) return sanitizeProject(JSON.parse(stored));
    const v1 = localStorage.getItem(PROJECT_KEY_V1);
    if (v1) return sanitizeProject(migrateProjectV1(JSON.parse(v1)));
    const old = localStorage.getItem(OLD_DESIGN_KEY);
    if (old) return sanitizeProject({ ...DEFAULT_PROJECT, bands: [{ design: sanitize(migrateDesignV1(JSON.parse(old))) }], view: 'box' });
  } catch {
    // unreadable or unavailable storage: start fresh
  }
  return DEFAULT_PROJECT;
}

export function App() {
  const [project, setProject] = useState<Project>(load);
  /** The project before the last brief variant was loaded. */
  const [undo, setUndo] = useState<Project | null>(null);
  /** The last thing Save or Open project did, in plain words. */
  const [fileMsg, setFileMsg] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
    } catch {
      // storage unavailable (private window): the project simply is not remembered
    }
  }, [project]);

  const set = (patch: Partial<Project>): void => setProject((p) => sanitizeProject({ ...p, ...patch }));
  const loadSystem = (p: Project): void => {
    setUndo(project);
    setProject(sanitizeProject({ ...p, name: project.name, shop: project.shop, units: project.units }));
  };
  const loadBox = (design: Design): void => {
    setUndo(project);
    setProject(sanitizeProject({ ...project, bands: project.bands.map((b, k) => (k === project.selected ? { ...b, design } : b)) }));
  };
  const loadSpeaker = (speaker: Loudspeaker): void => {
    setUndo(project);
    setProject(sanitizeProject({ ...project, speaker, view: 'system' }));
  };
  const loadCar = (car: CarSub): void => {
    setUndo(project);
    setProject(sanitizeProject({ ...project, car, view: 'system' }));
  };
  const saveProject = (): void => {
    void saveText(suggestedName(project), serializeProject(project), 'application/json').then((r) => setFileMsg(r.ok ? `Saved ${r.where}` : r.cancelled ? '' : r.error));
  };
  const openProject = (): void => {
    void openText(['json']).then((r) => {
      if (!r.ok) return setFileMsg(r.cancelled ? '' : r.error);
      const o = parseProjectFile(r.text);
      if (!o.ok || !o.project) return setFileMsg(o.error);
      setUndo(project);
      setProject(o.project);
      setFileMsg(`Opened ${r.name}. "Undo last load" brings back what you had.`);
    });
  };
  const speaker = project.kind === 'speaker';
  const car = project.kind === 'car';
  const box = !speaker && !car && project.view === 'box';
  const build = project.view === 'build';

  return (
    <div className="app">
      <header>
        <h1>Sound System Designer</h1>
        <p>Boxes, horns and whole systems. Lossless models; generic driver classes are invented values, not products.</p>
        <div className="segmented" role="radiogroup" aria-label="What to design">
          <button type="button" role="radio" aria-checked={!speaker && !car} className={speaker || car ? '' : 'on'} onClick={() => set({ kind: 'system', view: 'system' })}>
            PA system
          </button>
          <button type="button" role="radio" aria-checked={speaker} className={speaker ? 'on' : ''} onClick={() => set({ kind: 'speaker', view: 'system' })}>
            Home speaker
          </button>
          <button type="button" role="radio" aria-checked={car} className={car ? 'on' : ''} onClick={() => set({ kind: 'car', view: 'system' })}>
            Car subwoofer
          </button>
        </div>
        <nav aria-label="View">
          <button type="button" className={box || build ? '' : 'on'} aria-current={box || build ? undefined : 'page'} onClick={() => set({ view: 'system' })}>
            {speaker ? 'Speaker' : car ? 'Subwoofer' : 'System'}
          </button>
          {!speaker && !car && project.bands.slice(0, project.nBands).map((_, k) => (
            <button key={k} type="button" className={box && project.selected === k ? 'on' : ''} aria-current={box && project.selected === k ? 'page' : undefined} onClick={() => set({ view: 'box', selected: k })}>
              {project.nBands === 1 ? 'Box' : `${bandName(project.nBands, k)} box`}
            </button>
          ))}
          <button type="button" className={build ? 'on' : ''} aria-current={build ? 'page' : undefined} onClick={() => set({ view: 'build' })}>
            Build
          </button>
        </nav>
        <div className="actions">
          <button type="button" onClick={saveProject}>
            Save project
          </button>
          <button type="button" onClick={openProject}>
            Open project
          </button>
          {fileMsg && (
            <span className="hint" role="status">
              {fileMsg}
            </span>
          )}
        </div>
      </header>

      {!build && <BriefPanel key={speaker ? 'speaker' : car ? 'car' : box ? 'box' : 'system'} mode={speaker ? 'speaker' : car ? 'car' : box ? 'box' : 'system'} onLoadSystem={loadSystem} onLoadBox={loadBox} onLoadSpeaker={loadSpeaker} onLoadCar={loadCar} canUndo={undo !== null} onUndo={() => { if (undo) { setProject(undo); setUndo(null); } }} />}

      {build ? (
        <BuildView project={project} onChange={setProject} />
      ) : box ? (
        <BoxDesigner design={project.bands[project.selected]!.design} onChange={(design) => set({ bands: project.bands.map((b, k) => (k === project.selected ? { ...b, design } : b)) })} />
      ) : speaker ? (
        <SpeakerView project={project} onChange={setProject} />
      ) : car ? (
        <CarView project={project} onChange={setProject} />
      ) : (
        <SystemView project={project} onChange={setProject} />
      )}
      <footer className="about">
        <details>
          <summary>
            About {APP_NAME} {APP_VERSION}
          </summary>
          <p>
            Version {APP_VERSION}. Free software under the {LICENCE}: you may use, change and share it under that licence, and the source is at {SOURCE_URL} (the repository is private until its author makes it public).
          </p>
          <p>Generic parts only: the driver classes are invented values, not products, and no brand, driver-model or named sound-system claims are made. Levels and limits are small-signal calculations, not measurements: check anything you build against real drivers and a real amplifier. Project files end in {FILE_EXTENSION}.</p>
        </details>
      </footer>
    </div>
  );
}
