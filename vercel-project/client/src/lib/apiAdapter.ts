// ============================================================================
// HooLiv Dues Manager — Browser API adapter
// ----------------------------------------------------------------------------
// The original app spoke to an Express backend at /api/*. This adapter installs
// a global fetch() interceptor that routes those same /api/* calls to Supabase
// (RPC functions, Auth, Storage, and the admin-users Edge Function) and returns
// Response-shaped objects, so the entire React UI keeps working UNCHANGED.
//
// Only two things in the UI can't be intercepted by fetch (they are handled by
// small surgical edits in the pages):
//   - the CSV export (window.open) -> uses exportTenantsCsv() below
//   - <img src>/<a href> for attachments -> use the signed `url` we attach to
//     each attachment row in GET /api/tickets/:id/attachments
// ============================================================================

import * as XLSX from "xlsx";
import { supabase, emailForPhone, STORAGE_BUCKET } from "./supabase";

// ---- Response helpers ------------------------------------------------------
const jsonResponse = (data: unknown, status = 200) =>
  new Response(data === undefined ? "" : JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const textResponse = (text: string, status = 200) =>
  new Response(text, { status, headers: { "Content-Type": "text/plain" } });

// Map a Postgres/PostgREST error from an rpc() call to an HTTP-ish response.
function errorToResponse(error: { code?: string; message?: string } | null): Response {
  const msg = error?.message || "Request failed";
  const code = error?.code;
  if (code === "P0002") return jsonResponse({ message: msg }, 404);
  if (code === "42501") return jsonResponse({ message: msg }, 403);
  if (/unauthor/i.test(msg)) return jsonResponse({ message: msg }, 401);
  if (/forbidden/i.test(msg)) return jsonResponse({ message: msg }, 403);
  if (/not found/i.test(msg)) return jsonResponse({ message: msg }, 404);
  return jsonResponse({ message: msg }, 400);
}

// Call an RPC and wrap the result as a Response.
async function rpc(fn: string, args: Record<string, unknown> = {}): Promise<Response> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return errorToResponse(error);
  return jsonResponse(data ?? null);
}

// ---- mustChangePassword gate ----------------------------------------------
// Mirrors the server middleware: while a user must change their password, only
// a small allow-list of endpoints is reachable.
let mustChangePassword = false;
export const setMustChangePassword = (v: boolean) => {
  mustChangePassword = v;
};
const GATE_ALLOWED = new Set([
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
  "/api/set-password",
]);

