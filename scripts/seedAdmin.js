/**
 * scripts/seedAdmin.js
 *
 * Creates a default admin user in Supabase.
 * Run with: npm run seed:admin
 *
 * Credentials:
 *   email:    admin@brimstone.com
 *   password: admin123
 *   role:     admin
 */

const bcrypt = require("bcryptjs");
require("dotenv").config();

const supabase = require("../src/config/supabase");

const seed = async () => {
  try {
    // Check if admin already exists
    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("email", "admin@brimstone.com")
      .single();

    if (existing) {
      console.log("✅ Admin user already exists. Skipping seeder.");
      process.exit(0);
    }

    const hashedPassword = await bcrypt.hash("admin123", 10);

    const { error } = await supabase.from("users").insert([
      {
        name: "Brimstone Admin",
        email: "admin@brimstone.com",
        password: hashedPassword,
        mobileno: "9000000000",
        role: "admin",
      },
    ]);

    if (error) {
      console.error("Failed to create admin:", error.message);
      process.exit(1);
    }

    console.log("✅ Admin user created successfully!");
    console.log("   Email:    admin@brimstone.com");
    console.log("   Password: admin123");
    process.exit(0);
  } catch (err) {
    console.error("Seeder error:", err);
    process.exit(1);
  }
};

seed();
