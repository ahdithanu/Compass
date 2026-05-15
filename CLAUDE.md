# Project Standards

These standards apply to every project in this repository. They exist because
trading bots handle money and credentials — a leaked exchange API key or an
abuse vector can drain an account in minutes. Treat them as hard
requirements, not suggestions.

## Pre-launch checklist (enforce before any deploy)

### Privacy & data handling
- If the project collects user data, ship a privacy policy alongside it.
- Document where user data is stored (provider, region, table/bucket).
- Treat exchange account data, balances, and trade history as user data.

### Secrets & credentials
- Never expose API keys, exchange keys, or webhook secrets in frontend code,
  client bundles, or public configs.
- Keep secrets server-side or behind a proxy with auth.
- Read secrets from environment variables or a secret manager — never
  hardcoded, never committed.
- `.env` files must be in `.gitignore`. Include a `.env.example` with empty
  values instead.
- Before committing, confirm no `.env`, credential, or key file is staged.
- Strip secrets, tokens, and full request bodies from logs. Redact known
  sensitive fields explicitly.

### Application security
- Scan for the OWASP Top 10 basics (injection, broken auth, broken access
  control, security misconfiguration, SSRF).
- Parameterize all SQL — never string-concatenate user input into queries.
- Escape output to prevent XSS. Use framework-provided escaping by default.
- Verify auth and authorization on every endpoint that touches user data or
  exchange credentials. Don't rely on "the UI doesn't expose it."
- Set security headers on any HTTP service: `Content-Security-Policy`,
  `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, `X-Frame-Options` (or CSP `frame-ancestors`).
- Check API responses don't leak internal IDs, stack traces, or
  other-user data.

### Abuse & cost controls
- Rate-limit every external endpoint before launch. An unprotected endpoint
  in front of a paid API (LLM, exchange, data feed) is a billing incident
  waiting to happen.
- Cap per-user spend on any path that proxies a paid upstream.
- Add circuit breakers / kill switches on order-placing code paths.

### Trading-bot specific
- Exchange API keys must be scoped to the minimum needed (read-only when
  possible; withdrawals disabled unless explicitly required).
- IP-allowlist exchange API keys when the exchange supports it.
- Default to paper-trading / testnet. Live trading must be an explicit,
  reviewed flag — never the default.
- Persist every order placement and fill with enough context to reconcile
  against the exchange. Never silently retry an order without idempotency.
- Bound position size and daily loss in code, not just in config.

## Working with this repo

- Every new project (subdirectory) inherits this checklist. Add a project-
  level `SECURITY.md` only if it deviates or adds project-specific items.
- Before declaring a project "ready to ship," walk the checklist and confirm
  each item — don't assume.
- If you're asked to skip a check ("just push it, we'll fix it later"),
  push back and surface the risk.
