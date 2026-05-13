const { supabaseAdmin: supabase } = require("../config/supabase");

/**
 * Validate a UUID (Supabase uses UUIDs as primary keys)
 */
const isValidUUID = (id) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

// ─── POST /api/orders ───────────────────────────────────────────────────────

const createOrder = async (req, res) => {
  try {
    const { items, customer, shippingAddress, pricing } = req.body;

    // 1. Validate items array
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Order must contain at least one item.",
      });
    }

    // 2. Get userId from JWT
    const userId = req.user.id;

    // 3. Insert order into Supabase
    const { data: order, error } = await supabase
      .from("orders")
      .insert([
        {
          user_id: userId,
          status: "pending",
          items,           // stored as JSONB
          customer,        // stored as JSONB
          shipping_address: shippingAddress, // stored as JSONB
          pricing,         // stored as JSONB
        },
      ])
      .select("id, status, created_at")
      .single();

    if (error) {
      console.error("Supabase order insert error:", error);
      return res.status(500).json({ success: false, message: "Failed to place order." });
    }

    // 3.5 If a coupon was used, apply it to the worker system
    const code = pricing?.couponCode || pricing?.coupon_code;
    const subtotal = pricing?.subtotal || pricing?.sub_total;
    let referralStatus = null;
    
    if (code) {
      console.log(`[Referral] Applying coupon "${code}" for order ${order.id}. Subtotal: ${subtotal || pricing.total}`);
      
      const { data: couponData, error: couponError } = await supabase.rpc("apply_coupon_and_create_order", {
        p_coupon_code: String(code),
        p_customer_id: userId,
        p_order_amount: parseFloat(subtotal || pricing.total || 0),
        p_metadata: { 
          shop_order_id: order.id,
          items_count: items.length,
          total_with_tax: pricing.total,
          applied_at: new Date().toISOString()
        }
      });
      
      if (couponError) {
        console.error("[Referral] Supabase RPC error:", couponError);
        referralStatus = { success: false, error: couponError.message };
      } else if (couponData && !couponData.success) {
        console.error("[Referral] Logic failed:", couponData.reason || "Unknown reason");
        referralStatus = { success: false, reason: couponData.reason };
      } else {
        console.log("[Referral] Success! Link ID:", couponData?.order_id);
        referralStatus = { success: true, orderId: couponData?.order_id };
      }
    }

    // 4. Return created order
    return res.status(201).json({
      success: true,
      message: "Order placed successfully!",
      referralStatus,
      order: {
        id: order.id,
        status: order.status,
        createdAt: order.created_at,
      },
    });
  } catch (err) {
    console.error("Create order error:", err);
    return res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
};

// ─── GET /api/orders/user/my-orders ────────────────────────────────────────

const getMyOrders = async (req, res) => {
  try {
    const { data: orders, error } = await supabase
      .from("orders")
      .select("id, status, created_at, pricing, items")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase my-orders error:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch orders." });
    }

    // Map snake_case to camelCase for frontend consistency
    const mapped = orders.map((o) => ({
      _id: o.id,
      status: o.status,
      createdAt: o.created_at,
      pricing: o.pricing,
      items: o.items,
    }));

    return res.status(200).json({ success: true, orders: mapped });
  } catch (err) {
    console.error("Get my orders error:", err);
    return res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
};

// ─── GET /api/orders/admin/all-orders ──────────────────────────────────────

const getAllOrders = async (req, res) => {
  try {
    const { data: orders, error } = await supabase
      .from("orders")
      .select("id, status, created_at, customer, shipping_address, items, pricing, user_id")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase all-orders error:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch orders." });
    }

    const mapped = orders.map((o) => ({
      _id: o.id,
      status: o.status,
      createdAt: o.created_at,
      customer: o.customer,
      shippingAddress: o.shipping_address,
      items: o.items,
      pricing: o.pricing,
      userId: o.user_id,
    }));

    return res.status(200).json({ success: true, orders: mapped });
  } catch (err) {
    console.error("Get all orders error:", err);
    return res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
};

// ─── PUT /api/orders/:orderId/status ───────────────────────────────────────

const updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    // Validate UUID format (Supabase PKs are UUIDs, not MongoDB ObjectIds)
    if (!isValidUUID(orderId)) {
      return res.status(400).json({ success: false, message: "Invalid order ID." });
    }

    const validStatuses = ["pending", "confirmed", "shipped", "delivered"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}.`,
      });
    }

    // Check order exists
    const { data: existing, error: findError } = await supabase
      .from("orders")
      .select("id")
      .eq("id", orderId)
      .single();

    if (findError || !existing) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    // Update status
    const { error: updateError } = await supabase
      .from("orders")
      .update({ status })
      .eq("id", orderId);

    if (updateError) {
      console.error("Supabase update status error:", updateError);
      return res.status(500).json({ success: false, message: "Failed to update order status." });
    }

    // Sync status with worker commission system
    await syncCouponOrderStatus(orderId, status);

    return res.status(200).json({
      success: true,
      message: `Order status updated to ${status}`,
    });
  } catch (err) {
    console.error("Update order status error:", err);
    return res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
};

// Helper function to sync order status to coupon_orders if needed
const syncCouponOrderStatus = async (shopOrderId, newStatus) => {
  try {
    // Find the coupon_order that has this shop_order_id in its metadata
    const { data } = await supabase
      .from("coupon_orders")
      .select("id")
      .contains("metadata", { shop_order_id: shopOrderId })
      .single();

    if (data) {
      await supabase.rpc("confirm_coupon_order", {
        p_order_id: data.id,
        p_new_status: newStatus
      });
    }
  } catch (err) {
    console.error("Failed to sync coupon order status:", err);
  }
};

module.exports = { createOrder, getMyOrders, getAllOrders, updateOrderStatus };
