// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// The two small helpers a spreadsheet import needs: split one CSV line (comma, semicolon or tab, double quotes allowed) and read a
// number (a decimal comma is accepted). The driver import itself is drivers/csv.ts.

/** Splits one CSV line; double quotes may wrap a field and contain the delimiter, "" is a quote. */
export function splitLine(line: string, d: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === d) { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

export const num = (s: string | undefined): number | undefined => {
  if (s === undefined || s.trim() === '') return undefined;
  const n = Number(s.trim().replace(',', '.')); // 0,35 from a European spreadsheet
  return Number.isFinite(n) ? n : NaN;
};
