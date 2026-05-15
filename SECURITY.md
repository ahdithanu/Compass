# Pre-launch security & privacy checklist

Run this checklist before shipping any project in this repo. Don't tick a
box you haven't actually verified.

## Privacy
- [ ] Privacy policy published (if any user data is collected)
- [ ] Documented where user data lives (provider, region, store)
- [ ] Data retention and deletion policy decided

## Secrets
- [ ] No API keys, exchange keys, or tokens in frontend / client code
- [ ] All secrets sourced from env vars or a secret manager
- [ ] `.env` is gitignored; `.env.example` checked in with empty values
- [ ] `git log -p` and `git grep` show no committed secrets
- [ ] Logs scrubbed of secrets, tokens, full auth headers, full request bodies

## Application security
- [ ] Reviewed against OWASP Top 10 basics
- [ ] All SQL parameterized — no string concatenation of user input
- [ ] Output escaped to prevent XSS (rely on framework defaults)
- [ ] AuthN and AuthZ verified on every endpoint touching user data
- [ ] Security headers set: CSP, HSTS, X-Content-Type-Options,
      Referrer-Policy, X-Frame-Options / frame-ancestors
- [ ] API responses checked for leaked internal IDs, stack traces, or
      cross-tenant data
- [ ] Dependencies scanned for known CVEs (`npm audit`, `pip-audit`, etc.)

## Abuse & cost controls
- [ ] Rate limits on every external endpoint
- [ ] Per-user spend cap on paths proxying paid upstreams (LLM, data feeds)
- [ ] Kill switch on order-placing code paths

## Trading-bot specific
- [ ] Exchange API keys scoped to minimum permissions
- [ ] Withdrawals disabled on exchange keys unless explicitly required
- [ ] IP allowlist on exchange keys (where supported)
- [ ] Live trading gated behind an explicit flag; default is paper/testnet
- [ ] Orders idempotent — no silent retries that could double-fill
- [ ] Position size and daily loss bounded in code

## Source
This checklist consolidates the pre-launch items every AI-built ("vibe-coded")
app commonly skips: privacy policy, data location, security headers, OWASP
basics, SQL injection / XSS / auth, leaking env values, sensitive data in API
responses, secrets in logs, frontend-exposed API keys, and missing rate
limits. Trading-bot-specific items are added because exchange keys control
real funds.
