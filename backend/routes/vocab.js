const express = require("express");
const { body, query, validationResult } = require("express-validator");
const { createClient } = require("@supabase/supabase-js");

const router = express.Router();

const INITIAL_MASTERY = 0.3;

function nextMasteryOnSeen(current) {
  return Math.min(1.0, current + 0.05);
}

function nextMasteryOnClick(current) {
  return Math.max(0.0, current - 0.15);
}

function validationError(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  return res.status(400).json({ error: errors.array()[0].msg });
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

// Build a user-scoped Supabase client so RLS auth.uid() resolves correctly
function userClient(token) {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

// Auth middleware — same raw-fetch approach as the main auth middleware
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const parts = authHeader.split(" ");

  if (parts.length !== 2 || !/^Bearer$/i.test(parts[0])) {
    return sendError(res, 401, "Authorization header with Bearer token is required");
  }

  const token = parts[1];

  const resp = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: process.env.SUPABASE_ANON_KEY,
    },
  });

  if (!resp.ok) {
    return sendError(res, 401, "Invalid or expired token");
  }

  const user = await resp.json();
  req.user_id = user.id;
  req.token = token;
  return next();
}

router.use(requireAuth);

// GET /vocab
router.get("/", async (req, res) => {
  const db = userClient(req.token);
  const { data, error } = await db
    .from("vocabulary")
    .select("*")
    .eq("user_id", req.user_id)
    .order("mastery_score", { ascending: true });

  if (error) return sendError(res, 400, error.message);
  return res.json(data);
});

// GET /vocab/weak
router.get(
  "/weak",
  [query("limit").optional().isInt({ min: 1, max: 50 })],
  async (req, res) => {
    const invalid = validationError(req, res);
    if (invalid) return invalid;

    const limit = parseInt(req.query.limit) || 8;
    const db = userClient(req.token);

    const { data, error } = await db
      .from("vocabulary")
      .select("*")
      .eq("user_id", req.user_id)
      .lt("mastery_score", 0.3)
      .order("mastery_score", { ascending: true })
      .limit(limit);

    if (error) return sendError(res, 400, error.message);
    return res.json({ words: data });
  }
);

async function findExistingWord(db, userId, wordNative, wordEnglish, language) {
  const { data, error } = await db
    .from("vocabulary")
    .select("*")
    .eq("user_id", userId)
    .eq("word_native", wordNative)
    .eq("word_english", wordEnglish)
    .eq("language", language)
    .limit(1);

  if (error) return { error };
  return { row: data[0] || null };
}

// POST /vocab/record-click
router.post(
  "/record-click",
  [
    body("word_native").isString().trim().notEmpty().withMessage("word_native is required"),
    body("word_english").isString().trim().notEmpty().withMessage("word_english is required"),
    body("language").isString().trim().notEmpty().withMessage("language is required"),
  ],
  async (req, res) => {
    const invalid = validationError(req, res);
    if (invalid) return invalid;

    const { word_native, word_english, language } = req.body;
    const now = new Date().toISOString();
    const db = userClient(req.token);

    const existingResult = await findExistingWord(db, req.user_id, word_native, word_english, language);
    if (existingResult.error) return sendError(res, 400, existingResult.error.message);

    if (!existingResult.row) {
      const { data, error } = await db
        .from("vocabulary")
        .insert({
          user_id: req.user_id,
          word_native,
          word_english,
          language,
          times_seen: 1,
          times_clicked: 1,
          mastery_score: nextMasteryOnClick(INITIAL_MASTERY),
          last_seen: now,
          first_seen: now,
          last_clicked: now,
        })
        .select()
        .single();

      if (error) return sendError(res, 400, error.message);
      return res.status(201).json(data);
    }

    const { data, error } = await db
      .from("vocabulary")
      .update({
        times_seen: existingResult.row.times_seen + 1,
        times_clicked: existingResult.row.times_clicked + 1,
        mastery_score: nextMasteryOnClick(existingResult.row.mastery_score),
        last_seen: now,
        last_clicked: now,
      })
      .eq("id", existingResult.row.id)
      .select()
      .single();

    if (error) return sendError(res, 400, error.message);
    return res.json(data);
  }
);

// POST /vocab/record-seen-batch
router.post(
  "/record-seen-batch",
  [
    body("words").isArray({ min: 1 }).withMessage("words must be a non-empty array"),
    body("words.*.word_native").isString().trim().notEmpty(),
    body("words.*.word_english").isString().trim().notEmpty(),
    body("words.*.language").isString().trim().notEmpty(),
  ],
  async (req, res) => {
    const invalid = validationError(req, res);
    if (invalid) return invalid;

    const { words } = req.body;
    if (words.length > 50) return sendError(res, 400, "words array cannot exceed 50 items");

    const now = new Date().toISOString();
    const db = userClient(req.token);
    const results = [];

    for (const { word_native, word_english, language } of words) {
      const existingResult = await findExistingWord(db, req.user_id, word_native, word_english, language);
      if (existingResult.error) return sendError(res, 400, existingResult.error.message);

      if (!existingResult.row) {
        const { data, error } = await db
          .from("vocabulary")
          .insert({
            user_id: req.user_id,
            word_native,
            word_english,
            language,
            times_seen: 1,
            times_clicked: 0,
            mastery_score: nextMasteryOnSeen(INITIAL_MASTERY),
            last_seen: now,
            first_seen: now,
          })
          .select()
          .single();

        if (error) return sendError(res, 400, error.message);
        results.push(data);
      } else {
        const { data, error } = await db
          .from("vocabulary")
          .update({
            times_seen: existingResult.row.times_seen + 1,
            mastery_score: nextMasteryOnSeen(existingResult.row.mastery_score),
            last_seen: now,
          })
          .eq("id", existingResult.row.id)
          .select()
          .single();

        if (error) return sendError(res, 400, error.message);
        results.push(data);
      }
    }

    return res.json(results);
  }
);

module.exports = router;
