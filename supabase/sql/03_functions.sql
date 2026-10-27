-- ============================================================================
-- HooLiv Dues Manager — 03_functions.sql
-- All server-side business logic from the original Express app, reimplemented
-- as Postgres functions. The static frontend calls these via supabase.rpc(...).
--
-- Security model:
--   * Every RPC is SECURITY DEFINER and does its OWN auth + RBAC check based on
--     the caller's profile (resolved from auth.uid()). This mirrors the old
--     Express middleware (requireAuth / requireAdmin / getUserAccessFilter).
--   * RLS on the tables (04_rls.sql) is a second layer of defense.
--   * Functions return jsonb with camelCase keys so existing UI code and query
--     shapes are preserved exactly.
--
-- Sections:
--   A. Caller/permission helpers
--   B. Master-flag scoring engine (+ per-date variant for trends)
--   C. Settings RPCs
--   D. Profiles / users / team-members RPCs
--   E. Tenants: filtered list, stats, export, filter-options, get/update
--   F. Activity RPCs
--   G. Upload / bulk upsert / resets / mappings / history
--   H. Tickets / comments / attachments / handler lookup
--   I. Analytics: risk-distribution, escalation-trend, collectable-trend
-- ============================================================================

-- ============================================================================
-- SECTION A — Caller / permission helpers
-- ============================================================================

-- Current caller's profile row (or NULL if not signed in / no profile).
create or replace function public.current_profile()
returns public.profiles
language sql stable security definer set search_path = public
as $$
  select p.* from public.profiles p where p.auth_id = auth.uid();
$$;

-- Require an authenticated, active user; raises if not. Returns the profile.
create or replace function public.require_user()
returns public.profiles
language plpgsql stable security definer set search_path = public
as $$
declare pr public.profiles;
begin
  select * into pr from public.profiles where auth_id = auth.uid();
  if pr.id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if pr.active <> 1 then
    raise exception 'Account deactivated' using errcode = '42501';
  end if;
  return pr;
end;
$$;

-- Require regional_head (admin). Returns the profile.
create or replace function public.require_admin()
returns public.profiles
language plpgsql stable security definer set search_path = public
as $$
declare pr public.profiles;
begin
  pr := public.require_user();
  if pr.role <> 'regional_head' then
    raise exception 'Forbidden: Admin access required' using errcode = '42501';
  end if;
  return pr;
end;
$$;

-- Effective permission (regional_head inherits everything). key is a column name.
create or replace function public.has_permission(pr public.profiles, perm text)
returns boolean
language sql immutable
as $$
  select case
    when pr.role = 'regional_head' then true
    when perm = 'canManageUploads'         then pr.can_manage_uploads = 1
    when perm = 'canManageTeam'            then pr.can_manage_team = 1
    when perm = 'canManageSettings'        then pr.can_manage_settings = 1
    when perm = 'canExportData'            then pr.can_export_data = 1
    when perm = 'canManageTickets'         then pr.can_manage_tickets = 1
    when perm = 'canHandlePartialPayments' then pr.can_handle_partial_payments = 1
    else false
  end;
$$;

-- Build the permissions jsonb object exactly as the old API returned it.
create or replace function public.permissions_json(pr public.profiles)
returns jsonb
language sql immutable
as $$
  select jsonb_build_object(
    'canManageUploads',         public.has_permission(pr, 'canManageUploads'),
    'canManageTeam',            public.has_permission(pr, 'canManageTeam'),
    'canManageSettings',        public.has_permission(pr, 'canManageSettings'),
    'canExportData',            public.has_permission(pr, 'canExportData'),
    'canManageTickets',         public.has_permission(pr, 'canManageTickets'),
    'canHandlePartialPayments', public.has_permission(pr, 'canHandlePartialPayments')
  );
$$;

-- Human-readable role label map (matches USER_ROLE_LABELS in schema.ts).
create or replace function public.role_label(r text)
returns text language sql immutable as $$
  select case r
    when 'regional_head'   then 'Regional Head'
    when 'city_head'       then 'City Head'
    when 'cluster_manager' then 'Cluster Manager'
    when 'sr_pm'           then 'Sr. PM'
    when 'property_manager' then 'Property Manager'
    when 'mgmt_trainee'    then 'Mgmt. Trainee'
    else r
  end;
$$;

-- Access scope for the caller: NULL arrays => unrestricted (regional_head or
-- users with no explicit assignment, matching getUserAccessFilter()).
create or replace function public.caller_allowed_cities(pr public.profiles)
returns text[] language sql immutable as $$
  select case
    when pr.role = 'regional_head' then null
    when coalesce(array_length(pr.assigned_cities,1),0) > 0 then pr.assigned_cities
    else null
  end;
$$;
create or replace function public.caller_allowed_properties(pr public.profiles)
returns text[] language sql immutable as $$
  select case
    when pr.role = 'regional_head' then null
    when coalesce(array_length(pr.assigned_properties,1),0) > 0 then pr.assigned_properties
    else null
  end;
$$;

-- App setting getter/setter (mirrors storage.getAppSetting/setAppSetting).
create or replace function public.get_app_setting(p_key text)
returns text language sql stable security definer set search_path = public as $$
  select setting_value from public.app_settings where setting_key = p_key;
$$;

create or replace function public.set_app_setting(p_key text, p_value text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.app_settings (setting_key, setting_value, updated_at)
  values (p_key, p_value, now())
  on conflict (setting_key) do update set setting_value = excluded.setting_value, updated_at = now();
end;
$$;

-- Default master-flag config (matches DEFAULT_MASTER_FLAG_CONFIG in storage.ts).
create or replace function public.default_master_flag_config()
returns jsonb language sql immutable as $$
  select '{
    "enabled": false,
    "warningThreshold": 3,
    "criticalThreshold": 7,
    "conditions": [
      {"id":"overdue_days_default","type":"overdue_days","weight":3,"threshold":30,"enabled":true},
      {"id":"amount_due_default","type":"amount_due","weight":2,"threshold":5000,"enabled":true},
      {"id":"followup_missed_default","type":"followup_missed","weight":2,"threshold":7,"enabled":true}
    ]
  }'::jsonb;
$$;

create or replace function public.master_flag_config()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    (select setting_value::jsonb from public.app_settings where setting_key = 'master_flag_config'),
    public.default_master_flag_config()
  );
$$;

-- ============================================================================
-- SECTION B — Master-flag scoring engine
-- Direct translation of computeMasterFlagScore() / computeScoreForDate().
-- Given a tenant's derived fields + config + reference date, returns score/level.
-- SUSPENSE_OR_SETTLED = paid, already_paid, refund_adjustment, payment_not_updated
-- ============================================================================
create or replace function public.compute_master_flag(
  p_due_date               text,
  p_payment_status         text,
  p_total_amount_due       numeric,
  p_checkout_notice_date   text,
  p_expected_checkout_date text,
  p_latest_follow_up_date  text,
  p_follow_up_count        integer,
  p_missed_commitment      boolean,
  p_config                 jsonb,
  p_ref_date               date default current_date
) returns jsonb
language plpgsql immutable
as $$
declare
  cond              jsonb;
  total_score       numeric := 0;
  cond_type         text;
  cond_enabled      boolean;
  threshold         numeric;
  weight            numeric;
  is_suspense       boolean;
  today_str         text := to_char(p_ref_date, 'YYYY-MM-DD');
  warning_threshold numeric;
  critical_threshold numeric;
  diff              numeric;
  days_until        numeric;
begin
  if p_config is null or (p_config->>'enabled')::boolean is not true
     or jsonb_array_length(coalesce(p_config->'conditions','[]'::jsonb)) = 0 then
    return jsonb_build_object('score', 0, 'level', 'none');
  end if;

  is_suspense := p_payment_status in ('paid','already_paid','refund_adjustment','payment_not_updated');

  for cond in select * from jsonb_array_elements(p_config->'conditions')
  loop
    cond_enabled := coalesce((cond->>'enabled')::boolean, false);
    if not cond_enabled then continue; end if;
    cond_type := cond->>'type';
    threshold := coalesce((cond->>'threshold')::numeric, 0);
    weight    := coalesce((cond->>'weight')::numeric, 0);

    if cond_type = 'overdue_days' then
      if p_due_date is not null and not is_suspense then
        begin
          diff := floor((p_ref_date - p_due_date::date));
          if diff > threshold then total_score := total_score + weight; end if;
        exception when others then null; end;
      end if;

    elsif cond_type = 'amount_due' then
      if not is_suspense and p_total_amount_due > threshold then
        total_score := total_score + weight;
      end if;

    elsif cond_type = 'followup_missed' then
      if p_latest_follow_up_date is not null
         and p_latest_follow_up_date < today_str
         and not is_suspense then
        total_score := total_score + weight;
      end if;

    elsif cond_type = 'checkout_notice_dues' then
      if p_checkout_notice_date is not null and p_checkout_notice_date <> ''
         and p_total_amount_due > 0 and not is_suspense then
        total_score := total_score + weight;
      end if;

    elsif cond_type = 'expected_checkout_days' then
      if p_expected_checkout_date is not null and p_expected_checkout_date <> ''
         and p_checkout_notice_date is not null and p_checkout_notice_date <> ''
         and not is_suspense then
        begin
          days_until := floor((p_expected_checkout_date::date - p_ref_date));
          if days_until <= threshold and days_until >= 0 and p_total_amount_due > 0 then
            total_score := total_score + weight;
          end if;
        exception when others then null; end;
      end if;

    elsif cond_type = 'partial_payment_remaining' then
      if p_payment_status = 'partial_payment' and p_total_amount_due > threshold then
        total_score := total_score + weight;
      end if;

    elsif cond_type = 'repeated_overdue' then
      if not is_suspense and coalesce(p_follow_up_count,0) >= threshold and p_total_amount_due > 0 then
        total_score := total_score + weight;
      end if;

    elsif cond_type = 'manual_escalation' then
      if coalesce(p_missed_commitment,false) and p_total_amount_due > 0 then
        total_score := total_score + weight;
      end if;
    end if;
  end loop;

  warning_threshold  := coalesce((p_config->>'warningThreshold')::numeric, 0);
  critical_threshold := coalesce((p_config->>'criticalThreshold')::numeric, 0);

  if critical_threshold > 0 and total_score >= critical_threshold then
    return jsonb_build_object('score', total_score, 'level', 'critical');
  elsif warning_threshold > 0 and total_score >= warning_threshold then
    return jsonb_build_object('score', total_score, 'level', 'warning');
  else
    return jsonb_build_object('score', total_score, 'level', 'none');
  end if;
end;
$$;

-- ============================================================================
-- Enriched tenant view — computes the per-tenant derived fields the original
-- queries built with LATERAL joins:
--   latest_follow_up_date : most recent FOLLOW_UP activity's follow_up_date
--   latest_activity_at    : most recent activity timestamp (any type)
--   follow_up_count       : count of FOLLOW_UP activities
--   missed_commitment     : has an unpaid past-dated commitment in latest metadata
-- ============================================================================
create or replace view public.tenant_enriched as
select
  t.*,
  fu.follow_up_date as latest_follow_up_date,
  la.latest_activity_at,
  coalesce(fuc.fu_count, 0) as follow_up_count,
  coalesce(mc.missed, false) as missed_commitment
from public.tenants t
left join lateral (
  select a.follow_up_date from public.tenant_activity_log a
  where a.tenant_phone = t.primary_phone and a.activity_type = 'FOLLOW_UP' and a.follow_up_date is not null
  order by a.created_at desc limit 1
) fu on true
left join lateral (
  select a.created_at as latest_activity_at from public.tenant_activity_log a
  where a.tenant_phone = t.primary_phone
  order by a.created_at desc limit 1
) la on true
left join lateral (
  select count(*)::int as fu_count from public.tenant_activity_log a
  where a.tenant_phone = t.primary_phone and a.activity_type = 'FOLLOW_UP'
) fuc on true
left join lateral (
  select exists(
    select 1 from public.tenant_activity_log a,
      lateral jsonb_array_elements(a.metadata->'commitments') as c
    where a.tenant_phone = t.primary_phone
      and a.metadata is not null and a.metadata ? 'commitments'
      and (c->>'date')::date < current_date
      and t.total_amount_due > 0
      and t.payment_status not in ('paid','already_paid','refund_adjustment','payment_not_updated')
  ) as missed
) mc on true;