// ---- Edge Function (admin user management) --------------------------------
async function callAdminUsers(payload: Record<string, unknown>): Promise<Response> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token ?? "";
  const base = import.meta.env.VITE_SUPABASE_URL as string;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const res = await fetch(`${base}/functions/v1/admin-users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anon,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return jsonResponse(body, res.status);
}

// ---- Query-string / body helpers ------------------------------------------
function paramsToFilters(sp: URLSearchParams): Record<string, unknown> {
  // Convert the tenant/ticket query string into the jsonb filters object the
  // RPCs expect (keys already match: search, city, property, status, ...).
  const f: Record<string, unknown> = {};
  sp.forEach((v, k) => {
    if (k === "page" || k === "pageSize" || k === "sortField" || k === "sortDir") return;
    f[k] = v;
  });
  return f;
}

async function readBody(init?: RequestInit): Promise<any> {
  if (!init || init.body == null) return {};
  if (typeof init.body === "string") {
    try {
      return JSON.parse(init.body);
    } catch {
      return {};
    }
  }
  return init.body; // FormData handled separately
}

// ---- Attachments: attach signed URLs --------------------------------------
async function withSignedUrls(rows: any[]): Promise<any[]> {
  const out: any[] = [];
  for (const r of rows) {
    let url: string | null = null;
    if (r.storagePath) {
      const { data } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(r.storagePath, 60 * 60); // 1 hour
      url = data?.signedUrl ?? null;
    }
    out.push({ ...r, url });
  }
  return out;
}

// ---- File parsing for upload ----------------------------------------------
function parseWorkbookHeaders(buf: ArrayBuffer): string[] {
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, blankrows: false });
  return (rows[0] as string[])?.map((h) => String(h ?? "").trim()) ?? [];
}
function parseWorkbookRows(buf: ArrayBuffer): Record<string, string>[] {
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "", raw: false });
}

// ---- The CSV export (called from the surgical edit in tenants.tsx) --------
export async function exportTenantsCsv(queryString: string): Promise<void> {
  const sp = new URLSearchParams(queryString);
  const { data, error } = await supabase.rpc("rpc_tenants_export", {
    p_filters: paramsToFilters(sp),
  });
  if (error) throw new Error(error.message);
  const rows: any[] = data?.rows ?? [];

  const headers = [
    "Tenant Name", "Primary Phone", "Secondary Phone", "Parent Name", "Parent Phone",
    "City", "Property", "Room No", "Total Amount Due", "Check-in Date", "Due Date",
    "Billing Cycle", "Checkout Notice Date", "Expected Checkout Date", "Payment Status",
    "Latest Follow-up Date", "Escalation Level",
  ];
  const esc = (v: any) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push([
      r.tenantName, r.primaryPhone, r.secondaryPhone, r.parentName, r.parentPhone,
      r.city, r.propertyName, r.roomNo, r.totalAmountDue, r.checkInDate, r.dueDate,
      r.rentalBillingCycle, r.checkoutNoticeDate, r.expectedCheckoutDate, r.paymentStatus,
      r.latestFollowUpDate, r.escalationLevel,
    ].map(esc).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `tenants-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

// ===========================================================================
// Main router
// ===========================================================================
export async function handleApiRequest(rawUrl: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method || "GET").toUpperCase();
  const u = new URL(rawUrl, window.location.origin);
  const path = u.pathname;
  const sp = u.searchParams;

  // mustChangePassword gate
  if (mustChangePassword && !GATE_ALLOWED.has(path)) {
    return jsonResponse(
      { message: "You must change your password before accessing the system.", mustChangePassword: true },
      403,
    );
  }

  const seg = path.split("/").filter(Boolean); // e.g. ["api","tenants","5","activity"]

  try {
    // ---------------- AUTH ----------------
    if (path === "/api/auth/login" && method === "POST") {
      const { phone, password } = await readBody(init);
      const { error } = await supabase.auth.signInWithPassword({
        email: emailForPhone(String(phone || "")),
        password: String(password || ""),
      });
      if (error) return jsonResponse({ message: "Invalid phone number or password" }, 401);
      const { data: me, error: meErr } = await supabase.rpc("rpc_me");
      if (meErr) {
        await supabase.auth.signOut();
        return jsonResponse({ message: "Invalid phone number or password" }, 401);
      }
      mustChangePassword = !!me?.mustChangePassword;
      return jsonResponse(me);
    }

    if (path === "/api/auth/logout" && method === "POST") {
      await supabase.auth.signOut();
      mustChangePassword = false;
      return jsonResponse({ message: "Logged out" });
    }

    if (path === "/api/auth/me" && method === "GET") {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) return jsonResponse({ message: "Not authenticated" }, 401);
      const { data: me, error } = await supabase.rpc("rpc_me");
      if (error) return jsonResponse({ message: "Account deactivated" }, 401);
      mustChangePassword = !!me?.mustChangePassword;
      return jsonResponse(me);
    }

    if (path === "/api/set-password" && method === "POST") {
      const { newPassword, confirmPassword } = await readBody(init);
      if (!newPassword || String(newPassword).length < 8)
        return jsonResponse({ message: "Password must be at least 8 characters" }, 400);
      if (newPassword !== confirmPassword)
        return jsonResponse({ message: "Passwords do not match" }, 400);
      const { error: upErr } = await supabase.auth.updateUser({ password: newPassword });
      if (upErr) return jsonResponse({ message: upErr.message }, 400);
      const { error: markErr } = await supabase.rpc("rpc_mark_password_changed");
      if (markErr) return errorToResponse(markErr);
      mustChangePassword = false;
      return jsonResponse({ message: "Password updated successfully" });
    }

    // ---------------- USERS (Edge Function) ----------------
    if (path === "/api/users" && method === "GET") return rpc("rpc_list_users");
    if (path === "/api/users" && method === "POST") {
      const body = await readBody(init);
      return callAdminUsers({ action: "create", ...body });
    }
    if (seg[1] === "users" && seg.length === 3 && method === "PUT") {
      const body = await readBody(init);
      return callAdminUsers({ action: "update", id: Number(seg[2]), ...body });
    }
    if (seg[1] === "users" && seg.length === 3 && method === "DELETE") {
      return callAdminUsers({ action: "delete", id: Number(seg[2]) });
    }
    if (seg[1] === "users" && seg[3] === "reset-password" && method === "POST") {
      const body = await readBody(init);
      return callAdminUsers({ action: "reset-password", id: Number(seg[2]), ...body });
    }

    // ---------------- TENANTS ----------------
    if (path === "/api/tenants" && method === "GET") {
      return rpc("rpc_filtered_tenants", {
        p_page: Number(sp.get("page") || 1),
        p_page_size: Number(sp.get("pageSize") || 50),
        p_filters: {
          ...paramsToFilters(sp),
          sortField: sp.get("sortField"),
          sortDir: sp.get("sortDir"),
        },
      });
    }
    if (path === "/api/tenants/filter-options" && method === "GET") return rpc("rpc_filter_options");
    if (path === "/api/tenants/stats" && method === "GET") {
      return rpc("rpc_dashboard_stats", { p_city: sp.get("city"), p_property: sp.get("property") });
    }
    if (seg[1] === "tenants" && seg.length === 3 && method === "GET") {
      return rpc("rpc_tenant_by_id", { p_id: Number(seg[2]) });
    }
    if (seg[1] === "tenants" && seg.length === 3 && method === "PATCH") {
      const body = await readBody(init);
      return rpc("rpc_update_tenant", { p_id: Number(seg[2]), p_patch: body });
    }
    if (seg[1] === "tenants" && seg[3] === "activity" && method === "GET") {
      return rpc("rpc_get_activity_by_tenant", { p_tenant_id: Number(seg[2]) });
    }
    if (seg[1] === "tenants" && seg[3] === "activity" && method === "POST") {
      const body = await readBody(init);
      return rpc("rpc_create_activity", { p_tenant_id: Number(seg[2]), p_body: body });
    }

    // ---------------- ACTIVITY ----------------
    if (seg[1] === "activity" && seg[3] === "link-ticket" && method === "PATCH") {
      const body = await readBody(init);
      return rpc("rpc_link_activity_ticket", {
        p_activity_id: Number(seg[2]),
        p_ticket_id: Number(body.ticketId),
      });
    }
    if (path === "/api/activity" && method === "DELETE") {
      return rpc("rpc_clear_activity");
    }
    if (path === "/api/activity-reset-log" && method === "GET") {
      return rpc("rpc_get_activity_reset_log");
    }

    // ---------------- UPLOAD ----------------
    if (path === "/api/upload/preview" && method === "POST") {
      const fd = init!.body as FormData;
      const file = fd.get("file") as File;
      if (!file) return jsonResponse({ message: "No file provided" }, 400);
      const headers = parseWorkbookHeaders(await file.arrayBuffer());
      if (headers.length === 0) return jsonResponse({ message: "File has no data" }, 400);
      return jsonResponse({ headers });
    }
    if (path === "/api/upload" && method === "POST") {
      const fd = init!.body as FormData;
      const file = fd.get("file") as File;
      const mapping = JSON.parse(String(fd.get("mapping") || "{}"));
      const username = String(fd.get("username") || "");
      if (!file) return jsonResponse({ message: "No file provided" }, 400);
      const rows = parseWorkbookRows(await file.arrayBuffer());
      return rpc("rpc_bulk_upsert_tenants", {
        p_file_name: file.name,
        p_uploaded_by: username,
        p_mapping: mapping,
        p_rows: rows,
      });
    }

    // ---------------- RESET STATUSES ----------------
    if (path === "/api/reset-statuses" && method === "POST") {
      return rpc("rpc_reset_statuses", { p_scope: null, p_value: null });
    }
    if (path === "/api/reset-statuses/city" && method === "POST") {
      const body = await readBody(init);
      return rpc("rpc_reset_statuses", { p_scope: "city", p_value: body.city });
    }
    if (path === "/api/reset-statuses/property" && method === "POST") {
      const body = await readBody(init);
      return rpc("rpc_reset_statuses", { p_scope: "property", p_value: body.propertyName ?? body.property });
    }

    // ---------------- COLUMN MAPPING / UPLOAD HISTORY ----------------
    if (path === "/api/column-mapping" && method === "GET") return rpc("rpc_get_column_mapping");
    if (path === "/api/column-mapping" && method === "DELETE") return rpc("rpc_delete_column_mapping");
    if (path === "/api/upload-history" && method === "GET") return rpc("rpc_get_upload_history");
    if (seg[1] === "upload-history" && seg.length === 3 && method === "DELETE") {
      return rpc("rpc_delete_upload_history", { p_id: Number(seg[2]) });
    }

    // ---------------- SETTINGS ----------------
    if (path === "/api/settings/grace-period" && method === "GET") return rpc("rpc_get_grace_period");
    if (path === "/api/settings/grace-period" && method === "PUT") {
      const body = await readBody(init);
      return rpc("rpc_set_grace_period", { p_days: Number(body.gracePeriodDays) });
    }
    if (path === "/api/settings/master-flag" && method === "GET") return rpc("rpc_get_master_flag");
    if (path === "/api/settings/master-flag" && method === "PUT") {
      const body = await readBody(init);
      return rpc("rpc_set_master_flag", { p_config: body });
    }
    if (path === "/api/settings/flag-thresholds" && method === "GET") return rpc("rpc_get_flag_thresholds");
    if (path === "/api/settings/flag-thresholds" && method === "PUT") {
      const body = await readBody(init);
      return rpc("rpc_set_flag_thresholds", {
        p_orange: Number(body.orangeFlagDays),
        p_red: Number(body.redFlagDays),
        p_dd_orange: body.dueDateOrangeFlagDays != null ? Number(body.dueDateOrangeFlagDays) : null,
        p_dd_red: body.dueDateRedFlagDays != null ? Number(body.dueDateRedFlagDays) : null,
        p_fu_orange: body.followUpOrangeFlagDays != null ? Number(body.followUpOrangeFlagDays) : null,
        p_fu_red: body.followUpRedFlagDays != null ? Number(body.followUpRedFlagDays) : null,
      });
    }

    // ---------------- TEAM / PARTIAL-PAYMENT LOOKUP ----------------
    if (path === "/api/team-members" && method === "GET") {
      return rpc("rpc_team_members", {
        p_active: sp.get("active") === "true" || sp.get("active") === "1",
        p_city: sp.get("city"),
      });
    }
    if (path === "/api/partial-payment-handlers/lookup" && method === "GET") {
      return rpc("rpc_partial_payment_handler_lookup", {
        p_city: sp.get("city"),
        p_property: sp.get("property"),
      });
    }

    // ---------------- TICKETS ----------------
    if (path === "/api/tickets" && method === "GET") {
      return rpc("rpc_get_tickets", { p_filters: paramsToFilters(sp) });
    }
    if (path === "/api/tickets" && method === "POST") {
      // FormData with fields + images[]
      const fd = init!.body as FormData;
      const body: Record<string, unknown> = {};
      const images: File[] = [];
      fd.forEach((val, key) => {
        if (key === "images") images.push(val as File);
        else body[key] = val;
      });
      const { data: ticket, error } = await supabase.rpc("rpc_create_ticket", { p_body: body });
      if (error) return errorToResponse(error);
      const ticketId = ticket.id;
      for (const file of images) {
        const path2 = `${ticketId}/${crypto.randomUUID()}-${file.name}`;
        const { error: upErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(path2, file, { contentType: file.type, upsert: false });
        if (!upErr) {
          await supabase.rpc("rpc_create_ticket_attachment", {
            p_ticket_id: ticketId,
            p_filename: file.name,
            p_mime_type: file.type,
            p_storage_path: path2,
          });
        }
      }
      return jsonResponse(ticket);
    }
    if (seg[1] === "tickets" && seg[2] === "by-phone" && method === "GET") {
      return rpc("rpc_tickets_by_phone", { p_phone: decodeURIComponent(seg[3]) });
    }
    if (seg[1] === "tickets" && seg[2] === "open-count" && method === "GET") {
      return rpc("rpc_open_ticket_count_by_phone", { p_phone: decodeURIComponent(seg[3]) });
    }
    if (seg[1] === "tickets" && seg[3] === "attachments" && method === "GET") {
      const { data, error } = await supabase.rpc("rpc_get_ticket_attachments", {
        p_ticket_id: Number(seg[2]),
      });
      if (error) return errorToResponse(error);
      return jsonResponse(await withSignedUrls(data ?? []));
    }
    if (seg[1] === "tickets" && seg[3] === "comments" && method === "POST") {
      const body = await readBody(init);
      return rpc("rpc_ticket_comment_create", { p_ticket_id: Number(seg[2]), p_body: body });
    }
    if (seg[1] === "tickets" && seg.length === 3 && method === "GET") {
      return rpc("rpc_get_ticket", { p_id: Number(seg[2]) });
    }

    // ---------------- ANALYTICS ----------------
    if (path === "/api/analytics/risk-distribution" && method === "GET") {
      return rpc("rpc_risk_distribution", {
        p_filter_city: sp.get("city"),
        p_filter_property: sp.get("property"),
        p_checkout_only: sp.get("checkoutOnly") === "true",
      });
    }
    if (path === "/api/analytics/escalation-trend" && method === "GET") {
      return rpc("rpc_escalation_trend", {
        p_filter_city: sp.get("city"),
        p_filter_property: sp.get("property"),
      });
    }
    if (path === "/api/analytics/collectable-trend" && method === "GET") {
      return rpc("rpc_collectable_trend", {
        p_filter_city: sp.get("city"),
        p_filter_property: sp.get("property"),
        p_start_date: sp.get("startDate"),
        p_end_date: sp.get("endDate"),
      });
    }

    // Attachment view/download are handled by signed URLs (surgical edit); if
    // something still hits these, return 404 (old base64 format is gone).
    if (seg[1] === "attachments") {
      return jsonResponse({ message: "Not available" }, 404);
    }

    return jsonResponse({ message: `No adapter route for ${method} ${path}` }, 404);
  } catch (e: any) {
    return jsonResponse({ message: e?.message || "Adapter error" }, 500);
  }
}

// ===========================================================================
// Install the global fetch interceptor. Any request to a same-origin /api/*
// path is routed to Supabase; everything else falls through to the real fetch.
// ===========================================================================
export function installApiAdapter() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url: string;
    if (typeof input === "string") url = input;
    else if (input instanceof URL) url = input.toString();
    else url = input.url;

    // Only intercept our API. Requests to Supabase itself (absolute URLs) or any
    // other host go straight through.
    const isApi = url.startsWith("/api/") ||
      url.startsWith(window.location.origin + "/api/");
    if (!isApi) return originalFetch(input as any, init);

    // If called as fetch(Request), merge its method/body into init.
    if (typeof input !== "string" && !(input instanceof URL)) {
      const req = input as Request;
      const body = init?.body ?? (await req.clone().text().catch(() => undefined));
      return handleApiRequest(url, { method: req.method, body, headers: req.headers as any, ...init });
    }
    return handleApiRequest(url, init);
  };
}
