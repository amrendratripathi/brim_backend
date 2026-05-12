/**
 * scripts/seedAdmin.js
 * Creates the first admin user in the system.
 * Run: node scripts/seedAdmin.js
 */
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const bcrypt           = require("bcryptjs");
const readline         = require("readline");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

(async () => {
  console.log("\n🌿 Brimstone — Admin Seeder\n");

  const name     = await ask("Admin name:     ");
  const email    = await ask("Admin email:    ");
  const password = await ask("Admin password: ");
  const mobile   = await ask("Mobile number:  ");
  rl.close();

  if (!name || !email || !password || !mobile) {
    console.error("❌ All fields are required.");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("❌ Password must be at least 8 characters.");
    process.exit(1);
  }

  const hashed = await bcrypt.hash(password, 12);

  const { data, error } = await supabase
    .from("users")
    .insert([{
      name,
      email,
      password:  hashed,
      mobileno:  mobile,
      app_role: "admin",
    }])
    .select("id, name, email, app_role")
    .single();

  if (error) {
    if (error.code === "23505") {
      console.error("❌ An account with this email already exists.");
    } else {
      console.error("❌ Error:", error.message);
    }
    process.exit(1);
  }

  console.log("\n✅ Admin created successfully!");
  console.log(`   ID:    ${data.id}`);
  console.log(`   Name:  ${data.name}`);
  console.log(`   Email: ${data.email}`);
  console.log(`   Role:  ${data.app_role}\n`);
})();
