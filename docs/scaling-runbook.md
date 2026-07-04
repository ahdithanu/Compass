# Scaling Compass to thousands of users

Status of the **code**: done and deployed. The items below are **operator
actions** — platform settings and env vars only you can set. Ordered by
priority. None require touching application code.

---

## 0. What already scales (no action needed)

- **Login / auth** — handled by Supabase Auth (GoTrue), a managed
  horizontally-scaled service. Thousands of concurrent logins are its job, not
  the app's.
- **User isolation** — every request builds a fresh server client from its own
  cookies, and Row-Level Security scopes every query to `auth.uid()`. Users can
  never read each other's data, at any scale.
- **Hot-path DB queries** — already indexed (`runs(user_id, created_at desc)`,
  `run_checks(run_id)`, `user_feeds(user_id, created_at)`).
- **Web tier** — Vercel autoscales serverless functions with traffic.

---

## 1. Database: apply RLS optimization + stop it pausing  ⚠️ blocking

The Compass Supabase project is currently **PAUSED** (free tier pauses after
~7 days idle). A paused database serves *no one* — this is the first thing to
fix before real traffic.

1. **Apply the RLS `initplan` optimization** (already in `supabase/schema.sql`):
   - Supabase dashboard → **SQL Editor** → paste the contents of
     `supabase/schema.sql` → **Run**. It's idempotent (drop/create policy), so
     re-running is safe. This makes every RLS check evaluate `auth.uid()` once
     per query instead of once per row.
2. **Upgrade to Supabase Pro ($25/mo)** before launch. This gives you:
   - **Always-on** (no auto-pause).
   - A larger **connection pool** and compute — the free tier's ceiling will
     throttle you well before "thousands of users."
   - Daily backups + point-in-time recovery.
3. Confirm the app uses the **connection pooler** URL (Supavisor / port 6543),
   not a direct DB connection. *(This app talks to PostgREST over HTTPS, which
   already pools — so no change unless you add a direct Postgres client later.)*

---

## 2. Turn on the distributed rate limiter (free)

The code ships with a shared-store limiter that stays dormant until configured,
then holds the rate limit across every serverless instance (the in-memory
fallback only limits per-instance, which an attacker can spread across).

1. Create a free **Upstash Redis** database at https://upstash.com (free tier:
   10k commands/day, plenty for rate-limit counters).
2. Copy its **REST URL** and **REST token**.
3. In **Vercel → Project → Settings → Environment Variables**, add (Production):
   - `UPSTASH_REDIS_REST_URL` = *(the REST URL)*
   - `UPSTASH_REDIS_REST_TOKEN` = *(the REST token)*
4. **Redeploy.** The limiter switches to the shared window automatically; no
   code change. Verify by hammering `/api/recommendations` past the limit from
   one IP and confirming a `429` with `Retry-After`.

Optional tuning (env vars, all have safe defaults): `API_RATE_LIMIT_RECS`,
`API_RATE_LIMIT_INSIGHTS`, `API_RATE_LIMIT_FEEDS`.

---

## 3. Auth abuse protection (free Supabase toggles)

At scale you *will* get bots. These are free and take minutes.

1. **CAPTCHA on auth** — Supabase → **Authentication → Attack Protection** →
   enable **CAPTCHA** (hCaptcha or Cloudflare Turnstile). Stops automated
   credential-stuffing / mass signup. *(Note: enabling this adds a CAPTCHA
   challenge to the login/signup form — a small client change to pass the token;
   tell me when you enable it and I'll wire the widget in.)*
2. **Leaked-password protection** — Supabase → **Authentication → Passwords** →
   enable the **HaveIBeenPwned** check so users can't set known-breached
   passwords.
3. **Confirm email confirmations are required** (Authentication → Providers →
   Email) — already the app's assumption (signup says "check your email").
4. Review **Auth rate limits** (Authentication → Rate Limits) — Supabase caps
   auth requests per hour; raise/lower to match expected signup volume.

---

## 4. Observability before you need it

Not blocking, but you'll want eyes on production once real users arrive:

- **Error monitoring** — add Sentry (free tier) for server + client errors.
- **Log drain** — Vercel/Supabase logs to a central sink for audit + debugging.
- **Uptime + DB metrics** — watch Supabase connection count and CPU; that's the
  first thing to saturate under load.

---

## Priority order

1. **Un-pause / upgrade the database** (§1) — nothing works if it's asleep.
2. **Apply the RLS SQL** (§1.1) — one paste, immediate query-plan win.
3. **Upstash env vars** (§2) — activates real cross-instance rate limiting.
4. **CAPTCHA + leaked-password** (§3) — bot defense.
5. **Sentry + log drain** (§4) — visibility.
