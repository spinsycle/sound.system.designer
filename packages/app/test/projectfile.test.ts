// A7 pass condition: a saved project opens again exactly, and a malformed, foreign or too-new file is refused with a message.
import { describe, expect, it } from 'vitest';
import * as F from '../src/projectfile';
import * as P from '@soundsystemdesigner/physics';
import * as M from '../src/model';
import * as MG from '../src/migrate';
import * as S from '../src/system';

const roots = { ...S.applyTemplate(S.DEFAULT_PROJECT, S.TEMPLATES.findIndex((t) => t.label.includes('roots dub'))), name: 'My Rig' };

describe('saving and opening', () => {
  it('a saved project opens as the same project, apart from the page it was on', () => {
    const text = F.serializeProject(roots);
    const r = F.parseProjectFile(text);
    expect(r.ok).toBe(true);
    expect(r.error).toBe('');
    expect(r.project).toEqual({ ...roots, view: 'system', selected: 0 });
  });

  it('the file is readable JSON with a kind and a version, ending in a newline', () => {
    const text = F.serializeProject(roots);
    const j = JSON.parse(text) as { kind: string; version: number; project: S.Project };
    expect(j.kind).toBe('sound-system-designer-project');
    expect(j.version).toBe(2);
    expect(j.project.name).toBe('My Rig');
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  "kind"');
  });

  it('a project saved on the Build page opens on the System page', () => {
    const r = F.parseProjectFile(F.serializeProject({ ...roots, view: 'build', selected: 2 }));
    expect([r.project!.view, r.project!.selected]).toEqual(['system', 0]);
  });

  it('a hand-edited file is made valid, never trusted: numbers are clamped and junk is dropped', () => {
    const j = JSON.parse(F.serializeProject(roots)) as { project: Record<string, unknown> };
    j.project.distanceM = 1e9;
    j.project.nBands = 99;
    j.project.bands = 'nope';
    const r = F.parseProjectFile(JSON.stringify({ kind: F.FILE_KIND, version: 1, project: j.project }));
    expect(r.ok).toBe(true);
    expect(r.project!.distanceM).toBe(S.DISTANCE_RANGE.max);
    expect(r.project!.nBands).toBe(S.MAX_BANDS);
    expect(S.sanitizeProject(r.project)).toEqual(r.project);
  });

  it('a file name comes from the project name', () => {
    expect(F.suggestedName(roots)).toBe('my-rig.ssd.json');
    expect(F.suggestedName({ ...roots, name: '   ' })).toBe('project.ssd.json');
    expect(F.FILE_EXTENSION).toBe('.ssd.json');
  });
});

describe('files that are refused', () => {
  const refused = (text: string): string => {
    const r = F.parseProjectFile(text);
    expect(r.ok).toBe(false);
    expect(r.project).toBeNull();
    return r.error;
  };
  const wrap = (patch: Record<string, unknown>): string => JSON.stringify({ kind: F.FILE_KIND, version: 1, project: { nBands: 1 }, ...patch });

  it('not JSON', () => {
    expect(refused('hello')).toContain('not valid JSON');
    expect(refused('')).toContain('not valid JSON');
  });
  it('JSON that is not an object', () => {
    expect(refused('[1,2]')).toContain('not a project file');
    expect(refused('5')).toContain('not a project file');
    expect(refused('null')).toContain('not a project file');
  });
  it('a different kind of file, or none', () => {
    expect(refused(wrap({ kind: 'something-else' }))).toContain('not a Sound System Designer project');
    expect(refused(JSON.stringify({ version: 1, project: {} }))).toContain('not a Sound System Designer project');
  });
  it('a missing, fractional or zero version', () => {
    expect(refused(wrap({ version: undefined }))).toContain('no valid version');
    expect(refused(wrap({ version: 1.5 }))).toContain('no valid version');
    expect(refused(wrap({ version: 0 }))).toContain('no valid version');
    expect(refused(wrap({ version: '1' }))).toContain('no valid version');
  });
  it('a newer version says to update the app', () => {
    const e = refused(wrap({ version: 3 }));
    expect(e).toContain('newer version');
    expect(e).toContain('file version 3');
    expect(e).toContain('up to 2');
  });
  it('no project inside', () => {
    expect(refused(wrap({ project: undefined }))).toContain('no project');
    expect(refused(wrap({ project: [1] }))).toContain('no project');
    expect(refused(wrap({ project: 'x' }))).toContain('no project');
    expect(refused(wrap({ project: null }))).toContain('no project');
  });
  it('a file far larger than any project', () => {
    expect(refused('x'.repeat(F.MAX_FILE_BYTES + 1))).toContain('too large');
    expect(F.parseProjectFile(wrap({})).ok).toBe(true);
  });
});

describe('version 1 files and stored data (H1: Custom is a fixed number)', () => {
  const custom = { ...M.DEFAULT_DESIGN.custom, fsHz: 77, qts: 0.31 };
  const withClass = (driverClass: number): Record<string, unknown> => ({ nBands: 1, bands: [{ design: { driverClass, custom } }] });
  const open = (version: number, driverClass: number): M.Design => F.parseProjectFile(JSON.stringify({ kind: F.FILE_KIND, version, project: withClass(driverClass) })).project!.bands[0]!.design;

  it('a version 1 file with Custom (class 8) opens as Custom with its values', () => {
    const d = open(1, 8);
    expect(d.driverClass).toBe(M.CUSTOM_CLASS);
    expect(d.custom.fsHz).toBe(77);
    expect(d.custom.qts).toBe(0.31);
  });
  it('a version 1 file keeps its other classes', () => {
    for (const c of [0, 3, 7]) expect(open(1, c).driverClass).toBe(c);
  });
  it('in a version 2 file class 8 is the first new class, not Custom', () => {
    expect(open(2, 8).driverClass).toBe(8);
    expect(M.driverOf(open(2, 8)).name).toBe('3 in');
    expect(open(2, M.CUSTOM_CLASS).driverClass).toBe(M.CUSTOM_CLASS);
  });
  it('browser storage migrations leave other shapes alone', () => {
    expect(MG.migrateProjectV1(null)).toBeNull();
    expect(MG.migrateProjectV1({ bands: 3 })).toEqual({ bands: 3 });
    expect(MG.migrateProjectV1({ bands: [null, { design: 5 }] })).toEqual({ bands: [null, { design: 5 }] });
    expect(MG.migrateDesignV1({ driverClass: 8 })).toEqual({ driverClass: M.CUSTOM_CLASS });
    expect(MG.migrateDesignV1({ driverClass: 2 })).toEqual({ driverClass: 2 });
    expect(MG.migrateDesignV1(undefined)).toBeUndefined();
  });
});

describe('class numbers are made valid', () => {
  const n = P.ALL_DRIVER_CLASSES.length;
  it('the last class is kept, one past it and beyond is Custom, below zero is the first class', () => {
    expect(M.sanitize({ driverClass: n - 1 }).driverClass).toBe(n - 1);
    expect(M.sanitize({ driverClass: n }).driverClass).toBe(M.CUSTOM_CLASS);
    expect(M.sanitize({ driverClass: -3 }).driverClass).toBe(0);
    expect(M.sanitize({ driverClass: 2.5 }).driverClass).toBe(M.DEFAULT_DESIGN.driverClass);
    expect(M.driverOf({ ...M.DEFAULT_DESIGN, driverClass: n - 1 }).name).toBe('6x9 coax');
    expect(M.driverOf({ ...M.DEFAULT_DESIGN, driverClass: n }).name).toBe('Custom');
  });
});
