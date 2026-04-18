# Security

Threat model and mitigations for operating a free AI endpoint aggregation pipeline.

## Threat Surface

Brainpool aggregates endpoints that are, in the `reverse` tier, literally untrusted third-party servers that accept prompts and return LLM output. In the `official` tier, it holds real API keys for providers that can be abused or leaked. Both sides create distinct attack vectors.

## Threats — Ranked by Severity

### 1. API Key Exfiltration — HIGH

**Risk:** Brainpool stores real API keys (`auth_value`) for OpenRouter, Groq, Google AI Studio, Huggingface, Cloudflare. If any of these leak — via logs, exports, error messages, or DB dumps — they can be abused to burn quota, rack up charges on paid tiers linked to the same key, or get the key revoked.

**Mitigation:**
- `auth_value` and `auth_header` are **never written to export files**. `rowToResponse()` in `src/models/endpoint.ts` strips them before any JSONL / JSON export.
- Logs never include `auth_value`. The structured logger is domain-aware; sensitive fields must be explicitly excluded from log payloads.
- `brainpool.db` is listed in `.gitignore` — the SQLite file (which does contain auth material) must never be committed. Only the Actions cache has a copy.
- Secrets injected only via GitHub Actions repository secrets — never committed to `.env` files in the repo.
- Admin endpoints (if added) require `X-Admin-Token` header validation.

### 2. Gray-Market Endpoint Account Bans — HIGH for the upstream, LOW for Brainpool

**Risk:** `tier=reverse` endpoints scraped from gpt4free-providers or awesome-free-ai often reverse-engineer the private APIs of providers like ChatGPT web, Claude.ai web, or niche "free" proxies. Calling them can cause the operator's account to be banned, or can feed telemetry back to the provider. If Brainpool's router blindly routes paid user traffic through a reverse-engineered endpoint, the user may unknowingly violate provider ToS.

**Mitigation:**
- Every endpoint has `tier` set. Downstream clients can filter via `/endpoints?tier=official` or `/v1/chat/completions` against only the official pool.
- `tier=reverse` is not opted into by default in exports; consumers must explicitly request it.
- The router's default failover order prefers lower-latency endpoints, which tend to be official tiers (they're geographically closer and higher quality).
- README clearly labels `tier=reverse` as gray-market.

### 3. DMCA / Cease-and-Desist from Providers — MEDIUM

**Risk:** OpenAI, Anthropic, and Google send DMCA notices and legal letters to projects that enable unauthorized API access. gpt4free has been taken down and renamed repeatedly. Brainpool, as a tool that indexes and routes to reverse-engineered endpoints, is a likely target.

**Mitigation:**
- Brainpool is designed to run from a **throwaway GitHub org or account**, not the maintainer's primary account. A takedown burns the repo, not anything else.
- No copyrighted output is served directly — the router proxies responses; the upstream is responsible for them.
- The codebase ships under AGPL-3.0, meaning downstream operators who deploy Brainpool inherit the obligation to open-source their own code.
- Domain-agnostic naming (`base_url`, `endpoint`, `provider`) avoids enumeration of protected trademarks in the code itself.

### 4. Prompt Injection via Probe Responses — LOW

**Risk:** The validator sends `"What model are you?"` and receives arbitrary text back. If a malicious upstream returns a response containing instruction-like text aimed at the validator's downstream consumers (e.g., injected markdown that later gets rendered in a dashboard), it could trigger supply-chain attacks on readers.

**Mitigation:**
- The validator stores only `model_detected` (a regex-normalized enum value — `gpt-4o`, `claude-3-5-sonnet`, etc.) — never raw response text.
- `last_error` is capped at 500 characters in the probe result.
- Exports are JSONL; responses are never HTML-rendered as part of the pipeline.

### 5. Resource Exhaustion / OOM — LOW

**Risk:** 20 concurrent outbound LLM requests with 30s timeouts + large response bodies can exhaust memory. On GitHub Actions runners (7GB RAM) this is fine; on a small VPS, it could OOM.

**Mitigation:**
- Hard concurrency cap at 20 via `p-limit` (configurable via `VALIDATOR_CONCURRENCY`). Intentionally lower than Worldpool's 200 because AI requests are heavier.
- Configurable hard timeout per endpoint via `withHardTimeout()` — default 60s, kills hung requests unconditionally.
- 50-min global validation deadline via `Promise.race()` — returns partial results if hit.
- `max_tokens` capped at 32 for probe responses to bound payload size.
- Parallel sharding across 12 runners — each handles ~1/12th of the endpoint list.

### 6. Upstream Abuse Attribution — LOW-MEDIUM

**Risk:** If Brainpool's validator IP (or its users, via the router) sends abusive content to an upstream (e.g., someone routes disallowed prompts through `/v1/chat/completions`), the upstream may attribute it to Brainpool's key and ban it.

**Mitigation:**
- The router is off by default in environments where `ROUTER_ENABLED=false`.
- Rate limiting on the API layer (60 req/min/IP) prevents any single consumer from flooding upstreams.
- Validator probes are well-formed and benign (literally "Respond with OK").
- Consider adding content moderation headers (`x-brainpool-user-id`) for downstream traceability before shipping publicly.

## What's NOT a Threat

| Concern | Why it's not a risk |
|---------|---------------------|
| LLM output poisoning our DB | We only store regex-matched enum values, never raw text |
| DDoS *from* endpoints | They can't initiate inbound connections without a request from us |
| User prompts leaking between router requests | Each request is a fresh axios call; no persistent state per upstream |
| Endpoints seeing our real IP | GitHub Actions runners use Microsoft Azure IPs; rotate every run |

## Operational Rules

1. **Isolation:** Keep `brainpool.db` out of git. The repo publishes results; the DB holds secrets.
2. **Throwaway GitHub org:** Deploy to a secondary GitHub account that can be burned without collateral.
3. **Key rotation:** Rotate all provider API keys monthly or immediately after any suspected leak.
4. **Never route sensitive prompts through `tier=reverse`:** gray-market endpoints may log payloads.
5. **Respect upstream ToS:** If a provider explicitly forbids aggregation or resale of their free tier, remove that scraper.
6. **GitHub Actions preferred:** Running the pipeline in Actions uses Microsoft Azure runner IPs (12 different IPs per run), not your own infrastructure.

## Security Checklist for Contributors

- [ ] No scraper logs `auth_value`, ever
- [ ] `EndpointResponse` never exposes `auth_header` / `auth_value`
- [ ] `brainpool.db` is in `.gitignore`
- [ ] All probe errors wrap `try/catch` — malformed upstream responses can't crash the validator
- [ ] Hard timeout is applied to every outbound request (`VALIDATOR_HARD_TIMEOUT_MS`)
- [ ] `tier` is always set on emitted endpoints — never left as default
- [ ] Secrets accessed only via `config.keys.*`, never hardcoded
- [ ] Rate limiter is applied on every new HTTP route added to the server
- [ ] New scrapers opt in gracefully when keys are missing (log and return `[]`, don't throw)
