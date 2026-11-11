// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The one place that knows whether the app runs in the desktop shell or in a browser. In the shell, files go through a
// native Save or Open dialog and Ollama is reached from the Rust side; in a browser they are downloads, a file picker and
// the page's own fetch. The rest of the app calls these and never checks.
import type { FetchFn } from './ollama';

export const isDesktop = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export type SaveResult = { ok: true; where: string } | { ok: false; cancelled: boolean; error: string };

/** Hands a string to the user as a file: a Save As dialog in the app, a download in a browser. */
export async function saveText(name: string, text: string, mime: string): Promise<SaveResult> {
  if (isDesktop()) {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');
      const ext = name.includes('.') ? name.slice(name.indexOf('.') + 1) : '';
      const path = await save({ defaultPath: name, filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined });
      if (!path) return { ok: false, cancelled: true, error: '' };
      await writeTextFile(path, text);
      return { ok: true, where: path };
    } catch (e) {
      return { ok: false, cancelled: false, error: `Could not save the file: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { ok: true, where: name };
}

export type OpenResult = { ok: true; name: string; text: string } | { ok: false; cancelled: boolean; error: string };

/** Lets the user pick a text file: an Open dialog in the app, a file picker in a browser. */
export async function openText(extensions: readonly string[]): Promise<OpenResult> {
  if (isDesktop()) {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const path = await open({ multiple: false, directory: false, filters: [{ name: 'Project', extensions: [...extensions] }] });
      if (!path || Array.isArray(path)) return { ok: false, cancelled: true, error: '' };
      return { ok: true, name: path.split(/[\/]/).pop() ?? path, text: await readTextFile(path) };
    } catch (e) {
      return { ok: false, cancelled: false, error: `Could not open the file: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = extensions.map((x) => `.${x}`).join(',');
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve({ ok: false, cancelled: true, error: '' });
      f.text().then(
        (text) => resolve({ ok: true, name: f.name, text }),
        () => resolve({ ok: false, cancelled: false, error: 'Could not read that file.' }),
      );
    };
    input.oncancel = () => resolve({ ok: false, cancelled: true, error: '' });
    input.click();
  });
}

/**
 * The fetch the Ollama client uses. In the app it is Tauri's HTTP client, whose requests come from Rust with no browser
 * origin: Ollama answers 403 to the window's own origin, but accepts a request with none. In a browser it is the page's fetch.
 */
export async function appFetch(): Promise<FetchFn> {
  if (!isDesktop()) return (input, init) => fetch(input, init);
  const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
  // an empty Origin removes the header (the plugin's unsafe-headers feature): Ollama refuses the window's own origin
  return (input, init) => tauriFetch(input, { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), Origin: '' } });
}
