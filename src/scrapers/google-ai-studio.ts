// ─── Google AI Studio (Gemini) Free Tier ──────────────────────────────────────

import axios from 'axios';
import type { RawEndpoint } from '../types.js';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('scraper:google-ai-studio');

const BASE_URL = 'https://generativelanguage.googleapis.com';

interface GeminiModel {
  name: string;                      // e.g. "models/gemini-1.5-flash"
  supportedGenerationMethods?: string[];
}

export async function scrape(): Promise<RawEndpoint[]> {
  if (!config.keys.googleAiStudio) {
    log.warn('GOOGLE_AI_STUDIO_KEY not set — skipping');
    return [];
  }

  try {
    const res = await axios.get<{ models: GeminiModel[] }>(
      `${BASE_URL}/v1beta/models?key=${encodeURIComponent(config.keys.googleAiStudio)}`,
      { timeout: 15_000 },
    );

    const gen = (res.data.models ?? []).filter((m) =>
      (m.supportedGenerationMethods ?? []).includes('generateContent'),
    );

    const endpoints: RawEndpoint[] = gen.map((m) => {
      const shortId = m.name.replace(/^models\//, '');
      return {
        base_url: BASE_URL,
        api_kind: 'gemini',
        provider: 'google-ai-studio',
        auth_value: config.keys.googleAiStudio, // appended as ?key=... by probe
        model_claim: shortId,
        tier: 'official',
        free_tier: true,
        source: 'google-ai-studio',
      };
    });

    log.info(`Found ${endpoints.length} Gemini models`);
    return endpoints;
  } catch (err) {
    log.error('Google AI Studio fetch failed', { error: String(err) });
    return [];
  }
}
