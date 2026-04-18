// ─── Brainpool Configuration ──────────────────────────────────────────────────
// All config flows through this module. Env overrides for production.

export const config = {
  // ─── Server ───────────────────────────────────────────────────────────
  port: parseInt(process.env.PORT ?? '3000', 10),

  // ─── Database ─────────────────────────────────────────────────────────
  dbPath: process.env.DB_PATH ?? 'brainpool.db',

  // ─── Validator ────────────────────────────────────────────────────────
  validator: {
    concurrency: parseInt(process.env.VALIDATOR_CONCURRENCY ?? '20', 10),
    timeoutMs: parseInt(process.env.VALIDATOR_TIMEOUT_MS ?? '30000', 10),
    // Max tokens for test-prompt response — keep small
    maxResponseTokens: parseInt(process.env.VALIDATOR_MAX_TOKENS ?? '32', 10),
    // Per-endpoint hard ceiling (ms). Kills stuck validations.
    perEndpointHardTimeoutMs: parseInt(process.env.VALIDATOR_HARD_TIMEOUT_MS ?? '60000', 10),
    // Global ceiling for the whole validator shard (ms).
    globalDeadlineMs: parseInt(process.env.VALIDATOR_GLOBAL_DEADLINE_MS ?? String(50 * 60 * 1000), 10),
    // Skip the model-detection prompt (faster, less precise)
    skipModelDetection: process.env.SKIP_MODEL_DETECTION === 'true',
  },

  // ─── Scraper ─────────────────────────────────────────────────────────
  scraper: {
    maxPerSource: parseInt(process.env.MAX_PER_SOURCE ?? '0', 10), // 0 = no cap
    blacklistWindowSec: parseInt(process.env.BLACKLIST_WINDOW_SEC ?? String(3 * 60 * 60), 10),
  },

  // ─── Admin ────────────────────────────────────────────────────────────
  adminToken: process.env.ADMIN_TOKEN ?? 'dev-admin-token',

  // ─── Export ───────────────────────────────────────────────────────────
  export: {
    endpointsDir: 'endpoints',
    dataDir: 'data',
  },

  // ─── Router (OpenAI-compatible chat proxy) ────────────────────────────
  router: {
    enabled: process.env.ROUTER_ENABLED !== 'false',
    // Max number of endpoint failover attempts per request
    maxRetries: parseInt(process.env.ROUTER_MAX_RETRIES ?? '3', 10),
    // Upstream request timeout
    upstreamTimeoutMs: parseInt(process.env.ROUTER_UPSTREAM_TIMEOUT_MS ?? '60000', 10),
  },

  // ─── API keys for legit free tiers (optional — only used by scrapers that
  // need them to enumerate free models, not to validate gray endpoints). ─
  keys: {
    openrouter: process.env.OPENROUTER_API_KEY ?? '',
    groq: process.env.GROQ_API_KEY ?? '',
    googleAiStudio: process.env.GOOGLE_AI_STUDIO_KEY ?? '',
    huggingface: process.env.HUGGINGFACE_TOKEN ?? '',
    together: process.env.TOGETHER_API_KEY ?? '',
    cloudflare: process.env.CLOUDFLARE_API_TOKEN ?? '',
    cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
  },
} as const;
