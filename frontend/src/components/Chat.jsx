import { useState, useEffect, useRef, useCallback } from 'react'
import confetti from 'canvas-confetti'
import { sendMessage, getWeakWords, recordClick, recordSeenBatch, updateProfile, recordAnswer } from '../api'

const LANGUAGES = ['Spanish','French','Japanese','Mandarin','German','Korean','Portuguese','Italian']
const LEVELS = [
  { value: 1, label: 'Level 1 · Beginner' },
  { value: 2, label: 'Level 2 · Elementary' },
  { value: 3, label: 'Level 3 · Conversational' },
  { value: 4, label: 'Level 4 · Advanced' },
  { value: 5, label: 'Level 5 · Fluent' },
]

const EVAL_EVERY = 5        // evaluate after every N assistant messages
const UP_THRESHOLD = 0.15   // hover rate below this → suggest level up
const DOWN_THRESHOLD = 0.55 // hover rate above this → suggest level down

// Parses a message string that may contain {{target|native}} tokens.
// Returns an array of segments: { type: 'text'|'word', text, target, native }
function parseTokens(content) {
  const regex = /\{\{([^|{}]+)\|([^|{}]+)\}\}/g
  const segments = []
  let last = 0
  let match
  while ((match = regex.exec(content)) !== null) {
    if (match.index > last) {
      segments.push({ type: 'text', text: content.slice(last, match.index) })
    }
    segments.push({ type: 'word', target: match[1], native: match[2] })
    last = regex.lastIndex
  }
  if (last < content.length) {
    segments.push({ type: 'text', text: content.slice(last) })
  }
  return segments
}

// A hoverable target-language word — hover reveals translation, records once
function HoverWord({ target, native, language, token, onHovered }) {
  const recorded = useRef(false)

  function handleMouseEnter() {
    if (!recorded.current) {
      recorded.current = true
      recordClick(token, target, native, language).catch(() => {})
      onHovered?.()
    }
  }

  return (
    <span className="target-word" onMouseEnter={handleMouseEnter}>
      {target}
      <span className="native-tooltip">{native}</span>
    </span>
  )
}

// Fill-in-the-blank word for weak words — user types the target word
function QuizWord({ target, native, language, token, onHovered }) {
  const [status, setStatus] = useState('idle') // 'idle' | 'correct' | 'incorrect'
  const [input, setInput] = useState('')
  const inputRef = useRef(null)

  function fireConfetti() {
    if (!inputRef.current) return
    const rect = inputRef.current.getBoundingClientRect()
    confetti({
      particleCount: 70,
      spread: 55,
      startVelocity: 28,
      origin: {
        x: (rect.left + rect.width / 2) / window.innerWidth,
        y: (rect.top + rect.height / 2) / window.innerHeight,
      },
      colors: ['#8b5cf6', '#a78bfa', '#fbbf24', '#34d399', '#f472b6'],
    })
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') submit()
  }

  function submit() {
    if (status !== 'idle' || !input.trim()) return
    const correct = input.trim().toLowerCase() === target.toLowerCase()
    setStatus(correct ? 'correct' : 'incorrect')
    recordAnswer(token, target, native, language, correct).catch(() => {})
    if (correct) {
      fireConfetti()
    } else {
      onHovered?.() // counts as needing help
    }
  }

  if (status === 'correct') {
    return <span className="quiz-word quiz-word--correct">{target}</span>
  }
  if (status === 'incorrect') {
    return <span className="quiz-word quiz-word--incorrect" title={`Correct: ${target}`}>{target}</span>
  }

  return (
    <span className="quiz-word quiz-word--idle">
      <input
        ref={inputRef}
        className="quiz-input"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="?"
        size={Math.max(3, target.length)}
        aria-label={`Fill in the blank: ${native}`}
      />
    </span>
  )
}

// TargetWord — renders as quiz blank if the word has low familiarity, hover otherwise
function TargetWord({ target, native, language, token, onHovered, isQuiz }) {
  if (isQuiz) {
    return (
      <QuizWord
        target={target}
        native={native}
        language={language}
        token={token}
        onHovered={onHovered}
      />
    )
  }
  return (
    <HoverWord
      target={target}
      native={native}
      language={language}
      token={token}
      onHovered={onHovered}
    />
  )
}

