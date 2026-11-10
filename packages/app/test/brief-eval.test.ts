// Prompt-tuning harness against a real local model. Skipped unless OLLAMA_EVAL=1:
//   OLLAMA_EVAL=1 npx vitest run brief-eval            (set OLLAMA_MODEL to try another model)
// Eight fixed briefs, every variant; it reports how often the validator accepted the first answer, the second, or neither.
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FLAVOURS, type BriefMode, boxMetricsOf, metricsOf } from '../src/brief';
import type { Design } from '../src/model';
import { designVariant } from '../src/ollama';
import type { SystemAnswer } from '../src/brief';

const BRIEFS: { mode: BriefMode; text: string }[] = [
  { mode: 'system', text: 'A two-way PA for a 200-person room: an 18 in ported sub and 12 in tops.' },
  { mode: 'system', text: 'A compact three-way active system for a small club, about 60 people, with a horn-loaded high end.' },
  { mode: 'system', text: 'A Jamaican-style four-way sound system stack with scoop bass bins and horn mids for an outdoor dance, with plenty of bass.' },
  { mode: 'system', text: 'A single full-range speaker for a coffee shop, quiet and small.' },
  { mode: 'box', text: 'A sealed 12 in box for a studio monitor wedge.' },
  { mode: 'box', text: 'A ported box for one 15 in driver, tuned for deep bass at a dance.' },
  { mode: 'box', text: 'A band-pass subwoofer box using an 18 in driver.' },
  { mode: 'box', text: 'A small high-frequency horn for a compression driver, crossed at 2 kHz.' },
];

const MODEL = process.env.OLLAMA_MODEL ?? 'llama3.1:8b';
const cfg = { baseUrl: 'http://localhost:11434', model: MODEL };

describe.skipIf(!process.env.OLLAMA_EVAL)('real model', () => {
  it('answers the eight briefs', async () => {
    const rows: Record<string, unknown>[] = [];
    let first = 0;
    let second = 0;
    let failed = 0;
    for (const b of BRIEFS) {
      for (const f of FLAVOURS) {
        const t0 = Date.now();
        const r = await designVariant(b.mode, b.text, f, cfg);
        const secs = Math.round((Date.now() - t0) / 1000);
        if (r.ok) {
          if (r.attempts === 1) first++;
          else second++;
          const m = b.mode === 'system' ? metricsOf((r.value as SystemAnswer).project) : boxMetricsOf(r.value as Design);
          rows.push({ brief: b.text.slice(0, 40), flavour: f.id, attempts: r.attempts, secs, ...m });
        } else {
          failed++;
          rows.push({ brief: b.text.slice(0, 40), flavour: f.id, attempts: r.attempts, secs, errors: r.errors.slice(0, 3) });
        }
        console.log(JSON.stringify(rows[rows.length - 1]));
      }
    }
    const summary = { model: MODEL, first, second, failed, total: first + second + failed };
    console.log('SUMMARY ' + JSON.stringify(summary));
    if (process.env.OLLAMA_EVAL_OUT) writeFileSync(process.env.OLLAMA_EVAL_OUT, JSON.stringify({ summary, rows }, null, 2));
    expect(summary.total).toBe(24);
  }, 3_600_000);
});
