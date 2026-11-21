import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Support both Next.js (NEXT_PUBLIC_) and Vite (VITE_) conventions seamlessly
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://pwfmxbasjrbxqmohbsnm.supabase.co';

const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  'sb_publishable_zyN9jttl7iy1AWShZtty4Q_SgkyzmII';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl.startsWith('http')
);

let clientInstance: SupabaseClient | null = null;

/**
 * Returns the singleton Supabase client instance, or null if configuration is missing.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) {
    return null;
  }
  if (!clientInstance) {
    clientInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'american_pancakes_supabase_auth',
      },
    });
  }
  return clientInstance;
}

/**
 * Direct export of the configured client (or a dummy client if unconfigured)
 * to prevent crashes during builds when environment variables are not yet populated.
 */
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'american_pancakes_supabase_auth',
      },
    })
  : null;
