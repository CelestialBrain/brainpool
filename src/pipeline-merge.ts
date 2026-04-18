// ─── Merge Phase ──────────────────────────────────────────────────────────────
// Phase 3 of the parallel pipeline. Merges shard results, stores to DB, exports.
// Usage: npm run pipeline:merge -- --total-shards=12

import { readFileSync, existsSync } from 'fs';
import { upsertEndpoint } from './models/endpoint.js';
import { exportFiles, updateReadmeStats } from './services/exporter.js';
import type { ValidatedEndpoint } from './types.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('pipeline:merge');

async function main() {
  let totalShards = 4;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--total-shards=')) totalShards = parseInt(arg.split('=')[1], 10);
  }
  if (process.env.TOTAL_SHARDS) totalShards = parseInt(process.env.TOTAL_SHARDS, 10);

  log.info(`Merge phase started — collecting ${totalShards} shards`);

  const all: ValidatedEndpoint[] = [];
  for (let i = 0; i < totalShards; i++) {
    const path = `artifacts/validated-shard-${i}.json`;
    if (!existsSync(path)) {
      log.warn(`Shard ${i} result not found at ${path} — skipping`);
      continue;
    }
    const shardResults: ValidatedEndpoint[] = JSON.parse(readFileSync(path, 'utf-8'));
    const valid = shardResults.filter((e) => e.base_url && e.endpoint_id);
    if (valid.length < shardResults.length) {
      log.warn(`Shard ${i}: filtered ${shardResults.length - valid.length} invalid entries`);
    }
    log.info(`Shard ${i}: ${valid.length} results (${valid.filter((e) => e.alive).length} alive)`);
    for (const e of valid) all.push(e);
  }

  if (all.length === 0) {
    log.error('No shard results found — aborting merge');
    process.exit(1);
  }

  const aliveCount = all.filter((e) => e.alive).length;
  const rateLimitedCount = all.filter((e) => e.rate_limited).length;
  log.info(`Merged: ${all.length} total, ${aliveCount} alive, ${rateLimitedCount} rate-limited`);

  log.info('Storing to database...');
  upsertEndpoint(all);

  log.info('Exporting files...');
  try { await exportFiles(); } catch (err) { log.error('Export failed', { error: String(err) }); }
  try { await updateReadmeStats(); } catch (err) { log.error('README update failed', { error: String(err) }); }

  log.info(`Merge complete: ${aliveCount} alive, ${rateLimitedCount} rate-limited`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    log.error('Merge phase failed', { error: String(err) });
    process.exit(1);
  });