-- Convert an enriched tenant row to the camelCase jsonb shape the UI expects,
-- optionally attaching master-flag score/level.
create or replace function public.tenant_row_json(r public.tenant_enriched, p_config jsonb default null)
returns jsonb
language plpgsql stable
as $$
declare flag jsonb := jsonb_build_object('score',0,'level','none');
begin
  if p_config is not null and (p_config->>'enabled')::boolean is true then
    flag := public.compute_master_flag(
      r.due_date, r.payment_status, r.total_amount_due,
      r.checkout_notice_date, r.expected_checkout_date,
      r.latest_follow_up_date, r.follow_up_count, r.missed_commitment, p_config);
  end if;
  return jsonb_build_object(
    'id', r.id,
    'tenantName', r.tenant_name,
    'primaryPhone', r.primary_phone,
    'secondaryPhone', r.secondary_phone,
    'parentName', r.parent_name,
    'parentPhone', r.parent_phone,
    'city', r.city,
    'propertyName', r.property_name,
    'roomNo', r.room_no,
    'totalAmountDue', r.total_amount_due,
    'checkInDate', r.check_in_date,
    'dueDate', r.due_date,
    'rentalBillingCycle', r.rental_billing_cycle,
    'checkoutNoticeDate', r.checkout_notice_date,
    'expectedCheckoutDate', r.expected_checkout_date,
    'paymentStatus', r.payment_status,
    'createdAt', r.created_at,
    'updatedAt', r.updated_at,
    'latestFollowUpDate', r.latest_follow_up_date,
    'latestActivityAt', r.latest_activity_at,
    'missedCommitment', r.missed_commitment,
    'followUpCount', r.follow_up_count,
    'masterFlagScore', (flag->>'score')::numeric,
    'masterFlagLevel', flag->>'level'
  );
end;
$$;

-- Plain tenant (no enrichment) → camelCase jsonb, for get/update endpoints.
create or replace function public.plain_tenant_json(t public.tenants)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', t.id, 'tenantName', t.tenant_name, 'primaryPhone', t.primary_phone,
    'secondaryPhone', t.secondary_phone, 'parentName', t.parent_name, 'parentPhone', t.parent_phone,
    'city', t.city, 'propertyName', t.property_name, 'roomNo', t.room_no,
    'totalAmountDue', t.total_amount_due, 'checkInDate', t.check_in_date, 'dueDate', t.due_date,
    'rentalBillingCycle', t.rental_billing_cycle, 'checkoutNoticeDate', t.checkout_notice_date,
    'expectedCheckoutDate', t.expected_checkout_date, 'paymentStatus', t.payment_status,
    'createdAt', t.created_at, 'updatedAt', t.updated_at
  );
$$;

-- ============================================================================
-- SECTION C — Settings RPCs
-- ============================================================================

-- GET /api/settings/grace-period
create or replace function public.rpc_get_grace_period()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.require_user();
  return jsonb_build_object('gracePeriodDays', coalesce(public.get_app_setting('grace_period_days')::int, 5));
end; $$;

-- PUT /api/settings/grace-period
create or replace function public.rpc_set_grace_period(p_days int)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'Grace period must be between 1 and 90 days';
  end if;
  perform public.set_app_setting('grace_period_days', p_days::text);
  return jsonb_build_object('success', true, 'gracePeriodDays', p_days);
end; $$;

-- GET /api/settings/master-flag
create or replace function public.rpc_get_master_flag()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.require_user();
  return public.master_flag_config();
end; $$;

-- PUT /api/settings/master-flag
create or replace function public.rpc_set_master_flag(p_config jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare wt numeric; ct numeric;
begin
  perform public.require_admin();
  if p_config is null or (p_config ? 'enabled') is false
     or (p_config ? 'conditions') is false then
    raise exception 'Invalid master flag configuration';
  end if;
  wt := coalesce((p_config->>'warningThreshold')::numeric, 0);
  ct := coalesce((p_config->>'criticalThreshold')::numeric, 0);
  if (p_config->>'enabled')::boolean and wt >= ct and ct > 0 then
    raise exception 'Warning threshold must be less than Critical threshold';
  end if;
  perform public.set_app_setting('master_flag_config', p_config::text);
  return p_config;
end; $$;

-- GET /api/settings/flag-thresholds
create or replace function public.rpc_get_flag_thresholds()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.require_user();
  return jsonb_build_object(
    'orangeFlagDays',         coalesce(public.get_app_setting('orange_flag_days')::int, 15),
    'redFlagDays',            coalesce(public.get_app_setting('red_flag_days')::int, 30),
    'dueDateOrangeFlagDays',  coalesce(public.get_app_setting('due_date_orange_flag_days')::int, 3),
    'dueDateRedFlagDays',     coalesce(public.get_app_setting('due_date_red_flag_days')::int, 7),
    'followUpOrangeFlagDays', coalesce(public.get_app_setting('follow_up_orange_flag_days')::int, 2),
    'followUpRedFlagDays',    coalesce(public.get_app_setting('follow_up_red_flag_days')::int, 5)
  );
end; $$;

-- PUT /api/settings/flag-thresholds
create or replace function public.rpc_set_flag_thresholds(
  p_orange int, p_red int,
  p_dd_orange int default null, p_dd_red int default null,
  p_fu_orange int default null, p_fu_red int default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if p_orange is null or p_red is null then
    raise exception 'orangeFlagDays and redFlagDays must be numbers';
  end if;
  if p_orange < 1 or p_red < 1 or p_orange >= p_red then
    raise exception 'Orange days must be less than Red days, both must be >= 1';
  end if;
  perform public.set_app_setting('orange_flag_days', p_orange::text);
  perform public.set_app_setting('red_flag_days', p_red::text);
  if p_dd_orange is not null and p_dd_red is not null then
    if p_dd_orange < 1 or p_dd_red < 1 or p_dd_orange >= p_dd_red then
      raise exception 'Due Date orange days must be less than red days, both >= 1';
    end if;
    perform public.set_app_setting('due_date_orange_flag_days', p_dd_orange::text);
    perform public.set_app_setting('due_date_red_flag_days', p_dd_red::text);
  end if;
  if p_fu_orange is not null and p_fu_red is not null then
    if p_fu_orange < 1 or p_fu_red < 1 or p_fu_orange >= p_fu_red then
      raise exception 'Follow-Up orange days must be less than red days, both >= 1';
    end if;
    perform public.set_app_setting('follow_up_orange_flag_days', p_fu_orange::text);
    perform public.set_app_setting('follow_up_red_flag_days', p_fu_red::text);
  end if;
  return jsonb_build_object(
    'orangeFlagDays', p_orange, 'redFlagDays', p_red,
    'dueDateOrangeFlagDays', p_dd_orange, 'dueDateRedFlagDays', p_dd_red,
    'followUpOrangeFlagDays', p_fu_orange, 'followUpRedFlagDays', p_fu_red
  );
end; $$;

-- ============================================================================
-- SECTION D — Profiles / users / team-members
-- ============================================================================

-- Public-safe profile → jsonb (matches the old "safe user" shapes).
create or replace function public.profile_json(p public.profiles)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', p.id,
    'phone', p.phone,
    'displayName', p.display_name,
    'role', p.role,
    'roleLabel', public.role_label(p.role),
    'assignedCities', coalesce(p.assigned_cities, '{}'),
    'assignedProperties', coalesce(p.assigned_properties, '{}'),
    'active', p.active,
    'createdAt', p.created_at,
    'permissions', public.permissions_json(p)
  );
$$;

-- GET /api/auth/me  (also the login response body)
create or replace function public.rpc_me()
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  select * into p from public.profiles where auth_id = auth.uid();
  if p.id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p.active <> 1 then
    raise exception 'Account deactivated' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'id', p.id,
    'phone', p.phone,
    'displayName', p.display_name,
    'role', p.role,
    'roleLabel', public.role_label(p.role),
    'assignedCities', coalesce(p.assigned_cities, '{}'),
    'assignedProperties', coalesce(p.assigned_properties, '{}'),
    'permissions', public.permissions_json(p),
    'mustChangePassword', p.must_change_password = 1
  );
end; $$;

-- Called by the set-password edge function / self password change to clear flag.
create or replace function public.rpc_mark_password_changed()
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  p := public.require_user();
  update public.profiles set must_change_password = 0, updated_at = now() where id = p.id;
  return jsonb_build_object('message', 'Password updated successfully');
end; $$;

-- GET /api/users  (admin only) — full list with permissions
create or replace function public.rpc_list_users()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(public.profile_json(p) order by p.display_name)
    from public.profiles p
  ), '[]'::jsonb);
end; $$;

