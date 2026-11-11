// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// A small client for a local Ollama server, and the brief-to-design runner: ask, validate strictly, retry once with the
// validator's errors, refuse after two failures. The network function is a parameter so the tests can stand in for it.
import {
  type BriefMode,
  type DesignMeta,
  type Flavour,
  type SystemAnswer,
  type Validated,
  designSchema,
  retryPrompt,
  systemPrompt,
  systemSchema,
  userPrompt,
  validateDesign,
  validateSystem,
} from './brief';
import { type CarAnswer, type SpeakerAnswer, carPrompt, carSchema, speakerPrompt, speakerSchema, validateCar, validateSpeaker } from './briefhome';
import type { Design } from './model';

export type BriefValue = (Design & Partial<DesignMeta>) | SystemAnswer | SpeakerAnswer | CarAnswer;

export const DEFAULT_URL = 'http://localhost:11434';
export const DEFAULT_MODEL = 'llama3.1:8b';
/** Answers allowed per variant: the first, and one retry with the validator's errors. */
export const MAX_ATTEMPTS = 2;

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface Config {
  baseUrl: string;
  model: string;
}

/** Only this machine is ever contacted: the brief never leaves it. */
export function localOnly(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'The Ollama address is not a valid URL.';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'The Ollama address must start with http:// or https://.';
  if (!['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return 'Only an Ollama server on this machine (localhost) is allowed: the brief is never sent anywhere else.';
  return null;
}

const base = (url: string): string => url.replace(/\/+$/, '');

export class OllamaError extends Error {}

async function call(url: string, init: RequestInit | undefined, fetchFn: FetchFn): Promise<Response> {
  const bad = localOnly(url);
  if (bad) throw new OllamaError(bad);
  let res: Response;
  try {
    res = await fetchFn(url, init);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    const why = e instanceof Error && e.message ? ` (${e.message})` : typeof e === 'string' && e ? ` (${e})` : '';
    throw new OllamaError(`Ollama is not reachable at ${new URL(url).origin}${why}. Start it (the Ollama app, or "ollama serve") and try again.`);
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = ((await res.json()) as { error?: string }).error ?? '';
    } catch {
      // no body
    }
    throw new OllamaError(`Ollama answered ${res.status}${detail ? `: ${detail}` : ''}.`);
  }
  return res;
}

/** Names of the models Ollama has, sorted. */
export async function listModels(baseUrl: string, fetchFn: FetchFn = fetch, signal?: AbortSignal): Promise<string[]> {
  const res = await call(`${base(baseUrl)}/api/tags`, { signal }, fetchFn);
  const body = (await res.json()) as { models?: { name?: unknown }[] };
  return (body.models ?? []).map((m) => m.name).filter((n): n is string => typeof n === 'string').sort();
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** One chat turn, JSON only: Ollama is given the schema so it constrains the syntax. Returns the reply text. */
export async function chatJson(cfg: Config, messages: readonly Message[], schema: Record<string, unknown>, fetchFn: FetchFn = fetch, signal?: AbortSignal): Promise<string> {
  const res = await call(
    `${base(cfg.baseUrl)}/api/chat`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: cfg.model, messages, format: schema, stream: false, options: { temperature: 0.4 } }), signal },
    fetchFn,
  );
  const body = (await res.json()) as { message?: { content?: unknown } };
  const content = body.message?.content;
  if (typeof content !== 'string') throw new OllamaError('Ollama sent no answer.');
  return content;
}

export interface Success<T> {
  ok: true;
  value: T;
  attempts: number;
}
export interface Failure {
  ok: false;
  errors: string[];
  attempts: number;
}

/** Parse and check one reply; a reply that is not JSON at all is one error. */
function check(mode: BriefMode, reply: string): Validated<BriefValue> {
  let raw: unknown;
  try {
    raw = JSON.parse(reply.trim());
  } catch {
    return { ok: false, value: null, errors: ['the reply is not valid JSON: return one JSON object and nothing else'] };
  }
  if (mode === 'speaker') return validateSpeaker(raw);
  if (mode === 'car') return validateCar(raw);
  return mode === 'system' ? validateSystem(raw) : validateDesign(raw, '$', true);
}

/** One variant: ask, validate, and on rejection ask again with the validator's errors, up to MAX_ATTEMPTS answers. */
export async function designVariant(
  mode: BriefMode,
  brief: string,
  flavour: Flavour,
  cfg: Config,
  fetchFn: FetchFn = fetch,
  signal?: AbortSignal,
): Promise<Success<BriefValue> | Failure> {
  const schema = mode === 'system' ? systemSchema() : mode === 'speaker' ? speakerSchema() : mode === 'car' ? carSchema() : designSchema(true);
  const messages: Message[] = [
    { role: 'system', content: mode === 'speaker' ? speakerPrompt() : mode === 'car' ? carPrompt() : systemPrompt(mode) },
    { role: 'user', content: userPrompt(brief, flavour) },
  ];
  let errors: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const reply = await chatJson(cfg, messages, schema, fetchFn, signal);
    const v = check(mode, reply);
    if (v.ok && v.value) return { ok: true, value: v.value, attempts: attempt };
    errors = v.errors;
    messages.push({ role: 'assistant', content: reply }, { role: 'user', content: retryPrompt(errors) });
  }
  return { ok: false, errors, attempts: MAX_ATTEMPTS };
}
