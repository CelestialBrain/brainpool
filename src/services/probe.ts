// ─── Low-level Probe ──────────────────────────────────────────────────────────
// Send a test prompt through an endpoint in its native API kind and return
// the assistant text + latency. No interpretation — just transport.

import axios, { AxiosError } from 'axios';
import type { ApiKind, RawEndpoint } from '../types.js';
import { config } from '../config.js';

export interface ProbeResult {
  ok: boolean;
  status: number;
  latency_ms: number;
  text: string;          // assistant output or error payload
  rate_limited: boolean;
  error?: string;
}

interface ProbeOptions {
  model?: string;
  prompt: string;
  maxTokens?: number;
  timeoutMs?: number;
}

function buildHeaders(e: Pick<RawEndpoint, 'auth_header' | 'auth_value' | 'api_kind'>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'brainpool/0.1 (+https://github.com)',
  };
  if (e.auth_header && e.auth_value) {
    headers[e.auth_header] = e.auth_value;
  }
  // Google's Gemini key goes in URL query, not headers — handled per-branch
  return headers;
}

function extractOpenAiText(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const b = body as Record<string, unknown>;
  const choices = b.choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const c0 = choices[0] as Record<string, unknown>;
  const msg = c0.message as Record<string, unknown> | undefined;
  const content = msg?.content ?? c0.text;
  return typeof content === 'string' ? content : '';
}

function extractAnthropicText(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const b = body as Record<string, unknown>;
  const content = b.content;
  if (!Array.isArray(content) || content.length === 0) return '';
  const c0 = content[0] as Record<string, unknown>;
  return typeof c0.text === 'string' ? c0.text : '';
}

function extractGeminiText(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const b = body as Record<string, unknown>;
  const candidates = b.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return '';
  const c0 = candidates[0] as Record<string, unknown>;
  const content = c0.content as Record<string, unknown> | undefined;
  const parts = content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return '';
  const p0 = parts[0] as Record<string, unknown>;
  return typeof p0.text === 'string' ? p0.text : '';
}

function extractHuggingfaceText(body: unknown): string {
  if (typeof body === 'string') return body;
  if (Array.isArray(body) && body.length > 0) {
    const b0 = body[0] as Record<string, unknown>;
    if (typeof b0.generated_text === 'string') return b0.generated_text;
  }
  if (typeof body === 'object' && body !== null) {
    const b = body as Record<string, unknown>;
    if (typeof b.generated_text === 'string') return b.generated_text;
  }
  return '';
}

/** Build the request body for a given API kind. */
function buildPayload(kind: ApiKind, model: string, prompt: string, maxTokens: number): Record<string, unknown> {
  switch (kind) {
    case 'openai':
      return {
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0,
        stream: false,
      };
    case 'anthropic':
      return {
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
      };
    case 'gemini':
      return {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0 },
      };
    case 'huggingface':
      return {
        inputs: prompt,
        parameters: { max_new_tokens: maxTokens, temperature: 0.01, return_full_text: false },
      };
    case 'custom':
      return { model, prompt, max_tokens: maxTokens };
  }
}

/** Build the full request URL for an endpoint + model. */
function buildUrl(e: RawEndpoint, model: string): string {
  const base = e.base_url.replace(/\/+$/, '');
  switch (e.api_kind) {
    case 'openai': return `${base}/chat/completions`;
    case 'anthropic': return `${base}/v1/messages`;
    case 'gemini': {
      // model path-param, key can be in auth_value as "?key=..." or appended
      const keyParam = e.auth_value && !e.auth_header ? `?key=${encodeURIComponent(e.auth_value)}` : '';
      return `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent${keyParam}`;
    }
    case 'huggingface': return `${base}/${encodeURIComponent(model)}`;
    case 'custom': return `${base}/chat/completions`;
  }
}

function extractText(kind: ApiKind, body: unknown): string {
  switch (kind) {
    case 'openai':
    case 'custom':
      return extractOpenAiText(body);
    case 'anthropic':
      return extractAnthropicText(body);
    case 'gemini':
      return extractGeminiText(body);
    case 'huggingface':
      return extractHuggingfaceText(body);
  }
}

export async function probe(e: RawEndpoint, opts: ProbeOptions): Promise<ProbeResult> {
  const model = opts.model ?? e.model_claim ?? 'gpt-3.5-turbo';
  const maxTokens = opts.maxTokens ?? config.validator.maxResponseTokens;
  const timeoutMs = opts.timeoutMs ?? config.validator.timeoutMs;

  const url = buildUrl(e, model);
  const headers = buildHeaders(e);
  const payload = buildPayload(e.api_kind, model, opts.prompt, maxTokens);

  // Anthropic requires a specific header
  if (e.api_kind === 'anthropic' && !headers['anthropic-version']) {
    headers['anthropic-version'] = '2023-06-01';
  }

  const start = Date.now();
  try {
    const res = await axios.post(url, payload, {
      headers,
      timeout: timeoutMs,
      validateStatus: () => true,
    });
    const latency = Date.now() - start;
    const text = extractText(e.api_kind, res.data);

    const rateLimited = res.status === 429
      || (typeof res.data === 'object' && res.data !== null
          && JSON.stringify(res.data).toLowerCase().includes('rate'));

    if (res.status < 200 || res.status >= 300 || text.length === 0) {
      return {
        ok: false,
        status: res.status,
        latency_ms: latency,
        text: typeof res.data === 'string' ? res.data.slice(0, 500) : JSON.stringify(res.data).slice(0, 500),
        rate_limited: rateLimited,
        error: `http ${res.status}`,
      };
    }

    return { ok: true, status: res.status, latency_ms: latency, text, rate_limited: false };
  } catch (err) {
    const latency = Date.now() - start;
    const ax = err as AxiosError;
    return {
      ok: false,
      status: ax.response?.status ?? 0,
      latency_ms: latency,
      text: '',
      rate_limited: ax.response?.status === 429,
      error: ax.code ?? String(err).slice(0, 200),
    };
  }
}
