// A6 pass condition, part two: the runner asks, validates strictly, retries once with the validator's errors and then
// refuses; the connection is local only and failures say so in plain words. The network is a stand-in.
import { describe, expect, it } from 'vitest';
import * as B from '../src/brief';
import * as O from '../src/ollama';

const cfg: O.Config = { baseUrl: 'http://localhost:11434', model: 'test-model' };
const reply = (content: string): Response => new Response(JSON.stringify({ message: { role: 'assistant', content } }), { status: 200 });
const goodBox = JSON.stringify({ label: 'Sub', note: 'A ported 18.', driver: '18 in', type: 'ported', volumeL: 200, tuneHz: 38, portDiameterCm: 12 });
const badBox = JSON.stringify({ label: 'Sub', note: 'Too big.', driver: '18 in', type: 'sealed', volumeL: 9999 });
const goodSystem = JSON.stringify({
  label: 'One way',
  note: 'A single sealed box.',
  nBands: 1,
  xoverHz: [],
  lowestHz: 50,
  distanceM: 5,
  bands: [{ design: { driver: '12 in', type: 'sealed', volumeL: 50 }, count: 1, series: 1, ampPowerW: 300, ampLoadOhm: 4, ampMinLoadOhm: 2 }],
});
const FENCE = String.fromCharCode(96).repeat(3);

/** A fetch that answers from a list in order and records the requests. */
function script(...answers: (Response | Error)[]): { fn: O.FetchFn; calls: { url: string; body: Record<string, unknown> | null }[] } {
  const calls: { url: string; body: Record<string, unknown> | null }[] = [];
  let i = 0;
  return {
    calls,
    fn: async (url, init) => {
      calls.push({ url, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null });
      const a = answers[Math.min(i++, answers.length - 1)]!;
      if (a instanceof Error) throw a;
      return a.clone();
    },
  };
}

describe('the runner', () => {
  it('a valid first answer is accepted in one attempt, and the request carries the model, schema and brief', async () => {
    const s = script(reply(goodBox));
    const r = await O.designVariant('box', 'a ported sub for a small hall', B.FLAVOURS[0], cfg, s.fn);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.attempts).toBe(1);
    expect(s.calls.length).toBe(1);
    const c = s.calls[0]!;
    expect(c.url).toBe('http://localhost:11434/api/chat');
    expect(c.body!.model).toBe('test-model');
    expect(c.body!.stream).toBe(false);
    expect((c.body!.format as { required: string[] }).required).toContain('volumeL');
    const msgs = c.body!.messages as { role: string; content: string }[];
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[1]!.content).toContain('a ported sub for a small hall');
    expect(msgs[1]!.content).toContain('Compact');
  });

  it('a rejected answer is retried once with the validator errors, and a good second answer is accepted', async () => {
    const s = script(reply(badBox), reply(goodBox));
    const r = await O.designVariant('box', 'sub', B.FLAVOURS[1], cfg, s.fn);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.attempts).toBe(2);
    const second = s.calls[1]!.body!.messages as { role: string; content: string }[];
    expect(second.length).toBe(4);
    expect(second[2]).toEqual({ role: 'assistant', content: badBox });
    expect(second[3]!.content).toContain('volumeL: 9999 is above the maximum 1000 L');
  });

  it('two bad answers are refused, with the last errors, and nothing is asked a third time', async () => {
    const s = script(reply(badBox));
    const r = await O.designVariant('box', 'sub', B.FLAVOURS[2], cfg, s.fn);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.attempts).toBe(2);
      expect(r.errors.some((e) => e.includes('volumeL'))).toBe(true);
    }
    expect(s.calls.length).toBe(2);
  });

  it('a reply that is not JSON counts as a failed attempt and is retried', async () => {
    const s = script(reply('Sure! Here is a design: ...'), reply(goodBox));
    const r = await O.designVariant('box', 'sub', B.FLAVOURS[0], cfg, s.fn);
    expect(r.ok).toBe(true);
    const second = s.calls[1]!.body!.messages as { content: string }[];
    expect(second[3]!.content).toContain('not valid JSON');
  });

  it('whitespace around the JSON is fine; a code fence is not', async () => {
    expect((await O.designVariant('box', 'x', B.FLAVOURS[0], cfg, script(reply(`\n  ${goodBox}\n`)).fn)).ok).toBe(true);
    expect((await O.designVariant('box', 'x', B.FLAVOURS[0], cfg, script(reply(`${FENCE}json\n${goodBox}\n${FENCE}`)).fn)).ok).toBe(false);
  });

  it('system mode validates a whole system and returns a levelled project', async () => {
    const r = await O.designVariant('system', 'a single box', B.FLAVOURS[0], cfg, script(reply(goodSystem)).fn);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const v = r.value as B.SystemAnswer;
      expect(v.project.nBands).toBe(1);
      expect(v.project.bands[0]!.ampPowerW).toBe(300);
    }
    const s = script(reply(goodSystem));
    await O.designVariant('system', 'a single box', B.FLAVOURS[0], cfg, s.fn);
    expect((s.calls[0]!.body!.format as { required: string[] }).required).toContain('nBands');
  });

  it('a box answer given in system mode is rejected', async () => {
    expect((await O.designVariant('system', 'x', B.FLAVOURS[0], cfg, script(reply(goodBox)).fn)).ok).toBe(false);
  });
});

