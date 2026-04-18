// ─── Public-Bot Proxies ───────────────────────────────────────────────────────
// Curated list of known public Discord/Telegram/web chatbot proxies that
// expose OpenAI-compatible `/v1/chat/completions` endpoints. These operators
// publish their base URL and a shared key (or no key) and rely on IP rate
// limiting to stay alive. High churn — validator sorts.

import type { RawEndpoint } from '../types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('scraper:public-bots');

interface KnownBot {
  name: string;
  base_url: string;
  auth_value?: string;  // optional shared key when the operator publishes one
}

// Known-good public proxies as of 2026-Q2. Expect ~50% to be dead at any
// given time — that's what the validator is for.
const BOTS: KnownBot[] = [
  // zukijourney — Discord /v1 proxy
  { name: 'zukijourney', base_url: 'https://api.zukijourney.com/v1' },
  { name: 'zukijourney-ai', base_url: 'https://zukijourney.xyzbot.net/v1' },
  // NagaAI
  { name: 'naga-ai', base_url: 'https://api.naga.ac/v1' },
  // Oxygen
  { name: 'oxygen', base_url: 'https://app.oxyapi.uk/v1' },
  // ShuttleAI (free tier)
  { name: 'shuttleai', base_url: 'https://api.shuttleai.app/v1' },
  // ElectronHub
  { name: 'electronhub', base_url: 'https://api.electronhub.top/v1' },
  // ChatAnywhere
  { name: 'chatanywhere', base_url: 'https://api.chatanywhere.tech/v1' },
  // ChatGPT-api (public ETH-based free tier)
  { name: 'chatgpt-ai', base_url: 'https://chatgpt-api.shn.hk/v1' },
  // Airforce (already found via gpt4free but also a direct source)
  { name: 'airforce-direct', base_url: 'https://api.airforce/v1' },
  // Mandrill AI
  { name: 'mandrill', base_url: 'https://api.mandrillai.tech/v1' },
  // Heckai
  { name: 'heckai', base_url: 'https://api.heckai.weightwave.com/v1' },
  // FreeGPT shared
  { name: 'freegpt4free', base_url: 'https://freegpt4free.xyz/v1' },
  // SambaNova public demo
  { name: 'sambanova', base_url: 'https://api.sambanova.ai/v1' },
  // GitHub Models (public beta)
  { name: 'github-models', base_url: 'https://models.inference.ai.azure.com' },
];

export async function scrape(): Promise<RawEndpoint[]> {
  const endpoints: RawEndpoint[] = BOTS.map((b) => ({
    base_url: b.base_url,
    api_kind: 'openai',
    provider: `bot:${b.name}`,
    auth_value: b.auth_value,
    tier: 'reverse',
    free_tier: false,
    source: 'public-bots',
  }));

  log.info(`Emitted ${endpoints.length} known public-bot endpoints`);
  return endpoints;
}
