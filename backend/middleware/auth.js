const { createClient } = require("@supabase/supabase-js");

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const parts = authHeader.split(" ");

  if (parts.length !== 2 || !/^Bearer$/i.test(parts[0])) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = parts[1];

  // Verify the Supabase JWT via raw HTTP — works with all key formats
  const resp = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: process.env.SUPABASE_ANON_KEY,
    },
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    console.error("[auth] Supabase verify failed:", resp.status, body);
    return res.status(401).json({ error: "Unauthorized" });
  }

  const user = await resp.json();
  req.token = token;
  req.user = { id: user.id, email: user.email };
  req.supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  return next();
}

module.exports = authMiddleware;
