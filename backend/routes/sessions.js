const express = require("express");
const { body, validationResult } = require("express-validator");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

function validationError(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return null;
  }

  return res.status(400).json({ error: errors.array()[0].msg });
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

function calculateScore(totalWordsSwapped, wordsClicked) {
  return ((totalWordsSwapped - wordsClicked) / totalWordsSwapped) * 100;
}

async function ensureProfileExists(db, user) {
  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    return { error: profileError };
  }

  if (profile) {
    return { ok: true };
  }

  const { error: insertError } = await db.from("profiles").insert({
    id: user.id,
  });

  if (insertError) {
    return { error: insertError };
  }

  return { ok: true };
}

async function insertSessionRow(db, userId, payload) {
  return db
    .from("sessions")
    .insert({
      user_id: userId,
      ...payload,
    })
    .select()
    .single();
}

function getWeekStartUtc(date) {
  const d = new Date(date);
  const day = (d.getUTCDay() + 6) % 7; // Monday=0 ... Sunday=6
  d.setUTCDate(d.getUTCDate() - day);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

router.use(authMiddleware);

router.post(
  "/",
  [
    body("content_snippet")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("content_snippet is required"),
    body("total_words_swapped")
      .isInt({ min: 1 })
      .withMessage("total_words_swapped must be an integer >= 1"),
    body("words_clicked")
      .isInt({ min: 0 })
      .withMessage("words_clicked must be an integer >= 0"),
    body("level_used")
      .isInt({ min: 1 })
      .withMessage("level_used must be an integer >= 1"),
    body("words_clicked").custom((value, { req }) => {
      if (value > req.body.total_words_swapped) {
        throw new Error("words_clicked cannot be greater than total_words_swapped");
      }
      return true;
    }),
  ],
  async (req, res) => {
    const invalid = validationError(req, res);
    if (invalid) {
      return invalid;
    }

    const db = req.supabase;
    const profileReady = await ensureProfileExists(db, req.user);
    if (profileReady.error) {
      return sendError(res, 400, profileReady.error.message);
    }

    const { content_snippet, total_words_swapped, words_clicked, level_used } =
      req.body;

    const score = calculateScore(total_words_swapped, words_clicked);

    const payload = {
      content_snippet,
      total_words_swapped,
      words_clicked,
      level_used,
      score,
    };

    let { data, error } = await insertSessionRow(db, req.user.id, payload);

    // Defensive fallback for older users missing profile row.
    // If FK still fails, create/upsert profile and retry once.
    if (error && error.code === "23503") {
      const { error: upsertProfileError } = await db
        .from("profiles")
        .upsert({ id: req.user.id }, { onConflict: "id" });

      if (upsertProfileError) {
        return sendError(res, 400, upsertProfileError.message);
      }

      const retry = await insertSessionRow(db, req.user.id, payload);
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      return sendError(res, 400, error.message);
    }

    return res.status(201).json(data);
  }
);

router.get("/", async (req, res) => {
  const db = req.supabase;

  const { data: sessions, error: sessionsError } = await db
    .from("sessions")
    .select("*")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (sessionsError) {
    return sendError(res, 400, sessionsError.message);
  }

  const { data: allScores, error: statsError } = await db
    .from("sessions")
    .select("score")
    .eq("user_id", req.user.id);

  if (statsError) {
    return sendError(res, 400, statsError.message);
  }

  const totalSessions = allScores.length;
  const bestScore = totalSessions
    ? Math.max(...allScores.map((row) => row.score))
    : 0;
  const averageScore = totalSessions
    ? allScores.reduce((sum, row) => sum + row.score, 0) / totalSessions
    : 0;

  return res.json({
    sessions,
    summary: {
      average_score: averageScore,
      best_score: bestScore,
      total_sessions: totalSessions,
    },
  });
});

router.get("/progress", async (req, res) => {
  const db = req.supabase;
  const now = new Date();
  const currentWeekStart = getWeekStartUtc(now);
  const firstWeekStart = new Date(currentWeekStart);
  firstWeekStart.setUTCDate(firstWeekStart.getUTCDate() - 7 * 7);

  const { data, error } = await db
    .from("sessions")
    .select("score, created_at")
    .eq("user_id", req.user.id)
    .gte("created_at", firstWeekStart.toISOString())
    .order("created_at", { ascending: true });

  if (error) {
    return sendError(res, 400, error.message);
  }

  const buckets = [];
  const bucketMap = new Map();

  for (let i = 0; i < 8; i += 1) {
    const weekStart = new Date(firstWeekStart);
    weekStart.setUTCDate(firstWeekStart.getUTCDate() + i * 7);
    const key = weekStart.toISOString();
    const bucket = {
      week_start: key,
      average_score: 0,
      session_count: 0,
      total_score: 0,
    };
    buckets.push(bucket);
    bucketMap.set(key, bucket);
  }

  for (const session of data) {
    const weekStart = getWeekStartUtc(session.created_at).toISOString();
    const bucket = bucketMap.get(weekStart);
    if (!bucket) {
      continue;
    }
    bucket.session_count += 1;
    bucket.total_score += session.score;
  }

  const progress = buckets.map((bucket) => ({
    week_start: bucket.week_start,
    average_score:
      bucket.session_count > 0
        ? bucket.total_score / bucket.session_count
        : 0,
    session_count: bucket.session_count,
  }));

  return res.json({ progress });
});

module.exports = router;