describe('connection', () => {
  it('only localhost is contacted', async () => {
    expect(O.localOnly('http://localhost:11434')).toBeNull();
    expect(O.localOnly('http://127.0.0.1:11434')).toBeNull();
    expect(O.localOnly('http://[::1]:11434')).toBeNull();
    expect(O.localOnly('http://example.com:11434')).toContain('localhost');
    expect(O.localOnly('http://192.168.1.5:11434')).toContain('localhost');
    expect(O.localOnly('ftp://localhost')).toContain('http');
    expect(O.localOnly('not a url')).toContain('not a valid URL');
    const s = script(reply(goodBox));
    await expect(O.chatJson({ ...cfg, baseUrl: 'http://evil.example' }, [], {}, s.fn)).rejects.toThrow('localhost');
    expect(s.calls.length).toBe(0);
  });

  it('a trailing slash on the address is fine', async () => {
    const s = script(new Response(JSON.stringify({ models: [] })));
    await O.listModels('http://localhost:11434///', s.fn);
    expect(s.calls[0]!.url).toBe('http://localhost:11434/api/tags');
  });

  it('lists the models, sorted, ignoring odd entries', async () => {
    const s = script(new Response(JSON.stringify({ models: [{ name: 'b:1' }, { name: 'a:2' }, { nope: 1 }, { name: 5 }] })));
    expect(await O.listModels(cfg.baseUrl, s.fn)).toEqual(['a:2', 'b:1']);
    expect(await O.listModels(cfg.baseUrl, script(new Response('{}')).fn)).toEqual([]);
  });

  it('an unreachable server gives a plain message', async () => {
    await expect(O.listModels(cfg.baseUrl, script(new TypeError('fetch failed')).fn)).rejects.toThrow('Ollama is not reachable at http://localhost:11434');
    await expect(O.designVariant('box', 'x', B.FLAVOURS[0], cfg, script(new TypeError('fetch failed')).fn)).rejects.toThrow('not reachable');
  });

  it('the reason the request failed is shown, so a blocked or refused connection can be told apart', async () => {
    await expect(O.listModels(cfg.baseUrl, script(new TypeError('fetch failed')).fn)).rejects.toThrow('(fetch failed)');
    const f: O.FetchFn = async () => {
      throw 'url not allowed on the scope';
    };
    await expect(O.listModels(cfg.baseUrl, f)).rejects.toThrow('(url not allowed on the scope)');
    const g: O.FetchFn = async () => {
      throw 42;
    };
    await expect(O.listModels(cfg.baseUrl, g)).rejects.toThrow(/at http:\/\/localhost:11434\. Start it/);
  });

  it('an error status is reported with the server message', async () => {
    const r = new Response(JSON.stringify({ error: 'model "x" not found' }), { status: 404 });
    await expect(O.chatJson(cfg, [], {}, script(r).fn)).rejects.toThrow('Ollama answered 404: model "x" not found.');
    await expect(O.chatJson(cfg, [], {}, script(new Response('plain', { status: 500 })).fn)).rejects.toThrow('Ollama answered 500.');
  });

  it('an answer with no message is an error, and an abort is passed through', async () => {
    await expect(O.chatJson(cfg, [], {}, script(new Response('{}')).fn)).rejects.toThrow('no answer');
    const abort = new DOMException('stopped', 'AbortError');
    await expect(O.chatJson(cfg, [], {}, script(abort).fn)).rejects.toBe(abort);
  });
});
