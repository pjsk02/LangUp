const express = require("express");
const { body, validationResult } = require("express-validator");
const { createClient } = require("@supabase/supabase-js");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

function userClient(token) {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

// PATCH /profile — update target_language and/or proficiency_level
router.patch(
  "/",
  authMiddleware,
  [
    body("level")
      .optional()
      .isInt({ min: 1, max: 5 })
      .withMessage("level must be between 1 and 5"),
    body("target_language")
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .withMessage("target_language must be a non-empty string"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { level, target_language } = req.body;
    if (level === undefined && target_language === undefined) {
      return res.status(400).json({ error: "Provide at least one of: level, target_language" });
    }

    const updates = {};
    if (level !== undefined) updates.proficiency_level = level;
    if (target_language !== undefined) updates.target_language = target_language;

    const token = req.headers.authorization.split(" ")[1];
    const db = userClient(token);

    const { data, error } = await db
      .from("profiles")
      .update(updates)
      .eq("id", req.user.id)
      .select("proficiency_level, target_language")
      .single();

    if (error) return res.status(400).json({ error: error.message });

    return res.json({
      level: data.proficiency_level,
      target_language: data.target_language,
    });
  }
);

module.exports = router;
