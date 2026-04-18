// ─── Streaming Exporter ───────────────────────────────────────────────────────
// Appends validated endpoints to JSONL files in real-time as they pass
// validation. Called via onResult callback during validateAll().

import { appendFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { ValidatedEndpoint } from '../types.js';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('stream-export');

const endpointsDir = config.export.endpointsDir;
const byFamilyDir = join(endpointsDir, 'by-family');
const byProviderDir = join(endpointsDir, 'by-provider');
const byTierDir = join(endpointsDir, 'by-tier');

const FLAT_FILES = [
  join(endpointsDir, 'all.jsonl'),
  join(endpointsDir, 'alive.jsonl'),
  join(endpointsDir, 'rate-limited.jsonl'),
];

// Clear a file to empty
function clear(path: string): void {
  writeFileSync(path, '', 'utf-8');
}

export function initStreamExport(): void {
  for (const dir of [endpointsDir, byFamilyDir, byProviderDir, byTierDir]) {
    mkdirSync(dir, { recursive: true });
  }
  for (const f of FLAT_FILES) clear(f);
}

// ─── JSONL line shape ────────────────────────────────────────────────────────
// Intentionally excludes auth_value so exports are publishable.

interface PublicLine {
  id: string;
  base_url: string;
  api_kind: string;
  provider: string;
  model_detected: string | null;
  model_family: string | null;
  latency_ms: number;
  tier: string;
  free_tier: boolean;
  last_checked: number;
}

function toLine(e: ValidatedEndpoint): string {
  const line: PublicLine = {
    id: e.endpoint_id,
    base_url: e.base_url,
    api_kind: e.api_kind,
    provider: e.provider,
    model_detected: e.model_detected ?? null,
    model_family: e.model_family ?? null,
    latency_ms: e.latency_ms,
    tier: e.tier,
    free_tier: e.free_tier,
    last_checked: e.last_checked,
  };
  return JSON.stringify(line) + '\n';
}

function appendSafe(path: string, content: string): void {
  try {
    appendFileSync(path, content);
  } catch (err) {
    log.warn(`Append failed: ${path}`, { error: String(err) });
  }
}

export function streamResult(e: ValidatedEndpoint): void {
  const line = toLine(e);

  appendSafe(join(endpointsDir, 'all.jsonl'), line);

  if (e.alive) appendSafe(join(endpointsDir, 'alive.jsonl'), line);
  if (e.rate_limited) appendSafe(join(endpointsDir, 'rate-limited.jsonl'), line);

  if (!e.alive) return;

  if (e.model_family) {
    appendSafe(join(byFamilyDir, `${e.model_family}.jsonl`), line);
  }
  if (e.provider) {
    const safe = e.provider.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();
    appendSafe(join(byProviderDir, `${safe}.jsonl`), line);
  }
  if (e.tier) {
    appendSafe(join(byTierDir, `${e.tier}.jsonl`), line);
  }
}
