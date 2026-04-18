// ─── Endpoint Routes ──────────────────────────────────────────────────────────
// GET /endpoints — filtered, paginated endpoint list (no auth material leaked)

import { Hono } from 'hono';
import { queryEndpoint } from '../models/endpoint.js';
import type { EndpointQueryOption, ModelFamily, ApiKind, Tier } from '../types.js';

const endpoint = new Hono();

const VALID_FAMILIES = new Set<string>(['gpt', 'claude', 'gemini', 'llama', 'mistral', 'qwen', 'deepseek', 'other']);
const VALID_API_KINDS = new Set<string>(['openai', 'anthropic', 'gemini', 'huggingface', 'custom']);
const VALID_TIERS = new Set<string>(['official', 'reverse', 'unknown']);

function safeInt(val: string | undefined, fallback: number, max?: number): number {
  if (!val) return fallback;
  const n = parseInt(val, 10);
  if (isNaN(n) || n < 0) return fallback;
  return max !== undefined ? Math.min(n, max) : n;
}

endpoint.get('/endpoints', (c) => {
  const q = c.req.query();

  const opts: EndpointQueryOption = { alive_only: true };
  if (q.model_family && VALID_FAMILIES.has(q.model_family)) opts.model_family = q.model_family as ModelFamily;
  if (q.api_kind && VALID_API_KINDS.has(q.api_kind)) opts.api_kind = q.api_kind as ApiKind;
  if (q.tier && VALID_TIERS.has(q.tier)) opts.tier = q.tier as Tier;
  if (q.provider) opts.provider = q.provider;
  if (q.model_detected) opts.model_detected = q.model_detected;
  if (q.free_tier_only === 'true' || q.free_tier_only === '1') opts.free_tier_only = true;
  if (q.max_latency_ms) opts.max_latency_ms = safeInt(q.max_latency_ms, 0);
  if (q.limit) opts.limit = safeInt(q.limit, 100, 1000);
  if (q.offset) opts.offset = safeInt(q.offset, 0);

  const results = queryEndpoint(opts);
  return c.json({ endpoint: results, endpoint_count: results.length });
});

export default endpoint;
