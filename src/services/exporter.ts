// ─── Exporter Service ─────────────────────────────────────────────────────────
// Writes validated endpoints to flat files (endpoints/) and JSON exports
// (data/). Also updates README.md stats section and prepends to CHANGELOG.md.

import { mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import {
  queryEndpoint,
  queryAllEver,
  queryRateLimited,
  getStats,
  getSourceQuality,
} from '../models/endpoint.js';
import type {
  EndpointResponse,
  PoolStatsResponse,
  ModelFamily,
} from '../types.js';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('exporter');

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

function toJsonl(endpoints: EndpointResponse[]): string {
  return endpoints.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

async function readOldStats(dataDir: string): Promise<PoolStatsResponse | null> {
  try {
    const raw = await readFile(join(dataDir, 'stats.json'), 'utf-8');
    return JSON.parse(raw) as PoolStatsResponse;
  } catch {
    return null;
  }
}

async function appendChangelog(
  oldStats: PoolStatsResponse | null,
  newStats: PoolStatsResponse,
): Promise<void> {
  const path = 'CHANGELOG.md';
  let content: string;
  try { content = await readFile(path, 'utf-8'); } catch { content = '# Changelog\n\n'; }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr =
    `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ` +
    `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())} UTC`;

  const delta = (n: number, o?: number): string => {
    if (o === undefined) return '';
    const d = n - o;
    return d >= 0 ? ` (+${d})` : ` (${d})`;
  };

  const topFamilies = (newStats.by_family ?? []).slice(0, 5)
    .map((f) => `${f.model_family} ${f.alive_count}`).join(', ');
  const topProviders = (newStats.by_provider ?? []).slice(0, 5)
    .map((p) => `${p.provider} ${p.alive_count}`).join(', ');

  const entry = `## ${dateStr}
- Total alive: ${newStats.alive_count.toLocaleString()}${delta(newStats.alive_count, oldStats?.alive_count)}
- Rate-limited: ${newStats.rate_limited_count.toLocaleString()}
- Avg latency: ${newStats.avg_latency_ms.toLocaleString()} ms
- Avg reliability: ${newStats.avg_reliability_pct.toFixed(1)}%
- Top families: ${topFamilies}
- Top providers: ${topProviders}

`;

  const headerEnd = content.indexOf('\n');
  const newContent = headerEnd === -1
    ? `# Changelog\n\n${entry}`
    : content.slice(0, headerEnd + 1) + '\n' + entry + content.slice(headerEnd + 1);

  await writeFile(path, newContent, 'utf-8');
  log.info('CHANGELOG.md updated');
}

export async function exportFiles(): Promise<void> {
  const { endpointsDir, dataDir } = config.export;

  const oldStats = await readOldStats(dataDir);

  const byFamilyDir = join(endpointsDir, 'by-family');
  const byProviderDir = join(endpointsDir, 'by-provider');
  const byTierDir = join(endpointsDir, 'by-tier');

  await Promise.all([
    ensureDir(endpointsDir),
    ensureDir(dataDir),
    ensureDir(byFamilyDir),
    ensureDir(byProviderDir),
    ensureDir(byTierDir),
  ]);

  const alive = queryEndpoint({ alive_only: true, limit: 100_000 });
  const all = queryAllEver();
  const rateLimited = queryRateLimited();
  const official = queryEndpoint({ tier: 'official', alive_only: true, limit: 100_000 });
  const reverse = queryEndpoint({ tier: 'reverse', alive_only: true, limit: 100_000 });

  const families: ModelFamily[] = ['gpt', 'claude', 'gemini', 'llama', 'mistral', 'qwen', 'deepseek', 'other'];
  const byFamily = Object.fromEntries(
    families.map((f) => [f, queryEndpoint({ model_family: f, alive_only: true, limit: 100_000 })]),
  );

  const stats = getStats();
  const providerNames = stats.by_provider.map((p) => p.provider);
  const byProvider = Object.fromEntries(
    providerNames.map((p) => [p, queryEndpoint({ provider: p, alive_only: true, limit: 100_000 })]),
  );

  const sourceQuality = getSourceQuality();
  const fullStats = { ...stats, source_quality: sourceQuality };

  await Promise.all([
    writeFile(join(endpointsDir, 'all.jsonl'), toJsonl(all)),
    writeFile(join(endpointsDir, 'alive.jsonl'), toJsonl(alive)),
    writeFile(join(endpointsDir, 'rate-limited.jsonl'), toJsonl(rateLimited)),
    writeFile(join(byTierDir, 'official.jsonl'), toJsonl(official)),
    writeFile(join(byTierDir, 'reverse.jsonl'), toJsonl(reverse)),
    ...families.map((f) => writeFile(join(byFamilyDir, `${f}.jsonl`), toJsonl(byFamily[f]))),
    ...providerNames.map((p) => {
      const safe = p.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();
      return writeFile(join(byProviderDir, `${safe}.jsonl`), toJsonl(byProvider[p]));
    }),
    writeFile(join(dataDir, 'endpoints.json'), JSON.stringify(alive, null, 2)),
    writeFile(join(dataDir, 'stats.json'), JSON.stringify(fullStats, null, 2)),
  ]);

  log.info('Export complete', {
    all: all.length,
    alive: alive.length,
    rate_limited: rateLimited.length,
    official: official.length,
    reverse: reverse.length,
    families: Object.fromEntries(families.map((f) => [f, byFamily[f].length])),
  });

  await appendChangelog(oldStats, fullStats);
}

export async function updateReadmeStats(): Promise<void> {
  const path = 'README.md';

  let content: string;
  try { content = await readFile(path, 'utf-8'); }
  catch { log.warn('README.md not found — skipping stats update'); return; }

  const stats = getStats();
  const updated = new Date(
    stats.last_updated ? stats.last_updated * 1000 : Date.now(),
  ).toISOString();

  const table = `| Metric | Value |
| --- | --- |
| Total endpoints | ${stats.endpoint_count} |
| Alive endpoints | ${stats.alive_count} |
| Rate-limited | ${stats.rate_limited_count} |
| Avg latency | ${stats.avg_latency_ms} ms |
| Avg reliability | ${stats.avg_reliability_pct.toFixed(1)}% |
| Last updated | ${updated} |
`;

  const statsStart = '<!-- STATS_START -->';
  const statsEnd = '<!-- STATS_END -->';
  const sBefore = content.indexOf(statsStart);
  const sAfter = content.indexOf(statsEnd);

  if (sBefore === -1 || sAfter === -1) {
    log.warn('README.md missing STATS markers — skipping update');
    return;
  }

  content = content.slice(0, sBefore + statsStart.length) + '\n' + table + content.slice(sAfter);

  const badgesStart = '<!-- BADGES_START -->';
  const badgesEnd = '<!-- BADGES_END -->';
  const bBefore = content.indexOf(badgesStart);
  const bAfter = content.indexOf(badgesEnd);

  if (bBefore !== -1 && bAfter !== -1) {
    const dateLabel = updated.slice(0, 10).replace(/-/g, '--');
    const reliabilityLabel = `${stats.avg_reliability_pct.toFixed(1)}%25`;
    const badges = `![Alive](https://img.shields.io/badge/alive-${stats.alive_count}-brightgreen)
![Endpoints](https://img.shields.io/badge/endpoints-${stats.endpoint_count}-blue)
![Rate Limited](https://img.shields.io/badge/rate--limited-${stats.rate_limited_count}-orange)
![Avg Latency](https://img.shields.io/badge/avg--latency-${stats.avg_latency_ms}ms-yellow)
![Reliability](https://img.shields.io/badge/reliability-${reliabilityLabel}-purple)
![Updated](https://img.shields.io/badge/updated-${dateLabel}-lightgrey)
`;
    content = content.slice(0, bBefore + badgesStart.length) + '\n' + badges + content.slice(bAfter);
  }

  await writeFile(path, content, 'utf-8');
  log.info('README.md stats updated');
}
