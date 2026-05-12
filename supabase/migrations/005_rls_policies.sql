-- ============================================================
-- BRIMSTONE — Worker Referral & Coupon Management System
-- Migration 005: Row Level Security Policies
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- Enable RLS on all tables
-- ─────────────────────────────────────────────────────────────

ALTER TABLE workers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_orders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE commissions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_usage_log  ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────
-- HELPER: role-check function using our users table
-- We use app_role from the users table (not Supabase user metadata)
-- because our auth is custom JWT-based
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT app_role FROM users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT current_user_role() = 'admin'
$$;

CREATE OR REPLACE FUNCTION is_worker()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT current_user_role() IN ('admin', 'worker')
$$;

-- ─────────────────────────────────────────────────────────────
-- WORKERS TABLE POLICIES
-- ─────────────────────────────────────────────────────────────

-- Admins: full access
CREATE POLICY workers_admin_all ON workers
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Workers: read their own record
CREATE POLICY workers_self_read ON workers
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Workers: update their own record (limited fields via app logic)
CREATE POLICY workers_self_update ON workers
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- COUPON ORDERS TABLE POLICIES
-- ─────────────────────────────────────────────────────────────

-- Admins: full access
CREATE POLICY coupon_orders_admin_all ON coupon_orders
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Workers: read orders where they are the referring worker
CREATE POLICY coupon_orders_worker_read ON coupon_orders
  FOR SELECT TO authenticated
  USING (
    worker_id IN (SELECT id FROM workers WHERE user_id = auth.uid())
  );

-- Customers: read their own orders
CREATE POLICY coupon_orders_customer_read ON coupon_orders
  FOR SELECT TO authenticated
  USING (customer_id = auth.uid());

-- Customers: insert new orders (via apply_coupon function which is SECURITY DEFINER)
CREATE POLICY coupon_orders_customer_insert ON coupon_orders
  FOR INSERT TO authenticated
  WITH CHECK (customer_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- COMMISSIONS TABLE POLICIES
-- ─────────────────────────────────────────────────────────────

-- Admins: full access
CREATE POLICY commissions_admin_all ON commissions
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Workers: read their own commissions
CREATE POLICY commissions_worker_read ON commissions
  FOR SELECT TO authenticated
  USING (
    worker_id IN (SELECT id FROM workers WHERE user_id = auth.uid())
  );

-- ─────────────────────────────────────────────────────────────
-- PAYOUTS TABLE POLICIES
-- ─────────────────────────────────────────────────────────────

-- Admins: full access
CREATE POLICY payouts_admin_all ON payouts
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Workers: read and insert their own payouts
CREATE POLICY payouts_worker_read ON payouts
  FOR SELECT TO authenticated
  USING (
    worker_id IN (SELECT id FROM workers WHERE user_id = auth.uid())
  );

CREATE POLICY payouts_worker_insert ON payouts
  FOR INSERT TO authenticated
  WITH CHECK (
    worker_id IN (SELECT id FROM workers WHERE user_id = auth.uid())
  );

-- ─────────────────────────────────────────────────────────────
-- AUDIT LOGS POLICIES
-- ─────────────────────────────────────────────────────────────

-- Only admins can read audit logs
CREATE POLICY audit_logs_admin_read ON audit_logs
  FOR SELECT TO authenticated
  USING (is_admin());

-- System (SECURITY DEFINER functions) inserts logs; direct inserts blocked for non-admin
CREATE POLICY audit_logs_admin_insert ON audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (is_admin());

-- ─────────────────────────────────────────────────────────────
-- COUPON USAGE LOG POLICIES
-- ─────────────────────────────────────────────────────────────

-- Admins: full access
CREATE POLICY coupon_usage_admin_all ON coupon_usage_log
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Workers: read usage for their coupons
CREATE POLICY coupon_usage_worker_read ON coupon_usage_log
  FOR SELECT TO authenticated
  USING (
    worker_id IN (SELECT id FROM workers WHERE user_id = auth.uid())
  );

-- Customers: read their own usage
CREATE POLICY coupon_usage_customer_read ON coupon_usage_log
  FOR SELECT TO authenticated
  USING (customer_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- EXISTING TABLES: users — update policies
-- ─────────────────────────────────────────────────────────────

-- Admins can read all users
CREATE POLICY users_admin_read ON users
  FOR SELECT TO authenticated
  USING (is_admin());

-- Users can read and update their own profile
CREATE POLICY users_self_read ON users
  FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY users_self_update ON users
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- Service role bypass (Supabase service_role key bypasses RLS)
-- The Express.js backend uses service_role key → no RLS issues
-- ─────────────────────────────────────────────────────────────
-- No additional policy needed — service_role bypasses all RLS by default.
-- Only anon and authenticated roles are bound by the policies above.
