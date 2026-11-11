// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The project file: a design saved outside the browser's storage. Plain JSON with a kind and a version, read back through
// the same sanitiser the browser storage uses, so a damaged or hand-edited file can never produce an invalid project.
import { type Project, sanitizeProject } from './system';
import { slug } from './export';
import { migrateProjectV1 } from './migrate';

export const FILE_KIND = 'sound-system-designer-project';
export const FILE_VERSION = 2;
export const FILE_EXTENSION = '.ssd.json';
/** A project is a few kilobytes; anything near this size is not one. */
export const MAX_FILE_BYTES = 2_000_000;

export function serializeProject(p: Project): string {
  return JSON.stringify({ kind: FILE_KIND, version: FILE_VERSION, project: p }, null, 2) + '\n';
}

export interface Opened {
  ok: boolean;
  project: Project | null;
  /** Plain words for the user when it did not open. */
  error: string;
}

const fail = (error: string): Opened => ({ ok: false, project: null, error });

/** Read a project file's text. The view is reset to the system page so an opened file never lands on a stale tab. */
export function parseProjectFile(text: string): Opened {
  if (text.length > MAX_FILE_BYTES) return fail('That file is too large to be a project file.');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('That file is not valid JSON, so it is not a project file.');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('That file is not a project file.');
  const f = raw as Record<string, unknown>;
  if (f.kind !== FILE_KIND) return fail('That file is not a Sound System Designer project.');
  if (typeof f.version !== 'number' || !Number.isInteger(f.version) || f.version < 1) return fail('That project file has no valid version.');
  if (f.version > FILE_VERSION) return fail(`That project was saved by a newer version of the app (file version ${f.version}, this app reads up to ${FILE_VERSION}). Update the app to open it.`);
  if (typeof f.project !== 'object' || f.project === null || Array.isArray(f.project)) return fail('That project file has no project in it.');
  const body = f.version === 1 ? migrateProjectV1(f.project) : f.project;
  return { ok: true, project: { ...sanitizeProject(body), view: 'system', selected: 0 }, error: '' };
}

/** The file name offered when saving. */
export const suggestedName = (p: Project): string => `${slug(p.name)}${FILE_EXTENSION}`;
