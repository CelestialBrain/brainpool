// ─── Endpoint ID Helpers ──────────────────────────────────────────────────────

import { createHash } from 'crypto';
import type { RawEndpoint, ModelFamily } from '../types.js';

/** Stable key for an endpoint: base_url + auth presence + provider. */
export function endpointId(e: Pick<RawEndpoint, 'base_url' | 'auth_value' | 'provider'>): string {
  const key = `${e.base_url.toLowerCase().trim()}|${e.auth_value ?? ''}|${e.provider}`;
  return createHash('sha1').update(key).digest('hex').slice(0, 16);
}

/** Normalize a model string to one of the known families. */
export function classifyFamily(model: string | undefined | null): ModelFamily {
  if (!model) return 'other';
  const m = model.toLowerCase();
  if (m.includes('gpt') || m.includes('o1') || m.includes('o3') || m.includes('o4') || m.includes('openai')) return 'gpt';
  if (m.includes('claude') || m.includes('anthropic')) return 'claude';
  if (m.includes('gemini') || m.includes('bard') || m.includes('palm')) return 'gemini';
  if (m.includes('llama')) return 'llama';
  if (m.includes('mistral') || m.includes('mixtral')) return 'mistral';
  if (m.includes('qwen')) return 'qwen';
  if (m.includes('deepseek')) return 'deepseek';
  return 'other';
}
