# Security Policy

## Reporting a vulnerability

If you believe you've found a security vulnerability in Compass, please report it
privately — **do not open a public issue.**

- Email: **ahdi@uaconsulting.co** (use subject line `SECURITY: Compass`)
- Or use GitHub's **private vulnerability reporting** (Security tab → Report a
  vulnerability).

Please include: a description, reproduction steps, affected URL/endpoint, and
any logs or proof-of-concept. We aim to acknowledge within 3 business days.

## Scope

In scope: the Compass web app, its API routes, and authentication/data-isolation
behavior. Out of scope: third-party platforms we build on (Vercel, Supabase,
Anthropic, market-data providers) — report those to the respective vendors.

## Handling of data

Compass stores per-user profiles, run history, and saved feeds in Supabase with
row-level security (each row is readable/writable only by its owner). Secrets
(API keys) are stored as server-side environment variables and are never exposed
to the browser. The app presents **educational information only — not
personalized financial advice.**
