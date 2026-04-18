# Database & Code Conventions

Rules for writing consistent, refactorable code in the Brainpool codebase. Mirrors the conventions of [Worldpool](https://github.com/CelestialBrain/worldpool) — if you've worked in Worldpool, you already know these.

## Database

| Convention             | Rule                                                      | Example                                                  |
| ---------------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| **Primary keys**       | Always `{table}_id`                                       | `endpoint_id`                                            |
| **Foreign keys**       | Match the PK name exactly                                 | `FK → endpoint_id`                                       |
| **User-facing IDs**    | Natural key as `TEXT`                                     | `endpoint_id TEXT PRIMARY KEY` (value = 16-char sha1)    |
| **Internal IDs**       | `INTEGER PRIMARY KEY AUTOINCREMENT`                       | Only when no natural key exists                          |
| **Column naming**      | `snake_case`, never camelCase                             | `last_checked`, `latency_ms`, `model_family`             |
| **Table naming**       | Singular noun, no reserved words                          | `endpoint` (not `endpoints`)                             |
| **Timestamps**         | `INTEGER` storing Unix epoch seconds                      | `created_at INTEGER DEFAULT (unixepoch())`               |
| **Boolean columns**    | `INTEGER NOT NULL DEFAULT 0` (SQLite has no BOOLEAN)      | `alive INTEGER NOT NULL DEFAULT 0`                       |
| **Constrained values** | `CHECK` constraints (SQLite has no ENUMs)                 | `CHECK (tier IN ('official', 'reverse', 'unknown'))`    |
| **Indexes**            | `idx_{table}_{column}`                                    | `idx_endpoint_alive`, `idx_endpoint_model_family`        |

### SQLite-Specific Rules

- No `TIMESTAMPTZ` — use `INTEGER` with `unixepoch()` for all timestamps
- No `ENUM` types — use `CHECK` constraints instead
- Use `WAL` journal mode and `NORMAL` synchronous for performance
- Transactions via `db.transaction()` for bulk inserts

## TypeScript

| Convention             | Rule                                             | Example                                                   |
| ---------------------- | ------------------------------------------------ | --------------------------------------------------------- |
| **DB access**          | Always through `src/models/` DAL modules         | `import { upsertEndpoint } from '../models/endpoint.js'`  |
| **Row types**          | `{Table}Row` — matches DB columns, snake_case    | `EndpointRow { endpoint_id, base_url, api_kind, ... }`    |
| **API response types** | `{Table}Response` — clean shape for consumers    | `EndpointResponse { id, base_url, api_kind, ... }`        |
| **Variables**          | camelCase in TS, snake_case only in SQL strings  | `const latencyMs = row.latency_ms`                        |
| **Imports**            | `.js` extension for local ESM imports            | `import { probe } from '../services/probe.js'`            |
| **Config**             | Single `src/config.ts` exporting typed object    | `import { config } from '../config.js'`                   |

## API Response Naming

All API endpoints follow these naming rules:

| Rule               | Pattern              | Bad                        | Good                        |
| ------------------ | -------------------- | -------------------------- | --------------------------- |
| **Scalars**        | Singular noun        | `free_slots: 5`            | `free_slot: 5`              |
| **Counts**         | `{singular}_count`   | `total_endpoints: 42`      | `endpoint_count: 42`        |
| **Arrays**         | Singular noun        | `endpoints: [...]`         | `endpoint: [...]`           |
| **Measurements**   | Singular noun + unit | `avg_latency: 340`         | `avg_latency_ms: 340`       |
| **Booleans**       | Descriptive          | `free: true`               | `free_tier: true`           |

### Quick Example

```typescript
// GET /endpoints response
{
  endpoint: [                          // arrays are SINGULAR
    {
      id: "a1b2c3d4e5f6a7b8",          // endpoint_id aliased to id
      base_url: "https://api.groq.com/openai/v1",
      api_kind: "openai",
      provider: "groq",
      model_detected: "llama-3.1-70b",
      model_family: "llama",
      latency_ms: 280,                  // measurements include unit
      tier: "official",
      free_tier: true,
      last_checked: 1743696000,
      reliability_pct: 98.6
    }
  ],
  endpoint_count: 1                     // counts use {singular}_count
}
```

## Response Shape (DAL → Route → Consumer)

| Layer              | Type name          | PK field                      | Example                             |
| ------------------ | ------------------ | ----------------------------- | ----------------------------------- |
| **Raw DB schema**  | —                  | `endpoint_id`                 | `endpoint_id TEXT PRIMARY KEY`      |
| **DAL (models/)**  | `EndpointRow`      | `endpoint_id` (snake_case)    | `EndpointRow.endpoint_id`           |
| **API response**   | `EndpointResponse` | aliased to `id`               | `{ id, base_url, api_kind, ... }`   |

`auth_header` and `auth_value` are stripped at the DAL → Response boundary. The internal `queryEndpointInternal()` function on `src/models/endpoint.ts` returns full `EndpointRow` rows and is only called by the router.

## Structured Logger

Use `createLogger(prefix)` from `src/utils/logger.ts` instead of bare `console.log`.
Returns `log.info()`, `log.warn()`, `log.error()`, `log.debug()` with Manila TZ timestamps and module prefix.
Filtering via `LOG_LEVEL` env var (`debug`, `info`, `warn`, `error`).

```typescript
import { createLogger } from '../utils/logger.js';
const log = createLogger('validator');

log.info('Validation complete', { alive: 42, elapsed_ms: 4200 });
log.error('Probe failed', { endpoint_id, error: String(err) });
log.debug('Upstream hit', { provider, model, latency_ms });
```

## File Organization

```
migrations/           ← SQLite schema (numbered, idempotent)
endpoints/            ← Auto-generated JSONL files (committed by Actions)
  all.jsonl
  alive.jsonl
  rate-limited.jsonl
  by-family/
  by-provider/
  by-tier/
data/                 ← Auto-generated JSON exports
  endpoints.json
  stats.json
docs/                 ← ARCHITECTURE.md, CONVENTIONS.md, SECURITY.md
src/
  types.ts              ← ApiKind, ModelFamily, Tier, EndpointRow, EndpointResponse
  config.ts             ← Typed config with env overrides
  pipeline-scrape.ts    ← CLI entry: phase 1 scrape
  pipeline-validate.ts  ← CLI entry: phase 2 shard validation
  pipeline-merge.ts     ← CLI entry: phase 3 merge results
  index.ts              ← Hono server entry
  models/
    endpoint.ts         ← Upsert, query, stats, blacklist, alive-injection
  services/
    probe.ts            ← Low-level per-kind request builder + response extractor
    validator.ts        ← validateEndpoint, validateAll, hard-timeout, model detection
    router.ts           ← OpenAI-compatible chat proxy with failover
    exporter.ts         ← File export + README stats + changelog
    stream-export.ts    ← Real-time JSONL append during validation
  middleware/
    rate-limit.ts       ← 60 req/min per IP, sliding window
  routes/
    endpoint.ts         ← GET /endpoints
    stats.ts            ← GET /stats
    chat.ts             ← POST /v1/chat/completions
  scrapers/
    index.ts            ← Declarative registry, dedup by endpoint_id
    openrouter.ts       groq.ts              google-ai-studio.ts
    huggingface.ts      cloudflare-workers-ai.ts
    gpt4free-providers.ts   awesome-free-ai.ts
  utils/
    db.ts               ← SQLite singleton, WAL, migrations
    logger.ts           ← Structured logger, Manila TZ
    id.ts               ← endpointId() + classifyFamily()
```

## Scraper Contract

Each scraper is a file in `src/scrapers/` exporting a single function:

```typescript
export async function scrape(): Promise<RawEndpoint[]>;
```

Rules:
- Must not throw. Wrap all fetches in try/catch, log errors, return `[]` on failure.
- Must set `source: '<scraper-name>'` on every emitted endpoint so source quality can be tracked.
- Must set `tier`: `'official'` for legit free tiers, `'reverse'` for gray-market leads, `'unknown'` only as a last resort.
- Must set `api_kind` correctly so the probe knows how to call it.
- Skip gracefully with a log warning when a required API key is missing (`if (!config.keys.x) { log.warn(...); return []; }`).
- Emit one `RawEndpoint` per `(base_url, auth_value, provider)` combination; dedup happens in `scrapers/index.ts`.

## Migration Conventions

- Files numbered `NNN_{description}.sql` (e.g., `001_init.sql`)
- Each migration idempotent where possible (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`)
- Include a comment header with what the migration does
- Applied via the simple runner in `src/utils/db.ts` — statements split on `;`, duplicate-column errors from `ALTER TABLE ADD COLUMN` are swallowed
