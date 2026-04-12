import React, { Fragment, useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { ReaderLocationState } from "./InputScreen";
import { useAuth } from "../context/AuthContext";
import { recordClick, saveSession } from "../lib/api";

function isReaderState(x: unknown): x is ReaderLocationState {
  if (!x || typeof x !== "object") return false;
  const s = x as Record<string, unknown>;
  return (
    typeof s.sourceText === "string" &&
    typeof s.level === "number" &&
    typeof s.target_language === "string" &&
    s.blend != null &&
    typeof s.blend === "object" &&
    Array.isArray((s.blend as { words?: unknown }).words)
  );
}

function sessionScore(totalSwapped: number, clicks: number): number {
  const t = Math.max(1, totalSwapped);
  const c = Math.min(Math.max(0, clicks), t);
  return Math.round(((t - c) / t) * 100);
}

function glossLabel(original: string): string {
  const t = original.trim();
  if (t.length <= 18) return t.toUpperCase();
  return `${t.slice(0, 15)}…`.toUpperCase();
}

export default function ReaderScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const { token } = useAuth();
  const state = isReaderState(location.state) ? location.state : null;

  const [wordsClicked, setWordsClicked] = useState(0);
  const [revealedWordIndexes, setRevealedWordIndexes] = useState<Set<number>>(
    new Set()
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    setWordsClicked(0);
    setRevealedWordIndexes(new Set());
  }, [state?.sourceText, state?.blend]);

  const scorePct = state
    ? sessionScore(state.blend.total_words_swapped, wordsClicked)
    : 0;

  const handleWordActivate = useCallback(
    async (w: ReaderLocationState["blend"]["words"][0], index: number) => {
      if (!w.is_swapped || !state || !token) return;
      if (revealedWordIndexes.has(index)) return;

      setRevealedWordIndexes((prev) => {
        const next = new Set(prev);
        next.add(index);
        return next;
      });
      setWordsClicked((n) => n + 1);
      try {
        await recordClick(
          token,
          w.swapped,
          w.translation || w.original,
          state.target_language
        );
      } catch {
        /* non-blocking */
      }
    },
    [revealedWordIndexes, state, token]
  );

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  async function handleSaveSession() {
    if (!state || !token) return;
    const swapped = Math.max(1, state.blend.total_words_swapped);
    const clicked = Math.min(wordsClicked, swapped);
    const snippet = state.sourceText.trim().slice(0, 280);
    if (!snippet) return;

    setSaveError("");
    setSaveBusy(true);
    try {
      await saveSession(
        token,
        snippet,
        swapped,
        clicked,
        state.level
      );
      setModalOpen(false);
      navigate("/dashboard");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save session");
    } finally {
      setSaveBusy(false);
    }
  }

  if (!state) {
    return (
      <main className="reader-page">
        <div className="reader-screen reader-screen--empty">
          <div className="reader-inner">
            <h1 className="reader-title">Reader</h1>
            <p className="reader-muted">
              No passage loaded. Start from{" "}
              <Link to="/input" className="reader-link">
                Input Studio
              </Link>{" "}
              to paste text and run the blend step.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const { blend, level, target_language, sourceText } = state;
  const { words, total_words_swapped } = blend;

  return (
    <div className="reader-page">
      <header className="lu-reader-header">
        <div className="lu-reader-header-left">
          <span className="lu-reader-title">LangUp Reader</span>
          <span className="lu-reader-pill">Level {level}</span>
          <span className="lu-reader-pill">{target_language}</span>
        </div>
        <div className="lu-reader-header-right">
          <div>
            <div className="lu-reader-score-label">Score</div>
            <div className="lu-reader-score-val">{scorePct}%</div>
          </div>
        </div>
      </header>

      <main className="lu-reader-main">
        <div className="lu-word-flow" role="article" aria-label="Blended passage">
          {words.map((w, i) => {
            const isRevealed = revealedWordIndexes.has(i);
            const revealLabel = w.translation || w.original;

            return (
              <Fragment key={i}>
                {!w.is_swapped ? (
                  <span className="lu-native-piece">{w.swapped}</span>
                ) : (
                  <button
                    type="button"
                    className={`lu-word-stack ${isRevealed ? "is-revealed" : ""}`}
                    onClick={() => handleWordActivate(w, i)}
                  >
                    <span className="gloss-en">{isRevealed ? glossLabel(revealLabel) : "\u00a0"}</span>
                    <span className="romaji">{w.romaji || "\u00a0"}</span>
                    <span className="pill">
                      <span>{w.swapped}</span>
                    </span>
                  </button>
                )}
              </Fragment>
            );
          })}
        </div>

        <details className="reader-source">
          <summary>Original text</summary>
          <p>{sourceText}</p>
        </details>
      </main>

      <nav className="lu-reader-bottom" aria-label="Reader actions">
        <Link to="/input">
          <span className="material-symbols-outlined">content_paste</span>
          Studio
        </Link>
        <Link to="/dashboard">
          <span className="material-symbols-outlined">query_stats</span>
          Insights
        </Link>
        <Link to="/vocab">
          <span className="material-symbols-outlined">style</span>
          Vocabulary
        </Link>
        <button type="button" className="end-btn" onClick={() => setModalOpen(true)}>
          <span className="material-symbols-outlined">exit_to_app</span>
          End session
        </button>
      </nav>

      {modalOpen ? (
        <div className="lu-modal-root" role="presentation">
          <div
            className="lu-modal-backdrop"
            onClick={() => {
              if (!saveBusy) setModalOpen(false);
            }}
            aria-hidden
          />
          <div className="lu-modal-card" role="dialog" aria-modal="true" aria-labelledby="lu-session-title">
            <div className="lu-modal-inner">
              <div className="lu-modal-ring">
                <div>
                  <div className="lu-modal-score">{scorePct}%</div>
                  <div className="lu-modal-score-label">Accuracy</div>
                </div>
                <div className="lu-modal-ring-badge">
                  <span className="material-symbols-outlined filled" style={{ fontSize: "1rem" }}>
                    star
                  </span>
                </div>
              </div>

              <h2 className="lu-modal-title" id="lu-session-title">
                Session summary
              </h2>
              <p className="lu-modal-desc">
                Nice work — you read with {total_words_swapped} blended words
                at level {level}. {wordsClicked} lookups logged.
              </p>

              <div className="lu-modal-stats">
                <div className="lu-modal-stat">
                  <span>Words</span>
                  <span>{words.length}</span>
                </div>
                <div className="lu-modal-stat">
                  <span>Clicked</span>
                  <span>{wordsClicked}</span>
                </div>
                <div className="lu-modal-stat">
                  <span>Level</span>
                  <span style={{ color: "var(--lu-primary)" }}>{level}</span>
                </div>
              </div>

              {saveError ? (
                <p className="lu-studio-error" style={{ marginBottom: "1rem" }}>
                  {saveError}
                </p>
              ) : null}

              <div className="lu-modal-actions">
                <button
                  type="button"
                  className="lu-modal-btn-primary"
                  disabled={saveBusy || !token}
                  onClick={handleSaveSession}
                >
                  {saveBusy ? "Saving…" : "Save session"}
                </button>
                <button
                  type="button"
                  className="lu-modal-btn-ghost"
                  onClick={() => setModalOpen(false)}
                >
                  Keep reading
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}


