// ─── Groq Free Tier ───────────────────────────────────────────────────────────
// Legit free tier. All served models are free up to generous rate limits.

import axios from 'axios';
import type { RawEndpoint } from '../types.js';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('scraper:groq');

const BASE_URL = 'https://api.groq.com/openai/v1';

interface GroqModel {
  id: string;
  active?: boolean;
  context_window?: number;
}

export async function scrape(): Promise<RawEndpoint[]> {
  if (!config.keys.groq) {
    log.warn('GROQ_API_KEY not set — skipping');
    return [];
  }

  try {
    const res = await axios.get<{ data: GroqModel[] }>(`${BASE_URL}/models`, {
      timeout: 15_000,
      headers: { Authorization: `Bearer ${config.keys.groq}` },
    });

    const active = (res.data.data ?? []).filter((m) => m.active !== false);

    const endpoints: RawEndpoint[] = active.map((m) => ({
      base_url: BASE_URL,
      api_kind: 'openai',
      provider: 'groq',
      auth_header: 'Authorization',
      auth_value: `Bearer ${config.keys.groq}`,
      model_claim: m.id,
      tier: 'official',
      free_tier: true,
      source: 'groq',
    }));

    log.info(`Found ${endpoints.length} Groq models`);
    return endpoints;
  } catch (err) {
    log.error('Groq fetch failed', { error: String(err) });
    return [];
  }
}
