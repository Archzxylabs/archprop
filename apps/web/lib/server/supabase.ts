/**
 * Supabase client factories for route handlers.
 *
 * Two clients exist on purpose:
 *   - `createUserClient` carries the caller's JWT, so every read and write is
 *     subject to row level security with `auth.uid()` resolved by Postgres.
 *     Authorization therefore lives in the database policies, not in handler
 *     code that a future refactor could forget to check.
 *   - `createServiceClient` bypasses RLS and is used only for work the caller
 *     has no business performing directly (verifying a JWT issuer, recording
 *     a chain event the API itself observed). It never runs on a path that
 *     writes user-owned rows without the handler having already authorized
 *     the caller.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SupabaseConfig } from "./config";

export type UserSupabaseClient = SupabaseClient;

export function createUserClient(
  config: SupabaseConfig,
  accessToken?: string | null,
): UserSupabaseClient {
  const token = accessToken?.trim();
  const options = {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}),
  };
  return createClient(config.url, config.anonKey, options);
}

export function createServiceClient(config: SupabaseConfig): UserSupabaseClient {
  return createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
