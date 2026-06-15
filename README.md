# LangUp

**Immersive language learning through the content you already read.**

LangUp blends your target language into any English passage using a technique called *code-switching* — the same mechanism linguists observe in natural bilingual environments. Rather than drilling flashcards in isolation, you encounter new words inside context you care about, which is where retention actually happens.

---

## How It Works

1. Paste any English text — an article, a recipe, a song lyric, a chapter.
2. Choose a target language and an immersion level (1–5).
3. LangUp replaces a calculated subset of words with their target-language equivalents, live via the OpenAI API.
4. Read the blended passage. Click any word you don't recognize — it reveals the translation and logs a vocabulary hit.
5. End the session. Your mastery scores update, and weak words get reinforced in future chat discussions.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Browser (React)                        │
│                                                              │
│  InputScreen   ──►  ReaderScreen  ──►  DashboardScreen      │
│  (Paste / Agent)    (Blended text)     (Progress + Charts)  │
│                          │                                   │
│                   VocabScreen  (Mastery archive)             │
└──────────────────────────┬───────────────────────────────────┘
                           │ REST / JSON
┌──────────────────────────▼───────────────────────────────────┐
│                    Express API  (:4000)                       │
│                                                              │
│  /api/blend        word-swap pipeline  ──►  OpenAI           │
│  /chat             discussion agent   ──►  OpenAI            │
│  /api/studio/chat  text-drafting agent ──► OpenAI            │
│  /vocab            mastery CRUD                              │
│  /sessions         session save + aggregation                │
│  /auth             signup / login / logout                   │
└──────────────────────────┬───────────────────────────────────┘
                           │ Supabase JS SDK
┌──────────────────────────▼───────────────────────────────────┐
│                 Supabase (Postgres + Auth)                    │
│                                                              │
│   auth.users   profiles   vocabulary   sessions              │
└──────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

### Frontend
| Layer | Choice | Why |
|---|---|---|
| UI Framework | React 19 + TypeScript | Concurrent rendering, strict type safety |
| Routing | React Router DOM 7 | Nested routes, data loaders |
| Build | Vite | Sub-second HMR vs CRA's Webpack overhead |
| Auth state | Context API + localStorage | Lightweight — no Redux needed for a single-user token |
| API client | Custom typed `fetch` wrapper | Zero-dependency, fully typed request/response shapes |
| Supabase client | `@supabase/supabase-js` 2.x | Direct realtime subscriptions without extra infra |

### Backend
| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js + Express 5 | Async-first, mirrors OpenAI SDK's promise model |
| Validation | `express-validator` | Declarative, composable input sanitization |
| Auth middleware | Supabase JWT verification (raw HTTP) | Works with all key formats; no extra library |
| AI SDK | `openai` Node SDK 4.x | Streaming-ready, typed responses |

### Data
| Layer | Choice |
|---|---|
| Database | Supabase (Postgres) |
| Auth | Supabase Auth (email/password + JWT) |
| Row-level security | Enabled on all tables — users can only read/write their own rows |

---

## AI Model Layer — GPT-4o-mini

All three AI endpoints use **`gpt-4o-mini`**, not GPT-4o. This is intentional:

- **Latency over capability.** Word-swapping and translation are structured tasks, not open-ended reasoning. `gpt-4o-mini` responds in roughly 400–800 ms per call at this payload size vs. 2–4 s for GPT-4o, which matters when blending is per-word and synchronous.
- **Cost efficiency.** Blend calls loop per eligible word. At GPT-4o-mini pricing, blending a 300-word passage at Level 3 (≈35% swap rate ≈ 30 words) runs at a fraction of a cent. The same pipeline on GPT-4o would be 15–20× more expensive per session.
- **Temperature discipline.** Translation calls run at `temperature: 0` for deterministic, consistent output. Chat discussion runs at `temperature: 0.8` for natural conversation. Studio drafting at `temperature: 0.7` balances creativity with coherence.

### Blend Pipeline (per request)

```
Input text
  └─► tokenize into words
        └─► classify each word (noun / verb / adjective / article / preposition)
              └─► filter eligible words by level rules
                    └─► random sample at level percentage
                          └─► for each sampled word:
                                POST to OpenAI with system:
                                "Return ONLY JSON: { swapped, romaji, translation }"
                                temperature: 0
                          └─► assemble full word array (swapped + untouched)
Response: { words[], detected_language, total_words_swapped }
```

**Level → swap density:**

| Level | Name | Eligible Types | % of Eligible Swapped |
|---|---|---|---|
| 1 | Light Touch | Nouns | 10% |
| 2 | Basic Mix | Nouns + Adjectives | 20% |
| 3 | Intermediate Mix | Nouns + Adjectives + Verbs | 35% |
| 4 | Advanced Immersion | All except articles/prepositions | 55% |
| 5 | Full Immersion | All except articles/prepositions | 80% |

Articles (`a`, `an`, `the`) and common prepositions are never swapped at any level — they are grammatical glue and swapping them would break readability.

### Code-Switching Chat (per request)

The discussion endpoint encodes immersion density rules directly into the system prompt:

```
Level 1:  5–10% of content words, common nouns/adjectives only
Level 2: 10–15%, nouns and adjectives
Level 3: 15–25%, nouns, adjectives, simple verbs
Level 4: 25–40%, most word types + short phrases
Level 5: 30–50%, full phrases, complex grammar, cultural expressions
```

Every swapped word is emitted as `{{target_word|english_translation}}`, which the frontend parses into clickable word-stacks. Weak vocabulary words (mastery < 0.3) are injected into the system prompt so the model naturally weaves them into responses — reinforcement without the user noticing.

### Studio Agent

