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
import { CrossoverView } from './CrossoverView';
import { SpeakerView } from './SpeakerView';
import { SystemView } from './SystemView';
import { ProbeView } from './probe/ProbeView';
import { DriversView } from './drivers/DriversView';
import { type DriverDb, loadDb, saveDb } from './drivers/library';
import { applyDriver, targetsFor } from './drivers/pick';
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
  /** The Driver Probe page replaces the design while it is open. */
  const [probeOpen, setProbeOpen] = useState(false);
  /** The Drivers page replaces the design while it is open. */
  const [driversOpen, setDriversOpen] = useState(false);
  /** The driver database, shared by the Drivers page and the Probe page. */
  const [db, setDb] = useState<DriverDb>(() => loadDb());
  const changeDb = (next: DriverDb): void => {
    setDb(next);
    if (!saveDb(next)) setFileMsg('The drivers could not be remembered: browser storage is unavailable or full. Export the library as a file instead.');
  };

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
  const xover = project.kind === 'crossover';
  const box = !speaker && !car && !xover && project.view === 'box';
  const build = !xover && project.view === 'build';

  return (
    <div className="app">
      <header>
        <h1>Sound System Designer</h1>
        <p>Boxes, horns and whole systems. Box losses default to the Cookbook's QL 7; generic driver classes are invented values, not products.</p>
        <div className="segmented" role="radiogroup" aria-label="What to design">
          <button type="button" role="radio" aria-checked={!speaker && !car && !xover} className={speaker || car || xover ? '' : 'on'} onClick={() => set({ kind: 'system', view: 'system' })}>
            PA system
          </button>
          <button type="button" role="radio" aria-checked={speaker} className={speaker ? 'on' : ''} onClick={() => set({ kind: 'speaker', view: 'system' })}>
            Home speaker
          </button>
          <button type="button" role="radio" aria-checked={car} className={car ? 'on' : ''} onClick={() => set({ kind: 'car', view: 'system' })}>
            Car subwoofer
          </button>
          <button type="button" role="radio" aria-checked={xover} className={xover ? 'on' : ''} onClick={() => set({ kind: 'crossover', view: 'system' })}>
            Crossover
          </button>
        </div>
        {!xover && (
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
        )}
        <div className="actions">
          <button type="button" onClick={saveProject}>
            Save project
          </button>
          <button type="button" onClick={openProject}>
            Open project
          </button>
          <button type="button" aria-pressed={driversOpen} onClick={() => { setDriversOpen(!driversOpen); setProbeOpen(false); }}>
            Drivers
          </button>
          <button type="button" aria-pressed={probeOpen} onClick={() => { setProbeOpen(!probeOpen); setDriversOpen(false); }}>
            Driver Probe
          </button>
          {fileMsg && (
            <span className="hint" role="status">
              {fileMsg}
            </span>
          )}
        </div>
      </header>

      {driversOpen ? (
        <DriversView
          db={db}
          onDb={changeDb}
          onClose={() => setDriversOpen(false)}
          targets={targetsFor(project).targets}
          firstTarget={targetsFor(project).first}
          onUse={(snap, targetId) => {
            const next = applyDriver(project, targetId, snap);
            if (!next) return setFileMsg('That driver could not be used there.');
            setProject(next);
            setFileMsg(`${snap.name} is now the driver for: ${targetsFor(project).targets.find((t) => t.id === targetId)?.label ?? 'the design'}.`);
            setDriversOpen(false);
          }}
        />
      ) : probeOpen ? (
        <ProbeView onClose={() => setProbeOpen(false)} db={db} onDb={changeDb} onOpenDrivers={() => { setProbeOpen(false); setDriversOpen(true); }} />
      ) : (
        <>
      {!build && !xover && <BriefPanel key={speaker ? 'speaker' : car ? 'car' : box ? 'box' : 'system'} mode={speaker ? 'speaker' : car ? 'car' : box ? 'box' : 'system'} onLoadSystem={loadSystem} onLoadBox={loadBox} onLoadSpeaker={loadSpeaker} onLoadCar={loadCar} canUndo={undo !== null} onUndo={() => { if (undo) { setProject(undo); setUndo(null); } }} />}

      {xover ? (
        <CrossoverView project={project} onChange={setProject} onApply={(p) => { setUndo(project); setProject(p); }} canUndo={undo !== null} onUndo={() => { if (undo) { setProject(undo); setUndo(null); } }} />
      ) : build ? (
        <BuildView project={project} onChange={setProject} />
      ) : box ? (
        <BoxDesigner db={db} wallM={project.shop.thicknessMm / 1000} design={project.bands[project.selected]!.design} count={project.bands[project.selected]!.count} perBox={project.bands[project.selected]!.perBox} onPerBox={(perBox) => set({ bands: project.bands.map((b, k) => (k === project.selected ? { ...b, perBox } : b)) })} onChange={(design) => set({ bands: project.bands.map((b, k) => (k === project.selected ? { ...b, design } : b)) })} />
      ) : speaker ? (
        <SpeakerView db={db} project={project} onChange={setProject} />
      ) : car ? (
        <CarView db={db} project={project} onChange={setProject} />
      ) : (
        <SystemView project={project} onChange={setProject} />
      )}
        </>
      )}
      <footer className="about">
        <details>
          <summary>
            About {APP_NAME} {APP_VERSION}
          </summary>
          <p>
            Version {APP_VERSION}. Free software under the {LICENCE}: you may use, change and share it under that licence, and the source is at {SOURCE_URL}.
          </p>
          <p>Generic parts only: the driver classes are invented values, not products, and no brand, driver-model or named sound-system claims are made. Levels and limits are small-signal calculations, not measurements: check anything you build against real drivers and a real amplifier. Project files end in {FILE_EXTENSION}.</p>
        </details>
      </footer>
    </div>
  );
}
