// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Stored-data migrations. Version 1 data (browser key `...project.v1`, project files with version 1) stored the Custom
// driver as class 8, the end of the old list; version 2 gives it the fixed number CUSTOM_CLASS and uses 8 and up for new classes.
import { CUSTOM_CLASS } from './model';

/** Custom's number in version 1 data. */
export const V1_CUSTOM_CLASS = 8;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** A version 1 design with Custom renumbered; anything else is returned unchanged. */
export function migrateDesignV1(raw: unknown): unknown {
  return isObj(raw) && raw.driverClass === V1_CUSTOM_CLASS ? { ...raw, driverClass: CUSTOM_CLASS } : raw;
}

/** A version 1 project with every band's Custom driver renumbered; anything else is returned unchanged. */
export function migrateProjectV1(raw: unknown): unknown {
  if (!isObj(raw) || !Array.isArray(raw.bands)) return raw;
  return { ...raw, bands: raw.bands.map((b) => (isObj(b) ? { ...b, design: migrateDesignV1(b.design) } : b)) };
}
