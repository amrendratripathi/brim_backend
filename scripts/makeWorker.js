require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const readline = require("readline");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

(async () => {
  console.log("\n🌿 Brimstone — Make User a Worker\n");

  const email = await ask("Enter the user's email address: ");
  
  if (!email) {
    console.error("❌ Email is required.");
    process.exit(1);
  }

  // 1. Find user by email
  const { data: user, error: userErr } = await supabase
    .from("users")
    .select("id, name, app_role")
    .eq("email", email)
    .single();

  if (userErr || !user) {
    console.error(`❌ User with email ${email} not found.`);
    process.exit(1);
  }

  if (user.app_role === "worker" || user.app_role === "admin") {
    console.log(`⚠️ User is already a ${user.app_role}.`);
    process.exit(0);
  }

  // 2. Ask for commission/discount settings
  const discount = await ask("Discount Percentage for customers (default 10): ") || "10";
  const commission = await ask("Commission Percentage for worker (default 5): ") || "5";
  const customCoupon = await ask("Custom Coupon Code (leave blank to auto-generate): ");
  rl.close();

  let couponCode = customCoupon.toUpperCase().trim();
  
  if (!couponCode) {
    // Generate code: First up to 6 letters of name + 4 random characters
    const prefix = user.name.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().substring(0, 6) || "BRIM";
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    couponCode = `${prefix}${random}`;
  }

  // 3. Create worker profile
  const { data: worker, error: workerErr } = await supabase
    .from("workers")
    .insert([{
      user_id: user.id,
      coupon_code: couponCode,
      discount_percentage: parseFloat(discount),
      commission_percentage: parseFloat(commission),
      status: "active"
    }])
    .select()
    .single();

  if (workerErr) {
    console.error("❌ Failed to create worker profile:", workerErr.message);
    process.exit(1);
  }

  // 4. Update user role
  await supabase
    .from("users")
    .update({ app_role: "worker" })
    .eq("id", user.id);

  console.log("\n✅ Successfully upgraded user to Worker!");
  console.log("────────────────────────────────────────");
  console.log(`Name:        ${user.name}`);
  console.log(`Email:       ${email}`);
  console.log(`Coupon Code: ${couponCode}`);
  console.log(`Discount:    ${discount}%`);
  console.log(`Commission:  ${commission}%`);
  console.log("────────────────────────────────────────\n");
})();
