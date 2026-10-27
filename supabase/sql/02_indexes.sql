-- ============================================================================
-- HooLiv Dues Manager — 02_indexes.sql
-- Every index from the original schema is reproduced (they are load-bearing at
-- 100k+ tenant rows: server-side filtering/sorting/pagination depend on them).
-- ============================================================================

-- tenants ---------------------------------------------------------------------
create unique index if not exists tenants_primary_phone_idx on public.tenants (primary_phone);
create index        if not exists tenants_city_idx          on public.tenants (city);
create index        if not exists tenants_property_idx      on public.tenants (property_name);
create index        if not exists tenants_payment_status_idx on public.tenants (payment_status);
create index        if not exists tenants_tenant_name_idx   on public.tenants (tenant_name);
create index        if not exists tenants_city_property_idx on public.tenants (city, property_name);
create index        if not exists tenants_room_no_idx       on public.tenants (room_no);

-- tenant_activity_log ---------------------------------------------------------
create index if not exists activity_log_tenant_id_idx        on public.tenant_activity_log (tenant_id);
create index if not exists activity_log_tenant_phone_idx     on public.tenant_activity_log (tenant_phone);
create index if not exists activity_log_created_at_idx       on public.tenant_activity_log (created_at);
create index if not exists activity_log_phone_type_date_idx  on public.tenant_activity_log (tenant_phone, activity_type, created_at);
create index if not exists activity_log_phone_created_idx    on public.tenant_activity_log (tenant_phone, created_at);

-- app_settings ----------------------------------------------------------------
create unique index if not exists app_settings_key_idx on public.app_settings (setting_key);

-- profiles (was users) --------------------------------------------------------
create unique index if not exists profiles_phone_idx on public.profiles (phone);

-- tickets ---------------------------------------------------------------------
create index if not exists tickets_tenant_phone_idx on public.tickets (tenant_phone);
create index if not exists tickets_assignee_id_idx  on public.tickets (assignee_id);
create index if not exists tickets_status_idx       on public.tickets (status);
create index if not exists tickets_urgency_idx      on public.tickets (urgency);

-- ticket_comments -------------------------------------------------------------
create index if not exists ticket_comments_ticket_id_idx on public.ticket_comments (ticket_id);

-- ticket_attachments ----------------------------------------------------------
create index if not exists ticket_attachments_ticket_id_idx on public.ticket_attachments (ticket_id);

-- Helpful extra index for the JSONB "commitments" lookups used across the
-- dashboard/analytics queries (original relied on the phone/created_at indexes;
-- this GIN index accelerates the `metadata ? 'commitments'` containment checks).
create index if not exists activity_log_metadata_gin_idx
  on public.tenant_activity_log using gin (metadata jsonb_path_ops);
