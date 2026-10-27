# HooLiv Dues Manager — Vercel + Supabase

This is the HooLiv Tenant Dues Manager migrated off Replit to a **static frontend on
Vercel** with a **Supabase backend** (Postgres + Auth + Storage + Edge Functions).

The application UI is unchanged. The original Express/Drizzle backend has been
replaced by:

- **Postgres RPC functions** (`supabase/sql/03_functions.sql`) for all business
  logic, called from the browser via `supabase.rpc(...)`.
- **Supabase Auth** for login (phone + password, using a synthesized email).
- **Supabase Storage** (private bucket) for ticket attachments.
- **One Edge Function** (`admin-users`) for privileged user management.

A small browser adapter (`client/src/lib/apiAdapter.ts`) intercepts the app's
existing `/api/*` calls and routes them to Supabase, so the React code did not
have to be rewritten.

---

## What you need

- A [Supabase](https://supabase.com) project (free tier is fine).
- The [Supabase CLI](https://supabase.com/docs/guides/cli) (for the Edge Function).
- A [Vercel](https://vercel.com) account.
- Node.js 18+ locally (only if you want to build/preview locally).

Throughout, replace `YOUR-PROJECT-ref` and the keys with values from your
Supabase project (**Project Settings → API**).

---

## Step 1 — Create the database schema

Run the six SQL files **in order** in the Supabase **SQL Editor**
(or with `psql`). Each is idempotent enough to re-run, but order matters.

| Order | File | What it does |
|------|------|--------------|
| 1 | `supabase/sql/01_tables.sql` | Tables (11) |
| 2 | `supabase/sql/02_indexes.sql` | Indexes |
| 3 | `supabase/sql/03_functions.sql` | All RPC functions + grants |
| 4 | `supabase/sql/04_rls.sql` | Row Level Security (locks direct table access) |
| 5 | `supabase/sql/05_storage.sql` | Private `ticket-attachments` bucket + policies |
| 6 | `supabase/sql/06_seed.sql` | Default app settings |

Using the CLI instead of the editor:

```bash
supabase link --project-ref YOUR-PROJECT-ref
for f in 01_tables 02_indexes 03_functions 04_rls 05_storage 06_seed; do
  psql "$SUPABASE_DB_URL" -f "supabase/sql/${f}.sql"
done
```

> The app talks to the DB **only** through the `rpc_*` functions, each of which
> runs its own auth + role check. RLS is enabled and direct table access is
> revoked for the API roles — this is intentional.

---

## Step 2 — Deploy the admin Edge Function

The `admin-users` function performs the operations that require the Supabase
service role (creating/updating/deleting Auth users, resetting passwords).

```bash
supabase functions deploy admin-users

# Optional: choose the email domain used to turn phone numbers into login
# emails. It MUST match VITE_AUTH_EMAIL_DOMAIN in the frontend (Step 4).
supabase secrets set AUTH_EMAIL_DOMAIN=hooliv.local
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are provided
to the function automatically by Supabase — you do not set those yourself.

---

## Step 3 — Create the first admin

Login users must exist in Supabase Auth, which only the service role can create.
Use the one-time `bootstrap_admin` action (it only works while there are zero
users, so it is safe to call once):

```bash
curl -X POST "https://YOUR-PROJECT-ref.supabase.co/functions/v1/admin-users" \
  -H "Authorization: Bearer YOUR-SERVICE-ROLE-KEY" \
  -H "apikey: YOUR-SERVICE-ROLE-KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"bootstrap_admin","phone":"9999999999","password":"admin123","displayName":"Admin"}'
```

This mirrors the original default admin: **phone `9999999999`, password
`admin123`** (a Regional Head with full permissions). Change the password after
first login. From then on, all other users are created in-app under **Settings →
Team**.

---

## Step 4 — Deploy the frontend to Vercel

1. Push this folder to a Git repo (or use `vercel` CLI / drag-and-drop).
2. Import the project in Vercel. The included `vercel.json` already sets:
   - Build command: `npm run build`
   - Output directory: `dist/public`
   - SPA rewrites (all routes → `index.html`)
3. Add the environment variables (**Project → Settings → Environment Variables**),
   copying from `.env.example`:

   | Variable | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://YOUR-PROJECT-ref.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | your anon/public key |
   | `VITE_AUTH_EMAIL_DOMAIN` | `hooliv.local` (must match the Edge Function secret) |

4. Deploy. Log in with the admin phone/password from Step 3.

### Run locally (optional)

```bash
cp .env.example .env    # fill in the values
npm install
npm run dev             # http://localhost:5173
```

---

## How it works (for maintainers)

- **`client/src/lib/supabase.ts`** — the Supabase client and the
  `{phone}@{domain}` email helper.
- **`client/src/lib/apiAdapter.ts`** — installs a global `fetch` interceptor.
  Any `/api/*` request is translated into the right `supabase.rpc(...)`, Auth,
  Storage, or Edge Function call and returned as a `Response`, so the rest of the
  app is untouched. It also enforces the "must change password" gate and, on
  file upload, parses the spreadsheet in the browser (SheetJS) before calling
  `rpc_bulk_upsert_tenants`.
- Two UI spots can't be reached by `fetch` and were adjusted directly:
  - **CSV export** (was `window.open`) now builds the file client-side via
    `exportTenantsCsv`.
  - **Ticket attachment images** now use the signed Storage URL attached to each
    attachment row instead of the old `/api/attachments/:id/view` route.

### Auth model

Login is still phone + password. Internally the phone becomes
`{phone}@{VITE_AUTH_EMAIL_DOMAIN}` for Supabase Auth. Each profile row links to
its Auth user via `auth_id`, while keeping an integer `id` (the UI relies on
integer user IDs).

---

## Troubleshooting

- **Login fails for a brand-new project** — make sure you ran Step 3
  (`bootstrap_admin`) and that `VITE_AUTH_EMAIL_DOMAIN` matches the Edge
  Function's `AUTH_EMAIL_DOMAIN`.
- **"You must change your password…"** — expected for users created by an admin
  or after a password reset; set a new password when prompted.
- **User management actions fail** — confirm the `admin-users` function is
  deployed and that the signed-in user is a Regional Head.
- **Attachments don't display** — the bucket is created by `05_storage.sql`;
  confirm it exists and that the storage policies were applied. Only attachments
  uploaded after migration are available (old base64 attachments were not
  migrated).
- **Everything 404s through the app** — verify the SQL ran in order and that
  `03_functions.sql` completed (it grants `EXECUTE` on every `rpc_*` to the
  `authenticated` role at the end).
