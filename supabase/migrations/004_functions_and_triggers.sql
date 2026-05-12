-- ============================================================
-- BRIMSTONE — Worker Referral & Coupon Management System
-- Migration 004: Business Logic Functions & Triggers
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- FUNCTION 1: Generate unique coupon code
-- Called when creating a new worker
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION generate_unique_coupon(base_name TEXT DEFAULT NULL)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  coupon    TEXT;
  attempts  INT := 0;
  prefix    TEXT;
BEGIN
  -- Build prefix from worker name or use default
  IF base_name IS NOT NULL AND length(trim(base_name)) > 0 THEN
    prefix := upper(regexp_replace(trim(base_name), '[^A-Za-z0-9]', '', 'g'));
    prefix := left(prefix, 6);
  ELSE
    prefix := 'BRIM';
  END IF;

  LOOP
    coupon := prefix || upper(substring(md5(random()::TEXT || clock_timestamp()::TEXT), 1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM workers WHERE coupon_code = coupon);
    attempts := attempts + 1;
    IF attempts > 20 THEN
      RAISE EXCEPTION 'Could not generate a unique coupon after 20 attempts';
    END IF;
  END LOOP;

  RETURN coupon;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- FUNCTION 2: Validate coupon
-- Returns validation result as JSON
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION validate_coupon(
  p_coupon_code   TEXT,
  p_customer_id   UUID,
  p_order_amount  NUMERIC
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_worker        workers%ROWTYPE;
  v_already_used  BOOLEAN;
  v_discount      NUMERIC;
  v_final         NUMERIC;
BEGIN
  -- Fetch worker record
  SELECT * INTO v_worker FROM workers WHERE coupon_code = upper(trim(p_coupon_code));

  IF NOT FOUND THEN
    RETURN json_build_object('valid', false, 'reason', 'Coupon code does not exist');
  END IF;

  -- Status check
  IF v_worker.status != 'active' THEN
    RETURN json_build_object('valid', false, 'reason', 'Coupon is not active');
  END IF;

  -- Expiry check
  IF v_worker.coupon_expires_at IS NOT NULL AND v_worker.coupon_expires_at < NOW() THEN
    RETURN json_build_object('valid', false, 'reason', 'Coupon has expired');
  END IF;

  -- Usage limit check
  IF v_worker.coupon_max_uses IS NOT NULL AND v_worker.coupon_used_count >= v_worker.coupon_max_uses THEN
    RETURN json_build_object('valid', false, 'reason', 'Coupon usage limit has been reached');
  END IF;

  -- Minimum order amount check
  IF p_order_amount < v_worker.coupon_min_order THEN
    RETURN json_build_object(
      'valid', false,
      'reason', format('Minimum order amount of ₹%.2f required to use this coupon', v_worker.coupon_min_order)
    );
  END IF;

  -- Duplicate use check (one use per customer per coupon)
  SELECT EXISTS (
    SELECT 1 FROM coupon_usage_log
    WHERE customer_id = p_customer_id
      AND coupon_code = upper(trim(p_coupon_code))
  ) INTO v_already_used;

  IF v_already_used THEN
    RETURN json_build_object('valid', false, 'reason', 'You have already used this coupon');
  END IF;

  -- Calculate discount
  v_discount := round((p_order_amount * v_worker.discount_percentage / 100)::numeric, 2);
  v_final    := p_order_amount - v_discount;

  RETURN json_build_object(
    'valid',               true,
    'worker_id',           v_worker.id,
    'coupon_code',         v_worker.coupon_code,
    'discount_percentage', v_worker.discount_percentage,
    'discount_amount',     v_discount,
    'final_amount',        v_final,
    'original_amount',     p_order_amount
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- FUNCTION 3: Apply coupon — creates order, commission, usage log
-- Atomic transaction — all or nothing
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION apply_coupon_and_create_order(
  p_coupon_code   TEXT,
  p_customer_id   UUID,
  p_order_amount  NUMERIC,
  p_metadata      JSONB DEFAULT '{}'
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_validation    JSON;
  v_worker        workers%ROWTYPE;
  v_discount      NUMERIC;
  v_final         NUMERIC;
  v_commission    NUMERIC;
  v_order_id      UUID;
  v_commission_id UUID;
BEGIN
  -- Step 1: Validate coupon (re-check atomically)
  v_validation := validate_coupon(p_coupon_code, p_customer_id, p_order_amount);
  IF NOT (v_validation->>'valid')::BOOLEAN THEN
    RETURN v_validation;
  END IF;

  -- Fetch worker
  SELECT * INTO v_worker FROM workers WHERE coupon_code = upper(trim(p_coupon_code));

  v_discount   := (v_validation->>'discount_amount')::NUMERIC;
  v_final      := (v_validation->>'final_amount')::NUMERIC;
  v_commission := round((v_final * v_worker.commission_percentage / 100)::numeric, 2);

  -- Step 2: Insert coupon order
  INSERT INTO coupon_orders (
    worker_id, customer_id, order_amount,
    discount_amount, final_amount,
    coupon_code, order_status, metadata
  ) VALUES (
    v_worker.id, p_customer_id, p_order_amount,
    v_discount, v_final,
    upper(trim(p_coupon_code)), 'pending', p_metadata
  ) RETURNING id INTO v_order_id;

  -- Step 3: Insert commission record
  INSERT INTO commissions (
    worker_id, order_id, commission_amount, rate_snapshot, status
  ) VALUES (
    v_worker.id, v_order_id, v_commission, v_worker.commission_percentage, 'pending'
  ) RETURNING id INTO v_commission_id;

  -- Step 4: Log coupon usage (prevents re-use)
  INSERT INTO coupon_usage_log (worker_id, customer_id, order_id, coupon_code)
  VALUES (v_worker.id, p_customer_id, v_order_id, upper(trim(p_coupon_code)));

  -- Step 5: Update worker statistics atomically
  UPDATE workers SET
    coupon_used_count = coupon_used_count + 1,
    total_orders      = total_orders + 1,
    total_sales       = total_sales + v_final
  WHERE id = v_worker.id;

  RETURN json_build_object(
    'success',         true,
    'order_id',        v_order_id,
    'commission_id',   v_commission_id,
    'order_amount',    p_order_amount,
    'discount_amount', v_discount,
    'final_amount',    v_final,
    'commission',      v_commission,
    'coupon_code',     upper(trim(p_coupon_code))
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- FUNCTION 4: Confirm order → confirm commission & update earnings
-- Called when order status moves to 'confirmed' or 'delivered'
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION confirm_coupon_order(
  p_order_id      UUID,
  p_new_status    order_status_type,
  p_actor_id      UUID DEFAULT NULL
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_order      coupon_orders%ROWTYPE;
  v_commission commissions%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM coupon_orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'reason', 'Order not found');
  END IF;

  -- Update order status
  UPDATE coupon_orders SET order_status = p_new_status WHERE id = p_order_id;

  -- Get commission
  SELECT * INTO v_commission FROM commissions WHERE order_id = p_order_id LIMIT 1;

  IF p_new_status IN ('confirmed', 'delivered') THEN
    -- Confirm commission & credit worker balance
    UPDATE commissions
    SET status = 'confirmed', confirmed_at = NOW()
    WHERE order_id = p_order_id AND status = 'pending';

    -- Credit available_balance and total_earnings
    UPDATE workers SET
      total_earnings    = total_earnings + v_commission.commission_amount,
      available_balance = available_balance + v_commission.commission_amount
    WHERE id = v_commission.worker_id;

  ELSIF p_new_status IN ('cancelled', 'refunded') THEN
    -- Cancel commission & reverse worker stats
    UPDATE commissions
    SET status = 'cancelled'
    WHERE order_id = p_order_id AND status = 'pending';

    UPDATE workers SET
      total_orders  = GREATEST(total_orders - 1, 0),
      total_sales   = GREATEST(total_sales - v_order.final_amount, 0)
    WHERE id = v_order.worker_id;

    -- Remove usage log so customer can reuse coupon if order was cancelled
    DELETE FROM coupon_usage_log WHERE order_id = p_order_id;

    -- Decrement coupon used count
    UPDATE workers SET coupon_used_count = GREATEST(coupon_used_count - 1, 0)
    WHERE id = v_order.worker_id;
  END IF;

  -- Audit trail
  INSERT INTO audit_logs (actor_id, action, target_type, target_id, new_data)
  VALUES (p_actor_id, 'order_status_updated', 'coupon_orders', p_order_id,
          json_build_object('status', p_new_status)::JSONB);

  RETURN json_build_object('success', true, 'order_id', p_order_id, 'status', p_new_status);
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- FUNCTION 5: Request Payout
-- Worker requests withdrawal of available balance
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION request_payout(
  p_worker_id       UUID,
  p_amount          NUMERIC,
  p_payment_method  TEXT DEFAULT 'bank_transfer',
  p_payment_details JSONB DEFAULT '{}'
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_worker    workers%ROWTYPE;
  v_payout_id UUID;
BEGIN
  SELECT * INTO v_worker FROM workers WHERE id = p_worker_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'reason', 'Worker not found');
  END IF;

  IF v_worker.status != 'active' THEN
    RETURN json_build_object('success', false, 'reason', 'Worker account is not active');
  END IF;

  IF p_amount <= 0 THEN
    RETURN json_build_object('success', false, 'reason', 'Amount must be greater than 0');
  END IF;

  IF p_amount > v_worker.available_balance THEN
    RETURN json_build_object(
      'success', false,
      'reason', format('Insufficient balance. Available: ₹%.2f', v_worker.available_balance)
    );
  END IF;

  -- Check for an already pending payout request
  IF EXISTS (
    SELECT 1 FROM payouts
    WHERE worker_id = p_worker_id AND status = 'pending'
  ) THEN
    RETURN json_build_object('success', false, 'reason', 'You already have a pending payout request');
  END IF;

  -- Reserve the amount (deduct from available_balance immediately)
  UPDATE workers SET
    available_balance = available_balance - p_amount
  WHERE id = p_worker_id;

  INSERT INTO payouts (worker_id, amount, status, payment_method, payment_details)
  VALUES (p_worker_id, p_amount, 'pending', p_payment_method, p_payment_details)
  RETURNING id INTO v_payout_id;

  RETURN json_build_object(
    'success',    true,
    'payout_id',  v_payout_id,
    'amount',     p_amount,
    'status',     'pending'
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- FUNCTION 6: Approve / Reject Payout (admin only)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION process_payout(
  p_payout_id   UUID,
  p_action      TEXT,    -- 'approve' | 'reject'
  p_admin_id    UUID,
  p_admin_notes TEXT DEFAULT NULL
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_payout payouts%ROWTYPE;
BEGIN
  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN json_build_object('success', false, 'reason', 'Action must be approve or reject');
  END IF;

  SELECT * INTO v_payout FROM payouts WHERE id = p_payout_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'reason', 'Payout request not found');
  END IF;

  IF v_payout.status != 'pending' THEN
    RETURN json_build_object('success', false, 'reason', format('Payout is already %s', v_payout.status));
  END IF;

  IF p_action = 'approve' THEN
    UPDATE payouts SET
      status       = 'completed',
      reviewed_at  = NOW(),
      completed_at = NOW(),
      admin_notes  = p_admin_notes
    WHERE id = p_payout_id;

    -- Mark commissions as paid
    UPDATE commissions SET status = 'paid', paid_at = NOW()
    WHERE worker_id = v_payout.worker_id AND status = 'confirmed';

    -- Audit
    INSERT INTO audit_logs (actor_id, action, target_type, target_id, new_data)
    VALUES (p_admin_id, 'payout_approved', 'payouts', p_payout_id,
            json_build_object('amount', v_payout.amount)::JSONB);

    RETURN json_build_object('success', true, 'payout_id', p_payout_id, 'status', 'completed');

  ELSE  -- reject
    -- Refund the reserved amount back to available_balance
    UPDATE workers SET
      available_balance = available_balance + v_payout.amount
    WHERE id = v_payout.worker_id;

    UPDATE payouts SET
      status      = 'rejected',
      reviewed_at = NOW(),
      admin_notes = p_admin_notes
    WHERE id = p_payout_id;

    INSERT INTO audit_logs (actor_id, action, target_type, target_id, new_data)
    VALUES (p_admin_id, 'payout_rejected', 'payouts', p_payout_id,
            json_build_object('amount', v_payout.amount, 'reason', p_admin_notes)::JSONB);

    RETURN json_build_object('success', true, 'payout_id', p_payout_id, 'status', 'rejected');
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- FUNCTION 7: Get Worker Analytics (summary for one worker)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_worker_analytics(p_worker_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_worker  workers%ROWTYPE;
  v_result  JSON;
BEGIN
  SELECT * INTO v_worker FROM workers WHERE id = p_worker_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'reason', 'Worker not found');
  END IF;

  SELECT json_build_object(
    'worker_id',            v_worker.id,
    'coupon_code',          v_worker.coupon_code,
    'discount_percentage',  v_worker.discount_percentage,
    'commission_percentage',v_worker.commission_percentage,
    'total_sales',          v_worker.total_sales,
    'total_orders',         v_worker.total_orders,
    'total_earnings',       v_worker.total_earnings,
    'available_balance',    v_worker.available_balance,
    'coupon_used_count',    v_worker.coupon_used_count,
    'status',               v_worker.status,
    'pending_commissions', (
      SELECT COALESCE(SUM(commission_amount), 0)
      FROM commissions WHERE worker_id = p_worker_id AND status = 'pending'
    ),
    'confirmed_commissions', (
      SELECT COALESCE(SUM(commission_amount), 0)
      FROM commissions WHERE worker_id = p_worker_id AND status = 'confirmed'
    ),
    'paid_commissions', (
      SELECT COALESCE(SUM(commission_amount), 0)
      FROM commissions WHERE worker_id = p_worker_id AND status = 'paid'
    ),
    'pending_payouts', (
      SELECT COALESCE(SUM(amount), 0)
      FROM payouts WHERE worker_id = p_worker_id AND status = 'pending'
    ),
    'completed_payouts', (
      SELECT COALESCE(SUM(amount), 0)
      FROM payouts WHERE worker_id = p_worker_id AND status = 'completed'
    ),
    'recent_orders', (
      SELECT json_agg(row_to_json(o))
      FROM (
        SELECT id, order_amount, discount_amount, final_amount, order_status, created_at
        FROM coupon_orders
        WHERE worker_id = p_worker_id
        ORDER BY created_at DESC LIMIT 10
      ) o
    ),
    'monthly_sales', (
      SELECT json_agg(row_to_json(m))
      FROM (
        SELECT
          date_trunc('month', created_at) AS month,
          COUNT(*)                         AS orders,
          SUM(final_amount)                AS revenue
        FROM coupon_orders
        WHERE worker_id = p_worker_id AND order_status NOT IN ('cancelled','refunded')
        GROUP BY 1 ORDER BY 1 DESC LIMIT 12
      ) m
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- FUNCTION 8: Admin Dashboard Stats
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_admin_dashboard()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_result JSON;
BEGIN
  SELECT json_build_object(
    'total_workers',        (SELECT COUNT(*) FROM workers),
    'active_workers',       (SELECT COUNT(*) FROM workers WHERE status = 'active'),
    'total_coupon_orders',  (SELECT COUNT(*) FROM coupon_orders),
    'total_revenue',        (SELECT COALESCE(SUM(final_amount),0) FROM coupon_orders WHERE order_status NOT IN ('cancelled','refunded')),
    'total_discount_given', (SELECT COALESCE(SUM(discount_amount),0) FROM coupon_orders WHERE order_status NOT IN ('cancelled','refunded')),
    'total_commissions',    (SELECT COALESCE(SUM(commission_amount),0) FROM commissions WHERE status != 'cancelled'),
    'pending_payouts',      (SELECT COUNT(*) FROM payouts WHERE status = 'pending'),
    'pending_payout_amount',(SELECT COALESCE(SUM(amount),0) FROM payouts WHERE status = 'pending'),
    'completed_payout_amount',(SELECT COALESCE(SUM(amount),0) FROM payouts WHERE status = 'completed'),
    'top_workers', (
      SELECT json_agg(row_to_json(w))
      FROM (
        SELECT w.id, u.name, w.coupon_code, w.total_sales, w.total_orders,
               w.total_earnings, w.coupon_used_count, w.status
        FROM workers w JOIN users u ON u.id = w.user_id
        ORDER BY w.total_sales DESC LIMIT 10
      ) w
    ),
    'revenue_by_month', (
      SELECT json_agg(row_to_json(m))
      FROM (
        SELECT
          date_trunc('month', created_at) AS month,
          COUNT(*)                         AS orders,
          SUM(final_amount)                AS revenue,
          SUM(discount_amount)             AS discounts
        FROM coupon_orders
        WHERE order_status NOT IN ('cancelled','refunded')
        GROUP BY 1 ORDER BY 1 DESC LIMIT 12
      ) m
    ),
    'orders_by_status', (
      SELECT json_object_agg(order_status, cnt)
      FROM (SELECT order_status, COUNT(*) AS cnt FROM coupon_orders GROUP BY 1) s
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;