// Renders a single chat message, handling {{target|native}} tokens
function ParsedMessage({ msg, language, token, weakWords, onWordsRendered, onWordHovered }) {
  const segments = parseTokens(msg.content)
  const renderedRef = useRef(false)
  const weakSet = new Set((weakWords || []).map(w => w.word_native.toLowerCase()))

  useEffect(() => {
    if (msg.role === 'assistant' && !renderedRef.current) {
      renderedRef.current = true
      const words = segments
        .filter(s => s.type === 'word')
        .map(s => ({ word_native: s.target, word_english: s.native, language }))
      if (words.length > 0) {
        onWordsRendered?.(words)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`message ${msg.role}`}>
      <div className="message-bubble">
        {segments.map((seg, i) =>
          seg.type === 'text' ? (
            <span key={i}>{seg.text}</span>
          ) : (
            <TargetWord
              key={i}
              target={seg.target}
              native={seg.native}
              language={language}
              token={token}
              onHovered={onWordHovered}
              isQuiz={weakSet.has(seg.target.toLowerCase())}
            />
          )
        )}
      </div>
    </div>
  )
}

// Auto-growing textarea; submits on Enter (Shift+Enter = newline)
function InputArea({ onSend, disabled }) {
  const [text, setText] = useState('')
  const ref = useRef(null)

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function submit() {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setText('')
    if (ref.current) ref.current.style.height = 'auto'
  }

  function handleInput(e) {
    setText(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = e.target.scrollHeight + 'px'
  }

  return (
    <div className="input-area">
      <textarea
        ref={ref}
        value={text}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder="Type a message… (Enter to send)"
        disabled={disabled}
        rows={1}
      />
      <button onClick={submit} disabled={disabled || !text.trim()} className="send-btn">
        Send
      </button>
    </div>
  )
}

// Level suggestion banner shown when hover rate signals a level change
function LevelBanner({ suggestion, currentLevel, onAccept, onDismiss }) {
  const newLevel = suggestion === 'up' ? currentLevel + 1 : currentLevel - 1
  const LEVEL_NAMES = { 1: 'Beginner', 2: 'Elementary', 3: 'Conversational', 4: 'Advanced', 5: 'Fluent' }
  const message = suggestion === 'up'
    ? `You're breezing through the words! Try Level ${newLevel} (${LEVEL_NAMES[newLevel]})?`
    : `These words seem tough. Drop to Level ${newLevel} (${LEVEL_NAMES[newLevel]})?`

  return (
    <div className={`level-banner level-banner--${suggestion}`}>
      <span>{message}</span>
      <div className="level-banner-actions">
        <button className="level-banner-accept" onClick={() => onAccept(newLevel)}>Yes, switch</button>
        <button className="level-banner-dismiss" onClick={onDismiss}>Not now</button>
      </div>
    </div>
  )
}

export default function Chat({ session, onLogout, onProfileChange }) {
  const { token, profile } = session
  const [messages, setMessages] = useState([])
  const [weakWords, setWeakWords] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [levelSuggestion, setLevelSuggestion] = useState(null) // 'up' | 'down' | null
  const bottomRef = useRef(null)

  // Hover-rate tracking (not state — no re-render needed)
  const statsRef = useRef({ messagesCount: 0, wordsShown: 0, wordsHovered: 0 })

  // Load weak words on mount
  useEffect(() => {
    getWeakWords(token)
      .then(data => setWeakWords(data.words || []))
      .catch(() => {})
  }, [token])

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Called when a target word is hovered
  const handleWordHovered = useCallback(() => {
    statsRef.current.wordsHovered++
  }, [])

  // Called when a new assistant message renders
  const handleWordsRendered = useCallback((words) => {
    recordSeenBatch(token, words).catch(() => {})

    // Update stats
    const stats = statsRef.current
    stats.wordsShown += words.length
    stats.messagesCount++

    // Evaluate every EVAL_EVERY messages
    if (stats.messagesCount % EVAL_EVERY === 0 && stats.wordsShown > 0) {
      const hoverRate = stats.wordsHovered / stats.wordsShown
      if (hoverRate < UP_THRESHOLD && profile.level < 5) {
        setLevelSuggestion('up')
      } else if (hoverRate > DOWN_THRESHOLD && profile.level > 1) {
        setLevelSuggestion('down')
      }
      // Reset counters for next evaluation window
      stats.messagesCount = 0
      stats.wordsShown = 0
      stats.wordsHovered = 0
    }

    // Refresh weak words for next turn
    getWeakWords(token)
      .then(data => setWeakWords(data.words || []))
      .catch(() => {})
  }, [token, profile.level])

  async function handleProfileUpdate(updates) {
    try {
      await updateProfile(token, updates)
      onProfileChange(updates)
    } catch {
      // silently ignore
    }
  }

  async function handleAcceptLevel(newLevel) {
    setLevelSuggestion(null)
    handleProfileUpdate({ level: newLevel })
  }

  async function handleSend(text) {
    const userMsg = { role: 'user', content: text }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setLoading(true)
    setError('')

    try {
      const reply = await sendMessage(
        token,
        nextMessages,
        profile,
        null,
        weakWords,
      )
      setMessages(prev => [...prev, reply])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="chat-screen">
      <header className="chat-header">
        <span className="chat-title">LangUp</span>
        <div className="chat-controls">
          <select
            className="header-select"
            value={profile.target_lang}
            onChange={e => handleProfileUpdate({ target_language: e.target.value })}
          >
            {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <select
            className="header-select"
            value={profile.level}
            onChange={e => handleProfileUpdate({ level: Number(e.target.value) })}
          >
            {LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>
        <button className="logout-btn" onClick={onLogout}>Log out</button>
      </header>

      <div className="messages-list">
        {levelSuggestion && (
          <LevelBanner
            suggestion={levelSuggestion}
            currentLevel={profile.level}
            onAccept={handleAcceptLevel}
            onDismiss={() => setLevelSuggestion(null)}
          />
        )}
        {messages.length === 0 && (
          <p className="empty-state">
            Say hello to start practicing {profile.target_lang}!
          </p>
        )}
        {messages.map((msg, i) => (
          <ParsedMessage
            key={i}
            msg={msg}
            language={profile.target_lang}
            token={token}
            weakWords={weakWords}
            onWordsRendered={handleWordsRendered}
            onWordHovered={handleWordHovered}
          />
        ))}
        {loading && (
          <div className="message assistant">
            <div className="message-bubble typing">…</div>
          </div>
        )}
        {error && <p className="chat-error">{error}</p>}
        <div ref={bottomRef} />
      </div>

      <InputArea onSend={handleSend} disabled={loading} />
    </div>
  )
}
