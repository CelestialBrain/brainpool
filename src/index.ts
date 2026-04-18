// ─── Brainpool Entry Point ────────────────────────────────────────────────────
// Starts the Hono server and mounts all routes.

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { config } from './config.js';
import { rateLimit } from './middleware/rate-limit.js';
import endpointRoutes from './routes/endpoint.js';
import statsRoutes from './routes/stats.js';
import chatRoutes from './routes/chat.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('server');

const app = new Hono();

app.use('*', rateLimit());

app.get('/', (c) => c.json({ name: 'brainpool', status: 'ok' }));

app.route('/', endpointRoutes);
app.route('/', statsRoutes);
if (config.router.enabled) {
  app.route('/', chatRoutes);
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  log.info(`Brainpool server running`, { port: info.port });
});

export default app;
