// ─── OpenAI-Compatible Router ─────────────────────────────────────────────────
// Proxies /v1/chat/completions requests to the best matching upstream endpoint
// in the pool, with failover on 429 / 5xx / timeout.

import axios, { AxiosError } from 'axios';
import { queryEndpointInternal } from '../models/endpoint.js';
import type { EndpointRow } from '../types.js';
import { config } from '../config.js';
import { classifyFamily } from '../utils/id.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('router');

function buildHeaders(e: EndpointRow): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (e.auth_header && e.auth_value) {
    headers[e.auth_header] = e.auth_value;
  }
  if (e.api_kind === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
  }
  return headers;
}

function buildUrl(e: EndpointRow): string {
  const base = e.base_url.replace(/\/+$/, '');
  switch (e.api_kind) {
    case 'openai':
    case 'custom':
      return `${base}/chat/completions`;
    case 'anthropic':
      return `${base}/v1/messages`;
    case 'gemini': {
      const model = e.model_detected ?? e.model_claim ?? 'gemini-1.5-flash';
      const keyParam = e.auth_value && !e.auth_header ? `?key=${encodeURIComponent(e.auth_value)}` : '';
      return `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent${keyParam}`;
    }
    case 'huggingface': {
      const model = e.model_detected ?? e.model_claim ?? '';
      return `${base}/${encodeURIComponent(model)}`;
    }
  }
}

/** Convert an OpenAI-shaped request body to the target API's shape. */
function adaptPayload(e: EndpointRow, openaiBody: Record<string, unknown>): Record<string, unknown> {
  const messages = (openaiBody.messages as Array<{ role: string; content: string }> | undefined) ?? [];
  const maxTokens = (openaiBody.max_tokens as number | undefined) ?? 512;
  const temperature = (openaiBody.temperature as number | undefined) ?? 0.7;
  const model = e.model_detected ?? e.model_claim ?? (openaiBody.model as string | undefined) ?? '';

  switch (e.api_kind) {
    case 'openai':
    case 'custom':
      return { ...openaiBody, model, stream: false };
    case 'anthropic': {
      const system = messages.find((m) => m.role === 'system')?.content;
      const chat = messages.filter((m) => m.role !== 'system');
      return {
        model,
        max_tokens: maxTokens,
        temperature,
        ...(system ? { system } : {}),
        messages: chat,
      };
    }
    case 'gemini': {
      const prompt = messages.map((m) => `${m.role}: ${m.content}`).join('\n\n');
      return {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature },
      };
    }
    case 'huggingface': {
      const prompt = messages.map((m) => `${m.role}: ${m.content}`).join('\n\n');
      return {
        inputs: prompt,
        parameters: { max_new_tokens: maxTokens, temperature, return_full_text: false },
      };
    }
  }
}

/** Convert upstream response body to OpenAI chat.completion shape. */
function adaptResponse(e: EndpointRow, body: unknown): Record<string, unknown> {
  const model = e.model_detected ?? e.model_claim ?? 'unknown';

  function wrap(content: string): Record<string, unknown> {
    return {
      id: `brainpool-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }

  switch (e.api_kind) {
    case 'openai':
    case 'custom':
      // Already OpenAI-shaped
      return typeof body === 'object' && body !== null
        ? body as Record<string, unknown>
        : wrap(String(body));
    case 'anthropic': {
      const b = body as Record<string, unknown>;
      const content = Array.isArray(b.content) && b.content.length > 0
        ? (b.content[0] as Record<string, unknown>).text as string
        : '';
      return wrap(typeof content === 'string' ? content : '');
    }
    case 'gemini': {
      const b = body as Record<string, unknown>;
      const candidates = b.candidates as Array<Record<string, unknown>> | undefined;
      const parts = (candidates?.[0]?.content as Record<string, unknown> | undefined)?.parts as
        Array<Record<string, unknown>> | undefined;
      const text = parts?.[0]?.text;
      return wrap(typeof text === 'string' ? text : '');
    }
    case 'huggingface': {
      if (typeof body === 'string') return wrap(body);
      if (Array.isArray(body) && body.length > 0) {
        const t = (body[0] as Record<string, unknown>).generated_text;
        return wrap(typeof t === 'string' ? t : '');
      }
      return wrap('');
    }
  }
}

interface RouteOptions {
  model?: string;
}

export async function routeChatCompletion(
  openaiBody: Record<string, unknown>,
  opts: RouteOptions = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const requestedModel = opts.model ?? (openaiBody.model as string | undefined);
  const family = classifyFamily(requestedModel);

  // Primary candidates: exact family match (if not 'other')
  const primary = queryEndpointInternal({
    model_family: family !== 'other' ? family : undefined,
    limit: config.router.maxRetries * 3,
  });

  // Fallback candidates: universal gateways (family='other'), useful when
  // a specific family has no alive endpoints but a gpt4free-style proxy
  // accepts many models.
  const fallback = family !== 'other'
    ? queryEndpointInternal({ model_family: 'other', limit: config.router.maxRetries * 3 })
    : [];

  const seen = new Set<string>();
  const candidates = [...primary, ...fallback].filter((e) => {
    if (seen.has(e.endpoint_id)) return false;
    seen.add(e.endpoint_id);
    return true;
  });

  if (candidates.length === 0) {
    return {
      status: 503,
      body: { error: { message: `No alive endpoint for family=${family} model=${requestedModel ?? 'any'}`, type: 'no_upstream' } },
    };
  }

  let lastError: { status: number; body: Record<string, unknown> } = {
    status: 503,
    body: { error: { message: 'all upstreams failed', type: 'upstream_failure' } },
  };

  const tryCount = Math.min(config.router.maxRetries, candidates.length);
  for (let i = 0; i < tryCount; i++) {
    const e = candidates[i];
    const url = buildUrl(e);
    const headers = buildHeaders(e);
    const payload = adaptPayload(e, openaiBody);

    try {
      const res = await axios.post(url, payload, {
        headers,
        timeout: config.router.upstreamTimeoutMs,
        validateStatus: () => true,
      });

      if (res.status >= 200 && res.status < 300) {
        log.info('router hit', { provider: e.provider, model: e.model_detected, latency_ms: 'n/a' });
        return { status: 200, body: adaptResponse(e, res.data) };
      }

      lastError = {
        status: res.status,
        body: typeof res.data === 'object' && res.data !== null
          ? res.data as Record<string, unknown>
          : { error: { message: String(res.data).slice(0, 500), type: 'upstream_error' } },
      };

      if (res.status !== 429 && res.status < 500) {
        // Non-retryable client error — return immediately
        return lastError;
      }
    } catch (err) {
      const ax = err as AxiosError;
      lastError = {
        status: ax.response?.status ?? 502,
        body: { error: { message: ax.message, type: 'upstream_exception' } },
      };
    }
  }

  return lastError;
}
