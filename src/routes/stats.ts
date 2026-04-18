// ─── Stats Routes ─────────────────────────────────────────────────────────────
// GET /stats — pool health and breakdowns

import { Hono } from 'hono';
import { getStats } from '../models/endpoint.js';

const stats = new Hono();

stats.get('/stats', (c) => c.json(getStats()));

export default stats;
