import { createClient } from "@supabase/supabase-js";

// The static frontend talks to Supabase directly. These come from Vite env vars
// (see .env.example): VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Login uses a synthesized email of the form `{phone}@{AUTH_EMAIL_DOMAIN}`.
// Must match the AUTH_EMAIL_DOMAIN used by the admin-users Edge Function.
export const AUTH_EMAIL_DOMAIN =
  (import.meta.env.VITE_AUTH_EMAIL_DOMAIN as string) || "hooliv.local";

if (!url || !anonKey) {
  // Surface a clear message during development if env vars are missing.
  console.error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill them in.",
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

export const emailForPhone = (phone: string) =>
  `${phone.replace(/[^0-9+]/g, "").trim()}@${AUTH_EMAIL_DOMAIN}`;

export const STORAGE_BUCKET = "ticket-attachments";
