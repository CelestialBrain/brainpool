// ─── Cloudflare Workers AI (Free Tier) ────────────────────────────────────────
// Requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID.

import axios from 'axios';
import type { RawEndpoint } from '../types.js';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('scraper:cloudflare');

interface CfModel {
  name: string;        // e.g. "@cf/meta/llama-3.1-8b-instruct"
  task?: { name?: string };
}

export async function scrape(): Promise<RawEndpoint[]> {
  const { cloudflare, cloudflareAccountId } = config.keys;
  if (!cloudflare || !cloudflareAccountId) {
    log.warn('Cloudflare credentials not set — skipping');
    return [];
  }

  const baseAccount = `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/ai`;
  const v1Base = `${baseAccount}/v1`; // OpenAI-compatible endpoint

  try {
    const res = await axios.get<{ result: CfModel[] }>(
      `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/ai/models/search`,
      {
        timeout: 15_000,
        headers: { Authorization: `Bearer ${cloudflare}` },
      },
    );

    const text = (res.data.result ?? []).filter((m) =>
      (m.task?.name ?? '').toLowerCase().includes('text-generation'),
    );

    const endpoints: RawEndpoint[] = text.map((m) => ({
      base_url: v1Base,
      api_kind: 'openai',
      provider: 'cloudflare-workers-ai',
      auth_header: 'Authorization',
      auth_value: `Bearer ${cloudflare}`,
      model_claim: m.name,
      tier: 'official',
      free_tier: true,
      source: 'cloudflare-workers-ai',
    }));

    log.info(`Found ${endpoints.length} Cloudflare text-gen models`);
    return endpoints;
  } catch (err) {
    log.error('Cloudflare Workers AI fetch failed', { error: String(err) });
    return [];
  }
}
