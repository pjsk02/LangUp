# LinguaChat — Development Plan

## Product vision

A chatbot that helps users learn a new language by discussing content they care about.
The user pastes any text (article, book page, recipe, lyrics, etc.) and the chatbot
talks about that content in the user's native language — but strategically replaces
words with the target language. Clickable words reveal translations. A familiarity
tracker remembers which words the user knows and which they struggle with, so future
conversations reinforce weak vocabulary through natural repetition.

---

## Core user flow

```
1. User opens app → greeted by chatbot
2. Chatbot asks: what language are you learning? what's your native language?
3. User pastes a piece of content (any language)
4. Chatbot DISCUSSES the content — themes, meaning, opinions, questions —
   written in the user's native language, but with some words/phrases
   replaced with the target language
5. User clicks purple target-language words → translation revealed
6. Every word interaction is tracked (clicked = don't know, not clicked = recognized)
7. User continues chatting — asking questions about the content, going deeper
8. In future conversations, weak words are woven back in by the chatbot
```

The KEY insight: the chatbot is NOT a translator. It is a conversational partner
that discusses the content with the user, and uses code-switching as a teaching tool.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (React)                  │
│                                                     │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐  │
│  │ ChatView │  │ VocabPanel│  │ ContentPreview   │  │
│  │          │  │           │  │ (source text)    │  │
│  │ Messages │  │ Word list │  │                  │  │
│  │ w/ coded │  │ + scores  │  │                  │  │
│  │ words    │  │           │  │                  │  │
│  └────┬─────┘  └─────┬─────┘  └────────┬─────────┘  │
│       │              │                 │            │
│  ┌────┴──────────────┴─────────────────┴─────────┐  │
│  │              State Manager                     │  │
│  │  - messages[]                                  │  │
│  │  - vocabDb {}  (word → familiarity data)       │  │
│  │  - profile {}  (native lang, target lang, lvl) │  │
│  │  - sourceText  (current content being discussed│  │
│  └────────────────────┬──────────────────────────┘  │
│                       │                             │
│  ┌────────────────────┴──────────────────────────┐  │
│  │           Persistence Layer                    │  │
│  │  window.storage (cross-session)                │  │
│  │  Keys: vocab-db, user-profile, chat-history    │  │
│  └────────────────────┬──────────────────────────┘  │
│                       │                             │
│  ┌────────────────────┴──────────────────────────┐  │
│  │           Claude API Layer                     │  │
│  │  - Builds system prompt with:                  │  │
│  │    • user profile (languages, level)           │  │
│  │    • source text being discussed               │  │
│  │    • weak vocabulary to reinforce              │  │
│  │    • code-switching density rules              │  │
│  │  - Sends conversation history (last 20 msgs)   │  │
│  │  - Parses {{target|native}} tokens in response │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## Tech stack

| Layer      | Choice           | Reason                                      |
|------------|------------------|---------------------------------------------|
| Frontend   | React (.jsx)     | Runs as artifact in Claude chat              |
| Styling    | Inline + classes | No external CSS framework needed             |
| Fonts      | Newsreader + DM Sans | Editorial feel via Google Fonts CDN       |
| LLM        | Claude Sonnet 4  | Built-in API access from artifacts           |
| Storage    | window.storage   | Persistent key-value store across sessions   |
| State      | React useState   | Simple, no external state lib needed         |

---

## File structure (single artifact)

Everything lives in ONE .jsx file since it's a React artifact. Logical sections:

```
linguachat.jsx
│
├── CONSTANTS
│   ├── Storage keys
│   ├── Level definitions (beginner/intermediate/advanced)
│   └── Code-switching density rules per level
│
├── STORAGE LAYER
│   ├── loadStore(key) → reads from window.storage
│   ├── saveStore(key, value) → writes to window.storage
│   └── Handles errors gracefully (storage might fail)
│
├── VOCABULARY ENGINE
│   ├── updateFamiliarity(word, clicked) → SM-2 inspired scoring
│   ├── getWeakWords(vocabDb, n) → returns n lowest-familiarity words
│   ├── markWordsShown(text, vocabDb) → passive recognition bump
│   └── Familiarity formula:
│       - Click to reveal: familiarity -= 0.15 (they don't know it)
│       - Seen, not clicked: familiarity += 0.05 (passive recognition)
│       - Range: 0.0 (unknown) to 1.0 (mastered)
│       - New words start at 0.3
│
├── CLAUDE API LAYER
│   ├── callClaude(messages, system) → raw API call
│   ├── buildSystemPrompt(profile, vocabDb, sourceText) → constructs prompt
│   │   The system prompt is the brain of the app. It tells Claude to:
│   │   1. Discuss the SOURCE TEXT content (themes, meaning, insights)
│   │   2. Write primarily in native language
│   │   3. Replace words using {{target|native}} format
│   │   4. Follow level-specific density rules
│   │   5. Reinforce weak words from vocab DB
│   │   6. Be conversational, not a textbook
│   └── extractProfile(userMsg, response) → detects languages from chat
│
├── COMPONENTS
│   ├── TargetWord — clickable purple word with translation reveal
│   │   - Shows word in target language
│   │   - Click → reveals native translation
│   │   - Colored dot: red (weak) → amber (learning) → green (strong)
│   │   - onClick → updates vocabDb familiarity
│   │
│   ├── ParsedMessage — renders message text with embedded TargetWords
│   │   - Regex parses {{target|native}} tokens
│   │   - Splits text into plain segments + TargetWord components
│   │   - Plain text renders normally, tokens become interactive
│   │
│   ├── ChatMessage — single message bubble (user or assistant)
│   │   - User messages: solid purple bubble, right-aligned
│   │   - Assistant messages: light bg, left-aligned, parsed for words
│   │
│   ├── ContentPreview — shows the source text being discussed
│   │   - Collapsible panel above chat
│   │   - Shows detected language + brief summary
│   │   - User can swap in new content anytime
│   │
│   ├── VocabPanel — slide-out vocabulary tracker
│   │   - Stats: total / weak / learning / strong counts
│   │   - Word list sorted by familiarity (weakest first)
│   │   - Each word shows: target word, translation, familiarity bar
│   │   - Color-coded: red < 30%, amber 30-70%, green > 70%
│   │
│   └── InputArea — chat input with send button
│       - Auto-growing textarea
│       - Enter to send, Shift+Enter for newline
│       - Contextual placeholder based on conversation state
│
└── MAIN APP (LinguaChat)
    ├── State initialization from persistent storage
    ├── Message send/receive loop
    ├── Profile detection from conversation
    ├── Vocab tracking integration
    └── Layout: header + chat + input + vocab panel
```

---

## System prompt design (critical)

The system prompt is the most important part. It controls HOW Claude discusses
the content and HOW it code-switches. Here's the structure:

```
ROLE: You are LinguaChat, a friendly language tutor who discusses content
      with the user to help them learn [target language].

DISCUSSION RULES:
- You are discussing THIS specific text: [source text]
- Talk about its themes, meaning, cultural context, interesting points
- Ask the user questions about the content
- Share your own observations and insights
- Make the conversation engaging — you're a knowledgeable friend

CODE-SWITCHING RULES:
- Write primarily in [native language]
- Replace some words with [target language] using format: {{word|translation}}
- BEGINNER: 5-10% replacement, only common nouns and adjectives
- INTERMEDIATE: 15-25%, include verbs, phrases, simple idioms
- ADVANCED: 30-50%, full phrases, complex grammar, cultural expressions
- Vary what you replace — don't just do nouns every time

REINFORCEMENT:
- These words have low familiarity — weave them in naturally:
  [list of weak words with translations]

TONE:
- Conversational, warm, curious
- You're discussing the content together, not lecturing
- Occasionally quiz casually: "do you remember what [word] means?"
```

---

## Vocabulary tracking in detail

### Data model per word:
```json
{
  "targetWord": "食べる",
  "nativeWord": "to eat",
  "familiarity": 0.35,
  "timesShown": 12,
  "timesClicked": 8,
  "firstSeen": 1713000000000,
  "lastSeen": 1713100000000,
  "lastClicked": 1713090000000
}
```

### Storage key design:
```
"lc-vocab"    → { "食べる": {...}, "grande": {...}, ... }
"lc-profile"  → { nativeLang, targetLang, level }
"lc-history"  → { messages: [...last 30...], sourceText }
```

### Scoring logic:
```
On word SHOWN in a message (not clicked):
  familiarity = min(1.0, familiarity + 0.05)
  timesShown += 1

On word CLICKED (translation revealed):
  familiarity = max(0.0, familiarity - 0.15)
  timesClicked += 1
  lastClicked = now

Weak words = familiarity < 0.3  → RED dot
Learning    = 0.3 to 0.7        → AMBER dot
Strong      = > 0.7             → GREEN dot
```

### Reinforcement strategy:
Before each Claude API call, we:
1. Pull the 8 weakest words from vocab DB
2. Inject them into the system prompt
3. Ask Claude to naturally weave them into the response
4. This creates organic spaced repetition without flashcards

---

## Conversation state machine

```
START → ONBOARDING → CONTENT_LOADED → DISCUSSING → DISCUSSING
                                           ↓
                                    (user pastes new content)
                                           ↓
                                    CONTENT_LOADED → DISCUSSING
```

States:
- ONBOARDING: No profile yet. Chatbot asks about languages.
- CONTENT_LOADED: User pasted text. Chatbot analyzes and starts discussing.
- DISCUSSING: Active conversation about the content with code-switching.

Transitions are implicit — detected from message content and state.

---

## Build order

### Phase 1: Core chat loop
1. Basic React shell with header, message list, input
2. Claude API integration — send/receive messages
3. Simple system prompt — just discuss content in English first
4. Message rendering with proper bubble styling

### Phase 2: Code-switching engine
5. Update system prompt with code-switching rules + {{target|native}} format
6. Build ParsedMessage component — regex parser for tokens
7. Build TargetWord component — clickable with translation reveal
8. Profile detection from conversation (extract languages)

### Phase 3: Vocabulary tracking
9. Implement familiarity scoring (click = decay, shown = grow)
10. Persistent storage integration (window.storage)
11. Inject weak words into system prompt for reinforcement
12. Build VocabPanel — slide-out word list with scores

### Phase 4: Content handling
13. ContentPreview component — show source text being discussed
14. Detect when user pastes long text (> 150 chars) as source material
15. Update system prompt to focus discussion on the content
16. Allow swapping content mid-conversation

### Phase 5: Polish
17. Level selector (beginner/intermediate/advanced) in header
18. Onboarding flow — warm welcome message
19. Loading states, error handling, edge cases
20. Contextual placeholders, hints, empty states
21. Animations (fade-in messages, slide-in vocab panel)
22. Responsive layout

---

## Key design decisions

1. **Single file**: Everything in one .jsx artifact. No backend server needed.
   Claude API is called directly from the artifact.

2. **Content-first discussion**: The chatbot's PRIMARY job is to discuss the
   content intelligently. Code-switching is the teaching mechanism layered on top.
   If the chatbot just labels words without discussing meaning, the product fails.

3. **No flashcard mode**: Learning happens through conversation, not drills.
   The spaced repetition is invisible — weak words just keep showing up in
   natural chat until the user stops clicking on them.

4. **Progressive code-switching**: Start gentle (5-10% at beginner), scale up.
   The user should never feel overwhelmed. The purple words should feel like
   seasoning, not the main dish.

5. **Click = "I don't know"**: This is the key insight. In a flashcard app,
   you explicitly grade yourself. Here, the implicit signal is whether you
   clicked the word. No click = you recognized it. Click = you needed help.
   Much lower friction than self-grading.

6. **{{target|native}} format**: Simple, unambiguous, easy for Claude to produce
   and for regex to parse. No nested brackets, no edge case nightmares.

---

## Example conversation

```
CHATBOT: Hey! So I just read through that Japanese article you shared —
it's about {{地球温暖化|global warming}} and its effects on the Arctic.
Pretty heavy stuff. The article says that {{科学者|scientists}} are
warning that Arctic ice could completely {{消失|disappear}} by 2050 if
current trends continue. What do you think — were you surprised by
any of the {{情報|information}} in the article?

USER: Yeah, I didn't realize it could happen that fast. What does the
article say about the effects?

CHATBOT: Great question! The article mentions two main {{影響|effects}}.
First, {{海面上昇|sea level rise}} — which would affect coastal cities
worldwide. Second, the impact on {{生態系|ecosystems}}, especially
animals that depend on Arctic ice. The word {{深刻|serious/grave}} is
used to describe the situation, which is a stronger word than just
"bad" — it carries a sense of gravity. Do you remember what
{{科学者|scientists}} means from earlier?

USER: Scientists?

CHATBOT: {{正解|Correct}}! Nice recall. ...
```

Notice: the chatbot discusses the CONTENT (Arctic ice, climate effects)
while teaching vocabulary through context. This is the product.
