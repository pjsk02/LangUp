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

function calculateMasteryScore(timesClicked, timesSeen) {
  if (!timesSeen || timesSeen <= 0) {
    return 0;
  }

  return 1 - timesClicked / timesSeen;
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
  req.token = token;
  return next();
}

router.use(requireAuth);

router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("vocabulary")
    .select("*")
    .eq("user_id", req.user_id)
    .order("mastery_score", { ascending: true });

  if (error) {
    return sendError(res, 400, error.message);
  }

  return res.json(data);
});

async function findExistingWord(userId, wordNative, wordEnglish, language) {
  const { data, error } = await supabase
    .from("vocabulary")
    .select("*")
    .eq("user_id", userId)
    .eq("word_native", wordNative)
    .eq("word_english", wordEnglish)
    .eq("language", language)
    .limit(1);

  if (error) {
    return { error };
  }

  return { row: data[0] || null };
}

router.post(
  "/record-click",
  [
    body("word_native")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("word_native is required"),
    body("word_english")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("word_english is required"),
    body("language")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("language is required"),
  ],
  async (req, res) => {
    const invalid = validationError(req, res);
    if (invalid) {
      return invalid;
    }

    const { word_native, word_english, language } = req.body;
    const now = new Date().toISOString();

    const existingResult = await findExistingWord(
      req.user_id,
      word_native,
      word_english,
      language
    );

    if (existingResult.error) {
      return sendError(res, 400, existingResult.error.message);
    }

    if (!existingResult.row) {
      const { data, error } = await supabase
        .from("vocabulary")
        .insert({
          user_id: req.user_id,
          word_native,
          word_english,
          language,
          times_seen: 1,
          times_clicked: 1,
          mastery_score: 0,
          last_seen: now,
        })
        .select()
        .single();

      if (error) {
        return sendError(res, 400, error.message);
      }

      return res.status(201).json(data);
    }

    const nextTimesSeen = existingResult.row.times_seen + 1;
    const nextTimesClicked = existingResult.row.times_clicked + 1;
    const nextMastery = calculateMasteryScore(nextTimesClicked, nextTimesSeen);

    const { data, error } = await supabase
      .from("vocabulary")
      .update({
        times_seen: nextTimesSeen,
        times_clicked: nextTimesClicked,
        mastery_score: nextMastery,
        last_seen: now,
      })
      .eq("id", existingResult.row.id)
      .select()
      .single();

    if (error) {
      return sendError(res, 400, error.message);
    }

    return res.json(data);
  }
);

router.post(
  "/record-seen",
  [
    body("word_native")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("word_native is required"),
    body("word_english")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("word_english is required"),
    body("language")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("language is required"),
  ],
  async (req, res) => {
    const invalid = validationError(req, res);
    if (invalid) {
      return invalid;
    }

    const { word_native, word_english, language } = req.body;
    const now = new Date().toISOString();

    const existingResult = await findExistingWord(
      req.user_id,
      word_native,
      word_english,
      language
    );

    if (existingResult.error) {
      return sendError(res, 400, existingResult.error.message);
    }

    if (!existingResult.row) {
      const { data, error } = await supabase
        .from("vocabulary")
        .insert({
          user_id: req.user_id,
          word_native,
          word_english,
          language,
          times_seen: 1,
          times_clicked: 0,
          mastery_score: 1,
          last_seen: now,
        })
        .select()
        .single();

      if (error) {
        return sendError(res, 400, error.message);
      }

      return res.status(201).json(data);
    }

    const nextTimesSeen = existingResult.row.times_seen + 1;
    const nextMastery = calculateMasteryScore(
      existingResult.row.times_clicked,
      nextTimesSeen
    );

    const { data, error } = await supabase
      .from("vocabulary")
      .update({
        times_seen: nextTimesSeen,
        mastery_score: nextMastery,
        last_seen: now,
      })
      .eq("id", existingResult.row.id)
      .select()
      .single();

    if (error) {
      return sendError(res, 400, error.message);
    }

    return res.json(data);
  }
);

module.exports = router;
