// ─── OpenRouter Free Models ───────────────────────────────────────────────────
// Legit free tier. Enumerates models whose pricing is $0 prompt+completion.
// Requires OPENROUTER_API_KEY for authed requests.

import axios from 'axios';
import type { RawEndpoint } from '../types.js';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('scraper:openrouter');

const BASE_URL = 'https://openrouter.ai/api/v1';

interface OrModel {
  id: string;
  pricing?: { prompt?: string; completion?: string };
  context_length?: number;
}

export async function scrape(): Promise<RawEndpoint[]> {
  if (!config.keys.openrouter) {
    log.warn('OPENROUTER_API_KEY not set — skipping');
    return [];
  }

  try {
    const res = await axios.get<{ data: OrModel[] }>(`${BASE_URL}/models`, {
      timeout: 15_000,
      headers: { Authorization: `Bearer ${config.keys.openrouter}` },
    });

    const models = res.data.data ?? [];
    const free = models.filter((m) => {
      const p = parseFloat(m.pricing?.prompt ?? '1');
      const c = parseFloat(m.pricing?.completion ?? '1');
      return p === 0 && c === 0;
    });

    const endpoints: RawEndpoint[] = free.map((m) => ({
      base_url: BASE_URL,
      api_kind: 'openai',
      provider: 'openrouter',
      auth_header: 'Authorization',
      auth_value: `Bearer ${config.keys.openrouter}`,
      model_claim: m.id,
      tier: 'official',
      free_tier: true,
      source: 'openrouter',
    }));

    log.info(`Found ${endpoints.length} free OpenRouter models`);
    return endpoints;
  } catch (err) {
    log.error('OpenRouter fetch failed', { error: String(err) });
    return [];
  }
}
