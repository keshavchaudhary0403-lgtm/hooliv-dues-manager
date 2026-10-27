-- ============================================================================
-- HooLiv Dues Manager — 01_tables.sql
-- Schema migrated 1:1 from the original Drizzle definitions (shared/schema.ts).
-- Runs on a fresh Supabase Postgres database.
-- ----------------------------------------------------------------------------
-- Notable adaptations vs. the original:
--   * The original `users` table (custom bcrypt auth) becomes `profiles`, keyed
--     to Supabase Auth's `auth.users(id)`. Login/password now live in Supabase
--     Auth; `profiles` carries role, permissions and city/property assignments.
--   * `ticket_attachments.data` (base64 blob) is replaced by `storage_path`
--     pointing at an object in the `ticket-attachments` Storage bucket.
--   * The connect-pg-simple `session` table is dropped (Supabase Auth uses JWTs).
-- All other tables, columns, types, defaults and NOT NULL constraints are
-- preserved exactly so existing UI code and query shapes keep working.
-- ============================================================================

-- Clean slate (safe to re-run in a dev project) --------------------------------
drop table if exists public.ticket_attachments      cascade;
drop table if exists public.ticket_comments         cascade;
drop table if exists public.tickets                 cascade;
drop table if exists public.partial_payment_handlers cascade;
drop table if exists public.tenant_activity_log     cascade;
drop table if exists public.tenants                 cascade;
drop table if exists public.column_mappings         cascade;
drop table if exists public.upload_history          cascade;
drop table if exists public.activity_reset_log      cascade;
drop table if exists public.app_settings            cascade;
drop table if exists public.profiles                cascade;

-- ----------------------------------------------------------------------------
-- tenants (the 100k+ row core table)
-- ----------------------------------------------------------------------------
create table public.tenants (
  id                     serial primary key,
  tenant_name            text        not null,
  primary_phone          text        not null,
  secondary_phone        text,
  parent_name            text,
  parent_phone           text,
  city                   text        not null,
  property_name          text        not null,
  room_no                text,
  total_amount_due       integer     not null default 0,
  check_in_date          text,
  due_date               text,
  rental_billing_cycle   text,
  checkout_notice_date   text,
  expected_checkout_date text,
  payment_status         text        not null default 'no_update',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- tenant_activity_log — unified remarks + follow-ups, linked by tenant_phone
-- ----------------------------------------------------------------------------
create table public.tenant_activity_log (
  id            serial primary key,
  tenant_id     integer     not null,
  tenant_phone  text        not null default '',
  activity_type text        not null,
  follow_up_date text,
  remark_text   text,
  metadata      jsonb,
  created_by    text        not null,
  created_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- column_mappings — last-used CSV/Excel header mapping (single row kept)
-- ----------------------------------------------------------------------------
create table public.column_mappings (
  id           serial primary key,
  mapping_name text        not null default 'default',
  mapping      jsonb       not null,
  created_at   timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- upload_history
-- ----------------------------------------------------------------------------
create table public.upload_history (
  id               serial primary key,
  file_name        text        not null,
  total_rows       integer     not null default 0,
  records_created  integer     not null default 0,
  records_updated  integer     not null default 0,
  records_failed   integer     not null default 0,
  uploaded_by      text        not null,
  created_at       timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- activity_reset_log
-- ----------------------------------------------------------------------------
create table public.activity_reset_log (
  id               serial primary key,
  reset_by         text        not null,
  records_deleted  integer     not null default 0,
  reset_type       text        not null default 'clear_activity',
  reset_scope      text,
  created_at       timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- app_settings — key/value config (grace period, flag thresholds, master flag)
-- ----------------------------------------------------------------------------
create table public.app_settings (
  id            serial primary key,
  setting_key   text        not null,
  setting_value text        not null,
  updated_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- profiles — replaces the original custom `users` table.
-- IMPORTANT: `id` is an INTEGER surrogate key (exactly like the original
-- `users.id`), because the app and UI treat user/assignee IDs as integers
-- (e.g. tickets.assignee_id, partial_payment_handlers.team_member_id, and
-- `parseInt(newAssigneeId)` in the frontend). `auth_id` links the row to the
-- Supabase Auth user; RBAC resolves the caller via `auth_id = auth.uid()`.
-- `phone` mirrors the login phone (auth email is `{phone}@<AUTH_EMAIL_DOMAIN>`).
-- Permission/active flags kept as integer 0/1 to match original app logic.
-- ----------------------------------------------------------------------------
create table public.profiles (
  id                          serial      primary key,
  auth_id                     uuid        unique references auth.users(id) on delete cascade,
  phone                       text        not null,
  display_name                text        not null,
  role                        text        not null default 'property_manager',
  assigned_cities             text[]      default '{}',
  assigned_properties         text[]      default '{}',
  active                      integer     not null default 1,
  can_manage_uploads          integer     not null default 0,
  can_manage_team             integer     not null default 0,
  can_manage_settings         integer     not null default 0,
  can_export_data             integer     not null default 0,
  can_manage_tickets          integer     not null default 0,
  can_handle_partial_payments integer     not null default 0,
  must_change_password        integer     not null default 0,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- tickets
-- ----------------------------------------------------------------------------
create table public.tickets (
  id            serial primary key,
  tenant_phone  text        not null,
  tenant_id     integer,
  tenant_name   text,
  room_no       text,
  city          text,
  property_name text,
  raised_by     text        not null,
  assignee_id   integer,
  assignee_name text,
  urgency       text        not null default 'medium',
  description   text        not null,
  status        text        not null default 'open',
  sub_reason    text,
  activity_id   integer,
  images        text[],
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- ticket_comments
-- ----------------------------------------------------------------------------
create table public.ticket_comments (
  id                serial primary key,
  ticket_id         integer     not null,
  comment_text      text        not null,
  new_status        text,
  new_assignee_id   integer,
  new_assignee_name text,
  created_by        text        not null,
  created_at        timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- ticket_attachments — file metadata; bytes live in Storage (05_storage.sql)
-- ----------------------------------------------------------------------------
create table public.ticket_attachments (
  id           serial primary key,
  ticket_id    integer     not null,
  filename     text        not null,
  mime_type    text        not null,
  storage_path text        not null,
  created_at   timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- partial_payment_handlers
-- ----------------------------------------------------------------------------
create table public.partial_payment_handlers (
  id             serial primary key,
  city           text        not null,
  property_name  text,
  team_member_id integer     not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Relationships (kept lightweight, matching the original app's loose coupling).
-- The app links activity/tickets to tenants by phone rather than hard FKs, so
-- we add FKs only where the original guaranteed integrity, to avoid breaking
-- the upload flow (which deletes/recreates tenants and re-links by phone).
-- ----------------------------------------------------------------------------
alter table public.ticket_comments
  add constraint ticket_comments_ticket_id_fkey
  foreign key (ticket_id) references public.tickets(id) on delete cascade;

alter table public.ticket_attachments
  add constraint ticket_attachments_ticket_id_fkey
  foreign key (ticket_id) references public.tickets(id) on delete cascade;
