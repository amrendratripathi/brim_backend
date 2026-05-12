-- ============================================================
-- BRIMSTONE — Worker Referral & Coupon Management System
-- Migration 003: Core Schema
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- SECTION 1: ENUMS
-- ─────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE worker_status       AS ENUM ('active', 'inactive', 'suspended');
  CREATE TYPE order_status_type   AS ENUM ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'refunded');
  CREATE TYPE payout_status_type  AS ENUM ('pending', 'approved', 'rejected', 'completed');
  CREATE TYPE commission_status   AS ENUM ('pending', 'confirmed', 'paid', 'cancelled');
  CREATE TYPE user_role           AS ENUM ('admin', 'worker', 'customer');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ─────────────────────────────────────────────────────────────
-- SECTION 2: EXTEND USERS TABLE WITH ROLE
-- (adds role column to existing users table if missing)
-- ─────────────────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS app_role TEXT NOT NULL DEFAULT 'customer'
  CHECK (app_role IN ('admin', 'worker', 'customer'));

-- ─────────────────────────────────────────────────────────────
-- SECTION 3: WORKERS TABLE
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workers (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  coupon_code           TEXT NOT NULL UNIQUE,
  discount_percentage   NUMERIC(5,2) NOT NULL DEFAULT 10.00
                          CHECK (discount_percentage > 0 AND discount_percentage <= 100),
  commission_percentage NUMERIC(5,2) NOT NULL DEFAULT 5.00
                          CHECK (commission_percentage > 0 AND commission_percentage <= 100),
  total_sales           NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  total_orders          INTEGER NOT NULL DEFAULT 0,
  total_earnings        NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  available_balance     NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  coupon_max_uses       INTEGER DEFAULT NULL,           -- NULL = unlimited
  coupon_used_count     INTEGER NOT NULL DEFAULT 0,
  coupon_expires_at     TIMESTAMPTZ DEFAULT NULL,       -- NULL = no expiry
  coupon_min_order      NUMERIC(12,2) DEFAULT 0.00,     -- minimum order amount to use coupon
  status                worker_status NOT NULL DEFAULT 'active',
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- SECTION 4: COUPON ORDERS TABLE
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS coupon_orders (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  worker_id       UUID NOT NULL REFERENCES workers(id) ON DELETE RESTRICT,
  customer_id     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id        UUID REFERENCES orders(id) ON DELETE SET NULL,  -- link to main orders table
  order_amount    NUMERIC(12,2) NOT NULL CHECK (order_amount > 0),
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  final_amount    NUMERIC(12,2) NOT NULL CHECK (final_amount >= 0),
  coupon_code     TEXT NOT NULL,
  order_status    order_status_type NOT NULL DEFAULT 'pending',
  metadata        JSONB DEFAULT '{}',   -- extra order data (items, shipping, etc.)
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- SECTION 5: COMMISSIONS TABLE
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS commissions (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  worker_id         UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  order_id          UUID NOT NULL REFERENCES coupon_orders(id) ON DELETE CASCADE,
  commission_amount NUMERIC(12,2) NOT NULL CHECK (commission_amount >= 0),
  rate_snapshot     NUMERIC(5,2) NOT NULL,   -- commission % at time of order (immutable record)
  status            commission_status NOT NULL DEFAULT 'pending',
  confirmed_at      TIMESTAMPTZ,
  paid_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- SECTION 6: PAYOUTS TABLE
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payouts (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  worker_id       UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  status          payout_status_type NOT NULL DEFAULT 'pending',
  payment_method  TEXT DEFAULT 'bank_transfer',  -- bank_transfer | upi | crypto
  payment_details JSONB DEFAULT '{}',            -- encrypted payment info
  admin_notes     TEXT,
  requested_at    TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at     TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- SECTION 7: AUDIT LOG TABLE (security & traceability)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   UUID,
  old_data    JSONB DEFAULT '{}',
  new_data    JSONB DEFAULT '{}',
  ip_address  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- SECTION 8: COUPON USAGE LOG (prevent duplicate use tracking)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS coupon_usage_log (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  worker_id   UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id    UUID REFERENCES coupon_orders(id) ON DELETE CASCADE,
  coupon_code TEXT NOT NULL,
  used_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (customer_id, coupon_code)  -- one use per customer per coupon
);

-- ─────────────────────────────────────────────────────────────
-- SECTION 9: INDEXES
-- ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_workers_user_id         ON workers(user_id);
CREATE INDEX IF NOT EXISTS idx_workers_coupon_code     ON workers(coupon_code);
CREATE INDEX IF NOT EXISTS idx_workers_status          ON workers(status);
CREATE INDEX IF NOT EXISTS idx_coupon_orders_worker    ON coupon_orders(worker_id);
CREATE INDEX IF NOT EXISTS idx_coupon_orders_customer  ON coupon_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_coupon_orders_status    ON coupon_orders(order_status);
CREATE INDEX IF NOT EXISTS idx_coupon_orders_created   ON coupon_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commissions_worker      ON commissions(worker_id);
CREATE INDEX IF NOT EXISTS idx_commissions_order       ON commissions(order_id);
CREATE INDEX IF NOT EXISTS idx_commissions_status      ON commissions(status);
CREATE INDEX IF NOT EXISTS idx_payouts_worker          ON payouts(worker_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status          ON payouts(status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor        ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created      ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coupon_usage_customer   ON coupon_usage_log(customer_id);
CREATE INDEX IF NOT EXISTS idx_coupon_usage_code       ON coupon_usage_log(coupon_code);

-- ─────────────────────────────────────────────────────────────
-- SECTION 10: updated_at TRIGGER FUNCTION
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_workers_updated_at
  BEFORE UPDATE ON workers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_coupon_orders_updated_at
  BEFORE UPDATE ON coupon_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_commissions_updated_at
  BEFORE UPDATE ON commissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_payouts_updated_at
  BEFORE UPDATE ON payouts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
