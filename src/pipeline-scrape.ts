// ─── Scrape Phase ─────────────────────────────────────────────────────────────
// Phase 1 of the parallel pipeline. Scrapes all sources, deduplicates, applies
// blacklist, writes the endpoint list to a JSON file for sharded validation.
// Usage: npm run pipeline:scrape

import { writeFileSync, mkdirSync } from 'fs';
import { scrapeAll } from './scrapers/index.js';
import {
  getRecentlyDeadEndpointIds,
  getPreviouslyAliveEndpoints,
} from './models/endpoint.js';
import { endpointId } from './utils/id.js';
import { config } from './config.js';
import type { RawEndpoint, ApiKind, Tier } from './types.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('pipeline:scrape');

async function main() {
  log.info('Scrape phase started');

  const raw = await scrapeAll();
  if (raw.length === 0) {
    log.error('All scrapers returned zero endpoints — aborting');
    process.exit(1);
  }
  log.info(`Scraped ${raw.length} endpoints`);

  // Inject previously-alive endpoints from DB — must be re-validated
  const combined = raw.slice();
  try {
    const alive = getPreviouslyAliveEndpoints();
    if (alive.length > 0) {
      const scrapedIds = new Set(raw.map(endpointId));
      let injected = 0;
      for (const a of alive) {
        if (!scrapedIds.has(a.endpoint_id)) {
          combined.push({
            base_url: a.base_url,
            api_kind: a.api_kind as ApiKind,
            provider: a.provider,
            auth_header: a.auth_header ?? undefined,
            auth_value: a.auth_value ?? undefined,
            model_claim: a.model_claim ?? undefined,
            tier: a.tier as Tier,
            free_tier: a.free_tier === 1,
            source: a.source ?? undefined,
          });
          injected++;
        }
      }
      if (injected > 0) {
        log.info(`Injected ${injected} previously-alive endpoints not in source lists`, {
          from_db: alive.length,
          injected,
        });
      }
    }
  } catch (err) {
    log.warn('Failed to inject alive endpoints from DB (first run?)', { error: String(err) });
  }

  // Apply blacklist — skip recently-dead endpoints
  let toValidate = combined;
  try {
    const windowSec = config.scraper.blacklistWindowSec;
    const dead = getRecentlyDeadEndpointIds(windowSec);
    if (dead.size > 0) {
      toValidate = combined.filter((e) => !dead.has(endpointId(e)));
      const skipped = combined.length - toValidate.length;
      log.info(`Blacklist: skipping ${skipped} recently-dead endpoints`, {
        total: combined.length,
        after_blacklist: toValidate.length,
      });
    }
  } catch (err) {
    log.warn('Blacklist query failed (first run?) — validating all', { error: String(err) });
  }

  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/endpoints-to-validate.json', JSON.stringify(toValidate));
  log.info(`Wrote ${toValidate.length} endpoints to artifacts/endpoints-to-validate.json`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    log.error('Scrape phase failed', { error: String(err) });
    process.exit(1);
  });
