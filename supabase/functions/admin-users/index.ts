// ============================================================================
// HooLiv Dues Manager — admin-users Edge Function (Deno)
// ----------------------------------------------------------------------------
// Handles the user-management operations that require the Supabase service role
// (creating/updating/deleting Auth users and resetting passwords). Everything
// else in the app goes through the SECURITY DEFINER rpc_* functions.
//
// The browser api-adapter calls this function for:
//   POST   /api/users                     -> { action: "create", ... }
//   PUT    /api/users/:id                 -> { action: "update", id, ... }
//   DELETE /api/users/:id                 -> { action: "delete", id }
//   POST   /api/users/:id/reset-password  -> { action: "reset-password", id, password }
// Plus a one-time { action: "bootstrap_admin", ... } to create the first admin.
//
// Auth model: login email is `{phone}@${AUTH_EMAIL_DOMAIN}`.
// Deploy:  supabase functions deploy admin-users
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY are
//          injected automatically; set AUTH_EMAIL_DOMAIN yourself if desired.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const AUTH_EMAIL_DOMAIN = Deno.env.get("AUTH_EMAIL_DOMAIN") ?? "hooliv.local";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const normalizePhone = (p: string) => (p ?? "").replace(/[^0-9+]/g, "").trim();
const emailFor = (phone: string) => `${phone}@${AUTH_EMAIL_DOMAIN}`;

function permFlags(role: string, permissions: Record<string, boolean> | undefined) {
  const isAdm = role === "regional_head";
  const pick = (k: string) => (isAdm ? 1 : permissions?.[k] ? 1 : 0);
  return {
    can_manage_uploads: pick("canManageUploads"),
    can_manage_team: pick("canManageTeam"),
    can_manage_settings: pick("canManageSettings"),
    can_export_data: pick("canExportData"),
    can_manage_tickets: pick("canManageTickets"),
    can_handle_partial_payments: pick("canHandlePartialPayments"),
  };
}

