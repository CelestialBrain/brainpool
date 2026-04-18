// ─── Endpoint Model (DAL) ─────────────────────────────────────────────────────
// All SQLite queries for the `endpoint` table live here.

import { getDb } from '../utils/db.js';
import type {
  ValidatedEndpoint,
  EndpointResponse,
  EndpointQueryOption,
  PoolStatsResponse,
  EndpointRow,
  FamilyBreakdown,
  ProviderBreakdown,
  TierBreakdown,
  ModelFamily,
  SourceQuality,
  Tier,
  ApiKind,
} from '../types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('model:endpoint');

function rowToResponse(row: EndpointRow): EndpointResponse {
  return {
    id: row.endpoint_id,
    base_url: row.base_url,
    api_kind: row.api_kind,
    provider: row.provider,
    model_detected: row.model_detected,
    model_family: row.model_family,
    latency_ms: row.latency_ms,
    tier: row.tier,
    free_tier: row.free_tier === 1,
    last_checked: row.last_checked,
    reliability_pct: row.reliability_pct,
  };
}

export function upsertEndpoint(endpoints: ValidatedEndpoint[]): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const stmt = db.prepare(`
    INSERT INTO endpoint
      (endpoint_id, base_url, api_kind, provider, auth_header, auth_value,
       model_claim, model_detected, model_family,
       alive, rate_limited, latency_ms, ttft_ms,
       free_tier, tier, daily_limit, context_window, last_error,
       source, last_checked, created_at,
       check_count, alive_count, reliability_pct)
    VALUES
      (@endpoint_id, @base_url, @api_kind, @provider, @auth_header, @auth_value,
       @model_claim, @model_detected, @model_family,
       @alive, @rate_limited, @latency_ms, @ttft_ms,
       @free_tier, @tier, @daily_limit, @context_window, @last_error,
       @source, @last_checked, @created_at,
       @check_count, @alive_count, @reliability_pct)
    ON CONFLICT(endpoint_id) DO UPDATE SET
      model_detected = COALESCE(excluded.model_detected, endpoint.model_detected),
      model_family   = COALESCE(excluded.model_family, endpoint.model_family),
      alive          = excluded.alive,
      rate_limited   = excluded.rate_limited,
      latency_ms     = excluded.latency_ms,
      ttft_ms        = excluded.ttft_ms,
      tier           = excluded.tier,
      daily_limit    = COALESCE(excluded.daily_limit, endpoint.daily_limit),
      context_window = COALESCE(excluded.context_window, endpoint.context_window),
      last_error     = excluded.last_error,
      source         = excluded.source,
      last_checked   = excluded.last_checked,
      check_count    = endpoint.check_count + 1,
      alive_count    = endpoint.alive_count + excluded.alive,
      reliability_pct = ROUND(
        CAST(endpoint.alive_count + excluded.alive AS REAL)
        / CAST(endpoint.check_count + 1 AS REAL) * 100.0, 1
      )
  `);

  const insert = db.transaction((items: ValidatedEndpoint[]) => {
    for (const e of items) {
      stmt.run({
        endpoint_id: e.endpoint_id,
        base_url: e.base_url,
        api_kind: e.api_kind,
        provider: e.provider,
        auth_header: e.auth_header ?? null,
        auth_value: e.auth_value ?? null,
        model_claim: e.model_claim ?? null,
        model_detected: e.model_detected ?? null,
        model_family: e.model_family ?? null,
        alive: e.alive ? 1 : 0,
        rate_limited: e.rate_limited ? 1 : 0,
        latency_ms: e.latency_ms,
        ttft_ms: e.ttft_ms,
        free_tier: e.free_tier ? 1 : 0,
        tier: e.tier,
        daily_limit: e.daily_limit ?? null,
        context_window: e.context_window ?? null,
        last_error: e.last_error ?? null,
        source: e.source ?? null,
        last_checked: e.last_checked,
        created_at: now,
        check_count: 1,
        alive_count: e.alive ? 1 : 0,
        reliability_pct: e.alive ? 100.0 : 0.0,
      });
    }
  });

  insert(endpoints);
  log.info(`Upserted ${endpoints.length} endpoints`);
}

