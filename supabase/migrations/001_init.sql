-- ============================================================
-- BRIMSTONE — Supabase SQL Migration
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ─── USERS TABLE ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  password    TEXT NOT NULL,
  mobileno    TEXT NOT NULL,
  dob         TEXT,
  gender      TEXT CHECK (gender IN ('Male', 'Female', 'Other')),
  role        TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── ORDERS TABLE ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS orders (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'confirmed', 'shipped', 'delivered')),
  items            JSONB NOT NULL DEFAULT '[]',
  customer         JSONB,
  shipping_address JSONB,
  pricing          JSONB,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ─── INDEXES ────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_orders_user_id  ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status   ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created  ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);

-- ─── ROW LEVEL SECURITY ─────────────────────────────────────
-- Disable RLS so the backend service role key can read/write freely.
-- Re-enable and add policies if you switch to Supabase Auth on the frontend.

ALTER TABLE users  DISABLE ROW LEVEL SECURITY;
ALTER TABLE orders DISABLE ROW LEVEL SECURITY;
