-- ============================================================================
-- HooLiv Dues Manager — 04_rls.sql
-- Row Level Security. The application talks to the database EXCLUSIVELY through
-- the SECURITY DEFINER rpc_* functions in 03_functions.sql, each of which runs
-- its own auth + RBAC check. Those functions run as the table owner and so are
-- unaffected by the policies below.
--
-- For defense-in-depth we therefore LOCK DOWN all direct (PostgREST) table
-- access: RLS is enabled on every table and direct table privileges are revoked
-- from anon/authenticated. Any accidental direct query returns nothing; the only
-- way in is the vetted RPCs. `service_role` (used by the admin Edge Function)
-- bypasses RLS as usual.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'tenants','tenant_activity_log','column_mappings','upload_history',
    'activity_reset_log','app_settings','profiles','tickets','ticket_comments',
    'ticket_attachments','partial_payment_handlers'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    -- remove any default table-level DML privileges from the API roles
    execute format('revoke all on public.%I from anon, authenticated;', t);
  end loop;
end $$;

-- No permissive policies are defined for anon/authenticated on purpose: all
-- reads/writes must go through the rpc_* functions. If you later want to expose
-- a table directly via PostgREST, add explicit policies here.

-- Example (left commented) of how you would open up read-only profile access
-- to the owning user, should you ever bypass the RPC layer:
--
-- create policy profiles_self_select on public.profiles
--   for select to authenticated using (auth_id = auth.uid());
