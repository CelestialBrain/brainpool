// ─── Huggingface Inference (Free Serverless) ──────────────────────────────────
// Curated set of popular text-generation models served on the free serverless
// inference API. HF doesn't expose a "is this model free and up" endpoint so
// we ship a known-good list and let the validator decide which ones respond.

import type { RawEndpoint } from '../types.js';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('scraper:huggingface');

const BASE_URL = 'https://api-inference.huggingface.co/models';

const KNOWN_MODELS = [
  'meta-llama/Meta-Llama-3.1-8B-Instruct',
  'meta-llama/Llama-3.2-3B-Instruct',
  'mistralai/Mistral-7B-Instruct-v0.3',
  'mistralai/Mixtral-8x7B-Instruct-v0.1',
  'Qwen/Qwen2.5-7B-Instruct',
  'Qwen/Qwen2.5-72B-Instruct',
  'google/gemma-2-9b-it',
  'google/gemma-2-2b-it',
  'microsoft/Phi-3-mini-4k-instruct',
  'HuggingFaceH4/zephyr-7b-beta',
];

export async function scrape(): Promise<RawEndpoint[]> {
  if (!config.keys.huggingface) {
    log.warn('HUGGINGFACE_TOKEN not set — skipping');
    return [];
  }

  const endpoints: RawEndpoint[] = KNOWN_MODELS.map((m) => ({
    base_url: BASE_URL,
    api_kind: 'huggingface',
    provider: 'huggingface',
    auth_header: 'Authorization',
    auth_value: `Bearer ${config.keys.huggingface}`,
    model_claim: m,
    tier: 'official',
    free_tier: true,
    source: 'huggingface',
  }));

  log.info(`Emitted ${endpoints.length} Huggingface models`);
  return endpoints;
}
