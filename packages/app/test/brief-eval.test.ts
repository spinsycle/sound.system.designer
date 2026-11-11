// Prompt-tuning harness against a real local model. Skipped unless OLLAMA_EVAL=1:
//   OLLAMA_EVAL=1 npx vitest run brief-eval            (set OLLAMA_MODEL to try another model)
// Sixteen fixed briefs (eight PA and box, four home speaker, four car), every variant; it reports how often the validator accepted the first answer, the second, or neither.
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FLAVOURS, type BriefMode, boxMetricsOf, metricsOf } from '../src/brief';
import type { Design } from '../src/model';
import { designVariant } from '../src/ollama';
import type { SystemAnswer } from '../src/brief';
import { type CarAnswer, type SpeakerAnswer, carMetricsOf, speakerMetricsOf } from '../src/briefhome';

const ALL: { mode: BriefMode; text: string }[] = [
  { mode: 'system', text: 'A two-way PA for a 200-person room: an 18 in ported sub and 12 in tops.' },
  { mode: 'system', text: 'A compact three-way active system for a small club, about 60 people, with a horn-loaded high end.' },
  { mode: 'system', text: 'A Jamaican-style four-way sound system stack with scoop bass bins and horn mids for an outdoor dance, with plenty of bass.' },
  { mode: 'system', text: 'A single full-range speaker for a coffee shop, quiet and small.' },
  { mode: 'box', text: 'A sealed 12 in box for a studio monitor wedge.' },
  { mode: 'box', text: 'A ported box for one 15 in driver, tuned for deep bass at a dance.' },
  { mode: 'box', text: 'A band-pass subwoofer box using an 18 in driver.' },
  { mode: 'box', text: 'A small high-frequency horn for a compression driver, crossed at 2 kHz.' },
  { mode: 'speaker', text: 'A small desktop speaker pair for a computer desk, sealed, about 14 cm wide.' },
  { mode: 'speaker', text: 'A slim floorstanding MTM tower for a living room, ported, about 100 cm tall.' },
  { mode: 'speaker', text: 'A three-way floorstander with a 10 in woofer for a big room, plenty of bass.' },
  { mode: 'speaker', text: 'A bookshelf 2.5-way speaker with two 5.25 in woofers and a dome tweeter.' },
  { mode: 'car', text: 'A single 12 in sealed sub in a sedan trunk, about 500 W, tight and musical.' },
  { mode: 'car', text: 'Two 10 in subs in a ported box for a hatchback, about 1000 W, loud.' },
  { mode: 'car', text: 'A shallow 10 in sub under the seat of a pickup truck, small and quiet, no fronts.' },
  { mode: 'car', text: 'A 12 in sub in a sedan trunk plus component door speakers, 6.5 in, a balanced daily system.' },
];

// OLLAMA_EVAL_MODES=speaker,car runs only those modes
const MODES = process.env.OLLAMA_EVAL_MODES?.split(',');
const BRIEFS = MODES ? ALL.filter((b) => MODES.includes(b.mode)) : ALL;
const MODEL = process.env.OLLAMA_MODEL ?? 'llama3.1:8b';
const cfg = { baseUrl: 'http://localhost:11434', model: MODEL };

describe.skipIf(!process.env.OLLAMA_EVAL)('real model', () => {
  it('answers the sixteen briefs', async () => {
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
          const m = b.mode === 'system' ? metricsOf((r.value as SystemAnswer).project) : b.mode === 'speaker' ? speakerMetricsOf((r.value as SpeakerAnswer).speaker) : b.mode === 'car' ? carMetricsOf((r.value as CarAnswer).car) : boxMetricsOf(r.value as Design);
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
    expect(summary.total).toBe(BRIEFS.length * 3);
  }, 3_600_000);
});