The Studio chat endpoint helps users draft English source text through conversation. It writes plain English with no substitutions — the Reader handles blending. This separation keeps concerns clean and lets users iterate on their source material before committing to a session.

---

## Vocabulary & Mastery System

Every word the user encounters is tracked in the `vocabulary` table with a floating-point mastery score:

```
Initial mastery:  0.30
On passive seen:  mastery = min(1.0, mastery + 0.05)   ← word appeared in text
On click:         mastery = max(0.0, mastery - 0.15)   ← user didn't recognize it
```

This creates a lightweight spaced-repetition signal without a full SRS scheduler. Words below `0.3` are surfaced as "weak" and injected into future chat prompts. The asymmetry is intentional — recognition gaps penalize harder than passive exposure rewards, matching the actual difficulty of acquiring a word.

**Mastery tiers (frontend display):**

| Range | Label | Color |
|---|---|---|
| < 0.30 | Struggling | Red |
| 0.30 – 0.69 | Learning | Amber |
| ≥ 0.70 | Mastered | Green |

---

## Session Scoring

At the end of every reading session:

```
score = ((total_words_swapped - words_clicked) / total_words_swapped) × 100
```

Higher score = you recognized more swapped words without needing to click. This metric compounds across sessions into the 8-week progress chart on the Dashboard.

---

## API Reference

All protected endpoints require `Authorization: Bearer <token>`.

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `POST` | `/auth/signup` | — | Create account |
| `POST` | `/auth/login` | — | Get JWT token |
| `POST` | `/auth/logout` | ✓ | Invalidate session |
| `POST` | `/api/blend` | ✓ | Word-swap a passage |
| `POST` | `/chat` | ✓ | Code-switching discussion |
| `POST` | `/api/studio/chat` | ✓ | Studio drafting agent |
| `GET` | `/vocab` | ✓ | All vocabulary |
| `GET` | `/vocab/weak` | ✓ | Words with mastery < 0.3 |
| `POST` | `/vocab/record-click` | ✓ | Log word click |
| `POST` | `/vocab/record-seen-batch` | ✓ | Batch log passive exposures |
| `POST` | `/sessions` | ✓ | Save reading session |
| `GET` | `/sessions` | ✓ | Session history + summary |
| `GET` | `/sessions/progress` | ✓ | 8-week aggregated chart data |

---

## Database Schema

```sql
-- User profiles (extends Supabase auth.users)
profiles (
  id              uuid PRIMARY KEY,  -- matches auth.uid()
  target_language text,
  proficiency_level int DEFAULT 1
)

-- Per-word mastery tracking
vocabulary (
  id              uuid PRIMARY KEY,
  user_id         uuid REFERENCES auth.users,
  word_native     text,              -- target language word
  word_english    text,              -- English gloss
  language        text,
  times_seen      int,
  times_clicked   int,
  mastery_score   float,             -- 0.0 → 1.0
  first_seen      timestamptz,
  last_seen       timestamptz,
  last_clicked    timestamptz
)

-- Reading session records
sessions (
  id                  uuid PRIMARY KEY,
  user_id             uuid REFERENCES auth.users,
  content_snippet     text,          -- first 280 chars of source
  total_words_swapped int,
  words_clicked       int,
  level_used          int,
  score               float,
  created_at          timestamptz DEFAULT now()
)
```

Row-level security is enabled on all tables. All reads and writes are scoped to the authenticated user.

---

## Running Locally

**Prerequisites:** Node 18+, a Supabase project, an OpenAI API key.

```bash
# Backend
cd backend
cp .env.example .env        # fill in SUPABASE_URL, SUPABASE_ANON_KEY, OPENAI_API_KEY
npm install
npm run dev                  # http://localhost:4000

# Frontend (separate terminal)
cd frontend
npm install
npm start                    # http://localhost:3001
```

The frontend proxies API requests to `http://localhost:4000` via the `proxy` field in `package.json`.

---

## Environment Variables

**`backend/.env`**
```
PORT=4000
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=eyJ...
OPENAI_API_KEY=sk-proj-...
```

**`frontend/.env`**
```
REACT_APP_SUPABASE_URL=https://<project>.supabase.co
REACT_APP_SUPABASE_ANON_KEY=eyJ...
```

---

## Supported Languages

Japanese · Spanish · French · German · Korean · Mandarin · Arabic · Hindi

Romaji transliteration is returned for CJK scripts (Japanese, Korean, Mandarin) to aid pronunciation while reading.

---

## Project Structure

```
ynrjc/
├── backend/
│   ├── index.js               Express entry point
│   ├── middleware/
│   │   └── auth.js            JWT verification via Supabase HTTP API
│   ├── routes/
│   │   ├── auth.js
│   │   ├── blend.js           Word-swap pipeline
│   │   ├── chat.js            Code-switching discussion
│   │   ├── studio.js          Drafting agent
│   │   ├── vocab.js           Mastery CRUD
│   │   └── sessions.js        Session recording + aggregation
│   └── services/
│       └── supabase.js        Supabase client singleton
│
└── frontend/
    └── src/
        ├── App.jsx             Router + AuthProvider
        ├── context/
        │   └── AuthContext.tsx Auth state + hooks
        ├── lib/
        │   ├── api.ts          Typed REST client
        │   └── supabase.ts     Supabase client
        ├── pages/
        │   ├── AuthScreen.tsx
        │   ├── InputScreen.tsx  Paste + Agent modes
        │   ├── ReaderScreen.tsx Blended reading
        │   ├── VocabScreen.tsx  Mastery archive
        │   └── DashboardScreen.tsx Progress + charts
        └── components/
            └── NavBar.tsx
```
