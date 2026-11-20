-- ==============================================================================
-- Supabase Bootstrap Script for American Pancakes POS
-- Run this ONCE as the `postgres` admin role in the Supabase SQL Editor.
-- ==============================================================================

-- 1. Create the least-privilege application role (if not already existing)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'pos_app') THEN
    CREATE ROLE pos_app WITH LOGIN PASSWORD 'CHANGE_THIS_TO_A_SECURE_PASSWORD';
  END IF;
END $$;

-- 2. Grant basic connection and schema usage
GRANT CONNECT ON DATABASE postgres TO pos_app;
GRANT USAGE ON SCHEMA public TO pos_app;

-- 3. Grant table, sequence, and function access to pos_app
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pos_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO pos_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO pos_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO pos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO pos_app;

-- 4. Lock down schema public from Supabase PostgREST (anon / authenticated roles)
-- Ensures the public API cannot be bypassed directly without going through our Express API
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- 5. Helper function for RLS lockdown (applies deny-all to all tables in public)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
    EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' ENABLE ROW LEVEL SECURITY;';
  END LOOP;
END $$;
