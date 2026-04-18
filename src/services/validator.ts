// ─── Validator Service ────────────────────────────────────────────────────────
// Validates AI endpoints: alive check, model detection, latency, rate-limit state.

import pLimit from 'p-limit';
import type { RawEndpoint, ValidatedEndpoint, ModelFamily } from '../types.js';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';
import { endpointId, classifyFamily } from '../utils/id.js';
import { probe } from './probe.js';

const log = createLogger('validator');

// ─── Prompts ──────────────────────────────────────────────────────────────────
// The alive prompt is tightly scoped so any LLM should emit the marker reliably.
// The model prompt is designed to elicit model self-identification.

const ALIVE_PROMPT = 'Respond with ONLY the three letters OK and nothing else.';
const ALIVE_MARKER = /\bOK\b/i;

const MODEL_PROMPT = 'What model are you? Reply with just the short model name (e.g. "gpt-4o", "claude-3-5-sonnet", "llama-3.1-70b", "gemini-1.5-pro"). No other text.';

// Known strings that appear in model self-ID responses, ordered by specificity.
const MODEL_PATTERNS: Array<{ pattern: RegExp; normalized: string; family: ModelFamily }> = [
  { pattern: /claude[- ]?3\.?5[- ]?sonnet/i, normalized: 'claude-3-5-sonnet', family: 'claude' },
  { pattern: /claude[- ]?3\.?5[- ]?haiku/i,  normalized: 'claude-3-5-haiku',  family: 'claude' },
  { pattern: /claude[- ]?3[- ]?opus/i,       normalized: 'claude-3-opus',    family: 'claude' },
  { pattern: /claude[- ]?3[- ]?sonnet/i,     normalized: 'claude-3-sonnet',  family: 'claude' },
  { pattern: /claude[- ]?3[- ]?haiku/i,      normalized: 'claude-3-haiku',   family: 'claude' },
  { pattern: /claude[- ]?4/i,                normalized: 'claude-4',          family: 'claude' },
  { pattern: /claude/i,                       normalized: 'claude',            family: 'claude' },

  { pattern: /gpt[- ]?4o[- ]?mini/i,          normalized: 'gpt-4o-mini',       family: 'gpt' },
  { pattern: /gpt[- ]?4o/i,                   normalized: 'gpt-4o',            family: 'gpt' },
  { pattern: /gpt[- ]?4[- ]?turbo/i,          normalized: 'gpt-4-turbo',       family: 'gpt' },
  { pattern: /gpt[- ]?4/i,                    normalized: 'gpt-4',             family: 'gpt' },
  { pattern: /gpt[- ]?3\.?5/i,                normalized: 'gpt-3.5-turbo',     family: 'gpt' },
  { pattern: /\bo1[- ]?mini\b/i,              normalized: 'o1-mini',           family: 'gpt' },
  { pattern: /\bo1\b/i,                       normalized: 'o1',                family: 'gpt' },
  { pattern: /\bo3\b/i,                       normalized: 'o3',                family: 'gpt' },

  { pattern: /gemini[- ]?2\.?0[- ]?flash/i,   normalized: 'gemini-2.0-flash',  family: 'gemini' },
  { pattern: /gemini[- ]?1\.?5[- ]?pro/i,     normalized: 'gemini-1.5-pro',    family: 'gemini' },
  { pattern: /gemini[- ]?1\.?5[- ]?flash/i,   normalized: 'gemini-1.5-flash',  family: 'gemini' },
  { pattern: /gemini/i,                       normalized: 'gemini',            family: 'gemini' },

  { pattern: /llama[- ]?3\.?3/i,              normalized: 'llama-3.3',         family: 'llama' },
  { pattern: /llama[- ]?3\.?1[- ]?70b/i,      normalized: 'llama-3.1-70b',     family: 'llama' },
  { pattern: /llama[- ]?3\.?1/i,              normalized: 'llama-3.1',         family: 'llama' },
  { pattern: /llama[- ]?3/i,                  normalized: 'llama-3',           family: 'llama' },
  { pattern: /llama/i,                        normalized: 'llama',             family: 'llama' },

  { pattern: /mixtral/i,                      normalized: 'mixtral',           family: 'mistral' },
  { pattern: /mistral/i,                      normalized: 'mistral',           family: 'mistral' },

  { pattern: /qwen[- ]?2\.?5/i,               normalized: 'qwen-2.5',          family: 'qwen' },
  { pattern: /qwen/i,                         normalized: 'qwen',              family: 'qwen' },

  { pattern: /deepseek[- ]?v3/i,              normalized: 'deepseek-v3',       family: 'deepseek' },
  { pattern: /deepseek/i,                     normalized: 'deepseek',          family: 'deepseek' },
];

function detectModel(text: string, modelClaim: string | undefined): { detected: string | null; family: ModelFamily } {
  const haystack = `${text}\n${modelClaim ?? ''}`;
  for (const { pattern, normalized, family } of MODEL_PATTERNS) {
    if (pattern.test(haystack)) return { detected: normalized, family };
  }
  const fallbackFamily = classifyFamily(modelClaim);
  return { detected: null, family: fallbackFamily };
}