export function queryEndpoint(opts: EndpointQueryOption): EndpointResponse[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  const aliveOnly = opts.alive_only !== false;
  if (aliveOnly) conditions.push('alive = 1');

  if (opts.provider) { conditions.push('provider = @provider'); params.provider = opts.provider; }
  if (opts.model_family) { conditions.push('model_family = @model_family'); params.model_family = opts.model_family; }
  if (opts.model_detected) { conditions.push('model_detected = @model_detected'); params.model_detected = opts.model_detected; }
  if (opts.api_kind) { conditions.push('api_kind = @api_kind'); params.api_kind = opts.api_kind; }
  if (opts.tier) { conditions.push('tier = @tier'); params.tier = opts.tier; }
  if (opts.free_tier_only) conditions.push('free_tier = 1');
  if (opts.max_latency_ms !== undefined) {
    conditions.push('latency_ms <= @max_latency_ms');
    params.max_latency_ms = opts.max_latency_ms;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;

  params.limit = limit;
  params.offset = offset;

  const rows = db.prepare(`
    SELECT * FROM endpoint
    ${where}
    ORDER BY latency_ms ASC
    LIMIT @limit OFFSET @offset
  `).all(params) as EndpointRow[];

  return rows.map(rowToResponse);
}

/** Returns internal full row (incl. auth) — used by the router. Never exposed via API. */
export function queryEndpointInternal(opts: EndpointQueryOption): EndpointRow[] {
  const db = getDb();
  const conditions: string[] = ['alive = 1'];
  const params: Record<string, unknown> = {};

  if (opts.provider) { conditions.push('provider = @provider'); params.provider = opts.provider; }
  if (opts.model_family) { conditions.push('model_family = @model_family'); params.model_family = opts.model_family; }
  if (opts.model_detected) { conditions.push('model_detected = @model_detected'); params.model_detected = opts.model_detected; }
  if (opts.api_kind) { conditions.push('api_kind = @api_kind'); params.api_kind = opts.api_kind; }
  if (opts.tier) { conditions.push('tier = @tier'); params.tier = opts.tier; }
  if (opts.free_tier_only) conditions.push('free_tier = 1');

  const where = `WHERE ${conditions.join(' AND ')}`;
  const limit = opts.limit ?? 50;

  params.limit = limit;

  return db.prepare(`
    SELECT * FROM endpoint ${where} ORDER BY latency_ms ASC LIMIT @limit
  `).all(params) as EndpointRow[];
}

export function getStats(): PoolStatsResponse {
  const db = getDb();

  const totals = db.prepare(`
    SELECT
      COUNT(*) as endpoint_count,
      SUM(CASE WHEN alive = 1 THEN 1 ELSE 0 END) as alive_count,
      SUM(CASE WHEN rate_limited = 1 THEN 1 ELSE 0 END) as rate_limited_count,
      AVG(CASE WHEN alive = 1 AND latency_ms >= 0 THEN latency_ms ELSE NULL END) as avg_latency_ms,
      AVG(CASE WHEN check_count > 0 THEN reliability_pct ELSE NULL END) as avg_reliability_pct,
      MAX(last_checked) as last_updated
    FROM endpoint
  `).get() as {
    endpoint_count: number;
    alive_count: number;
    rate_limited_count: number;
    avg_latency_ms: number | null;
    avg_reliability_pct: number | null;
    last_updated: number | null;
  };

  const byFamily = db.prepare(`
    SELECT model_family, COUNT(*) as alive_count
    FROM endpoint
    WHERE alive = 1 AND model_family IS NOT NULL
    GROUP BY model_family
    ORDER BY alive_count DESC
  `).all() as Array<{ model_family: ModelFamily; alive_count: number }>;

  const byProvider = db.prepare(`
    SELECT provider, COUNT(*) as alive_count
    FROM endpoint
    WHERE alive = 1
    GROUP BY provider
    ORDER BY alive_count DESC
  `).all() as Array<{ provider: string; alive_count: number }>;

  const byTier = db.prepare(`
    SELECT tier, COUNT(*) as alive_count
    FROM endpoint
    WHERE alive = 1
    GROUP BY tier
  `).all() as Array<{ tier: Tier; alive_count: number }>;

  return {
    endpoint_count: totals.endpoint_count ?? 0,
    alive_count: totals.alive_count ?? 0,
    rate_limited_count: totals.rate_limited_count ?? 0,
    avg_latency_ms: Math.round(totals.avg_latency_ms ?? 0),
    avg_reliability_pct: Math.round((totals.avg_reliability_pct ?? 0) * 10) / 10,
    by_family: byFamily as FamilyBreakdown[],
    by_provider: byProvider as ProviderBreakdown[],
    by_tier: byTier as TierBreakdown[],
    last_updated: totals.last_updated ?? null,
  };
}

export function getSourceQuality(): SourceQuality[] {
  const db = getDb();

  return db.prepare(`
    SELECT
      source,
      COUNT(*) as total,
      SUM(CASE WHEN alive = 1 THEN 1 ELSE 0 END) as alive,
      AVG(CASE WHEN alive = 1 AND latency_ms >= 0 THEN latency_ms ELSE NULL END) as avg_latency_ms,
      ROUND(CAST(SUM(CASE WHEN alive = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) * 100, 1) as alive_pct
    FROM endpoint
    WHERE source IS NOT NULL
    GROUP BY source
    ORDER BY alive_pct DESC
  `).all() as SourceQuality[];
}

export function getPreviouslyAliveEndpoints(): Array<{
  endpoint_id: string;
  base_url: string;
  api_kind: ApiKind;
  provider: string;
  auth_header: string | null;
  auth_value: string | null;
  model_claim: string | null;
  tier: Tier;
  free_tier: number;
  source: string | null;
}> {
  const db = getDb();
  return db.prepare(`
    SELECT endpoint_id, base_url, api_kind, provider, auth_header, auth_value,
           model_claim, tier, free_tier, source
    FROM endpoint
    WHERE alive = 1
  `).all() as ReturnType<typeof getPreviouslyAliveEndpoints>;
}

export function getRecentlyDeadEndpointIds(withinSec: number): Set<string> {
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - withinSec;

  const rows = db.prepare(`
    SELECT endpoint_id FROM endpoint
    WHERE alive = 0 AND last_checked >= @cutoff
  `).all({ cutoff }) as Array<{ endpoint_id: string }>;

  return new Set(rows.map((r) => r.endpoint_id));
}
