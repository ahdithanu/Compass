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
- 🟡 **Data retention / deletion** — cascade deletes on user removal; no formal
  retention policy or self-serve data export/erasure (GDPR/CCPA) yet.

## Application hardening
- ✅ **SSRF guards** on user-supplied feed URLs (blocks loopback / private /
  link-local / cloud-metadata hosts).
- ✅ **Request body-size caps** (413) and **input validation** on all writes.
- ✅ **Per-client rate limiting** (429 + Retry-After) — ⬜ but in-memory /
  per-instance; needs a shared store (Upstash/Redis) or WAF for real scale.
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
- ⬜ **SAST** (CodeQL/Semgrep) — CodeQL needs GitHub Advanced Security on private
  repos; decide GHAS vs Semgrep.
- ⬜ **Secret rotation** policy, SBOM.

## Observability & operations
- ✅ **Request-id correlation** (`x-request-id`) + structured logs.
- ✅ **Per-run checker audit trail** persisted (multi-stage verification).
- ⬜ **Centralized logging / SIEM**, security alerting, anomaly detection.
- ⬜ **Error monitoring** (e.g. Sentry).

## Compliance & governance
- ✅ Educational-only framing + disclaimers (reduces regulatory exposure).
- ⬜ **SOC 2 / ISO 27001**, DPA, formal policies.
- ⬜ **Penetration test**.
- ✅ **Responsible disclosure** policy (`SECURITY.md`).

## Recommended next steps (in priority order)
1. Enable GitHub native **secret scanning + push protection** and **Dependabot
   alerts** (settings toggles, free).
2. Move rate limiting to a **shared store** (Upstash Redis) so limits hold across
   instances.
3. Decide **SAST**: GitHub Advanced Security (CodeQL) or Semgrep CI.
4. Tighten **CSP** to enforced with script nonces once Report-Only is clean.
5. Add **SSO + enforced MFA** (Supabase supports both on paid tiers) for
   enterprise tenants.
6. Add **error monitoring** (Sentry) and a log drain for centralized audit.
