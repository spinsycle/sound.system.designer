// Release guards: the version is the same in every place it is written, and the desktop shell is only allowed to do what the
// app needs (no remote HTTP, no script eval, a per-user installer).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_VERSION } from '../src/about';

const root = new URL('../../../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');
const json = (p: string): Record<string, unknown> => JSON.parse(read(p)) as Record<string, unknown>;

describe('version', () => {
  it('is one number everywhere', () => {
    const cargo = /^version = "([^"]+)"/m.exec(read('src-tauri/Cargo.toml'))![1];
    expect(json('package.json').version).toBe(APP_VERSION);
    expect(json('packages/app/package.json').version).toBe(APP_VERSION);
    expect(json('src-tauri/tauri.conf.json').version).toBe(APP_VERSION);
    expect(cargo).toBe(APP_VERSION);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('desktop shell', () => {
  const conf = json('src-tauri/tauri.conf.json') as {
    app: { security: { csp: string } };
    bundle: { targets: string[]; windows: { nsis: { installMode: string } } };
    identifier: string;
  };
  const cap = json('src-tauri/capabilities/default.json') as { windows: string[]; permissions: (string | { identifier: string; allow: { url: string }[] })[] };

  it('the installer is per user, NSIS, and licensed AGPL', () => {
    expect(conf.bundle.targets).toEqual(['nsis']);
    expect(conf.bundle.windows.nsis.installMode).toBe('currentUser');
    expect(read('src-tauri/Cargo.toml')).toContain('license = "AGPL-3.0-only"');
    expect(conf.identifier).toBe('com.spinsycle.soundsystemdesigner');
  });

  it('the content security policy keeps scripts local and allows no eval', () => {
    const csp = conf.app.security.csp;
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toMatch(/https?:\/\/(?!ipc\.localhost)/); // nothing remote
  });

  it('the window may only talk HTTP to this machine, and only read and write picked files', () => {
    const http = cap.permissions.find((p): p is { identifier: string; allow: { url: string }[] } => typeof p !== 'string' && p.identifier === 'http:default')!;
    expect(http.allow.map((a) => a.url).sort()).toEqual(['http://127.0.0.1:*/*', 'http://localhost:*/*']);
    const plain = cap.permissions.filter((p): p is string => typeof p === 'string');
    expect(plain).toEqual(['core:default', 'dialog:allow-save', 'dialog:allow-open', 'fs:allow-write-text-file', 'fs:allow-read-text-file']);
    expect(cap.windows).toEqual(['main']);
  });
});
