const express = require("express");
const { body, validationResult } = require("express-validator");
const OpenAI = require("openai");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const LEVEL_RULES = {
  1: { percentage: "5-10%", description: "common nouns and simple adjectives only" },
  2: { percentage: "10-15%", description: "nouns and adjectives" },
  3: { percentage: "15-25%", description: "nouns, adjectives, and simple verbs" },
  4: { percentage: "25-40%", description: "most word types including phrases" },
  5: { percentage: "30-50%", description: "full phrases, complex grammar, cultural expressions" },
};

function buildSystemPrompt(profile, sourceText, weakWords) {
  const { native_lang, target_lang, level } = profile;
  const rule = LEVEL_RULES[level] || LEVEL_RULES[3];

  let prompt = `You are LinguaChat, a warm and curious language tutor helping the user learn ${target_lang}.

DISCUSSION RULES:
- Your job is to have a natural conversation about the content the user is reading
- Talk about themes, meaning, cultural context, and interesting points in the text
- Ask the user questions to keep them engaged
- Share observations and insights like a knowledgeable friend would
- You are NOT a translator — you are a conversational partner

CODE-SWITCHING RULES:
- Write primarily in ${native_lang}
- Replace ${rule.percentage} of words with ${target_lang} equivalents
- Only replace ${rule.description}

CRITICAL FORMAT RULE — no exceptions:
Every ${target_lang} word you include MUST be wrapped in double curly braces: {{word|translation}}
The format is: opening double brace, the ${target_lang} word, a pipe character |, the English translation, closing double brace.

✅ CORRECT: "This {{texto|text}} raises {{interesantes|interesting}} points about {{política|politics}}."
❌ WRONG bare word: "This texto raises interesantes points."
❌ WRONG parentheses: "This texto (text) raises interesting points."
❌ WRONG any other format: never use brackets, slashes, or any other notation.

If you include a ${target_lang} word without {{}} wrapping, you are breaking the app. Every single ${target_lang} word must use {{word|translation}}.

- Vary which words you replace — don't always pick the same word types
- The replaced words should feel natural in context, not forced

FORMATTING:
- Never use markdown in your responses
- Write in flowing prose, like a chat message
- Keep responses conversational and concise (2-4 sentences)`;

  if (sourceText && sourceText.trim()) {
    prompt += `

SOURCE TEXT (the content you are discussing with the user):
"""
${sourceText.trim()}
"""
Stay focused on this text. Draw your observations and questions from it.`;
  }

  if (weakWords && weakWords.length > 0) {
    const wordList = weakWords
      .map((w) => `${w.word_native} (${w.word_english})`)
      .join(", ");
    prompt += `

REINFORCEMENT (these words have low familiarity — weave at least 1-2 of them into your response naturally):
${wordList}`;
  }

  return prompt;
}

function validationError(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  return res.status(400).json({ error: errors.array()[0].msg });
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

// POST /chat
// Body:
//   messages     — conversation history: [{ role: "user"|"assistant", content: string }]
//   profile      — { native_lang, target_lang, level (1–5) }
//   source_text  — (optional) the article/text being discussed
//   weak_words   — (optional) [{ word_native, word_english }] from GET /vocab/weak
router.post(
  "/",
  authMiddleware,
  [
    body("messages")
      .isArray({ min: 1 })
      .withMessage("messages must be a non-empty array"),
    body("messages.*.role")
      .isIn(["user", "assistant"])
      .withMessage("each message role must be 'user' or 'assistant'"),
    body("messages.*.content")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("each message must have non-empty content"),
    body("profile.native_lang")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("profile.native_lang is required"),
    body("profile.target_lang")
      .isString()
      .trim()
      .notEmpty()
      .withMessage("profile.target_lang is required"),
    body("profile.level")
      .isInt({ min: 1, max: 5 })
      .withMessage("profile.level must be an integer between 1 and 5"),
    body("source_text")
      .optional({ nullable: true })
      .isString()
      .withMessage("source_text must be a string"),
    body("weak_words")
      .optional()
      .isArray()
      .withMessage("weak_words must be an array"),
  ],
  async (req, res) => {
    const invalid = validationError(req, res);
    if (invalid) return invalid;

    if (!process.env.OPENAI_API_KEY) {
      return sendError(res, 500, "OPENAI_API_KEY is not configured");
    }

    const { messages, profile, source_text, weak_words } = req.body;

    const systemPrompt = buildSystemPrompt(profile, source_text, weak_words);

    // Keep last 20 messages to stay within context limits
    const trimmedMessages = messages.slice(-20);

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.8,
        messages: [
          { role: "system", content: systemPrompt },
          ...trimmedMessages,
        ],
      });

      const reply = completion.choices?.[0]?.message?.content?.trim();
      if (!reply) {
        return sendError(res, 500, "Empty response from model");
      }

      return res.json({
        role: "assistant",
        content: reply,
        usage: completion.usage,
      });
    } catch (error) {
      return sendError(res, 500, error.message || "Chat request failed");
    }
  }
);

module.exports = router;
