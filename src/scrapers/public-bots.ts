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

// Known-good public proxies as of 2026-Q2. Expect most to be dead at any
// given time — that's what the validator is for.
const BOTS: KnownBot[] = [
  // zukijourney — Discord /v1 proxy
  { name: 'zukijourney', base_url: 'https://api.zukijourney.com/v1' },
  { name: 'zukijourney-ai', base_url: 'https://zukijourney.xyzbot.net/v1' },
  { name: 'zukijourney-unf', base_url: 'https://api.zukijourney.com/unf/v1' },
  // NagaAI
  { name: 'naga-ai', base_url: 'https://api.naga.ac/v1' },
  { name: 'naga-free', base_url: 'https://api.naga.ac/v1/free' },
  // Oxygen
  { name: 'oxygen', base_url: 'https://app.oxyapi.uk/v1' },
  { name: 'oxygen-free', base_url: 'https://app.oxyapi.uk/free/v1' },
  // ShuttleAI (free tier)
  { name: 'shuttleai', base_url: 'https://api.shuttleai.app/v1' },
  { name: 'shuttleai-alt', base_url: 'https://api.shuttleai.com/v1' },
  // ElectronHub
  { name: 'electronhub', base_url: 'https://api.electronhub.top/v1' },
  { name: 'electronhub-free', base_url: 'https://free.electronhub.top/v1' },
  // ChatAnywhere
  { name: 'chatanywhere', base_url: 'https://api.chatanywhere.tech/v1' },
  { name: 'chatanywhere-free', base_url: 'https://api.chatanywhere.com.cn/v1' },
  // ChatGPT-api (public ETH-based free tier)
  { name: 'chatgpt-ai', base_url: 'https://chatgpt-api.shn.hk/v1' },
  // Airforce
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
  // Pawan — very popular Discord bot
  { name: 'pawan', base_url: 'https://api.pawan.krd/v1' },
  { name: 'pawan-unfiltered', base_url: 'https://api.pawan.krd/unfiltered/v1' },
  // Helix / Helicone public
  { name: 'helicone', base_url: 'https://oai.helicone.ai/v1' },
  // FresedGPT
  { name: 'fresed', base_url: 'https://fresedgpt.space/v1' },
  // PurGPT
  { name: 'purgpt', base_url: 'https://purgpt.xyz/v1' },
  // DDG Chat wrapper
  { name: 'ddg', base_url: 'https://duckduckgo.com/duckchat/v1' },
  // HuggingFace Router (new 2025 OpenAI-compatible)
  { name: 'hf-router', base_url: 'https://router.huggingface.co/v1' },
  // Nexra
  { name: 'nexra', base_url: 'https://nexra.aryahcr.cc/v1' },
  // Deepinfra public proxy
  { name: 'deepinfra', base_url: 'https://api.deepinfra.com/v1/openai' },
  // Fireworks free endpoint
  { name: 'fireworks', base_url: 'https://api.fireworks.ai/inference/v1' },
  // Together AI
  { name: 'together', base_url: 'https://api.together.xyz/v1' },
  // Perplexity
  { name: 'perplexity', base_url: 'https://api.perplexity.ai' },
  // Moonshot (Chinese free tier)
  { name: 'moonshot', base_url: 'https://api.moonshot.cn/v1' },
  // Codestral / Mistral
  { name: 'mistral', base_url: 'https://api.mistral.ai/v1' },
  // Cerebras
  { name: 'cerebras', base_url: 'https://api.cerebras.ai/v1' },
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
