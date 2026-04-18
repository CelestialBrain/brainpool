// ─── OpenAI-Compatible Chat Route ─────────────────────────────────────────────
// POST /v1/chat/completions — proxies to the pool with family+model routing.

import { Hono } from 'hono';
import { routeChatCompletion } from '../services/router.js';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

const chat = new Hono();

chat.post('/v1/chat/completions', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json({ error: { message: 'invalid JSON body', type: 'invalid_request' } }, 400);
  }

  const model = typeof body.model === 'string' ? body.model : undefined;
  const { status, body: response } = await routeChatCompletion(body, { model });
  return c.json(response, status as ContentfulStatusCode);
});

chat.get('/v1/models', (c) => {
  // Thin model-list shim for OpenAI clients that probe /v1/models
  return c.json({
    object: 'list',
    data: [],  // intentionally empty — clients should hit /endpoints for real data
  });
});

export default chat;
