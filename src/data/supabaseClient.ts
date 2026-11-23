import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The one Supabase client for the app: sync and social share it, so they share the signed-in
 * account. Sessions are kept in the browser and refreshed; nothing is read from the URL (sign-in
 * is email + password, TASKS.md D15).
 */
export function connectSupabase(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
}
