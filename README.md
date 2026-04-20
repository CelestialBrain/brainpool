# Brainpool

<!-- BADGES_START -->
![Alive](https://img.shields.io/badge/alive-2-brightgreen)
![Endpoints](https://img.shields.io/badge/endpoints-112-blue)
![Rate Limited](https://img.shields.io/badge/rate--limited-4-orange)
![Avg Latency](https://img.shields.io/badge/avg--latency-582ms-yellow)
![Reliability](https://img.shields.io/badge/reliability-1.8%25-purple)
![Updated](https://img.shields.io/badge/updated-2026--04--20-lightgrey)
<!-- BADGES_END -->

**Global free AI API endpoint pool. Self-maintaining, aggregated, open.**

Brainpool aggregates free AI endpoints from 7 sources (5 legitimate free-tier providers + 2 gray-market meta-sources), validates every one for liveness, model identity, latency, and rate-limit state, then exports curated lists and serves them via an OpenAI-compatible REST API with failover routing. Runs every 20 minutes on GitHub Actions using 12 parallel validation runners.

---

## Pipeline

```
SCRAPE (1 runner, ~15s)
  7 sources → dedup → inject alive endpoints from DB → blacklist dead
    │
    ├── SHARD 0  ──┐
    ├── SHARD 1    │
    ├── ...        │  12 runners validate in parallel
    └── SHARD 11 ──┘  alive + model-detect + latency + rate-limit state
    │
MERGE (1 runner, ~15s)
  combine shards → store to DB → export files → commit
```

**Warm runs:** ~3-8 min. **Every 20 minutes. $0 cost (public repo).**

---

## Sources

Counts from latest pipeline run (auto-updated).

### Legitimate free tiers (`tier=official`)

| Source | What it provides | Requires |
|--------|------------------|----------|
| OpenRouter | All models with pricing `$0/$0` | `OPENROUTER_API_KEY` |
| Groq | Full active model list, generous free rate limits | `GROQ_API_KEY` |
| Google AI Studio | All Gemini models that support `generateContent` | `GOOGLE_AI_STUDIO_KEY` |
| Huggingface Inference | Curated set of serverless text-gen models | `HUGGINGFACE_TOKEN` |
| Cloudflare Workers AI | Text-generation models under `@cf/` | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` |

### Gray-market meta-sources (`tier=reverse`)

| Source | What it provides |
|--------|------------------|
| gpt4free-providers | Base URLs extracted from `xtekky/gpt4free`'s `g4f/Provider/` directory |
| awesome-free-ai | URLs scraped from community-curated free-AI README files (cheahjs, zukixa) |

Gray-market endpoints are probed on every run. Ones that respond are promoted into the live pool; ones that consistently fail fall into the blacklist window.

---

## Validation

Every endpoint gets a configurable hard timeout (60s default) and these checks:

| Check | What it does |
|-------|-------------|
| **Alive** | Sends a short prompt (`"Respond with ONLY the three letters OK"`) through the endpoint's native API shape (OpenAI / Anthropic / Gemini / Huggingface) |
| **Latency** | Round-trip time for the alive probe in milliseconds |
| **Model detection** | Sends `"What model are you?"` and regex-matches 30+ known model names to normalize identity |
| **Family classification** | Buckets into `gpt`, `claude`, `gemini`, `llama`, `mistral`, `qwen`, `deepseek`, or `other` |
| **Rate-limit state** | HTTP 429 + body-text heuristics flag `rate_limited=1` |
| **Shape adaptation** | Requests/responses translated per API kind so the router exposes a uniform OpenAI interface |

---

## Endpoint Files

Updated every 20 minutes via GitHub Actions. All files are JSONL — one endpoint per line — and intentionally exclude `auth_value` so they are safe to publish.

### By Family
| File | Description |
|------|-------------|
| [`endpoints/by-family/gpt.jsonl`](endpoints/by-family/gpt.jsonl) | GPT-family (gpt-3.5, gpt-4, gpt-4o, o1, o3, …) |
| [`endpoints/by-family/claude.jsonl`](endpoints/by-family/claude.jsonl) | Anthropic Claude models |
| [`endpoints/by-family/gemini.jsonl`](endpoints/by-family/gemini.jsonl) | Google Gemini models |
| [`endpoints/by-family/llama.jsonl`](endpoints/by-family/llama.jsonl) | Meta Llama models |
| [`endpoints/by-family/mistral.jsonl`](endpoints/by-family/mistral.jsonl) | Mistral / Mixtral |
| [`endpoints/by-family/qwen.jsonl`](endpoints/by-family/qwen.jsonl) | Alibaba Qwen |
| [`endpoints/by-family/deepseek.jsonl`](endpoints/by-family/deepseek.jsonl) | DeepSeek |
| [`endpoints/by-family/other.jsonl`](endpoints/by-family/other.jsonl) | Everything else |

### By Provider
| File | Description |
|------|-------------|
| [`endpoints/by-provider/openrouter.jsonl`](endpoints/by-provider/openrouter.jsonl) | OpenRouter free models |
| [`endpoints/by-provider/groq.jsonl`](endpoints/by-provider/groq.jsonl) | Groq free tier |
| [`endpoints/by-provider/google-ai-studio.jsonl`](endpoints/by-provider/google-ai-studio.jsonl) | Google AI Studio |
| [`endpoints/by-provider/huggingface.jsonl`](endpoints/by-provider/huggingface.jsonl) | Huggingface Inference |
| [`endpoints/by-provider/cloudflare-workers-ai.jsonl`](endpoints/by-provider/cloudflare-workers-ai.jsonl) | Cloudflare Workers AI |
| + `g4f:<provider>.jsonl` per gpt4free provider | |

### By Tier
| File | Description |
|------|-------------|
| [`endpoints/by-tier/official.jsonl`](endpoints/by-tier/official.jsonl) | Legit free tiers |
| [`endpoints/by-tier/reverse.jsonl`](endpoints/by-tier/reverse.jsonl) | Reverse-engineered / gray-market |

### Flat files
| File | Description |
|------|-------------|
| [`endpoints/all.jsonl`](endpoints/all.jsonl) | Every endpoint validated this run |
| [`endpoints/alive.jsonl`](endpoints/alive.jsonl) | Alive on last check |
| [`endpoints/rate-limited.jsonl`](endpoints/rate-limited.jsonl) | Responded 429 on last check |

### Structured Data
| File | Description |
|------|-------------|
| [`data/endpoints.json`](data/endpoints.json) | Full alive pool with all public metadata |
| [`data/stats.json`](data/stats.json) | Pool health with source quality metrics |

---

## API

REST API on port 3000. Rate limited to 60 req/min per IP.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health |
| `/endpoints` | GET | Filtered endpoint list. Params: `model_family`, `api_kind`, `tier`, `provider`, `model_detected`, `free_tier_only`, `max_latency_ms`, `limit`, `offset` |
| `/stats` | GET | Pool health, family/provider/tier breakdowns |
| `/v1/chat/completions` | POST | OpenAI-compatible chat proxy. Picks best live upstream for requested `model`, fails over on 429 / 5xx |
| `/v1/models` | GET | OpenAI-compatible model list stub |

The router translates between the OpenAI chat schema and the target upstream's schema (Anthropic messages, Gemini generateContent, Huggingface inputs) so clients pointed at Brainpool can talk to any backend transparently.

---

## Pool Statistics

<!-- STATS_START -->
| Metric | Value |
| --- | --- |
| Total endpoints | 112 |
| Alive endpoints | 2 |
| Rate-limited | 4 |
| Avg latency | 582 ms |
| Avg reliability | 1.8% |
| Last updated | 2026-04-20T00:36:03.000Z |
<!-- STATS_END -->

---

## Quick Start

```bash
npm install
npm run pipeline:scrape    # phase 1: scrape only
npm run pipeline:validate  # phase 2: validate a shard
npm run pipeline:merge     # phase 3: merge results
npm run dev                # API server (hot reload)
npm start                  # API server
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VALIDATOR_CONCURRENCY` | `20` | Parallel endpoint probes |
| `VALIDATOR_TIMEOUT_MS` | `30000` | Per-request axios timeout |
| `VALIDATOR_MAX_TOKENS` | `32` | `max_tokens` for probe responses |
| `VALIDATOR_HARD_TIMEOUT_MS` | `60000` | Hard per-endpoint ceiling |
| `VALIDATOR_GLOBAL_DEADLINE_MS` | `3000000` (50 min) | Whole-shard ceiling |
| `SKIP_MODEL_DETECTION` | `false` | Skip the "what model are you?" probe |
| `MAX_PER_SOURCE` | `0` (no cap) | Cap endpoints per source |
| `BLACKLIST_WINDOW_SEC` | `10800` | Skip dead endpoints checked within 3h |
| `ROUTER_ENABLED` | `true` | Mount `/v1/chat/completions` on the server |
| `ROUTER_MAX_RETRIES` | `3` | Failover attempts per chat request |
| `ROUTER_UPSTREAM_TIMEOUT_MS` | `60000` | Per-upstream timeout |
| `OPENROUTER_API_KEY` | — | Enables OpenRouter scraper |
| `GROQ_API_KEY` | — | Enables Groq scraper |
| `GOOGLE_AI_STUDIO_KEY` | — | Enables Gemini scraper |
| `HUGGINGFACE_TOKEN` | — | Enables Huggingface scraper |
| `CLOUDFLARE_API_TOKEN` / `ACCOUNT_ID` | — | Enables Workers AI scraper |
| `ADMIN_TOKEN` | `dev-admin-token` | Admin endpoint auth |

---

## Architecture

### GitHub Actions Pipeline

3-phase pipeline across 14 runners, every 20 minutes:

1. **Scrape** (1 runner, ~15s) — 7 sources, dedup by `endpoint_id`, inject alive endpoints from DB, blacklist dead, upload artifact
2. **Validate** (12 runners in parallel, ~3-20 min) — 20 concurrency, hard timeouts, model-detect probe, streams to JSONL
3. **Merge** (1 runner, ~15s) — combine shards, upsert SQLite, export, commit

### Blacklist

SQLite DB cached between Actions runs. Endpoints where `alive = 0 AND last_checked >= now - 3h` are skipped. Subsequent runs only validate new + previously-alive endpoints.

### Safety & Guardrails

- Configurable hard timeout per endpoint (default 60s)
- 50-minute global validation deadline
- `fail-fast: false` on matrix (one shard failing doesn't kill others)
- `if: always()` on commit and merge (partial results still saved)
- Concurrency group prevents overlapping Actions runs
- `git pull --rebase` before push (handles concurrent commits)
- `auth_value` never written to export files — only lives in the DB and the running server process

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full architecture.

---

## Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 22+ (TypeScript, ESM) |
| HTTP | Hono |
| Database | SQLite (better-sqlite3, WAL) |
| Concurrency | `p-limit` |
| CI/CD | GitHub Actions (12 shards, every 20 min, $0) |

---

## Security

See [docs/SECURITY.md](docs/SECURITY.md) for the full threat model.

- Auth material stored in DB, never in exports or logs
- Rate limiting on all API endpoints (60 req/min)
- Configurable hard timeout prevents hung upstreams
- Non-retryable upstream errors short-circuit the router
- Gray-market endpoints are isolated by `tier=reverse` for downstream filtering
- Free endpoints are untrusted — never send credentials, PII, or proprietary content through them

---

## Conventions

See [docs/CONVENTIONS.md](docs/CONVENTIONS.md) for database, TypeScript, and API naming rules.

---

## License

AGPL-3.0 — see [LICENSE](LICENSE).