-- GET /api/team-members?active=&city=
-- Returns profiles (without password), optionally active-only and city-scoped.
create or replace function public.rpc_team_members(p_active boolean default false, p_city text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare city_props text[];
begin
  perform public.require_user();
  if p_city is not null and p_city <> '' then
    select array_agg(distinct property_name) into city_props from public.tenants where city = p_city;
    return coalesce((
      select jsonb_agg(public.profile_json(m) order by m.display_name)
      from public.profiles m
      where (not p_active or m.active = 1)
        and (
          m.role = 'regional_head'
          or (m.assigned_cities @> array[p_city])
          or (coalesce(array_length(m.assigned_properties,1),0) > 0
              and m.assigned_properties && coalesce(city_props, '{}'))
        )
    ), '[]'::jsonb);
  end if;
  return coalesce((
    select jsonb_agg(public.profile_json(m) order by m.display_name)
    from public.profiles m
    where (not p_active or m.active = 1)
  ), '[]'::jsonb);
end; $$;

-- GET /api/partial-payment-handlers/lookup?city=&property=
create or replace function public.rpc_partial_payment_handler_lookup(p_city text, p_property text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare h public.profiles;
begin
  perform public.require_user();
  if p_city is null or p_property is null then
    raise exception 'city and property required';
  end if;
  select * into h from public.profiles
   where active = 1 and can_handle_partial_payments = 1
     and assigned_cities @> array[p_city]
     and assigned_properties @> array[p_property]
   limit 1;
  if h.id is null then return 'null'::jsonb; end if;
  return jsonb_build_object('teamMemberId', h.id, 'memberName', h.display_name);
end; $$;

-- ============================================================================
-- SECTION E — Tenants
-- ============================================================================

-- ----------------------------------------------------------------------------
-- GET /api/tenants  — filtered, sorted, paginated list.
-- Faithful translation of storage.getFilteredTenants(). Access scope is derived
-- from the caller's profile (regional_head => unrestricted).
-- p_filters is a jsonb bag mirroring the query params:
--   search, city, property(array or csv), status, followUp, sortField, sortDir,
--   flagOverdue, flagDueDate, flagFollowUp, collectableDate, amountAbove,
--   amountBelow, billingCycle, hasCheckoutNotice, masterEscalation
-- ----------------------------------------------------------------------------
create or replace function public.rpc_filtered_tenants(
  p_page int default 1,
  p_page_size int default 50,
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  pr public.profiles;
  allowed_cities text[];
  allowed_props  text[];
  v_search text; v_city text; v_status text; v_followup text;
  v_sort_field text; v_sort_dir text; v_flag_overdue text; v_flag_due text; v_flag_fu text;
  v_collectable text; v_billing text; v_checkout text; v_escalation text;
  v_props text[]; v_billing_arr text[]; v_city_arr text[];
  v_amount_above numeric; v_amount_below numeric;
  orange int; red int; dd_o int; dd_r int; fu_o int; fu_r int;
  today text := to_char(current_date,'YYYY-MM-DD');
  tomorrow text := to_char(current_date+1,'YYYY-MM-DD');
  eow text := to_char(current_date + (7 - extract(dow from current_date))::int, 'YYYY-MM-DD');
  where_sql text := ' where t.payment_status != ''already_paid'' ';
  order_sql text;
  dir_sql text;
  cfg jsonb;
  mf_enabled boolean;
  offset_val int := (p_page - 1) * p_page_size;
  rec public.tenant_enriched;
  items jsonb := '[]'::jsonb;
  total int := 0;
  total_due numeric := 0;
  value_at_risk numeric := 0;
  escalated int := 0;
  lvl text;
  q text;
begin
  pr := public.require_user();
  allowed_cities := public.caller_allowed_cities(pr);
  allowed_props  := public.caller_allowed_properties(pr);

  cfg := public.master_flag_config();
  mf_enabled := (cfg->>'enabled')::boolean;

  -- read filter values
  v_search      := nullif(p_filters->>'search','');
  v_city        := nullif(p_filters->>'city','');
  v_status      := nullif(p_filters->>'status','');
  v_followup    := nullif(p_filters->>'followUp','');
  v_sort_field  := coalesce(nullif(p_filters->>'sortField',''), 'totalAmountDue');
  v_sort_dir    := coalesce(nullif(p_filters->>'sortDir',''), 'desc');
  v_flag_overdue:= nullif(p_filters->>'flagOverdue','');
  v_flag_due    := nullif(p_filters->>'flagDueDate','');
  v_flag_fu     := nullif(p_filters->>'flagFollowUp','');
  v_collectable := nullif(p_filters->>'collectableDate','');
  v_billing     := nullif(p_filters->>'billingCycle','');
  v_checkout    := nullif(p_filters->>'hasCheckoutNotice','');
  v_escalation  := nullif(p_filters->>'masterEscalation','');
  if p_filters ? 'amountAbove' and p_filters->>'amountAbove' is not null then v_amount_above := (p_filters->>'amountAbove')::numeric; end if;
  if p_filters ? 'amountBelow' and p_filters->>'amountBelow' is not null then v_amount_below := (p_filters->>'amountBelow')::numeric; end if;

  -- property may arrive as array or csv string
  if jsonb_typeof(p_filters->'property') = 'array' then
    select array_agg(value) into v_props from jsonb_array_elements_text(p_filters->'property');
  elsif v_city is not null then null;
  end if;
  if p_filters->>'property' is not null and jsonb_typeof(p_filters->'property') = 'string' then
    v_props := string_to_array(p_filters->>'property', ',');
  end if;

  -- access scope
  if allowed_cities is not null then
    where_sql := where_sql || format(' and t.city = any(%L) ', allowed_cities);
  end if;
  if allowed_props is not null then
    where_sql := where_sql || format(' and t.property_name = any(%L) ', allowed_props);
  end if;

  -- search
  if v_search is not null then
    where_sql := where_sql || format(
      ' and (t.tenant_name ilike %L or t.primary_phone ilike %L or t.room_no ilike %L) ',
      '%'||v_search||'%','%'||v_search||'%','%'||v_search||'%');
  end if;

  -- city (single / csv / multi)
  if v_city is not null and v_city <> 'all' then
    if position(',' in v_city) > 0 then v_city_arr := string_to_array(v_city, ','); else v_city_arr := array[v_city]; end if;
    where_sql := where_sql || format(' and t.city = any(%L) ', v_city_arr);
  end if;

  -- property
  if v_props is not null and not (array_length(v_props,1) = 1 and v_props[1] = 'all') then
    where_sql := where_sql || format(' and t.property_name = any(%L) ', v_props);
  end if;

  -- status
  if v_status is not null and v_status <> 'all' then
    if v_status = 'not_paid' then
      where_sql := where_sql || ' and t.payment_status not in (''paid'',''already_paid'',''refund_adjustment'',''payment_not_updated'') ';
    elsif v_status = 'suspense' then
      where_sql := where_sql || ' and t.payment_status in (''paid'',''refund_adjustment'',''payment_not_updated'') ';
    elsif v_status = 'collectable' then
      where_sql := where_sql || $collectable$ and t.primary_phone in (
        select t2.primary_phone from public.tenants t2
        join lateral (
          select follow_up_date from public.tenant_activity_log
          where tenant_phone = t2.primary_phone and activity_type = 'FOLLOW_UP' and follow_up_date is not null
          order by created_at desc limit 1
        ) lf2 on true
        where t2.payment_status = 'pending' and lf2.follow_up_date is not null
          and date_trunc('month', lf2.follow_up_date::date) = date_trunc('month', current_date)
        union
        select per_t.primary_phone from (
          select t3.primary_phone from public.tenants t3
          join lateral (
            select a.metadata from public.tenant_activity_log a
            where a.tenant_phone = t3.primary_phone and a.metadata is not null and a.metadata ? 'commitments'
            order by a.created_at desc limit 1
          ) lc on true
          cross join lateral jsonb_array_elements(lc.metadata->'commitments') as c(value)
          where t3.payment_status not in ('paid','already_paid','refund_adjustment','payment_not_updated')
            and (c.value->>'date') is not null
            and date_trunc('month', (c.value->>'date')::date) = date_trunc('month', current_date)
          group by t3.primary_phone
        ) per_t
      ) $collectable$;
    else
      where_sql := where_sql || format(' and t.payment_status = %L ', v_status);
    end if;
  end if;

  -- followUp (uses enriched latest_follow_up_date via alias fu on the view row)
  if v_followup is not null and v_followup <> 'all' then
    where_sql := where_sql || ' and t.payment_status not in (''paid'',''refund_adjustment'') ';
    if v_followup = 'today' then
      where_sql := where_sql || format(' and te.latest_follow_up_date = %L ', today);
    elsif v_followup = 'tomorrow' then
      where_sql := where_sql || format(' and te.latest_follow_up_date = %L ', tomorrow);
    elsif v_followup = 'this_week' then
      where_sql := where_sql || format(' and te.latest_follow_up_date >= %L and te.latest_follow_up_date <= %L ', today, eow);
    elsif v_followup = 'this_month' then
      where_sql := where_sql || ' and date_trunc(''month'', te.latest_follow_up_date::date) = date_trunc(''month'', current_date) ';
    elsif v_followup = 'overdue' then
      where_sql := where_sql || format(' and te.latest_follow_up_date < %L ', today);
    elsif v_followup = 'later' then
      where_sql := where_sql || format(' and te.latest_follow_up_date > %L ', eow);
    elsif v_followup = 'none' then
      where_sql := where_sql || ' and te.latest_follow_up_date is null ';
    end if;
  end if;

  -- collectableDate
  if v_collectable is not null then
    where_sql := where_sql || format($cd$ and (
      (t.payment_status = 'pending' and exists (
        select 1 from public.tenant_activity_log a2
        where a2.tenant_phone = t.primary_phone and a2.activity_type = 'FOLLOW_UP' and a2.follow_up_date is not null
        and a2.follow_up_date::date = %L::date
        and a2.created_at = (select max(a3.created_at) from public.tenant_activity_log a3 where a3.tenant_phone = t.primary_phone and a3.activity_type='FOLLOW_UP' and a3.follow_up_date is not null)
      ))
      or
      (t.payment_status not in ('paid','already_paid','refund_adjustment','payment_not_updated') and exists (
        select 1 from public.tenant_activity_log a4
        where a4.tenant_phone = t.primary_phone and a4.metadata is not null and a4.metadata ? 'commitments'
        and a4.created_at = (select max(a5.created_at) from public.tenant_activity_log a5 where a5.tenant_phone = t.primary_phone and a5.metadata is not null and a5.metadata ? 'commitments')
        and exists (select 1 from jsonb_array_elements(a4.metadata->'commitments') as c(value) where (c.value->>'date')::date = %L::date)
      ))
    ) $cd$, v_collectable, v_collectable);
  end if;

  -- flagOverdue
  if v_flag_overdue is not null and v_flag_overdue <> 'all' then
    orange := coalesce(public.get_app_setting('orange_flag_days')::int, 15);
    red    := coalesce(public.get_app_setting('red_flag_days')::int, 30);
    where_sql := where_sql || ' and t.payment_status not in (''paid'',''already_paid'',''refund_adjustment'',''payment_not_updated'') and t.due_date is not null ';
    if v_flag_overdue = 'red' then
      where_sql := where_sql || format(' and (current_date - t.due_date::date) >= %s ', red);
    elsif v_flag_overdue = 'orange' then
      where_sql := where_sql || format(' and (current_date - t.due_date::date) >= %s and (current_date - t.due_date::date) < %s ', orange, red);
    else
      where_sql := where_sql || format(' and (current_date - t.due_date::date) >= %s ', orange);
    end if;
  end if;

  -- flagDueDate
  if v_flag_due is not null and v_flag_due <> 'all' then
    dd_o := coalesce(public.get_app_setting('due_date_orange_flag_days')::int, 3);
    dd_r := coalesce(public.get_app_setting('due_date_red_flag_days')::int, 7);
    where_sql := where_sql || ' and t.payment_status not in (''paid'',''already_paid'',''refund_adjustment'',''payment_not_updated'') and t.due_date is not null ';
    if v_flag_due = 'red' then
      where_sql := where_sql || format(' and (current_date - t.due_date::date) >= %s ', dd_r);
    elsif v_flag_due = 'orange' then
      where_sql := where_sql || format(' and (current_date - t.due_date::date) >= %s and (current_date - t.due_date::date) < %s ', dd_o, dd_r);
    else
      where_sql := where_sql || format(' and (current_date - t.due_date::date) >= %s ', dd_o);
    end if;
  end if;

  -- flagFollowUp
  if v_flag_fu is not null and v_flag_fu <> 'all' then
    fu_o := coalesce(public.get_app_setting('follow_up_orange_flag_days')::int, 2);
    fu_r := coalesce(public.get_app_setting('follow_up_red_flag_days')::int, 5);
    where_sql := where_sql || ' and te.latest_follow_up_date is not null ';
    if v_flag_fu = 'red' then
      where_sql := where_sql || format(' and (current_date - te.latest_follow_up_date::date) >= %s ', fu_r);
    elsif v_flag_fu = 'orange' then
      where_sql := where_sql || format(' and (current_date - te.latest_follow_up_date::date) >= %s and (current_date - te.latest_follow_up_date::date) < %s ', fu_o, fu_r);
    else
      where_sql := where_sql || format(' and (current_date - te.latest_follow_up_date::date) >= %s ', fu_o);
    end if;
  end if;

  -- amount
  if v_amount_above is not null then where_sql := where_sql || format(' and t.total_amount_due >= %s ', v_amount_above); end if;
  if v_amount_below is not null then where_sql := where_sql || format(' and t.total_amount_due <= %s ', v_amount_below); end if;

  -- billingCycle
  if v_billing is not null and v_billing <> 'all' then
    if position(',' in v_billing) > 0 then v_billing_arr := string_to_array(v_billing, ','); else v_billing_arr := array[v_billing]; end if;
    where_sql := where_sql || format(' and t.rental_billing_cycle = any(%L) ', v_billing_arr);
  end if;

  -- hasCheckoutNotice
  if v_checkout = 'yes' then
    where_sql := where_sql || ' and t.checkout_notice_date is not null and t.checkout_notice_date != '''' ';
  elsif v_checkout = 'no' then
    where_sql := where_sql || ' and (t.checkout_notice_date is null or t.checkout_notice_date = '''') ';
  end if;

  -- ORDER BY (te.* aliases the enriched view columns)
  dir_sql := case when v_sort_dir = 'desc' then 'desc nulls last' else 'asc nulls last' end;
  order_sql := case v_sort_field
    when 'totalAmountDue' then format('te.total_amount_due %s, case when te.payment_status in (''paid'',''already_paid'',''refund_adjustment'',''payment_not_updated'') then -9999 when te.due_date is null then -9999 else (current_date - te.due_date::date) end desc nulls last', dir_sql)
    when 'dueDate' then format('te.due_date %s', dir_sql)
    when 'latestFollowUpDate' then format('te.latest_follow_up_date %s', dir_sql)
    when 'daysOverdue' then format('case when te.payment_status in (''paid'',''already_paid'',''refund_adjustment'',''payment_not_updated'') then -9999 when te.due_date is null then -9999 else (current_date - te.due_date::date) end %s, te.total_amount_due desc nulls last', dir_sql)
    when 'latestActivity' then format('te.latest_activity_at %s', dir_sql)
    when 'tenantName' then format('te.tenant_name %s', dir_sql)
    else 'te.latest_activity_at desc nulls last, te.updated_at desc nulls last'
  end;

  -- ==========================================================================
  -- Escalation-filter path: score ALL matching rows, filter by level, then
  -- compute totals + paginate in memory (mirrors the original code path).
  -- ==========================================================================
  if v_escalation is not null and v_escalation <> 'off' and mf_enabled then
    q := format('select te.* from public.tenant_enriched te %s order by %s, te.id asc',
                replace(where_sql,' t.',' te.'), order_sql);

    for rec in execute q loop
      lvl := public.compute_master_flag(rec.due_date, rec.payment_status, rec.total_amount_due,
                rec.checkout_notice_date, rec.expected_checkout_date, rec.latest_follow_up_date,
                rec.follow_up_count, rec.missed_commitment, cfg) ->> 'level';
      -- escalation filter
      if v_escalation = 'all' and lvl not in ('warning','critical') then continue; end if;
      if v_escalation = 'critical' and lvl <> 'critical' then continue; end if;
      if v_escalation = 'warning' and lvl <> 'warning' then continue; end if;
      if v_escalation = 'healthy' and not (lvl = 'none' and rec.total_amount_due > 0) then continue; end if;

      total := total + 1;
      total_due := total_due + coalesce(rec.total_amount_due,0);
      if lvl in ('warning','critical') then
        escalated := escalated + 1;
        value_at_risk := value_at_risk + coalesce(rec.total_amount_due,0);
      end if;
      if total > offset_val and total <= offset_val + p_page_size then
        items := items || public.tenant_row_json(rec, cfg);
      end if;
    end loop;

    return jsonb_build_object(
      'items', items, 'total', total, 'totalDueAmount', total_due,
      'page', p_page, 'pageSize', p_page_size,
      'escalationSummary', jsonb_build_object('totalValueAtRisk', value_at_risk, 'escalatedCount', escalated),
      'masterFlagActive', mf_enabled
    );
  end if;

  -- ==========================================================================
  -- Normal path: count + sum, then paginate in SQL.
  -- ==========================================================================
  execute format('select count(*)::int, coalesce(sum(te.total_amount_due),0)::numeric from public.tenant_enriched te %s',
                 replace(where_sql,' t.',' te.'))
    into total, total_due;

  q := format('select te.* from public.tenant_enriched te %s order by %s, te.id asc limit %s offset %s',
              replace(where_sql,' t.',' te.'), order_sql, p_page_size, offset_val);
  for rec in execute q loop
    items := items || public.tenant_row_json(rec, cfg);
  end loop;

  return jsonb_build_object(
    'items', items, 'total', total, 'totalDueAmount', total_due,
    'page', p_page, 'pageSize', p_page_size, 'masterFlagActive', mf_enabled
  );
end; $$;

-- ----------------------------------------------------------------------------
-- Distinct filter values (cities, properties, cityPropertyMap, billingCycles),
-- scoped to an access filter. Shared by filter-options and dashboard stats.
-- ----------------------------------------------------------------------------
create or replace function public.distinct_filter_values(allowed_cities text[], allowed_props text[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  where_sql text := '';
  cities text[]; props text[]; cycles text[];
  cpmap jsonb := '{}'::jsonb;
  r record;
begin
  if allowed_cities is not null then where_sql := where_sql || format(' and city = any(%L) ', allowed_cities); end if;
  if allowed_props  is not null then where_sql := where_sql || format(' and property_name = any(%L) ', allowed_props); end if;
  if length(where_sql) > 0 then where_sql := ' where ' || substr(where_sql, 6); end if;

  execute format($f$
    select coalesce(array_agg(distinct city order by city) filter (where city is not null),'{}'),
           coalesce(array_agg(distinct property_name) filter (where property_name is not null),'{}')
    from public.tenants %s $f$, where_sql)
    into cities, props;
  -- sort properties
  select coalesce(array_agg(p order by p),'{}') into props from unnest(props) p;

  for r in execute format($f$
      select city, array_agg(distinct property_name order by property_name) as ps
      from public.tenants %s %s city is not null and property_name is not null
      group by city $f$,
      where_sql, case when length(where_sql)>0 then ' and ' else ' where ' end)
  loop
    cpmap := cpmap || jsonb_build_object(r.city, to_jsonb(r.ps));
  end loop;

  execute format($f$
    select coalesce(array_agg(distinct rental_billing_cycle order by rental_billing_cycle)
             filter (where rental_billing_cycle is not null),'{}')
    from public.tenants %s $f$, where_sql)
    into cycles;

  return jsonb_build_object(
    'cities', to_jsonb(cities),
    'properties', to_jsonb(props),
    'cityPropertyMap', cpmap,
    'billingCycles', to_jsonb(cycles)
  );
end; $$;

-- GET /api/tenants/filter-options
create or replace function public.rpc_filter_options()
returns jsonb language plpgsql security definer set search_path = public as $$
declare pr public.profiles;
begin
  pr := public.require_user();
  return public.distinct_filter_values(public.caller_allowed_cities(pr), public.caller_allowed_properties(pr));
end; $$;

-- GET /api/tenants/stats — full dashboard aggregation.
create or replace function public.rpc_dashboard_stats(p_city text default null, p_property text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pr public.profiles;
  allowed_cities text[]; allowed_props text[];
  access_sql text := ''; filt_sql text := ''; where_str text := ''; extra text;
  city_arr text[]; prop_arr text[];
  cnt int;
  fv jsonb;
  agg record; pend record; commit record;
  status_counts jsonb := '{}'::jsonb; city_data jsonb := '[]'::jsonb; prop_data jsonb := '[]'::jsonb;
  orange int; red int; ddo int; ddr int; fuo int; fur int;
  r record;
  flag_overdue jsonb; flag_due jsonb; flag_fu jsonb;
  fu_where text; fu_data jsonb := '[]'::jsonb; this_month_total int := 0;
  bucket text; b jsonb;
begin
  pr := public.require_user();
  allowed_cities := public.caller_allowed_cities(pr);
  allowed_props  := public.caller_allowed_properties(pr);

  if allowed_cities is not null then access_sql := access_sql || format(' and city = any(%L) ', allowed_cities); end if;
  if allowed_props  is not null then access_sql := access_sql || format(' and property_name = any(%L) ', allowed_props); end if;

  -- empty-data short circuit — org-wide, not scoped to the caller's city/property
  -- access. A scoped user whose assigned cities/properties have no matching
  -- tenants right now must still see the real (zero-filled) dashboard, not the
  -- "no CRM data uploaded yet" screen.
  select count(*)::int from public.tenants into cnt;
  if cnt = 0 then
    return jsonb_build_object('hasData',false,'totalTenants',0,'totalDues',0,'pendingCount',0,
      'totalOutstanding',0,'outstandingTenantCount',0,'suspenseDue',0,'suspenseTenantCount',0,
      'collectableDue',0,'collectableTenantCount',0,'cities','[]'::jsonb,'properties','[]'::jsonb,'cityPropertyMap','{}'::jsonb);
  end if;

  fv := public.distinct_filter_values(allowed_cities, allowed_props);

  filt_sql := access_sql;
  if p_city is not null and p_city <> 'all' then
    if position(',' in p_city) > 0 then city_arr := string_to_array(p_city,','); else city_arr := array[p_city]; end if;
    filt_sql := filt_sql || format(' and city = any(%L) ', city_arr);
  end if;
  if p_property is not null then
    if position(',' in p_property) > 0 then prop_arr := string_to_array(p_property,','); else prop_arr := array[p_property]; end if;
    if not (array_length(prop_arr,1)=1 and prop_arr[1]='all') then
      filt_sql := filt_sql || format(' and property_name = any(%L) ', prop_arr);
    end if;
  end if;
  where_str := case when length(filt_sql)>0 then ' where '||substr(filt_sql,6) else '' end;
  extra := case when length(filt_sql)>0 then ' and ' else ' where ' end;

  -- main aggregates
  execute format($f$
    select count(*)::int as "totalTenants",
      coalesce(sum(total_amount_due),0)::bigint as "totalDues",
      count(*) filter (where payment_status='pending')::int as "pendingCount",
      count(*) filter (where payment_status!='already_paid')::int as "outstandingTenantCount",
      coalesce(sum(total_amount_due) filter (where payment_status in ('paid','refund_adjustment','payment_not_updated')),0)::bigint as "suspenseDues",
      count(*) filter (where payment_status in ('paid','refund_adjustment','payment_not_updated'))::int as "suspenseTenantCount"
    from public.tenants %s $f$, where_str) into agg;

  -- pending due (this month follow-ups, excluding those with this-month commitments)
  execute format($f$
    select coalesce(sum(t.total_amount_due),0)::bigint as "pendingDue",
           count(distinct t.primary_phone)::int as "pendingDueCount"
    from public.tenants t
    join lateral (
      select follow_up_date from public.tenant_activity_log
      where tenant_phone=t.primary_phone and activity_type='FOLLOW_UP' and follow_up_date is not null
      order by created_at desc limit 1
    ) lf on true
    %s %s t.payment_status='pending'
      and lf.follow_up_date is not null
      and date_trunc('month', lf.follow_up_date::date)=date_trunc('month', current_date)
      and not exists (
        select 1 from (
          select a2.metadata from public.tenant_activity_log a2
          where a2.tenant_phone=t.primary_phone and a2.metadata is not null and a2.metadata ? 'commitments'
          order by a2.created_at desc limit 1
        ) lc
        cross join lateral jsonb_array_elements(lc.metadata->'commitments') c2
        where (c2.value->>'date') is not null
          and date_trunc('month',(c2.value->>'date')::date)=date_trunc('month',current_date)
      )
  $f$, replace(where_str,' city',' t.city') , extra) into pend;

  -- commitment due (this month commitments for pending/partial)
  execute format($f$
    select coalesce(sum(per_tenant.commitment_total),0)::bigint as "commitmentDue",
           count(*)::int as "commitmentCount"
    from (
      select t.primary_phone, sum((c.value->>'amount')::numeric) as commitment_total
      from public.tenants t
      join lateral (
        select a.metadata from public.tenant_activity_log a
        where a.tenant_phone=t.primary_phone and a.metadata is not null and a.metadata ? 'commitments'
        order by a.created_at desc limit 1
      ) latest_commit on true
      cross join lateral jsonb_array_elements(latest_commit.metadata->'commitments') as c(value)
      %s %s t.payment_status in ('pending','partial_payment')
        and (c.value->>'date') is not null
        and date_trunc('month',(c.value->>'date')::date)=date_trunc('month',current_date)
      group by t.primary_phone
    ) per_tenant
  $f$, replace(where_str,' city',' t.city'), extra) into commit;

  -- status counts
  for r in execute format($f$
      select payment_status as status, count(*)::int as count, coalesce(sum(total_amount_due),0)::bigint as amount
      from public.tenants %s group by payment_status $f$, where_str)
  loop
    status_counts := status_counts || jsonb_build_object(coalesce(r.status,'no_update'),
      jsonb_build_object('count', r.count, 'amount', r.amount));
  end loop;

  -- city / property data
  execute format($f$ select coalesce(jsonb_agg(jsonb_build_object('name',name,'amount',amount) order by amount desc),'[]'::jsonb)
    from (select city as name, coalesce(sum(total_amount_due),0)::bigint as amount from public.tenants %s group by city) s $f$, where_str) into city_data;
  execute format($f$ select coalesce(jsonb_agg(jsonb_build_object('name',name,'amount',amount) order by amount desc),'[]'::jsonb)
    from (select property_name as name, coalesce(sum(total_amount_due),0)::bigint as amount from public.tenants %s group by property_name) s $f$, where_str) into prop_data;

  -- thresholds
  orange := coalesce(public.get_app_setting('orange_flag_days')::int,15);
  red    := coalesce(public.get_app_setting('red_flag_days')::int,30);
  ddo    := coalesce(public.get_app_setting('due_date_orange_flag_days')::int,3);
  ddr    := coalesce(public.get_app_setting('due_date_red_flag_days')::int,7);
  fuo    := coalesce(public.get_app_setting('follow_up_orange_flag_days')::int,2);
  fur    := coalesce(public.get_app_setting('follow_up_red_flag_days')::int,5);

  -- flag buckets helper via inline aggregation
  execute format($f$
    select jsonb_build_object(
      'notFlagged', coalesce(sum(case when bucket='notFlagged' then c else 0 end),0),
      'warning',    coalesce(sum(case when bucket='warning' then c else 0 end),0),
      'critical',   coalesce(sum(case when bucket='critical' then c else 0 end),0))
    from (
      select case when due_date is null then 'notFlagged'
                  when (current_date - due_date::date) >= %s then 'critical'
                  when (current_date - due_date::date) >= %s then 'warning'
                  else 'notFlagged' end as bucket, count(*)::int c
      from public.tenants %s %s payment_status not in ('paid','already_paid','refund_adjustment','payment_not_updated')
      group by 1) s $f$, red, orange, where_str, extra) into flag_overdue;

  execute format($f$
    select jsonb_build_object(
      'notFlagged', coalesce(sum(case when bucket='notFlagged' then c else 0 end),0),
      'warning',    coalesce(sum(case when bucket='warning' then c else 0 end),0),
      'critical',   coalesce(sum(case when bucket='critical' then c else 0 end),0))
    from (
      select case when due_date is null then 'notFlagged'
                  when (current_date - due_date::date) >= %s then 'critical'
                  when (current_date - due_date::date) >= %s then 'warning'
                  else 'notFlagged' end as bucket, count(*)::int c
      from public.tenants %s %s payment_status not in ('paid','already_paid','refund_adjustment','payment_not_updated')
      group by 1) s $f$, ddr, ddo, where_str, extra) into flag_due;

  execute format($f$
    select jsonb_build_object(
      'notFlagged', coalesce(sum(case when bucket='notFlagged' then c else 0 end),0),
      'warning',    coalesce(sum(case when bucket='warning' then c else 0 end),0),
      'critical',   coalesce(sum(case when bucket='critical' then c else 0 end),0))
    from (
      select case when lf.follow_up_date is null then 'notFlagged'
                  when (current_date - lf.follow_up_date::date) >= %s then 'critical'
                  when (current_date - lf.follow_up_date::date) >= %s then 'warning'
                  else 'notFlagged' end as bucket, count(*)::int c
      from public.tenants t
      left join lateral (select follow_up_date from public.tenant_activity_log
        where tenant_phone=t.primary_phone and activity_type='FOLLOW_UP' and follow_up_date is not null
        order by created_at desc limit 1) lf on true
      %s %s t.payment_status not in ('paid','already_paid','refund_adjustment','payment_not_updated')
      group by 1) s $f$, fur, fuo, replace(where_str,' city',' t.city'), extra) into flag_fu;

  -- follow-up distribution buckets
  fu_where := replace(where_str,' city',' t.city');
  execute format($f$
    select jsonb_object_agg(bucket, count), coalesce(sum(cm),0)::int
    from (
      select case
          when lf.follow_up_date is null then 'No Follow-up'
          when lf.follow_up_date::date < current_date then 'Overdue'
          when lf.follow_up_date::date = current_date then 'Today'
          when lf.follow_up_date::date = current_date + 1 then 'Tomorrow'
          when lf.follow_up_date::date <= current_date + 7 then 'This Week'
          when date_trunc('month', lf.follow_up_date::date)=date_trunc('month',current_date) then 'This Month'
          else 'Later' end as bucket,
        count(*)::int as count,
        count(*) filter (where lf.follow_up_date is not null and date_trunc('month',lf.follow_up_date::date)=date_trunc('month',current_date))::int as cm
      from public.tenants t
      left join lateral (select follow_up_date from public.tenant_activity_log
        where tenant_phone=t.primary_phone and activity_type='FOLLOW_UP' and follow_up_date is not null
        order by created_at desc limit 1) lf on true
      %s %s t.payment_status!='already_paid' and t.payment_status not in ('paid','refund_adjustment') and t.total_amount_due>0
      group by 1) s $f$, fu_where, extra) into b, this_month_total;

  -- assemble ordered follow-up array (This Month uses aggregated count)
  fu_data := '[]'::jsonb;
  foreach bucket in array array['Today','Tomorrow','This Week','This Month','Overdue','Later','No Follow-up']
  loop
    if bucket = 'This Month' then
      fu_data := fu_data || jsonb_build_object('bucket', bucket, 'count', this_month_total);
    else
      fu_data := fu_data || jsonb_build_object('bucket', bucket, 'count', coalesce((b->>bucket)::int, 0));
    end if;
  end loop;

  return jsonb_build_object(
    'hasData', true,
    'totalTenants', agg."totalTenants",
    'totalDues', agg."totalDues",
    'pendingCount', agg."pendingCount",
    'totalOutstanding', agg."totalDues",
    'outstandingTenantCount', agg."outstandingTenantCount",
    'suspenseDue', agg."suspenseDues",
    'suspenseTenantCount', agg."suspenseTenantCount",
    'collectableDue', coalesce(pend."pendingDue",0) + coalesce(commit."commitmentDue",0),
    'collectableTenantCount', coalesce(pend."pendingDueCount",0) + coalesce(commit."commitmentCount",0),
    'cities', fv->'cities',
    'properties', fv->'properties',
    'cityPropertyMap', fv->'cityPropertyMap',
    'statusCounts', status_counts,
    'cityData', city_data,
    'propertyData', prop_data,
    'followUpData', fu_data,
    'flagDistribution', jsonb_build_object(
      'daysOverdue', flag_overdue, 'dueDate', flag_due, 'followUp', flag_fu,
      'thresholds', jsonb_build_object('orangeDays',orange,'redDays',red,'ddOrange',ddo,'ddRed',ddr,'fuOrange',fuo,'fuRed',fur))
  );
end; $$;

-- GET /api/tenants/:id  — attaches latestFollowUpDate
create or replace function public.rpc_tenant_by_id(p_id int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.tenants; lf text;
begin
  perform public.require_user();
  select * into t from public.tenants where id = p_id;
  if t.id is null then raise exception 'Tenant not found' using errcode='P0002'; end if;
  select follow_up_date into lf from public.tenant_activity_log
    where tenant_phone = t.primary_phone and activity_type='FOLLOW_UP' and follow_up_date is not null
    order by created_at desc limit 1;
  return public.plain_tenant_json(t) || jsonb_build_object('latestFollowUpDate', lf);
end; $$;

-- PATCH /api/tenants/:id  — partial update (camelCase keys in jsonb)
create or replace function public.rpc_update_tenant(p_id int, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.tenants;
begin
  perform public.require_user();
  update public.tenants set
    tenant_name           = coalesce(p_patch->>'tenantName', tenant_name),
    primary_phone         = coalesce(p_patch->>'primaryPhone', primary_phone),
    secondary_phone       = case when p_patch ? 'secondaryPhone' then p_patch->>'secondaryPhone' else secondary_phone end,
    parent_name           = case when p_patch ? 'parentName' then p_patch->>'parentName' else parent_name end,
    parent_phone          = case when p_patch ? 'parentPhone' then p_patch->>'parentPhone' else parent_phone end,
    city                  = coalesce(p_patch->>'city', city),
    property_name         = coalesce(p_patch->>'propertyName', property_name),
    room_no               = case when p_patch ? 'roomNo' then p_patch->>'roomNo' else room_no end,
    total_amount_due      = coalesce((p_patch->>'totalAmountDue')::int, total_amount_due),
    check_in_date         = case when p_patch ? 'checkInDate' then p_patch->>'checkInDate' else check_in_date end,
    due_date              = case when p_patch ? 'dueDate' then p_patch->>'dueDate' else due_date end,
    rental_billing_cycle  = case when p_patch ? 'rentalBillingCycle' then p_patch->>'rentalBillingCycle' else rental_billing_cycle end,
    checkout_notice_date  = case when p_patch ? 'checkoutNoticeDate' then p_patch->>'checkoutNoticeDate' else checkout_notice_date end,
    expected_checkout_date= case when p_patch ? 'expectedCheckoutDate' then p_patch->>'expectedCheckoutDate' else expected_checkout_date end,
    payment_status        = coalesce(p_patch->>'paymentStatus', payment_status),
    updated_at            = now()
  where id = p_id returning * into t;
  if t.id is null then raise exception 'Tenant not found' using errcode='P0002'; end if;
  return public.plain_tenant_json(t);
end; $$;

-- GET /api/tenants/export  — returns enriched rows (adapter builds the CSV).
-- Mirrors storage.getExportTenants + the master-escalation enrichment in routes.
-- Returns { rows: [ {..camelCase.., latestFollowUpDate, escalationLevel} ] }.
create or replace function public.rpc_tenants_export(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pr public.profiles; allowed_cities text[]; allowed_props text[];
  where_sql text := ' where t.payment_status != ''already_paid'' ';
  v_search text; v_city text; v_status text; v_billing text; v_checkout text; v_escalation text;
  v_props text[]; v_city_arr text[]; v_billing_arr text[];
  cfg jsonb; mf_enabled boolean;
  rows jsonb := '[]'::jsonb; rec record; lvl text; esc text; q text;
begin
  pr := public.require_user();
  allowed_cities := public.caller_allowed_cities(pr);
  allowed_props  := public.caller_allowed_properties(pr);
  cfg := public.master_flag_config();
  mf_enabled := (cfg->>'enabled')::boolean;

  v_search := nullif(p_filters->>'search','');
  v_city := nullif(p_filters->>'city','');
  v_status := nullif(p_filters->>'status','');
  v_billing := nullif(p_filters->>'billingCycle','');
  v_checkout := nullif(p_filters->>'hasCheckoutNotice','');
  v_escalation := nullif(p_filters->>'masterEscalation','');
  if jsonb_typeof(p_filters->'property')='array' then
    select array_agg(value) into v_props from jsonb_array_elements_text(p_filters->'property');
  elsif jsonb_typeof(p_filters->'property')='string' then
    v_props := string_to_array(p_filters->>'property',',');
  end if;

  if allowed_cities is not null then where_sql := where_sql || format(' and t.city = any(%L) ', allowed_cities); end if;
  if allowed_props  is not null then where_sql := where_sql || format(' and t.property_name = any(%L) ', allowed_props); end if;
  if v_search is not null then
    where_sql := where_sql || format(' and (t.tenant_name ilike %L or t.primary_phone ilike %L or t.room_no ilike %L) ',
      '%'||v_search||'%','%'||v_search||'%','%'||v_search||'%');
  end if;
  if v_city is not null and v_city <> 'all' then
    if position(',' in v_city)>0 then v_city_arr := string_to_array(v_city,','); else v_city_arr := array[v_city]; end if;
    where_sql := where_sql || format(' and t.city = any(%L) ', v_city_arr);
  end if;
  if v_props is not null and not (array_length(v_props,1)=1 and v_props[1]='all') then
    where_sql := where_sql || format(' and t.property_name = any(%L) ', v_props);
  end if;
  if v_status is not null and v_status <> 'all' then
    where_sql := where_sql || format(' and t.payment_status = %L ', v_status);
  end if;
  if v_billing is not null and v_billing <> 'all' then
    if position(',' in v_billing)>0 then v_billing_arr := string_to_array(v_billing,','); else v_billing_arr := array[v_billing]; end if;
    where_sql := where_sql || format(' and t.rental_billing_cycle = any(%L) ', v_billing_arr);
  end if;
  if v_checkout = 'yes' then where_sql := where_sql || ' and t.checkout_notice_date is not null and t.checkout_notice_date != '''' ';
  elsif v_checkout = 'no' then where_sql := where_sql || ' and (t.checkout_notice_date is null or t.checkout_notice_date = '''') '; end if;

  q := format('select te.* from public.tenant_enriched te %s order by te.tenant_name asc',
              replace(where_sql,' t.',' te.'));
  for rec in execute q loop
    esc := '';
    if mf_enabled then
      -- NOTE: export uses followUpCount=0 & missedCommitment=false (original quirk)
      lvl := public.compute_master_flag(rec.due_date, rec.payment_status, rec.total_amount_due,
              rec.checkout_notice_date, rec.expected_checkout_date, rec.latest_follow_up_date,
              0, false, cfg) ->> 'level';
      esc := case lvl when 'none' then '' when 'warning' then 'Warning' when 'critical' then 'Critical' else '' end;
    end if;
    -- apply masterEscalation filter (only when enabled)
    if v_escalation is not null and v_escalation <> 'off' and mf_enabled then
      if v_escalation='all' and esc not in ('Warning','Critical') then continue; end if;
      if v_escalation='critical' and esc <> 'Critical' then continue; end if;
      if v_escalation='warning' and esc <> 'Warning' then continue; end if;
    end if;
    rows := rows || (public.plain_tenant_json(row(rec.id,rec.tenant_name,rec.primary_phone,rec.secondary_phone,
              rec.parent_name,rec.parent_phone,rec.city,rec.property_name,rec.room_no,rec.total_amount_due,
              rec.check_in_date,rec.due_date,rec.rental_billing_cycle,rec.checkout_notice_date,
              rec.expected_checkout_date,rec.payment_status,rec.created_at,rec.updated_at)::public.tenants)
              || jsonb_build_object('latestFollowUpDate', rec.latest_follow_up_date, 'escalationLevel', esc));
  end loop;
  return jsonb_build_object('rows', rows);
end; $$;

-- ============================================================================
-- SECTION F — Activity
-- ============================================================================

-- Activity row → camelCase jsonb
create or replace function public.activity_json(a public.tenant_activity_log)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', a.id, 'tenantId', a.tenant_id, 'tenantPhone', a.tenant_phone,
    'activityType', a.activity_type, 'followUpDate', a.follow_up_date,
    'remarkText', a.remark_text, 'metadata', a.metadata,
    'createdBy', a.created_by, 'createdAt', a.created_at
  );
$$;

-- GET /api/tenants/:id/activity  (and used by tenant detail)
create or replace function public.rpc_get_activity_by_tenant(p_tenant_id int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.tenants;
begin
  perform public.require_user();
  select * into t from public.tenants where id = p_tenant_id;
  if t.id is null then raise exception 'Tenant not found' using errcode='P0002'; end if;
  return coalesce((
    select jsonb_agg(public.activity_json(a) order by a.created_at desc)
    from public.tenant_activity_log a where a.tenant_phone = t.primary_phone
  ), '[]'::jsonb);
end; $$;

-- POST /api/tenants/:id/activity  (optionally updates tenant status)
create or replace function public.rpc_create_activity(p_tenant_id int, p_body jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.tenants; a public.tenant_activity_log; pr public.profiles;
begin
  pr := public.require_user();
  select * into t from public.tenants where id = p_tenant_id;
  if t.id is null then raise exception 'Tenant not found' using errcode='P0002'; end if;
  insert into public.tenant_activity_log (tenant_id, tenant_phone, activity_type, follow_up_date, remark_text, metadata, created_by)
  values (t.id, t.primary_phone, p_body->>'activityType',
          nullif(p_body->>'followUpDate',''), nullif(p_body->>'remarkText',''),
          case when p_body ? 'metadata' then p_body->'metadata' else null end,
          coalesce(pr.display_name, nullif(p_body->>'createdBy',''), 'Unknown'))
  returning * into a;
  if p_body ? 'status' and nullif(p_body->>'status','') is not null then
    update public.tenants set payment_status = p_body->>'status', updated_at = now() where id = t.id;
  end if;
  return public.activity_json(a);
end; $$;

-- PATCH /api/activity/:id/link-ticket  — merge {ticketId} into metadata
create or replace function public.rpc_link_activity_ticket(p_activity_id int, p_ticket_id int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.tenant_activity_log;
begin
  perform public.require_user();
  if p_activity_id is null then raise exception 'Invalid activity ID'; end if;
  if p_ticket_id is null then raise exception 'Valid ticketId required'; end if;
  select * into a from public.tenant_activity_log where id = p_activity_id;
  if a.id is null then raise exception 'Activity not found' using errcode='P0002'; end if;
  update public.tenant_activity_log
    set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('ticketId', p_ticket_id)
    where id = p_activity_id returning * into a;
  return public.activity_json(a);
end; $$;

-- ============================================================================
-- SECTION G — Upload / bulk upsert / resets / mappings / history
-- ============================================================================

-- POST /api/upload — bulk upsert. The browser parses the file (SheetJS) and
-- sends the raw rows plus the field->header mapping; ALL business logic stays
-- here (mirrors routes.ts /api/upload exactly).
--   p_mapping : { tenantName:"Header", primaryPhone:"Header", ... }
--   p_rows    : [ { "Header": value, ... }, ... ]
-- Returns { created, updated, failed, totalRows }.
create or replace function public.rpc_bulk_upsert_tenants(
  p_file_name text, p_uploaded_by text, p_mapping jsonb, p_rows jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pr public.profiles;
  grace int;
  total_rows int := coalesce(jsonb_array_length(p_rows), 0);
  failed int := 0;
  created int := 0;
  updated int := 0;
  r jsonb;
  v_name text; v_phone text; v_city text; v_prop text; v_amount int; v_due text;
  m_amount text; m_due text;
begin
  pr := public.require_user();
  if not public.has_permission(pr, 'canManageUploads') then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  if p_mapping is null then raise exception 'Column mapping is required'; end if;

  -- save the mapping (single-row table)
  delete from public.column_mappings where true;
  insert into public.column_mappings (mapping_name, mapping) values ('default', p_mapping);

  grace := coalesce(public.get_app_setting('grace_period_days')::int, 5);

  -- staging of parsed/validated rows
  create temp table _staging (
    tenant_name text, primary_phone text, city text, property_name text,
    total_amount_due int, secondary_phone text, parent_name text, parent_phone text,
    room_no text, check_in_date text, due_date text, rental_billing_cycle text,
    checkout_notice_date text, expected_checkout_date text, is_zero boolean
  ) on commit drop;

  m_amount := p_mapping->>'totalAmountDue';
  m_due    := p_mapping->>'dueDate';

  for r in select * from jsonb_array_elements(p_rows)
  loop
    begin
      v_name  := trim(coalesce(r->>(p_mapping->>'tenantName'), ''));
      v_phone := regexp_replace(trim(coalesce(r->>(p_mapping->>'primaryPhone'), '')), '[^0-9+]', '', 'g');
      v_city  := trim(coalesce(r->>(p_mapping->>'city'), ''));
      v_prop  := trim(coalesce(r->>(p_mapping->>'propertyName'), ''));
      if v_name='' or v_phone='' or v_city='' or v_prop='' then failed := failed + 1; continue; end if;
      begin
        v_amount := coalesce(trunc(nullif(regexp_replace(coalesce(r->>m_amount,'0'), '[^0-9.-]','','g'),'')::numeric)::int, 0);
      exception when others then v_amount := 0; end;
      v_due := case when m_due is not null then nullif(trim(coalesce(r->>m_due,'')),'') else null end;

      insert into _staging values (
        v_name, v_phone, v_city, v_prop, v_amount,
        null,
        case when p_mapping->>'parentName' is not null then nullif(trim(coalesce(r->>(p_mapping->>'parentName'),'')),'') else null end,
        case when p_mapping->>'parentPhone' is not null then nullif(regexp_replace(trim(coalesce(r->>(p_mapping->>'parentPhone'),'')),'[^0-9+]','','g'),'') else null end,
        case when p_mapping->>'roomNo' is not null then nullif(trim(coalesce(r->>(p_mapping->>'roomNo'),'')),'') else null end,
        case when p_mapping->>'checkInDate' is not null then nullif(trim(coalesce(r->>(p_mapping->>'checkInDate'),'')),'') else null end,
        v_due,
        case when p_mapping->>'rentalBillingCycle' is not null then nullif(trim(coalesce(r->>(p_mapping->>'rentalBillingCycle'),'')),'') else null end,
        case when p_mapping->>'checkoutNoticeDate' is not null then nullif(trim(coalesce(r->>(p_mapping->>'checkoutNoticeDate'),'')),'') else null end,
        case when p_mapping->>'expectedCheckoutDate' is not null then nullif(trim(coalesce(r->>(p_mapping->>'expectedCheckoutDate'),'')),'') else null end,
        (v_amount = 0)
      );
    exception when others then failed := failed + 1;
    end;
  end loop;

  -- dedupe by phone keeping the LAST occurrence (matches JS map overwrite)
  delete from _staging s using _staging s2
    where s.ctid < s2.ctid and s.primary_phone = s2.primary_phone;

  -- snapshot which phones already exist (before mutating)
  create temp table _existing on commit drop as
    select id, primary_phone, payment_status from public.tenants
    where primary_phone in (select primary_phone from _staging);

  -- latest saved activity status per phone (metadata.status), latest by created_at
  create temp table _saved on commit drop as
    select distinct on (a.tenant_phone) a.tenant_phone as phone, a.metadata->>'status' as status
    from public.tenant_activity_log a
    where a.tenant_phone in (select primary_phone from _staging)
      and a.metadata is not null and a.metadata ? 'status'
    order by a.tenant_phone, a.created_at desc;

  -- delete tenants not present in the uploaded set
  delete from public.tenants where primary_phone not in (select primary_phone from _staging);

  -- INSERTS (phones that did not exist before)
  with ins as (
    insert into public.tenants (
      tenant_name, primary_phone, city, property_name, total_amount_due,
      secondary_phone, parent_name, parent_phone, room_no, check_in_date, due_date,
      rental_billing_cycle, checkout_notice_date, expected_checkout_date, payment_status)
    select s.tenant_name, s.primary_phone, s.city, s.property_name, s.total_amount_due,
      s.secondary_phone, s.parent_name, s.parent_phone, s.room_no, s.check_in_date, s.due_date,
      s.rental_billing_cycle, s.checkout_notice_date, s.expected_checkout_date,
      case
        when s.is_zero then 'already_paid'
        when sv.status is not null and sv.status <> 'already_paid' then sv.status
        else 'no_update'
      end
    from _staging s
    left join _saved sv on sv.phone = s.primary_phone
    where s.primary_phone not in (select primary_phone from _existing)
    returning 1)
  select count(*) into created from ins;

  -- UPDATES (phones that existed before). payment_status only changes when a
  -- status is derived; otherwise the existing status is preserved. Matching the
  -- original: zero-amount => already_paid; saved status restored; and an
  -- existing 'already_paid' with amount>0 and no derived status => no_update.
  with upd as (
    update public.tenants t set
      tenant_name = s.tenant_name, city = s.city, property_name = s.property_name,
      total_amount_due = s.total_amount_due, secondary_phone = s.secondary_phone,
      parent_name = s.parent_name, parent_phone = s.parent_phone, room_no = s.room_no,
      check_in_date = s.check_in_date, due_date = s.due_date,
      rental_billing_cycle = s.rental_billing_cycle, checkout_notice_date = s.checkout_notice_date,
      expected_checkout_date = s.expected_checkout_date,
      payment_status = coalesce(
        case
          when s.is_zero then 'already_paid'
          when sv.status is not null and sv.status <> 'already_paid' then sv.status
          when (not s.is_zero) and ex.payment_status = 'already_paid' then 'no_update'
          else null
        end, t.payment_status),
      updated_at = now()
    from _staging s
    join _existing ex on ex.primary_phone = s.primary_phone
    left join _saved sv on sv.phone = s.primary_phone
    where t.primary_phone = s.primary_phone
    returning 1)
  select count(*) into updated from upd;

  -- relink activity records to (possibly new) tenant ids by phone
  update public.tenant_activity_log a set tenant_id = t.id
  from public.tenants t where a.tenant_phone = t.primary_phone and a.tenant_id <> t.id;

  -- auto follow-ups for tenants that have a due date and no existing follow-up
  insert into public.tenant_activity_log (tenant_id, tenant_phone, activity_type, follow_up_date, remark_text, created_by)
  select t.id, t.primary_phone, 'FOLLOW_UP',
         to_char((s.due_date::date + grace), 'YYYY-MM-DD'),
         'Auto-scheduled: Due date + ' || grace || ' day grace period', 'System'
  from _staging s
  join public.tenants t on t.primary_phone = s.primary_phone
  where s.due_date is not null
    and (s.due_date ~ '^\d{4}-\d{2}-\d{2}')  -- parseable date guard
    and not exists (
      select 1 from public.tenant_activity_log a
      where a.tenant_phone = s.primary_phone and a.activity_type='FOLLOW_UP' and a.follow_up_date is not null
    );

  insert into public.upload_history (file_name, total_rows, records_created, records_updated, records_failed, uploaded_by)
  values (p_file_name, total_rows, created, updated, failed, coalesce(pr.display_name, p_uploaded_by, 'Unknown'));

  return jsonb_build_object('created', created, 'updated', updated, 'failed', failed, 'totalRows', total_rows);
end; $$;

-- GET /api/column-mapping
create or replace function public.rpc_get_column_mapping()
returns jsonb language plpgsql security definer set search_path = public as $$
declare cm public.column_mappings;
begin
  perform public.require_user();
  select * into cm from public.column_mappings order by created_at desc limit 1;
  if cm.id is null then return 'null'::jsonb; end if;
  return jsonb_build_object('id',cm.id,'mappingName',cm.mapping_name,'mapping',cm.mapping,'createdAt',cm.created_at);
end; $$;

-- DELETE /api/column-mapping
create or replace function public.rpc_delete_column_mapping()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  delete from public.column_mappings where true;
  return jsonb_build_object('success', true);
end; $$;

-- GET /api/upload-history
create or replace function public.rpc_get_upload_history()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.require_user();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',id,'fileName',file_name,'totalRows',total_rows,'recordsCreated',records_created,
      'recordsUpdated',records_updated,'recordsFailed',records_failed,'uploadedBy',uploaded_by,'createdAt',created_at)
      order by created_at desc)
    from (select * from public.upload_history order by created_at desc limit 50) h
  ), '[]'::jsonb);
end; $$;

-- DELETE /api/upload-history/:id  (if none remain, delete all tenants)
create or replace function public.rpc_delete_upload_history(p_id int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare remaining int;
begin
  perform public.require_admin();
  delete from public.upload_history where id = p_id;
  select count(*)::int into remaining from public.upload_history;
  if remaining = 0 then delete from public.tenants where true; end if;
  return jsonb_build_object('success', true, 'remainingUploads', remaining);
end; $$;

-- DELETE /api/activity  (clear all activity)
create or replace function public.rpc_clear_activity()
returns jsonb language plpgsql security definer set search_path = public as $$
declare pr public.profiles; deleted int;
begin
  pr := public.require_admin();
  with d as (delete from public.tenant_activity_log where true returning 1) select count(*)::int into deleted from d;
  insert into public.activity_reset_log (reset_by, records_deleted, reset_type)
  values (coalesce(pr.display_name,'Unknown'), deleted, 'clear_activity');
  return jsonb_build_object('success', true, 'deleted', deleted);
end; $$;

-- POST /api/reset-statuses  (all / city / property)
create or replace function public.rpc_reset_statuses(p_scope text default null, p_value text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pr public.profiles; affected int; scope_label text;
begin
  pr := public.require_admin();
  if p_scope = 'city' then
    if coalesce(p_value,'')='' then raise exception 'City is required'; end if;
    with u as (update public.tenants set payment_status='no_update', updated_at=now()
               where payment_status <> 'already_paid' and city = p_value returning 1)
      select count(*)::int into affected from u;
    scope_label := 'City: ' || p_value;
  elsif p_scope = 'property' then
    if coalesce(p_value,'')='' then raise exception 'Property name is required'; end if;
    with u as (update public.tenants set payment_status='no_update', updated_at=now()
               where payment_status <> 'already_paid' and property_name = p_value returning 1)
      select count(*)::int into affected from u;
    scope_label := 'Property: ' || p_value;
  else
    with u as (update public.tenants set payment_status='no_update', updated_at=now()
               where payment_status <> 'already_paid' returning 1)
      select count(*)::int into affected from u;
    scope_label := 'All Data';
  end if;
  insert into public.activity_reset_log (reset_by, records_deleted, reset_type, reset_scope)
  values (coalesce(pr.display_name,'Unknown'), affected, 'reset_statuses', scope_label);
  return jsonb_build_object('success', true, 'affected', affected);
end; $$;

-- GET /api/activity-reset-log
create or replace function public.rpc_get_activity_reset_log()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.require_user();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id',id,'resetBy',reset_by,'recordsDeleted',records_deleted,
      'resetType',reset_type,'resetScope',reset_scope,'createdAt',created_at) order by created_at desc)
    from public.activity_reset_log
  ), '[]'::jsonb);
end; $$;

-- ============================================================================
-- SECTION H — Tickets / comments / attachments
-- ============================================================================

create or replace function public.ticket_json(t public.tickets)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id',t.id,'tenantPhone',t.tenant_phone,'tenantId',t.tenant_id,'tenantName',t.tenant_name,
    'roomNo',t.room_no,'city',t.city,'propertyName',t.property_name,'raisedBy',t.raised_by,
    'assigneeId',t.assignee_id,'assigneeName',t.assignee_name,'urgency',t.urgency,
    'description',t.description,'status',t.status,'subReason',t.sub_reason,'activityId',t.activity_id,
    'images',coalesce(to_jsonb(t.images),'[]'::jsonb),'createdAt',t.created_at,'updatedAt',t.updated_at
  );
$$;

create or replace function public.ticket_comment_json(c public.ticket_comments)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id',c.id,'ticketId',c.ticket_id,'commentText',c.comment_text,'newStatus',c.new_status,
    'newAssigneeId',c.new_assignee_id,'newAssigneeName',c.new_assignee_name,
    'createdBy',c.created_by,'createdAt',c.created_at
  );
$$;

-- GET /api/tickets?status=&urgency=&assigneeId=&search=
create or replace function public.rpc_get_tickets(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare where_sql text := ''; q text; rec public.tickets; out jsonb := '[]'::jsonb;
  v_status text; v_urgency text; v_assignee text; v_search text;
begin
  perform public.require_user();
  v_status := nullif(p_filters->>'status',''); v_urgency := nullif(p_filters->>'urgency','');
  v_assignee := nullif(p_filters->>'assigneeId',''); v_search := nullif(p_filters->>'search','');
  if v_status is not null and v_status <> 'all' then where_sql := where_sql || format(' and status = %L ', v_status); end if;
  if v_urgency is not null and v_urgency <> 'all' then where_sql := where_sql || format(' and urgency = %L ', v_urgency); end if;
  if v_assignee is not null then where_sql := where_sql || format(' and assignee_id = %s ', v_assignee::int); end if;
  if v_search is not null then
    where_sql := where_sql || format(' and (tenant_name ilike %L or tenant_phone ilike %L or room_no ilike %L) ',
      '%'||v_search||'%','%'||v_search||'%','%'||v_search||'%');
  end if;
  q := 'select * from public.tickets' || case when length(where_sql)>0 then ' where '||substr(where_sql,6) else '' end
       || ' order by created_at desc';
  for rec in execute q loop out := out || public.ticket_json(rec); end loop;
  return out;
end; $$;

-- GET /api/tickets/:id  (+ comments)
create or replace function public.rpc_get_ticket(p_id int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.tickets; comments jsonb;
begin
  perform public.require_user();
  select * into t from public.tickets where id = p_id;
  if t.id is null then raise exception 'Ticket not found' using errcode='P0002'; end if;
  select coalesce(jsonb_agg(public.ticket_comment_json(c) order by c.created_at desc), '[]'::jsonb)
    into comments from public.ticket_comments c where c.ticket_id = p_id;
  return public.ticket_json(t) || jsonb_build_object('comments', comments);
end; $$;

-- GET /api/tickets/by-phone/:phone
create or replace function public.rpc_tickets_by_phone(p_phone text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.require_user();
  return coalesce((
    select jsonb_agg(public.ticket_json(t) order by t.created_at desc)
    from public.tickets t where t.tenant_phone = p_phone
  ), '[]'::jsonb);
end; $$;

-- GET /api/tickets/open-count/:phone
create or replace function public.rpc_open_ticket_count_by_phone(p_phone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c int;
begin
  perform public.require_user();
  select count(*)::int into c from public.tickets
    where tenant_phone = p_phone and status not in ('resolved','closed','rejected');
  return jsonb_build_object('count', c);
end; $$;

-- POST /api/tickets  — validates assignee + city/property access.
-- (Image bytes are uploaded to Storage by the adapter, which then calls
--  rpc_create_ticket_attachment for each file.)
create or replace function public.rpc_create_ticket(p_body jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pr public.profiles; assignee public.profiles; t public.tickets;
  v_city text; has_city boolean; has_prop boolean; city_props text[];
begin
  pr := public.require_user();
  if nullif(p_body->>'tenantPhone','') is null or nullif(p_body->>'assigneeId','') is null then
    raise exception 'Missing required fields';
  end if;
  select * into assignee from public.profiles where id = (p_body->>'assigneeId')::int;
  if assignee.id is null then
    raise exception 'Assignee not found. Please add the user in Settings first.';
  end if;
  v_city := nullif(p_body->>'city','');
  if v_city is not null and assignee.role <> 'regional_head' then
    has_city := assignee.assigned_cities @> array[v_city];
    has_prop := false;
    if not has_city and coalesce(array_length(assignee.assigned_properties,1),0) > 0 then
      select array_agg(distinct property_name) into city_props from public.tenants where city = v_city;
      has_prop := assignee.assigned_properties && coalesce(city_props,'{}');
    end if;
    if not has_city and not has_prop then
      raise exception 'Assignee does not have access to this tenant''s city or property.' using errcode='42501';
    end if;
  end if;
  insert into public.tickets (tenant_phone, tenant_id, tenant_name, room_no, city, property_name,
    raised_by, assignee_id, assignee_name, urgency, description, sub_reason, activity_id, images)
  values (p_body->>'tenantPhone', nullif(p_body->>'tenantId','')::int, nullif(p_body->>'tenantName',''),
    nullif(p_body->>'roomNo',''), v_city, nullif(p_body->>'propertyName',''),
    coalesce(pr.display_name, nullif(p_body->>'raisedBy',''), 'Unknown'),
    (p_body->>'assigneeId')::int, coalesce(nullif(p_body->>'assigneeName',''), assignee.display_name),
    coalesce(nullif(p_body->>'urgency',''),'medium'), p_body->>'description',
    nullif(p_body->>'subReason',''), nullif(p_body->>'activityId','')::int, '{}')
  returning * into t;
  return public.ticket_json(t);
end; $$;

-- POST /api/tickets/:id/comments  — insert comment + update ticket
create or replace function public.rpc_ticket_comment_create(p_ticket_id int, p_body jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pr public.profiles; t public.tickets; assignee public.profiles;
  c public.ticket_comments; new_name text; new_status text; new_assignee int;
begin
  pr := public.require_user();
  select * into t from public.tickets where id = p_ticket_id;
  if t.id is null then raise exception 'Ticket not found' using errcode='P0002'; end if;
  if nullif(trim(coalesce(p_body->>'commentText','')),'') is null then raise exception 'Comment is required'; end if;
  if nullif(trim(coalesce(p_body->>'createdBy','')),'') is null then raise exception 'Created by is required'; end if;
  new_status := nullif(p_body->>'newStatus','');
  new_assignee := nullif(p_body->>'newAssigneeId','')::int;
  if new_assignee is not null then
    select * into assignee from public.profiles where id = new_assignee;
    if assignee.id is null then raise exception 'New assignee not found'; end if;
    new_name := assignee.display_name;
  end if;
  insert into public.ticket_comments (ticket_id, comment_text, new_status, new_assignee_id, new_assignee_name, created_by)
  values (p_ticket_id, trim(p_body->>'commentText'), new_status, new_assignee, new_name, trim(p_body->>'createdBy'))
  returning * into c;
  if new_status is not null or new_assignee is not null then
    update public.tickets set
      status = coalesce(new_status, status),
      assignee_id = coalesce(new_assignee, assignee_id),
      assignee_name = case when new_assignee is not null then new_name else assignee_name end,
      updated_at = now()
    where id = p_ticket_id;
  end if;
  return public.ticket_comment_json(c);
end; $$;

-- GET /api/tickets/:id/attachments  — metadata rows (adapter adds signed URLs)
create or replace function public.rpc_get_ticket_attachments(p_ticket_id int)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.require_user();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',id,'ticketId',ticket_id,'filename',filename,'mimeType',mime_type,
      'storagePath',storage_path,'createdAt',created_at) order by created_at asc)
    from public.ticket_attachments where ticket_id = p_ticket_id
  ), '[]'::jsonb);
end; $$;

-- Called by the adapter after uploading each image to Storage.
create or replace function public.rpc_create_ticket_attachment(
  p_ticket_id int, p_filename text, p_mime_type text, p_storage_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.ticket_attachments;
begin
  perform public.require_user();
  insert into public.ticket_attachments (ticket_id, filename, mime_type, storage_path)
  values (p_ticket_id, p_filename, p_mime_type, p_storage_path)
  returning * into a;
  return jsonb_build_object('id',a.id,'ticketId',a.ticket_id,'filename',a.filename,
    'mimeType',a.mime_type,'storagePath',a.storage_path,'createdAt',a.created_at);
end; $$;

-- ============================================================================
-- SECTION I — Analytics
-- ============================================================================

-- Shared where-clause builder for the analytics endpoints (returns a WHERE
-- string using the `t.` alias; base filter excludes settled/suspense statuses).
create or replace function public._analytics_where(
  allowed_cities text[], allowed_props text[], filter_city text, filter_prop text, checkout_only boolean
) returns text language plpgsql immutable as $$
declare w text := ' where t.payment_status not in (''already_paid'',''paid'',''refund_adjustment'',''payment_not_updated'') ';
  arr text[];
begin
  if allowed_cities is not null then w := w || format(' and t.city = any(%L) ', allowed_cities); end if;
  if allowed_props  is not null then w := w || format(' and t.property_name = any(%L) ', allowed_props); end if;
  if filter_city is not null and filter_city <> 'all' then
    if position(',' in filter_city)>0 then arr := string_to_array(filter_city,','); else arr := array[filter_city]; end if;
    w := w || format(' and t.city = any(%L) ', arr);
  end if;
  if filter_prop is not null then
    if position(',' in filter_prop)>0 then arr := string_to_array(filter_prop,','); else arr := array[filter_prop]; end if;
    if not (array_length(arr,1)=1 and arr[1]='all') then w := w || format(' and t.property_name = any(%L) ', arr); end if;
  end if;
  if checkout_only then w := w || ' and t.checkout_notice_date is not null and t.checkout_notice_date != '''' '; end if;
  return w;
end; $$;

-- GET /api/analytics/risk-distribution
create or replace function public.rpc_risk_distribution(
  p_filter_city text default null, p_filter_property text default null, p_checkout_only boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pr public.profiles; cfg jsonb; w text; q text; rec public.tenant_enriched; lvl text;
  city text; amt numeric;
  city_map jsonb := '{}'::jsonb; entry jsonb;
  crit int := 0; warn int := 0; healthy int := 0; var numeric := 0;
  cities_arr jsonb := '[]'::jsonb; k text;
begin
  pr := public.require_user();
  cfg := public.master_flag_config();
  if (cfg->>'enabled')::boolean is not true then
    return jsonb_build_object('cities','[]'::jsonb,
      'totals', jsonb_build_object('criticalCount',0,'warningCount',0,'healthyCount',0,'totalValueAtRisk',0),
      'masterFlagActive', false);
  end if;
  w := public._analytics_where(public.caller_allowed_cities(pr), public.caller_allowed_properties(pr),
        p_filter_city, p_filter_property, p_checkout_only);
  q := format('select te.* from public.tenant_enriched te %s', replace(w,' t.',' te.'));
  for rec in execute q loop
    lvl := public.compute_master_flag(rec.due_date, rec.payment_status, rec.total_amount_due,
             rec.checkout_notice_date, rec.expected_checkout_date, rec.latest_follow_up_date,
             rec.follow_up_count, rec.missed_commitment, cfg) ->> 'level';
    city := coalesce(rec.city, 'Unknown'); amt := coalesce(rec.total_amount_due,0);
    entry := coalesce(city_map->city, jsonb_build_object(
      'critical', jsonb_build_object('count',0,'amount',0),
      'warning',  jsonb_build_object('count',0,'amount',0),
      'healthy',  jsonb_build_object('count',0,'amount',0),
      'total', 0));
    entry := jsonb_set(entry, '{total}', to_jsonb((entry->>'total')::int + 1));
    if lvl = 'critical' then
      entry := jsonb_set(entry, '{critical,count}',  to_jsonb((entry#>>'{critical,count}')::int + 1));
      entry := jsonb_set(entry, '{critical,amount}', to_jsonb((entry#>>'{critical,amount}')::numeric + amt));
      crit := crit + 1; var := var + amt;
    elsif lvl = 'warning' then
      entry := jsonb_set(entry, '{warning,count}',  to_jsonb((entry#>>'{warning,count}')::int + 1));
      entry := jsonb_set(entry, '{warning,amount}', to_jsonb((entry#>>'{warning,amount}')::numeric + amt));
      warn := warn + 1; var := var + amt;
    else
      entry := jsonb_set(entry, '{healthy,count}',  to_jsonb((entry#>>'{healthy,count}')::int + 1));
      entry := jsonb_set(entry, '{healthy,amount}', to_jsonb((entry#>>'{healthy,amount}')::numeric + amt));
      healthy := healthy + 1;
    end if;
    city_map := jsonb_set(city_map, array[city], entry);
  end loop;
  -- assemble cities array sorted by city name
  for k in select jsonb_object_keys(city_map) order by 1 loop
    cities_arr := cities_arr || (jsonb_build_object('city', k) || (city_map->k));
  end loop;
  return jsonb_build_object(
    'cities', cities_arr,
    'totals', jsonb_build_object('criticalCount',crit,'warningCount',warn,'healthyCount',healthy,'totalValueAtRisk',var),
    'masterFlagActive', true);
end; $$;

-- GET /api/analytics/escalation-trend  — 7-day date-relative critical/warning counts
create or replace function public.rpc_escalation_trend(
  p_filter_city text default null, p_filter_property text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pr public.profiles; cfg jsonb; w text; q text; rec public.tenant_enriched;
  trend jsonb := '[]'::jsonb; i int; ref date; crit int; warn int; lvl text;
begin
  pr := public.require_user();
  cfg := public.master_flag_config();
  if (cfg->>'enabled')::boolean is not true then
    for i in reverse 6..0 loop
      trend := trend || jsonb_build_object('date', to_char(current_date - i,'YYYY-MM-DD'), 'critical',0,'warning',0);
    end loop;
    return jsonb_build_object('trend', trend);
  end if;
  w := public._analytics_where(public.caller_allowed_cities(pr), public.caller_allowed_properties(pr),
        p_filter_city, p_filter_property, false);
  q := format('select te.* from public.tenant_enriched te %s', replace(w,' t.',' te.'));

  create temp table _trend_rows on commit drop as select 1 where false;  -- placeholder unused
  for i in reverse 6..0 loop
    ref := current_date - i; crit := 0; warn := 0;
    for rec in execute q loop
      lvl := public.compute_master_flag(rec.due_date, rec.payment_status, rec.total_amount_due,
               rec.checkout_notice_date, rec.expected_checkout_date, rec.latest_follow_up_date,
               rec.follow_up_count, rec.missed_commitment, cfg, ref) ->> 'level';
      if lvl = 'critical' then crit := crit + 1; elsif lvl = 'warning' then warn := warn + 1; end if;
    end loop;
    trend := trend || jsonb_build_object('date', to_char(ref,'YYYY-MM-DD'), 'critical', crit, 'warning', warn);
  end loop;
  drop table if exists _trend_rows;
  return jsonb_build_object('trend', trend);
end; $$;

-- GET /api/analytics/collectable-trend
create or replace function public.rpc_collectable_trend(
  p_filter_city text default null, p_filter_property text default null,
  p_start_date text default null, p_end_date text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pr public.profiles; access_sql text := ''; where_str text; extra text;
  s_date text; e_date text; arr text[];
  data jsonb := '[]'::jsonb; date_map jsonb := '{}'::jsonb; r record; k text;
begin
  pr := public.require_user();
  -- access scope (uses raw allowed arrays; regional_head => NULL => unrestricted)
  if public.caller_allowed_cities(pr) is not null then access_sql := access_sql || format(' and t.city = any(%L) ', public.caller_allowed_cities(pr)); end if;
  if public.caller_allowed_properties(pr) is not null then access_sql := access_sql || format(' and t.property_name = any(%L) ', public.caller_allowed_properties(pr)); end if;
  if p_filter_city is not null and p_filter_city <> 'all' then
    if position(',' in p_filter_city)>0 then arr := string_to_array(p_filter_city,','); else arr := array[p_filter_city]; end if;
    access_sql := access_sql || format(' and t.city = any(%L) ', arr);
  end if;
  if p_filter_property is not null then
    if position(',' in p_filter_property)>0 then arr := string_to_array(p_filter_property,','); else arr := array[p_filter_property]; end if;
    if not (array_length(arr,1)=1 and arr[1]='all') then access_sql := access_sql || format(' and t.property_name = any(%L) ', arr); end if;
  end if;
  where_str := case when length(access_sql)>0 then ' where '||substr(access_sql,6) else '' end;
  extra := case when length(access_sql)>0 then ' and ' else ' where ' end;
  s_date := coalesce(p_start_date, to_char(current_date,'YYYY-MM-DD'));
  e_date := coalesce(p_end_date, s_date);

  -- pending rows (this follow-up in range, no this-month commitment)
  for r in execute format($f$
    select lf.follow_up_date::date::text as trend_date,
           coalesce(sum(t.total_amount_due),0)::bigint as amount,
           count(distinct t.primary_phone)::int as tenant_count
    from public.tenants t
    join lateral (
      select follow_up_date from public.tenant_activity_log
      where tenant_phone=t.primary_phone and activity_type='FOLLOW_UP' and follow_up_date is not null
      order by created_at desc limit 1) lf on true
    %s %s t.payment_status='pending'
      and lf.follow_up_date is not null
      and lf.follow_up_date::date >= %L::date and lf.follow_up_date::date <= %L::date
      and not exists (
        select 1 from (
          select a2.metadata from public.tenant_activity_log a2
          where a2.tenant_phone=t.primary_phone and a2.metadata is not null and a2.metadata ? 'commitments'
          order by a2.created_at desc limit 1) lc
        cross join lateral jsonb_array_elements(lc.metadata->'commitments') c2
        where (c2.value->>'date') is not null and date_trunc('month',(c2.value->>'date')::date)=date_trunc('month',current_date))
    group by lf.follow_up_date::date
  $f$, replace(where_str,' t.',' t.'), extra, s_date, e_date)
  loop
    date_map := jsonb_set(date_map, array[r.trend_date],
      jsonb_build_object('amount', coalesce((date_map#>>array[r.trend_date,'amount'])::numeric,0) + r.amount,
                         'pending', r.tenant_count,
                         'commit', coalesce((date_map#>>array[r.trend_date,'commit'])::int,0)));
  end loop;

  -- commitment rows (commitment date in range, pending/partial)
  for r in execute format($f$
    select (c.value->>'date')::date::text as trend_date,
           coalesce(sum((c.value->>'amount')::numeric),0)::bigint as amount,
           count(distinct t.primary_phone)::int as tenant_count
    from public.tenants t
    join lateral (
      select a.metadata from public.tenant_activity_log a
      where a.tenant_phone=t.primary_phone and a.metadata is not null and a.metadata ? 'commitments'
      order by a.created_at desc limit 1) latest_commit on true
    cross join lateral jsonb_array_elements(latest_commit.metadata->'commitments') as c(value)
    %s %s t.payment_status in ('pending','partial_payment')
      and (c.value->>'date') is not null
      and (c.value->>'date')::date >= %L::date and (c.value->>'date')::date <= %L::date
    group by (c.value->>'date')::date
  $f$, where_str, extra, s_date, e_date)
  loop
    date_map := jsonb_set(date_map, array[r.trend_date],
      jsonb_build_object('amount', coalesce((date_map#>>array[r.trend_date,'amount'])::numeric,0) + r.amount,
                         'pending', coalesce((date_map#>>array[r.trend_date,'pending'])::int,0),
                         'commit', r.tenant_count));
  end loop;

  for k in select jsonb_object_keys(date_map) order by 1 loop
    data := data || jsonb_build_object('date', k,
      'amount', (date_map#>>array[k,'amount'])::numeric,
      'tenantCount', coalesce((date_map#>>array[k,'pending'])::int,0) + coalesce((date_map#>>array[k,'commit'])::int,0));
  end loop;
  return jsonb_build_object('data', data);
end; $$;

-- ============================================================================
-- GRANTS — the static frontend calls these RPCs as the `authenticated` role.
-- (Every rpc_* is SECURITY DEFINER and performs its own auth/RBAC check.)
-- Helper functions run under the definer inside those RPCs and are not exposed.
-- ============================================================================
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'rpc\_%'
  loop
    execute format('grant execute on function %s to authenticated;', fn.sig);
    execute format('grant execute on function %s to service_role;', fn.sig);
  end loop;
end $$;
