# Enterprise Security Checklist

Living tracker of Compass's security posture. Status: ✅ done · 🟡 partial ·
⬜ todo (needs work/decision). This is the source of truth for security
questionnaires.

## Data protection & isolation
- ✅ **Row-level security (RLS)** on every table (`profiles`, `runs`,
  `run_checks`, `user_feeds`), scoped to `auth.uid()`. Verified by Supabase
  security advisors (no findings).
- ✅ **Encryption in transit** (HTTPS everywhere via Vercel) and **at rest**
  (managed Postgres on Supabase).
- ✅ **Typed DB access** generated from the live schema — column drift breaks the
  build, not production.
- ✅ **Per-user feed quota** (max 50) + a per-run ingestion fan-out cap — bounds
  storage growth and outbound request volume.
- 🟡 **Data retention / deletion** — cascade deletes on user removal; no formal
  `runs` retention policy or self-serve data export/erasure (GDPR/CCPA) yet.

## Application hardening
- ✅ **SSRF guards** on user-supplied feed URLs: blocks loopback / private /
  link-local / cloud-metadata hosts **in every IP notation** — dotted, decimal,
  hex, octal, IPv4-mapped **and IPv4-compatible / NAT64 (`64:ff9b::`) IPv6** —
  and **re-validates every redirect hop** (manual redirect following — a feed
  can't 30x to metadata). Verified by a second-pass audit.
  Residual: DNS-rebinding (public name → private IP at connect time) not pinned.
- ✅ **XML hardening** — entity processing disabled (no expansion DoS) + body
  read is **streamed with a hard byte cap** (+ `Content-Length` pre-check) so an
  oversize/chunked feed can't be buffered into memory.
- ✅ **No unescaped dynamic RegExp** (ticker matching escapes input — no ReDoS).
- ✅ **Request body-size caps** (413) and **input validation** on all writes.
- ✅ **Per-client rate limiting** (429 + Retry-After), keyed off the
  platform-set client IP (`x-vercel-forwarded-for`) so a spoofed
  `x-forwarded-for` can't rotate buckets. **Scale-ready:** uses a shared
  Upstash Redis store (atomic INCR/PEXPIRE window) when
  `UPSTASH_REDIS_REST_URL/TOKEN` are set, so the limit holds across every
  serverless instance; degrades to the in-memory limiter (never fail-open) when
  the store is unset or errors. Set the two env vars (Upstash has a free tier)
  to activate the distributed window.
- ✅ **Security headers** — HSTS, X-Frame-Options, X-Content-Type-Options,
  Referrer-Policy, Permissions-Policy.
- 🟡 **Content-Security-Policy** — shipped in **Report-Only** mode; enforce after
  the report stream is clean (likely needs script nonces).
- 🟡 **CSRF** — relies on Supabase SameSite cookies; not separately hardened.

## Authentication & access
- ✅ Email/password auth via Supabase Auth.
- ⬜ **SSO (SAML/OIDC)** — not configured.
- ⬜ **Enforced MFA** — not configured.
- ⬜ **Session/password policies**, account lockout, admin RBAC.

## Secrets & supply chain
- ✅ Secrets are **server-side env vars**; only the RLS-protected Supabase anon
  key is public.
- ✅ **Dependabot** (weekly npm + actions updates).
- ✅ **CI dependency audit** (`npm audit --omit=dev --audit-level=high`).
- 🟡 **Secret scanning** — enable GitHub native secret scanning + push
  protection in repo settings.
- ✅ **SAST** — Semgrep in CI (free OSS rulesets: `p/default`, `p/typescript`,
  `p/javascript`, `p/owasp-top-ten`). Non-blocking for now (`continue-on-error`)
  so findings surface in the step log; flip to gating once triaged. CodeQL
  deferred (needs GitHub Advanced Security on private repos).
- ⬜ **Secret rotation** policy, SBOM.

## Observability & operations
- ✅ **Request-id correlation** (`x-request-id`) + structured logs.
- ✅ **Per-run checker audit trail** persisted (multi-stage verification).
- ⬜ **Centralized logging / SIEM**, security alerting, anomaly detection.
- 🟡 **Error monitoring** — every uncaught route error is reported to Sentry via
  the central `withRequest` funnel (dependency-free, DSN-gated). Set `SENTRY_DSN`
  to activate; covers server errors (client-side SDK still todo).

## Compliance & governance
- ✅ Educational-only framing + disclaimers (reduces regulatory exposure).
- ⬜ **SOC 2 / ISO 27001**, DPA, formal policies.
- ⬜ **Penetration test**.
- ✅ **Responsible disclosure** policy (`SECURITY.md`).

## Recommended next steps (in priority order)
1. Enable GitHub native **secret scanning + push protection** and **Dependabot
   alerts** (settings toggles, free).
2. Tighten **CSP** to enforced with script nonces once Report-Only is clean
   (verify on a Vercel preview first — nonces force dynamic rendering).
3. Move rate limiting to a **shared store** (Upstash Redis) so limits hold across
   instances. *(paid tier)*
4. Add **SSO + enforced MFA** (Supabase supports both on paid tiers) for
   enterprise tenants. *(paid tier)*
5. Add **error monitoring** (Sentry) and a log drain for centralized audit.
