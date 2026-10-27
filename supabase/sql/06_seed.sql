-- ============================================================================
-- HooLiv Dues Manager — 06_seed.sql
-- Seeds default application settings. Idempotent.
--
-- NOTE ON THE ADMIN USER:
--   The original app shipped a default admin (phone 9999999999 / admin123).
--   With Supabase, a login user must exist in auth.users with a real hashed
--   password, which can only be created by the Auth service (not plain SQL).
--   Create it AFTER deploying the Edge Function (see README), e.g.:
--
--     curl -X POST "$SUPABASE_URL/functions/v1/admin-users" \
--       -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
--       -H "Content-Type: application/json" \
--       -d '{"action":"bootstrap_admin","phone":"9999999999",
--            "password":"admin123","displayName":"Admin"}'
--
--   That call creates the auth user `9999999999@<AUTH_EMAIL_DOMAIN>` and the
--   matching regional_head profile row. `bootstrap_admin` only works while no
--   profiles exist yet, so it is safe to expose once.
-- ============================================================================

insert into public.app_settings (setting_key, setting_value) values
  ('grace_period_days', '5'),
  ('orange_flag_days', '15'),
  ('red_flag_days', '30'),
  ('due_date_orange_flag_days', '3'),
  ('due_date_red_flag_days', '7'),
  ('follow_up_orange_flag_days', '2'),
  ('follow_up_red_flag_days', '5'),
  ('master_flag_config',
   '{"enabled":false,"warningThreshold":3,"criticalThreshold":7,"conditions":[' ||
   '{"id":"overdue_days_default","type":"overdue_days","weight":3,"threshold":30,"enabled":true},' ||
   '{"id":"amount_due_default","type":"amount_due","weight":2,"threshold":5000,"enabled":true},' ||
   '{"id":"followup_missed_default","type":"followup_missed","weight":2,"threshold":7,"enabled":true}]}')
on conflict (setting_key) do nothing;
