// ─── Enums ────────────────────────────────────────────────────────────────────

export type ApiKind = 'openai' | 'anthropic' | 'gemini' | 'huggingface' | 'custom';
export type ModelFamily = 'gpt' | 'claude' | 'gemini' | 'llama' | 'mistral' | 'qwen' | 'deepseek' | 'other';
export type Tier = 'official' | 'reverse' | 'unknown';

// ─── Scraper Output ───────────────────────────────────────────────────────────

/** Raw endpoint as returned by a scraper — no validation yet. */
export interface RawEndpoint {
  base_url: string;
  api_kind: ApiKind;
  provider: string;
  auth_header?: string;
  auth_value?: string;
  model_claim?: string;
  tier?: Tier;
  free_tier?: boolean;
  source?: string;
}

// ─── Database Row ─────────────────────────────────────────────────────────────

export interface EndpointRow {
  endpoint_id: string;
  base_url: string;
  api_kind: ApiKind;
  provider: string;
  auth_header: string | null;
  auth_value: string | null;
  model_claim: string | null;
  model_detected: string | null;
  model_family: ModelFamily | null;
  alive: number;
  rate_limited: number;
  latency_ms: number;
  ttft_ms: number;
  free_tier: number;
  tier: Tier;
  daily_limit: number | null;
  context_window: number | null;
  last_error: string | null;
  source: string | null;
  last_checked: number;
  created_at: number;
  check_count: number;
  alive_count: number;
  reliability_pct: number;
}

// ─── Validated Endpoint (Internal) ────────────────────────────────────────────

export interface ValidatedEndpoint {
  endpoint_id: string;
  base_url: string;
  api_kind: ApiKind;
  provider: string;
  auth_header?: string;
  auth_value?: string;
  model_claim?: string;
  model_detected?: string;
  model_family?: ModelFamily;
  alive: boolean;
  rate_limited: boolean;
  latency_ms: number;
  ttft_ms: number;
  free_tier: boolean;
  tier: Tier;
  daily_limit?: number;
  context_window?: number;
  last_error?: string;
  source?: string;
  last_checked: number;
}

// ─── API Response ─────────────────────────────────────────────────────────────

export interface EndpointResponse {
  id: string;
  base_url: string;
  api_kind: ApiKind;
  provider: string;
  model_detected: string | null;
  model_family: ModelFamily | null;
  latency_ms: number;
  tier: Tier;
  free_tier: boolean;
  last_checked: number;
  reliability_pct: number;
}

export interface PoolStatsResponse {
  endpoint_count: number;
  alive_count: number;
  rate_limited_count: number;
  avg_latency_ms: number;
  avg_reliability_pct: number;
  by_family: FamilyBreakdown[];
  by_provider: ProviderBreakdown[];
  by_tier: TierBreakdown[];
  last_updated: number | null;
  source_quality?: SourceQuality[];
}

export interface FamilyBreakdown {
  model_family: ModelFamily;
  alive_count: number;
}

export interface ProviderBreakdown {
  provider: string;
  alive_count: number;
}

export interface TierBreakdown {
  tier: Tier;
  alive_count: number;
}

export interface SourceQuality {
  source: string;
  total: number;
  alive: number;
  avg_latency_ms: number | null;
  alive_pct: number;
}

// ─── Query Options ────────────────────────────────────────────────────────────

export interface EndpointQueryOption {
  provider?: string;
  model_family?: ModelFamily;
  model_detected?: string;
  api_kind?: ApiKind;
  tier?: Tier;
  free_tier_only?: boolean;
  alive_only?: boolean;
  max_latency_ms?: number;
  limit?: number;
  offset?: number;
}
