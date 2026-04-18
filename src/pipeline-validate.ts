// ─── Validate Shard ───────────────────────────────────────────────────────────
// Phase 2 of the parallel pipeline. Validates a slice of the endpoint list.
// Usage: npm run pipeline:validate -- --shard=0 --total-shards=12
// Reads: artifacts/endpoints-to-validate.json
// Writes: artifacts/validated-shard-{N}.json

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { validateAll } from './services/validator.js';
import { initStreamExport, streamResult } from './services/stream-export.js';
import type { RawEndpoint } from './types.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('pipeline:validate');

function parseArgs(): { shard: number; totalShards: number } {
  const args = process.argv.slice(2);
  let shard = 0;
  let totalShards = 4;

  for (const arg of args) {
    if (arg.startsWith('--shard=')) shard = parseInt(arg.split('=')[1], 10);
    if (arg.startsWith('--total-shards=')) totalShards = parseInt(arg.split('=')[1], 10);
  }

  if (process.env.SHARD_INDEX) shard = parseInt(process.env.SHARD_INDEX, 10);
  if (process.env.TOTAL_SHARDS) totalShards = parseInt(process.env.TOTAL_SHARDS, 10);

  return { shard, totalShards };
}

async function main() {
  const { shard, totalShards } = parseArgs();
  log.info(`Validate shard ${shard}/${totalShards} started`);

  const all: RawEndpoint[] = JSON.parse(
    readFileSync('artifacts/endpoints-to-validate.json', 'utf-8'),
  );
  log.info(`Loaded ${all.length} total endpoints`);

  const chunkSize = Math.ceil(all.length / totalShards);
  const start = shard * chunkSize;
  const end = Math.min(start + chunkSize, all.length);
  const mine = all.slice(start, end);
  log.info(`Shard ${shard}: validating endpoints ${start}-${end} (${mine.length} endpoints)`);

  initStreamExport();
  const validated = await validateAll(mine, streamResult);

  const alive = validated.filter((e) => e.alive).length;
  const rateLimited = validated.filter((e) => e.rate_limited).length;
  log.info(`Shard ${shard} complete: ${validated.length} validated, ${alive} alive, ${rateLimited} rate-limited`);

  mkdirSync('artifacts', { recursive: true });
  writeFileSync(`artifacts/validated-shard-${shard}.json`, JSON.stringify(validated));
  log.info(`Wrote results to artifacts/validated-shard-${shard}.json`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    log.error('Validate shard failed', { error: String(err) });
    process.exit(1);
  });