function safeUser(p: any) {
  const isAdm = p.role === "regional_head";
  return {
    id: p.id,
    phone: p.phone,
    displayName: p.display_name,
    role: p.role,
    assignedCities: p.assigned_cities ?? [],
    assignedProperties: p.assigned_properties ?? [],
    active: p.active,
    permissions: {
      canManageUploads: isAdm || p.can_manage_uploads === 1,
      canManageTeam: isAdm || p.can_manage_team === 1,
      canManageSettings: isAdm || p.can_manage_settings === 1,
      canExportData: isAdm || p.can_export_data === 1,
      canManageTickets: isAdm || p.can_manage_tickets === 1,
      canHandlePartialPayments: isAdm || p.can_handle_partial_payments === 1,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  let body: any;
  try { body = await req.json(); } catch { return json({ message: "Invalid JSON" }, 400); }
  const action = body?.action as string;

  try {
    // ----- bootstrap_admin: only allowed while there are zero profiles ---------
    if (action === "bootstrap_admin") {
      const { count } = await admin.from("profiles").select("id", { count: "exact", head: true });
      if ((count ?? 0) > 0) return json({ message: "Admin already exists" }, 409);
      const phone = normalizePhone(body.phone || "9999999999");
      const password = body.password || "admin123";
      const displayName = body.displayName || "Admin";
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email: emailFor(phone), password, email_confirm: true,
      });
      if (cErr) return json({ message: cErr.message }, 400);
      const { data: prof, error: pErr } = await admin.from("profiles").insert({
        auth_id: created.user!.id, phone, display_name: displayName, role: "regional_head",
        assigned_cities: [], assigned_properties: [], active: 1, must_change_password: 0,
      }).select().single();
      if (pErr) return json({ message: pErr.message }, 400);
      return json(safeUser(prof));
    }

    // ----- All other actions require an authenticated ADMIN caller -------------
    const authHeader = req.headers.get("Authorization") ?? "";
    const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
    });
    const { data: me } = await asCaller.rpc("rpc_me");
    if (!me || me.role !== "regional_head") return json({ message: "Forbidden" }, 403);

    // ----- create --------------------------------------------------------------
    if (action === "create") {
      const { phone, password, displayName, role, assignedCities, assignedProperties, permissions } = body;
      if (!phone || !password || !displayName || !role)
        return json({ message: "Phone, password, display name, and role are required" }, 400);
      const np = normalizePhone(phone);
      const { data: existing } = await admin.from("profiles").select("id").eq("phone", np).maybeSingle();
      if (existing) return json({ message: "A user with this phone number already exists" }, 409);

      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email: emailFor(np), password, email_confirm: true,
      });
      if (cErr) return json({ message: cErr.message }, 400);

      const { data: prof, error: pErr } = await admin.from("profiles").insert({
        auth_id: created.user!.id, phone: np, display_name: displayName, role,
        assigned_cities: assignedCities ?? [], assigned_properties: assignedProperties ?? [],
        active: 1, must_change_password: 1, ...permFlags(role, permissions),
      }).select().single();
      if (pErr) { await admin.auth.admin.deleteUser(created.user!.id); return json({ message: pErr.message }, 400); }
      return json(safeUser(prof));
    }

    // ----- update --------------------------------------------------------------
    if (action === "update") {
      const id = Number(body.id);
      const { phone, password, displayName, role, assignedCities, assignedProperties, active, permissions } = body;
      const { data: target } = await admin.from("profiles").select("*").eq("id", id).maybeSingle();
      if (!target) return json({ message: "User not found" }, 404);

      if (password) {
        const { error } = await admin.auth.admin.updateUserById(target.auth_id, { password });
        if (error) return json({ message: error.message }, 400);
      }
      const patch: Record<string, unknown> = {};
      if (displayName !== undefined) patch.display_name = displayName;
      if (role !== undefined) patch.role = role;
      if (assignedCities !== undefined) patch.assigned_cities = assignedCities;
      if (assignedProperties !== undefined) patch.assigned_properties = assignedProperties;
      if (active !== undefined) patch.active = active;
      if (phone !== undefined) {
        const np = normalizePhone(phone);
        patch.phone = np;
        const { error } = await admin.auth.admin.updateUserById(target.auth_id, { email: emailFor(np) });
        if (error) return json({ message: error.message }, 400);
      }
      if (permissions !== undefined) {
        Object.assign(patch, permFlags(role ?? target.role, permissions));
      }
      const { data: prof, error: uErr } = await admin.from("profiles")
        .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select().single();
      if (uErr) return json({ message: uErr.message }, 400);
      return json(safeUser(prof));
    }

    // ----- delete --------------------------------------------------------------
    if (action === "delete") {
      const id = Number(body.id);
      const { data: target } = await admin.from("profiles").select("auth_id").eq("id", id).maybeSingle();
      if (!target) return json({ message: "User not found" }, 404);
      // Deleting the auth user cascades to the profile row (FK on delete cascade).
      const { error } = await admin.auth.admin.deleteUser(target.auth_id);
      if (error) return json({ message: error.message }, 400);
      return json({ message: "User deleted" });
    }

    // ----- reset-password ------------------------------------------------------
    if (action === "reset-password") {
      const id = Number(body.id);
      const { password } = body;
      if (!password || password.length < 8)
        return json({ message: "Password must be at least 8 characters" }, 400);
      const { data: target } = await admin.from("profiles").select("auth_id").eq("id", id).maybeSingle();
      if (!target) return json({ message: "User not found" }, 404);
      const { error } = await admin.auth.admin.updateUserById(target.auth_id, { password });
      if (error) return json({ message: error.message }, 400);
      await admin.from("profiles").update({ must_change_password: 1, updated_at: new Date().toISOString() }).eq("id", id);
      return json({ message: "Temporary password set. User must change it on next login." });
    }

    return json({ message: "Unknown action" }, 400);
  } catch (e) {
    return json({ message: (e as Error).message }, 500);
  }
});
