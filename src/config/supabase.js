const { createClient } = require("@supabase/supabase-js");

// Service-role client — bypasses all RLS (backend only, never expose to frontend)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,   // service_role key
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Anon client — used for testing public endpoints
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = { supabaseAdmin, supabase };
