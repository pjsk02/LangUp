const supabase = require("../services/supabase");

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const parts = authHeader.split(" ");

  if (parts.length !== 2 || !/^Bearer$/i.test(parts[0])) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = parts[1];
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  req.user = {
    id: data.user.id,
    email: data.user.email,
  };

  return next();
}

module.exports = authMiddleware;
