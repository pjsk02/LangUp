const express = require("express");
const { body, validationResult } = require("express-validator");
const OpenAI = require("openai");
const authMiddleware = require("../middleware/middleware/auth");

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const TRANSLATION_SYSTEM_PROMPT =
  "You are a language translation assistant. Given an English word and a target language, return ONLY a JSON object with no markdown, no backticks, no explanation: { swapped: string, romaji: string, translation: string } Where swapped = the word in target language script, romaji = pronunciation in latin characters, translation = English meaning back.";

const SWAP_RULES = {
  1: { percentage: 0.1 },
  2: { percentage: 0.2 },
  3: { percentage: 0.35 },
  4: { percentage: 0.55 },
  5: { percentage: 0.8 },
};

const ARTICLES_PREPOSITIONS = new Set([
  "a",
  "an",
  "the",
  "in",
  "on",
  "at",
  "to",
  "for",
  "from",
  "with",
  "by",
  "about",
  "into",
  "over",
  "after",
  "under",
  "between",
  "through",
  "during",
  "before",
  "without",
  "around",
  "among",
  "of",
]);

const COMMON_VERBS = new Set([
  "be",
  "is",
  "are",
  "was",
  "were",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "go",
  "goes",
  "went",
  "make",
  "makes",
  "made",
  "learn",
  "study",
  "read",
  "write",
  "speak",
  "listen",
  "practice",
  "know",
  "think",
  "want",
  "need",
  "like",
]);

function validationError(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return null;
  }
  return res.status(400).json({ error: errors.array()[0].msg });
}

function classifyWord(word) {
  const w = word.toLowerCase();

  if (ARTICLES_PREPOSITIONS.has(w)) {
    return "article_or_preposition";
  }

  if (
    COMMON_VERBS.has(w) ||
    w.endsWith("ing") ||
    w.endsWith("ed") ||
    w.endsWith("en")
  ) {
    return "verb";
  }

  if (
    w.endsWith("ous") ||
    w.endsWith("ful") ||
    w.endsWith("ive") ||
    w.endsWith("al") ||
    w.endsWith("able") ||
    w.endsWith("ible") ||
    w.endsWith("ish") ||
    w.endsWith("ic") ||
    w.endsWith("less")
  ) {
    return "adjective";
  }

  return "noun";
}

function isEligibleByLevel(word, level) {
  const wordType = classifyWord(word);

  if (level === 1) {
    return wordType === "noun";
  }

  if (level === 2) {
    return wordType === "noun" || wordType === "adjective";
  }

  if (level === 3) {
    return (
      wordType === "noun" || wordType === "adjective" || wordType === "verb"
    );
  }

  if (level === 4) {
    return wordType !== "article_or_preposition";
  }

  if (level === 5) {
    return wordType !== "article_or_preposition";
  }

  return false;
}

function tokenizeWords(text) {
  return text.match(/[A-Za-z]+(?:'[A-Za-z]+)*/g) || [];
}

function pickSwapIndices(words, level) {
  const rule = SWAP_RULES[level];
  const eligible = [];

  words.forEach((word, index) => {
    if (isEligibleByLevel(word, level)) {
      eligible.push(index);
    }
  });

  if (!eligible.length) {
    return [];
  }

  const desired = Math.max(1, Math.round(words.length * rule.percentage));
  const swapCount = Math.min(desired, eligible.length);

  for (let i = eligible.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }

  return eligible.slice(0, swapCount);
}

function parseTranslationJson(content) {
  try {
    return JSON.parse(content);
  } catch (_err) {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("Invalid translation response format");
    }
    return JSON.parse(content.slice(start, end + 1));
  }
}

async function translateWord(originalWord, targetLanguage) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      { role: "system", content: TRANSLATION_SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          word: originalWord,
          target_language: targetLanguage,
        }),
      },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content?.trim();
  if (!raw) {
    throw new Error("Empty translation response");
  }

  const parsed = parseTranslationJson(raw);
  return {
    swapped:
      typeof parsed.swapped === "string" && parsed.swapped.trim()
        ? parsed.swapped
        : originalWord,
    romaji: typeof parsed.romaji === "string" ? parsed.romaji : "",
    translation:
      typeof parsed.translation === "string" ? parsed.translation : "",
  };
}

router.post(
  "/blend",
  authMiddleware,
  [
    body("text").isString().trim().notEmpty().withMessage("text is required"),
    body("level")
      .isInt({ min: 1, max: 5 })
      .withMessage("level must be an integer from 1 to 5"),
    body("target_language")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("target_language is required"),
  ],
  async (req, res) => {
    const invalid = validationError(req, res);
    if (invalid) {
      return invalid;
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY is not configured" });
    }

    const { text, level, target_language } = req.body;
    const words = tokenizeWords(text);
    const swapIndexSet = new Set(pickSwapIndices(words, Number(level)));

    try {
      const wordResults = await Promise.all(
        words.map(async (word, index) => {
          if (!swapIndexSet.has(index)) {
            return {
              original: word,
              swapped: word,
              romaji: "",
              translation: "",
              is_swapped: false,
            };
          }

          const translated = await translateWord(word, target_language);
          return {
            original: word,
            swapped: translated.swapped,
            romaji: translated.romaji,
            translation: translated.translation,
            is_swapped: true,
          };
        })
      );

      const totalWordsSwapped = wordResults.filter(
        (word) => word.is_swapped
      ).length;

      return res.json({
        words: wordResults,
        detected_language: target_language,
        total_words_swapped: totalWordsSwapped,
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Blend failed" });
    }
  }
);

module.exports = router;
