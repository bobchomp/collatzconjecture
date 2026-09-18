# Supabase setup

Backs the auth gate and per-account server-config sync. A few one-time
steps in the Supabase dashboard — I don't have access to your project
from here, so these are on you.

## 1. Apply the schema

Once you connect this repo via **Project Settings → Integrations → GitHub**,
Supabase will pick up new files under `supabase/migrations/` automatically
on push. Until that's connected (or if you just want it live right now),
apply it manually: **SQL Editor → New query**, paste the contents of
`supabase/migrations/20260917200000_create_server_configs.sql`, run it.

## 2. Turn off public sign-up

**Authentication → Sign In / Providers → Email**, turn off "Allow new users
to sign up" (wording may vary slightly by dashboard version). This is a
manual toggle, not something a migration can set. With it off, the app has
no self-serve sign-up flow at all — accounts only exist if you create them.

## 3. Create accounts manually

**Authentication → Users → Add user**. Set an email and password directly
there (skip the invite-email flow unless you want it) — that's the account
someone signs in with on the site. Repeat for anyone else who needs access.

## What's actually protecting what

- **The auth gate** (sign in to see the app at all) is a client-side
  convenience boundary — like any static site, the JS is readable by
  anyone who looks. It's there to stop casual/anonymous use, not as the
  real security layer.
- **Row Level Security** on `server_configs` is the real boundary: every
  policy is scoped to `auth.uid()`, so even a signed-in user can only ever
  read/write their own row — enforced by Postgres itself, not by the
  frontend trusting anyone.
- **The scan server's own password** (`SCAN_API_PASSWORD`, separate from
  all of this) is unaffected — it's still the actual gate on who can run
  scans on your Cloud Run / homelab server, regardless of Supabase auth.
