// ─── HuggingFace Spaces Enumerator ────────────────────────────────────────────
// Lists public text-generation / conversational Spaces via the HF API and
// emits each as an OpenAI-compatible `/v1` candidate. Most Spaces don't
// expose `/v1/chat/completions` — but the ones running open-webui, librechat,
// openrouter-proxy, gpt4free-ts, or custom OpenAI proxies do. The validator
// sorts which respond.

import axios from 'axios';
import type { RawEndpoint } from '../types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('scraper:hf-spaces');

// Tags / pipeline_tags on HF that correlate with OpenAI-style backends
const FILTERS = [
  'conversational',
  'text-generation',
  'text-generation-inference',
];

interface HfSpace {
  id: string;            // "owner/name"
  private?: boolean;
  likes?: number;
  tags?: string[];
}

/** Convert "owner/name" → the runtime URL "owner-name.hf.space". */
function spaceHost(spaceId: string): string {
  // HF replaces "/" with "-" and lowercases, collapses repeated dashes
  const host = spaceId.replace(/\//g, '-').toLowerCase();
  return `${host}.hf.space`;
}

/** Hint whether a space is likely running an OpenAI-compatible backend. */
const OPENAI_HINT_PATTERNS = [
  /open[- ]?webui/i,
  /lobe[- ]?chat/i,
  /libre[- ]?chat/i,
  /chatgpt[- ]?next[- ]?web/i,
  /gpt4free/i,
  /openai[- ]?proxy/i,
  /openrouter[- ]?proxy/i,
  /cloud[- ]?chat/i,
  /llama[- ]?cpp[- ]?server/i,
  /vllm/i,
  /lmstudio/i,
  /ollama/i,
];

function looksOpenAiCompatible(space: HfSpace): boolean {
  const hay = `${space.id} ${(space.tags ?? []).join(' ')}`;
  return OPENAI_HINT_PATTERNS.some((p) => p.test(hay));
}

async function fetchTopSpaces(filter: string, limit: number): Promise<HfSpace[]> {
  const url = `https://huggingface.co/api/spaces?filter=${encodeURIComponent(filter)}&sort=likes&direction=-1&limit=${limit}`;
  try {
    const res = await axios.get<HfSpace[]>(url, {
      timeout: 15_000,
      headers: { 'User-Agent': 'brainpool/0.1', Accept: 'application/json' },
    });
    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    log.warn(`HF spaces fetch failed for filter=${filter}`, { error: String(err) });
    return [];
  }
}

export async function scrape(): Promise<RawEndpoint[]> {
  const all: HfSpace[] = [];
  for (const f of FILTERS) {
    const spaces = await fetchTopSpaces(f, 100);
    all.push(...spaces);
  }

  // Dedup + filter private
  const uniq = new Map<string, HfSpace>();
  for (const s of all) {
    if (!s.private && !uniq.has(s.id)) uniq.set(s.id, s);
  }
  const spaces = Array.from(uniq.values());
  log.info(`Enumerated ${spaces.length} unique public text-gen spaces`);

  // Prioritize spaces whose name / tags suggest an OpenAI backend, but keep
  // a tail of top-liked ones too — sometimes operators don't label their
  // spaces descriptively.
  const hinted = spaces.filter(looksOpenAiCompatible);
  const others = spaces.filter((s) => !looksOpenAiCompatible(s)).slice(0, 40);

  const chosen = [...hinted, ...others];

  const endpoints: RawEndpoint[] = chosen.map((s) => ({
    base_url: `https://${spaceHost(s.id)}/v1`,
    api_kind: 'openai',
    provider: `hf-space:${s.id}`,
    tier: 'reverse',
    free_tier: false,
    source: 'hf-spaces',
  }));

  log.info(`Emitted ${endpoints.length} HF Space candidates`, {
    hinted: hinted.length,
    others: Math.min(others.length, 40),
  });
  return endpoints;
}
