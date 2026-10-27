# CLAUDE.md — HooLiv Dues Manager

Permanent project instructions for Claude Code. Read this before making any changes.

## Project Overview

HooLiv Dues Manager: a tenant dues/collections management app, migrated from
Express/Drizzle-on-Replit to a static **React + Vite** frontend on **Vercel**
backed by **Supabase** (Postgres + Auth + Storage + Edge Functions). The
original React UI was preserved as-is; a browser-side adapter translates its
existing `/api/*` calls into Supabase calls.

## Architecture (DO NOT rewrite without explicit approval)

- **Frontend**: `vercel-project/client/src` — React 18, Vite, TypeScript,
  `wouter` for routing, `@tanstack/react-query` for data fetching, shadcn/Radix
  + Tailwind for UI. Aliases: `@` → `client/src`, `@shared` → `shared/`.
- **API adapter**: `client/src/lib/apiAdapter.ts` — installs a global `fetch`
  interceptor. Every `/api/*` call the UI makes is translated here into a
  `supabase.rpc(...)`, Auth, Storage, or Edge Function call, and wrapped back
  into a `Response`. This is the seam between frontend and backend — almost
  all backend logic changes route through this file.
- **Supabase client**: `client/src/lib/supabase.ts` — reads
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `VITE_AUTH_EMAIL_DOMAIN`.
- **Database**: `supabase/sql/01_tables.sql` … `06_seed.sql`, applied in
  numeric order (order matters, see README). All business logic lives in
  `rpc_*` Postgres functions in `03_functions.sql` — the app **never** queries
  tables directly from the browser. RLS (`04_rls.sql`) revokes direct table
  access for API roles; this is intentional, not a bug.
- **Edge Function**: `supabase/functions/admin-users/index.ts` (Deno) — the
  *only* Edge Function. Handles privileged user management
  (create/update/delete/reset-password/bootstrap_admin) using the service-role
  key, gated on caller role via `rpc_me()`.
- **Auth**: Supabase Auth, phone+password. Phone is synthesized into
  `{phone}@{VITE_AUTH_EMAIL_DOMAIN}` for login. `profiles.auth_id` links to the
  Supabase Auth user; the app UI relies on the integer `profiles.id`, not the
  Auth UUID.
- **API keys**: the project uses Supabase's newer **publishable** /
  **secret** key system (`sb_publishable_...` / `sb_secret_...`), not the
  legacy JWT-based `anon`/`service_role` keys — legacy keys were disabled and
  the legacy JWT signing secret was revoked (2026-08-19) after one had been
  leaked in a script (see Secrets section). `VITE_SUPABASE_ANON_KEY` now holds
  the publishable key; anywhere a "service role key" is needed (e.g.
  `bootstrap.sh`), use the secret key. These are opaque strings, not JWTs —
  `createClient(url, key)` treats them identically to the old keys, no code
  changes needed.
- **Deployment**: Vercel, static build, deployed by manually uploading the
  built folder (no Git integration / no Vercel "Root Directory" setting
  exists for this project). `vercel.json` sets build command `npm run build`,
  output `dist/public`, SPA rewrites. Env vars (`VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`, `VITE_AUTH_EMAIL_DOMAIN`) are set in Vercel
  project settings, mirrored in `vercel-project/.env.example`.

  **Deploy gotcha**: always upload/deploy the `vercel-project/` folder
  itself (the one containing `package.json` and `vercel.json`) — never the
  outer `hooliv-dues-manager/` repo folder. Uploading the wrong folder
  produces a blank white page in production (Vercel can't find
  `package.json`, or the build silently uses wrong settings) and there is no
  "Root Directory" project setting to fix it after the fact for a
  non-Git-connected project. The Vercel project's Framework Preset should be
  set to **Vite** (Settings → General → Build & Development Settings) to
  avoid a misleading "framework mismatch" warning on upload — though
  `vercel.json`'s explicit `buildCommand`/`outputDirectory` take precedence
  over the preset regardless.

Preserve this architecture: React + Vite frontend, Supabase backend, RPC
functions, Supabase Auth, Edge Functions, Vercel deployment. Do not introduce
a new backend server, swap the RPC pattern for direct table access, or change
the auth model without approval.

## Before Making Any Changes

For every non-trivial change, before touching any file:

1. **Identify the root cause** of the issue (not just the symptom).
2. **Explain the problem** in plain terms.
3. **Explain the proposed fix.**
4. **List the affected files.**
5. **Wait for explicit approval** before modifying anything.

Do not rewrite working architecture without approval, even if a cleaner
pattern seems obvious. If a change seems to require touching the
architecture described above, flag that explicitly as part of the proposal.

## Debugging Process

Always trace the complete request flow before proposing a fix:

```
Frontend (page/component)
  → API adapter (client/src/lib/apiAdapter.ts)
    → Supabase RPC (supabase/sql/03_functions.sql) or Edge Function (supabase/functions/admin-users)
      → Database (tables/RLS in supabase/sql/01_tables.sql, 04_rls.sql)
        → UI response (React Query cache / component state)
```

Identify which link in this chain is broken before proposing a change.
Most bugs are one of:
- A route missing/mismatched in `apiAdapter.ts`.
- An RPC function bug or a permission/RLS check rejecting a valid caller.
- A response shape mismatch between the RPC's `json` builder and what the
  React component expects.

## Database Change Rules

- SQL files are applied in order: `01_tables` → `02_indexes` → `03_functions`
  → `04_rls` → `05_storage` → `06_seed`. Preserve this ordering; new
  migrations should be added as new numbered files or clearly documented,
  not by editing already-applied files silently (unless the user confirms
  the schema hasn't been deployed anywhere yet).
- All new business logic goes in `rpc_*` functions in `03_functions.sql`,
  following the existing `require_user()` / `require_admin()` guard pattern.
- Never propose bypassing RLS or querying tables directly from the browser
  client.

## Secrets

- Never commit or print live Supabase keys (the publishable/anon key is
  public-safe, but the secret/`service_role` key is not). Any script or file
  containing a plaintext secret/service-role key should be flagged
  immediately and fixed to read the value from an environment variable
  instead.
- `bootstrap.sh` (one-time first-admin creation, see README) takes its
  Supabase project ref and secret key from `SUPABASE_PROJECT_REF` /
  `SUPABASE_SERVICE_ROLE_KEY` env vars — it does not and must not hardcode
  them. Run it as:
  `SUPABASE_PROJECT_REF=... SUPABASE_SERVICE_ROLE_KEY=... ./bootstrap.sh`
- **Incident history**: `bootstrap.sh` previously had a live `service_role`
  JWT hardcoded in plaintext (found 2026-08-18, no git repo existed yet so it
  was never pushed anywhere). Response: parameterized the script via env
  vars, then migrated the whole project off legacy JWT-based keys to the
  publishable/secret key system and revoked the legacy JWT signing secret
  (2026-08-19), which permanently invalidated the leaked key. See "API keys"
  under Architecture above.

## Keeping This File Updated

After every **approved** implementation that changes architecture, features,
database schema, workflows, or the deployment process:
- Update the relevant section of this CLAUDE.md in the same change set.
- Keep this file's description of the system in sync with reality — future
  Claude Code sessions rely on it being accurate, not aspirational.
