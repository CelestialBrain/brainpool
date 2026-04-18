-- 001_init.sql
-- Initialize the endpoint table and all required indexes.
-- Idempotent — safe to run multiple times.

CREATE TABLE IF NOT EXISTS endpoint (
  endpoint_id      TEXT    PRIMARY KEY,                          -- sha1(base_url|auth_key|provider)
  base_url         TEXT    NOT NULL,                              -- e.g., https://api.openrouter.ai/v1
  api_kind         TEXT    NOT NULL CHECK (api_kind IN ('openai', 'anthropic', 'gemini', 'huggingface', 'custom')),
  provider         TEXT    NOT NULL,                              -- e.g., openrouter, groq, gpt4free-bot
  auth_header      TEXT,                                           -- e.g., Authorization
  auth_value       TEXT,                                           -- e.g., "Bearer sk-..."  (nullable = no auth / public)
  model_claim      TEXT,                                           -- what the source says it is (e.g., "gpt-4")
  model_detected   TEXT,                                           -- what validation found it to be
  model_family     TEXT,                                           -- normalized: gpt, claude, gemini, llama, mistral, qwen, other
  alive            INTEGER NOT NULL DEFAULT 0,                    -- 0 | 1
  rate_limited     INTEGER NOT NULL DEFAULT 0,                    -- 0 | 1
  latency_ms       INTEGER NOT NULL DEFAULT -1 CHECK (latency_ms >= -1),
  ttft_ms          INTEGER NOT NULL DEFAULT -1,                   -- time-to-first-token (-1 if non-streaming)
  free_tier        INTEGER NOT NULL DEFAULT 1,                    -- 0 = paid/gray, 1 = legit free tier
  tier             TEXT    NOT NULL DEFAULT 'reverse' CHECK (tier IN ('official', 'reverse', 'unknown')),
  daily_limit      INTEGER,                                        -- rpd cap if known
  context_window   INTEGER,                                        -- max context tokens if known
  last_error       TEXT,
  source           TEXT,                                           -- which scraper found it
  last_checked     INTEGER NOT NULL,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  check_count      INTEGER NOT NULL DEFAULT 0,
  alive_count      INTEGER NOT NULL DEFAULT 0,
  reliability_pct  REAL    NOT NULL DEFAULT 0.0
);

CREATE INDEX IF NOT EXISTS idx_endpoint_alive          ON endpoint (alive);
CREATE INDEX IF NOT EXISTS idx_endpoint_provider       ON endpoint (provider);
CREATE INDEX IF NOT EXISTS idx_endpoint_model_family   ON endpoint (model_family);
CREATE INDEX IF NOT EXISTS idx_endpoint_model_detected ON endpoint (model_detected);
CREATE INDEX IF NOT EXISTS idx_endpoint_api_kind       ON endpoint (api_kind);
CREATE INDEX IF NOT EXISTS idx_endpoint_tier           ON endpoint (tier);
CREATE INDEX IF NOT EXISTS idx_endpoint_last_checked   ON endpoint (last_checked);
CREATE INDEX IF NOT EXISTS idx_endpoint_latency        ON endpoint (latency_ms);

CREATE INDEX IF NOT EXISTS idx_endpoint_alive_family   ON endpoint (alive, model_family);
CREATE INDEX IF NOT EXISTS idx_endpoint_alive_provider ON endpoint (alive, provider);
CREATE INDEX IF NOT EXISTS idx_endpoint_alive_latency  ON endpoint (alive, latency_ms);
