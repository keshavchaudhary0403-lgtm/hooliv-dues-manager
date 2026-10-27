#!/usr/bin/env bash
# One-time creation of the first admin user (see README Step 3).
# Requires zero existing profiles — safe to run once, then it will 409.
#
# Required env vars (do NOT hardcode these here):
#   SUPABASE_PROJECT_REF   e.g. dtnxnsrhgzoljkcvuyrm
#   SUPABASE_SERVICE_ROLE_KEY   from Project Settings -> API -> service_role
#
# Optional overrides:
#   ADMIN_PHONE (default: 9999999999)
#   ADMIN_PASSWORD (default: admin123 — change immediately after first login)
#   ADMIN_DISPLAY_NAME (default: Admin)

set -euo pipefail

: "${SUPABASE_PROJECT_REF:?Set SUPABASE_PROJECT_REF}"
: "${SUPABASE_SERVICE_ROLE_KEY:?Set SUPABASE_SERVICE_ROLE_KEY}"

ADMIN_PHONE="${ADMIN_PHONE:-9999999999}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"
ADMIN_DISPLAY_NAME="${ADMIN_DISPLAY_NAME:-Admin}"

curl -X POST "https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/admin-users" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"bootstrap_admin\",\"phone\":\"${ADMIN_PHONE}\",\"password\":\"${ADMIN_PASSWORD}\",\"displayName\":\"${ADMIN_DISPLAY_NAME}\"}"
