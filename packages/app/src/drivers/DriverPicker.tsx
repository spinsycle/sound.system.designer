// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The one driver chooser used on the box, home-speaker and car pages: your favourites first, then your own drivers, then the generic
// classes, then Custom. Choosing a database driver copies it into the design; "Update from the library" re-copies it after the
// driver was edited on the Drivers page.
import { ALL_DRIVER_CLASSES } from '@soundsystemdesigner/physics';
import { CUSTOM_CLASS, type Design } from '../model';
import type { DriverKind } from './entry';
import type { DriverDb } from './library';
import { libraryMissing, libraryUpdate, patchFor, pickLists, valueOf } from './pick';

export interface ClassGroup {
  label: string;
  /** Class indices, in the order listed. */
  classes: number[];
}

export function DriverPicker(p: { id: string; design: Design; db: DriverDb; onChange: (patch: Partial<Design>) => void; groups?: ClassGroup[]; label?: string; kinds?: readonly DriverKind[]; allowCustom?: boolean }) {
  const { design: d, db } = p;
  const groups = p.groups ?? [{ label: 'Generic classes', classes: ALL_DRIVER_CLASSES.map((_, i) => i) }];
  // a generic driver is offered only if its class is in the lists shown (the car's fronts allow just a few)
  const { favourites, mine } = pickLists(db, p.kinds, new Set(groups.flatMap((g) => g.classes)));
  const value = valueOf(d);
  const update = libraryUpdate(d, db);
  const missing = libraryMissing(d, db);
  const genericIndex = (id: string): string => `class:${id.slice('generic-'.length)}`;
  return (
    <>
      <div className="field">
        <label htmlFor={p.id}>{p.label ?? 'Driver'}</label>
        <select
          id={p.id}
          value={value}
          onChange={(e) => {
            const patch = patchFor(e.target.value, db);
            if (patch) p.onChange(patch);
          }}
        >
          {missing && d.libDriver && <option value={value}>{d.libDriver.name} (not in your library)</option>}
          {favourites.length > 0 && (
            <optgroup label="Favourites">
              {favourites.map((e) => (
                <option key={`f-${e.id}`} value={e.source === 'generic' ? genericIndex(e.id) : `lib:${e.id}`}>
                  {e.name}
                </option>
              ))}
            </optgroup>
          )}
          {mine.length > 0 && (
            <optgroup label="My drivers">
              {mine.map((e) => (
                <option key={e.id} value={`lib:${e.id}`}>
                  {e.name}
                </option>
              ))}
            </optgroup>
          )}
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.classes.map((i) => (
                <option key={ALL_DRIVER_CLASSES[i]!.name} value={`class:${i}`}>
                  {ALL_DRIVER_CLASSES[i]!.name}
                </option>
              ))}
            </optgroup>
          ))}
          {(p.allowCustom ?? true) && <option value="custom">Custom</option>}
        </select>
      </div>
      {update && (
        <p className="hint" role="status">
          The library has different numbers for {update.name}.{' '}
          <button type="button" onClick={() => p.onChange({ driverClass: CUSTOM_CLASS, libDriver: update })}>
            Update from the library
          </button>
        </p>
      )}
      {missing && <p className="hint">This driver is not in your library (deleted, or the project came from another computer). The design keeps its own copy of the numbers.</p>}
    </>
  );
}
