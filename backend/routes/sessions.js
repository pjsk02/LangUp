const express = require("express");
const { body, validationResult } = require("express-validator");
const supabase = require("../services/supabase");

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

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const parts = authHeader.split(" ");

  if (parts.length !== 2 || !/^Bearer$/i.test(parts[0])) {
    return sendError(res, 401, "Authorization header with Bearer token is required");
  }

  const token = parts[1];
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return sendError(res, 401, "Invalid or expired token");
  }

  req.user_id = data.user.id;
  return next();
}

function getWeekStartUtc(date) {
  const d = new Date(date);
  const day = (d.getUTCDay() + 6) % 7; // Monday=0 ... Sunday=6
  d.setUTCDate(d.getUTCDate() - day);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

router.use(requireAuth);

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

    const { content_snippet, total_words_swapped, words_clicked, level_used } =
      req.body;

    const score = calculateScore(total_words_swapped, words_clicked);

    const { data, error } = await supabase
      .from("sessions")
      .insert({
        user_id: req.user_id,
        content_snippet,
        total_words_swapped,
        words_clicked,
        level_used,
        score,
      })
      .select()
      .single();

    if (error) {
      return sendError(res, 400, error.message);
    }

    return res.status(201).json(data);
  }
);

router.get("/", async (req, res) => {
  const { data: sessions, error: sessionsError } = await supabase
    .from("sessions")
    .select("*")
    .eq("user_id", req.user_id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (sessionsError) {
    return sendError(res, 400, sessionsError.message);
  }

  const { data: allScores, error: statsError } = await supabase
    .from("sessions")
    .select("score")
    .eq("user_id", req.user_id);

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
  const now = new Date();
  const currentWeekStart = getWeekStartUtc(now);
  const firstWeekStart = new Date(currentWeekStart);
  firstWeekStart.setUTCDate(firstWeekStart.getUTCDate() - 7 * 7);

  const { data, error } = await supabase
    .from("sessions")
    .select("score, created_at")
    .eq("user_id", req.user_id)
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
