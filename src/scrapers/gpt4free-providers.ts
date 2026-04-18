// ─── gpt4free Providers Scraper ───────────────────────────────────────────────
// Gray-market: scrapes the g4f repository's Providers/ directory to extract
// base URLs of reverse-engineered public endpoints. We only keep entries that
// (a) expose an OpenAI-shaped chat completions URL and (b) don't require a key.
// Output is tier=reverse — must be probed to find what actually works.

import axios from 'axios';
import type { RawEndpoint } from '../types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('scraper:gpt4free');

const PROVIDERS_API =
  'https://api.github.com/repos/xtekky/gpt4free/contents/g4f/Provider?ref=main';

interface GhEntry {
  name: string;
  type: 'file' | 'dir';
  download_url: string | null;
}

const URL_RE = /https?:\/\/[a-z0-9.-]+(?:\:[0-9]+)?(?:\/[^\s"'`)\]]*)?/gi;
const OPENAI_PATH_HINTS = ['/chat/completions', '/v1'];

function inferApiKind(url: string): 'openai' | 'custom' {
  if (url.toLowerCase().includes('/chat/completions')) return 'openai';
  if (url.toLowerCase().includes('/v1')) return 'openai';
  return 'custom';
}

function normalizeBase(url: string): string {
  // Strip path past /v1 segment if present, else strip /chat/completions.
  const idx = url.indexOf('/chat/completions');
  if (idx !== -1) return url.slice(0, idx);
  const v1 = url.match(/^(https?:\/\/[^\s"'`)\]]+?\/v\d+)/i);
  if (v1) return v1[1];
  return url.replace(/\/+$/, '');
}

async function listProviderFiles(): Promise<Array<{ name: string; download_url: string }>> {
  const res = await axios.get<GhEntry[]>(PROVIDERS_API, {
    timeout: 15_000,
    headers: { 'User-Agent': 'brainpool/0.1', Accept: 'application/vnd.github+json' },
  });
  return (res.data ?? [])
    .filter((e): e is GhEntry & { download_url: string } =>
      e.type === 'file' && e.name.endsWith('.py') && e.download_url !== null)
    .map((e) => ({ name: e.name, download_url: e.download_url }));
}

async function fetchFile(url: string): Promise<string> {
  try {
    const res = await axios.get<string>(url, {
      timeout: 15_000,
      responseType: 'text',
      headers: { 'User-Agent': 'brainpool/0.1' },
    });
    return typeof res.data === 'string' ? res.data : '';
  } catch {
    return '';
  }
}

export async function scrape(): Promise<RawEndpoint[]> {
  try {
    const files = await listProviderFiles();
    log.info(`Enumerated ${files.length} provider files`);

    const bodies = await Promise.all(files.map((f) => fetchFile(f.download_url)));

    const endpoints: RawEndpoint[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < files.length; i++) {
      const { name } = files[i];
      const body = bodies[i];
      if (!body) continue;

      const matches = body.match(URL_RE) ?? [];
      for (const url of matches) {
        if (!OPENAI_PATH_HINTS.some((h) => url.toLowerCase().includes(h))) continue;
        const base = normalizeBase(url);
        if (seen.has(base)) continue;
        seen.add(base);
        endpoints.push({
          base_url: base,
          api_kind: inferApiKind(url),
          provider: `g4f:${name.replace(/\.py$/, '').toLowerCase()}`,
          tier: 'reverse',
          free_tier: false,
          source: 'gpt4free-providers',
        });
      }
    }

    log.info(`Extracted ${endpoints.length} gpt4free endpoint candidates`);
    return endpoints;
  } catch (err) {
    log.error('gpt4free scrape failed', { error: String(err) });
    return [];
  }
}
