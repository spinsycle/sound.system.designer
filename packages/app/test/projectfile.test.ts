// A7 pass condition: a saved project opens again exactly, and a malformed, foreign or too-new file is refused with a message.
import { describe, expect, it } from 'vitest';
import * as F from '../src/projectfile';
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
    expect(j.version).toBe(1);
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
    const e = refused(wrap({ version: 2 }));
    expect(e).toContain('newer version');
    expect(e).toContain('file version 2');
    expect(e).toContain('up to 1');
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
