// ─── Scraper Index ────────────────────────────────────────────────────────────
// Runs all source fetchers in parallel, deduplicates by endpoint_id.

import { scrape as openrouter } from './openrouter.js';
import { scrape as groq } from './groq.js';
import { scrape as googleAiStudio } from './google-ai-studio.js';
import { scrape as huggingface } from './huggingface.js';
import { scrape as cloudflare } from './cloudflare-workers-ai.js';
import { scrape as gpt4free } from './gpt4free-providers.js';
import { scrape as awesomeFreeAi } from './awesome-free-ai.js';
import { scrape as publicBots } from './public-bots.js';

import type { RawEndpoint } from '../types.js';
import { config } from '../config.js';
import { endpointId } from '../utils/id.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('scrapers');

const scrapers = [
  { name: 'openrouter', fn: openrouter },
  { name: 'groq', fn: groq },
  { name: 'google-ai-studio', fn: googleAiStudio },
  { name: 'huggingface', fn: huggingface },
  { name: 'cloudflare-workers-ai', fn: cloudflare },
  { name: 'gpt4free-providers', fn: gpt4free },
  { name: 'awesome-free-ai', fn: awesomeFreeAi },
  { name: 'public-bots', fn: publicBots },
];

export async function scrapeAll(): Promise<RawEndpoint[]> {
  const MAX_PER_SOURCE = config.scraper.maxPerSource;

  const results = await Promise.allSettled(scrapers.map((s) => s.fn()));
  const all: RawEndpoint[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      let endpoints = result.value;
      if (MAX_PER_SOURCE > 0 && endpoints.length > MAX_PER_SOURCE) {
        log.warn(`Source ${scrapers[i].name} returned ${endpoints.length} — capping at ${MAX_PER_SOURCE}`);
        endpoints = endpoints.slice(0, MAX_PER_SOURCE);
      }
      log.info(`Source ${scrapers[i].name}: ${endpoints.length} endpoints`);
      for (const e of endpoints) all.push(e);
    } else {
      log.error(`Source ${scrapers[i].name} failed`, { reason: String(result.reason) });
    }
  }

  // Deduplicate by endpoint_id — first-seen wins
  const seen = new Map<string, RawEndpoint>();
  for (const e of all) {
    const id = endpointId(e);
    if (!seen.has(id)) seen.set(id, e);
  }

  const deduped = Array.from(seen.values());
  log.info(`Total after dedup: ${deduped.length} (from ${all.length} raw)`);
  return deduped;
}
