# Architecture

## Pipeline

3-phase parallel pipeline, every 20 minutes via GitHub Actions. 14 runners total.

```
SCRAPE (1 runner, ~15s)
  7+ sources in parallel → dedup by endpoint_id → blacklist dead endpoints from DB
      │
      ├── SHARD 0 ──┐
      ├── SHARD 1   │
      ├── ...       │  12 runners validate in parallel
      └── SHARD 11──┘  20 concurrency each, configurable hard timeout per endpoint
      │
MERGE (1 runner, ~15s)
  combine 12 shard artifacts → SQLite upsert → export files → commit
```

## Phase 1: Scrape

Entry point: `npm run pipeline:scrape` (`src/pipeline-scrape.ts`)

All 7+ sources run in parallel via `Promise.allSettled()`. No per-source cap by default (set `MAX_PER_SOURCE` env var to limit). Results are deduplicated by `endpoint_id` — a 16-char SHA1 of `base_url|auth_value|provider` — then previously-alive endpoints from the DB are injected (ensures they get re-validated even if they dropped off source lists), then filtered against the blacklist. Output uploaded as GitHub Actions artifact.

**Source types:**

- **REST APIs / model-list scrapers (5):** OpenRouter (`/models`, filter pricing `$0`), Groq (`/models`, filter active), Google AI Studio (`/v1beta/models`, filter by `supportedGenerationMethods`), Cloudflare Workers AI (`/ai/models/search`, filter text-gen). Each requires its own API key and yields one endpoint per model.
- **Curated known-good list (1):** Huggingface Inference — a hardcoded list of popular serverless text-gen model IDs; the validator decides which respond.
- **Code-scraping meta-sources (2):** gpt4free-providers (enumerates `xtekky/gpt4free`'s `g4f/Provider/` directory via the GitHub contents API, regex-extracts URLs with OpenAI-shaped paths) and awesome-free-ai (fetches community README files, regex-extracts URLs under `/v1`, `/openai`, `/api`).

**Fetcher contract:** `export async function scrape(): Promise<RawEndpoint[]>`

Registered in a declarative array in `src/scrapers/index.ts`.

## Blacklist

Queries SQLite DB (cached between Actions runs) for endpoints where `alive = 0` and `last_checked` within the last 3 hours (`BLACKLIST_WINDOW_SEC`). Filters them out before validation.

- **Cold start:** No DB cache, validates everything
- **Warm runs:** Skip recently-dead endpoints, only validate new + previously-alive
- **3-hour window:** Dead endpoints eventually become eligible for retry

## Phase 2: Validate (12 shards)

Entry point: `npm run pipeline:validate` (`src/pipeline-validate.ts`)

Downloads the endpoint list artifact, takes its slice (shard N of 12), validates each endpoint.

**Per-endpoint checks:**

| Check | What it does | Pass |
|-------|-------------|------|
| Alive probe | Sends `"Respond with ONLY the three letters OK"` through the endpoint's native API shape | Non-empty response body |
| Latency | `Date.now()` delta on alive probe | Recorded in ms |
| Model detection | Sends `"What model are you?"` and regex-matches 30+ known model names | `model_detected` normalized |
| Family classification | `classifyFamily()` buckets into `gpt`, `claude`, `gemini`, `llama`, `mistral`, `qwen`, `deepseek`, `other` | `model_family` set |
| Rate-limit state | HTTP 429 + body-text heuristics | `rate_limited = 1` |

**API-kind shape adaptation:** `src/services/probe.ts` knows how to speak OpenAI-chat, Anthropic-messages, Gemini-generateContent, and Huggingface-inputs. Request payloads are built and response text is extracted per-kind so the validator works over a uniform interface.

**Safety mechanisms:**
- Configurable hard timeout per endpoint via `withHardTimeout()` (default 60s) — kills hung sockets unconditionally
- 50-min global deadline via `Promise.race()` — returns partial results if hit
- 20 concurrent requests via `p-limit` (AI providers rate-limit by IP, so lower than Worldpool's 200)
- Results stream to JSONL files in real-time via `onResult` callback

Each shard uploads its validated results as a GitHub Actions artifact.

## Phase 3: Merge

Entry point: `npm run pipeline:merge` (`src/pipeline-merge.ts`)

Downloads all 12 shard artifacts, merges, filters invalid entries (missing `base_url` or `endpoint_id`), stores to SQLite via upsert, runs full export, commits to repo.

**Export outputs:**
- `endpoints/all.jsonl` / `alive.jsonl` / `rate-limited.jsonl` — flat JSONL
- `endpoints/by-family/` — per model-family (8 files)
- `endpoints/by-provider/` — per provider
- `endpoints/by-tier/` — `official.jsonl` / `reverse.jsonl`
- `data/endpoints.json` + `data/stats.json` — structured data
- README stats + badges auto-updated
- `CHANGELOG.md` appended with deltas

**Auth safety:** All export shapes go through `rowToResponse()` in `src/models/endpoint.ts`, which strips `auth_value` and `auth_header`. The raw internal row is only ever read by `src/services/router.ts` inside the server process.

## Router Subsystem

`POST /v1/chat/completions` accepts OpenAI-shaped requests and proxies to a live upstream.

1. Classify the requested model by family via `classifyFamily()`
2. Pull candidate endpoints: `alive=1`, matching `model_family` and (when set) `model_detected`, ordered by `latency_ms ASC`, limit `ROUTER_MAX_RETRIES * 3`
3. For each candidate up to `ROUTER_MAX_RETRIES`:
   - Build URL + headers + payload adapted for the target API kind
   - POST through axios with `ROUTER_UPSTREAM_TIMEOUT_MS`
   - On 2xx, adapt the response back to OpenAI shape and return
   - On 429 / 5xx, try the next candidate
   - On other 4xx, return immediately (client error — don't burn more upstreams)

Shape adapters live in `src/services/router.ts`. The same file handles Anthropic `system` message extraction, Gemini prompt flattening, and Huggingface `inputs`-style packing.

## Deployment

### GitHub Actions (Primary)

Every 20 minutes, 14 runners, $0 cost (public repo).

**Caches persisted between runs:**
- `brainpool.db` — endpoint database (blacklist, reliability tracking)

**Safety:**
- `concurrency` group prevents overlapping runs
- `fail-fast: false` on validation matrix
- `if: always()` on merge job (runs even if some shards fail)
- Configurable hard timeout per endpoint, 50 min global deadline
- `git pull --rebase` before push (handles concurrent commits)

### Local (Optional)

```bash
npm run pipeline:scrape
npm run pipeline:validate -- --shard=0 --total-shards=1
npm run pipeline:merge -- --total-shards=1
npm start   # API server + router
```

## Threat Model

See [SECURITY.md](SECURITY.md).