async function withHardTimeout<T>(fn: () => Promise<T>, fallback: T, label: string): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      log.debug(`Hard timeout hit for ${label}`);
      resolve(fallback);
    }, config.validator.perEndpointHardTimeoutMs);

    fn()
      .then((result) => { clearTimeout(timer); resolve(result); })
      .catch(() => { clearTimeout(timer); resolve(fallback); });
  });
}

export async function validateEndpoint(e: RawEndpoint): Promise<ValidatedEndpoint> {
  const id = endpointId(e);
  const base: ValidatedEndpoint = {
    endpoint_id: id,
    base_url: e.base_url,
    api_kind: e.api_kind,
    provider: e.provider,
    auth_header: e.auth_header,
    auth_value: e.auth_value,
    model_claim: e.model_claim,
    alive: false,
    rate_limited: false,
    latency_ms: -1,
    ttft_ms: -1,
    free_tier: e.free_tier ?? true,
    tier: e.tier ?? 'unknown',
    source: e.source,
    last_checked: Math.floor(Date.now() / 1000),
  };

  return withHardTimeout(() => validateEndpointInner(e, base), base, id);
}

async function validateEndpointInner(e: RawEndpoint, base: ValidatedEndpoint): Promise<ValidatedEndpoint> {
  // ── Alive check ──────────────────────────────────────────────────────────
  const aliveProbe = await probe(e, { prompt: ALIVE_PROMPT, maxTokens: 8 });

  if (!aliveProbe.ok) {
    return {
      ...base,
      alive: false,
      latency_ms: aliveProbe.latency_ms,
      rate_limited: aliveProbe.rate_limited,
      last_error: aliveProbe.error ?? `http ${aliveProbe.status}`,
    };
  }

  const passedMarker = ALIVE_MARKER.test(aliveProbe.text);

  // If the marker is missing we still treat it as alive — some free endpoints are
  // heavily filtered/finetuned and don't follow short-response instructions.
  // Instead, record the fact that the response came back.

  // ── Model detection ──────────────────────────────────────────────────────
  let detectedModel: string | null = null;
  let family: ModelFamily = classifyFamily(e.model_claim);

  if (!config.validator.skipModelDetection) {
    const modelProbe = await probe(e, { prompt: MODEL_PROMPT, maxTokens: config.validator.maxResponseTokens });
    if (modelProbe.ok) {
      const det = detectModel(modelProbe.text, e.model_claim);
      detectedModel = det.detected;
      family = det.family;
    } else {
      // Fall back to the alive-probe text
      const det = detectModel(aliveProbe.text, e.model_claim);
      detectedModel = det.detected;
      family = det.family;
    }
  } else {
    const det = detectModel(aliveProbe.text, e.model_claim);
    detectedModel = det.detected;
    family = det.family;
  }

  return {
    ...base,
    alive: true,
    rate_limited: false,
    latency_ms: aliveProbe.latency_ms,
    model_detected: detectedModel ?? undefined,
    model_family: family,
    last_error: passedMarker ? undefined : 'marker_missing_but_responded',
  };
}

export type OnEndpointResult = (result: ValidatedEndpoint) => void;

export async function validateAll(
  endpoints: RawEndpoint[],
  onResult?: OnEndpointResult,
): Promise<ValidatedEndpoint[]> {
  const limit = pLimit(config.validator.concurrency);

  log.info(`Validating ${endpoints.length} endpoints`, {
    concurrency: config.validator.concurrency,
    timeout_ms: config.validator.timeoutMs,
  });

  let completed = 0;
  let aliveCount = 0;
  let rateLimitedCount = 0;
  const results: ValidatedEndpoint[] = [];

  const heartbeat = setInterval(() => {
    log.info(`Heartbeat`, {
      completed,
      total: endpoints.length,
      pct: ((completed / Math.max(1, endpoints.length)) * 100).toFixed(1) + '%',
      alive: aliveCount,
      rate_limited: rateLimitedCount,
    });
  }, 30_000);

  try {
    const tasks = endpoints.map((e) =>
      limit(async () => {
        const result = await validateEndpoint(e);
        completed++;
        if (result.alive) aliveCount++;
        if (result.rate_limited) rateLimitedCount++;
        results.push(result);

        if (onResult) onResult(result);

        if (completed % 25 === 0 || completed === endpoints.length) {
          log.info(`Progress`, {
            completed,
            total: endpoints.length,
            pct: ((completed / endpoints.length) * 100).toFixed(1) + '%',
            alive: aliveCount,
            rate_limited: rateLimitedCount,
          });
        }
      }),
    );

    const deadline = new Promise<void>((resolve) => {
      setTimeout(() => {
        log.warn(`Global validation deadline reached — returning ${results.length} results`, {
          completed, total: endpoints.length, alive: aliveCount,
        });
        resolve();
      }, config.validator.globalDeadlineMs);
    });

    await Promise.race([Promise.all(tasks), deadline]);
  } finally {
    clearInterval(heartbeat);
  }

  log.info(`Validation complete`, {
    total: results.length,
    alive: aliveCount,
    rate_limited: rateLimitedCount,
  });

  return results;
}
