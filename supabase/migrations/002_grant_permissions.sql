-- ============================================================
-- BRIMSTONE — Grant permissions to anon + authenticated roles
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- This fixes the 42501 RLS/permission error when using the anon key
-- ============================================================

-- Disable RLS (in case it got re-enabled)
ALTER TABLE users  DISABLE ROW LEVEL SECURITY;
ALTER TABLE orders DISABLE ROW LEVEL SECURITY;

-- Grant full access to the anon role (used by publishable/anon key)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE users  TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE orders TO anon;

-- Grant full access to the authenticated role (used after login)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE users  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE orders TO authenticated;

-- Grant usage on sequences (needed for UUID generation)
GRANT USAGE ON SCHEMA public TO anon, authenticated;
