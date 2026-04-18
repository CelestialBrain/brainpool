// ─── Awesome-Free-AI Meta-source ──────────────────────────────────────────────
// Pulls URLs from a curated list of "free AI API" README files on GitHub,
// filters for OpenAI-shaped bases. Output is tier=reverse; validator sorts it.

import axios from 'axios';
import type { RawEndpoint } from '../types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('scraper:awesome-free-ai');

const SOURCES = [
  // Community-curated free AI lists. Treated as leads, not ground truth.
  'https://raw.githubusercontent.com/cheahjs/free-llm-api-resources/main/README.md',
  'https://raw.githubusercontent.com/zukixa/cool-ai-stuff/main/README.md',
];

const URL_RE = /https?:\/\/[a-z0-9.-]+(?:\:[0-9]+)?\/(?:v1|openai|api)[^\s"'`)\]]*/gi;

function normalizeBase(url: string): string {
  const stripped = url.replace(/\/chat\/completions.*$/i, '').replace(/\/+$/, '');
  const m = stripped.match(/^(https?:\/\/[^\s"'`)\]]+?\/v\d+)/i);
  return m ? m[1] : stripped;
}

export async function scrape(): Promise<RawEndpoint[]> {
  const all: RawEndpoint[] = [];
  const seen = new Set<string>();

  for (const url of SOURCES) {
    try {
      const res = await axios.get<string>(url, {
        timeout: 15_000,
        responseType: 'text',
        headers: { 'User-Agent': 'brainpool/0.1' },
      });
      const body = typeof res.data === 'string' ? res.data : '';
      const matches = body.match(URL_RE) ?? [];
      for (const m of matches) {
        const base = normalizeBase(m);
        if (seen.has(base)) continue;
        seen.add(base);
        all.push({
          base_url: base,
          api_kind: 'openai',
          provider: 'awesome-free-ai',
          tier: 'reverse',
          free_tier: false,
          source: 'awesome-free-ai',
        });
      }
      log.info(`Pulled from ${url}`, { new: matches.length });
    } catch (err) {
      log.error(`Fetch failed: ${url}`, { error: String(err) });
    }
  }

  log.info(`Total meta-source candidates: ${all.length}`);
  return all;
}
