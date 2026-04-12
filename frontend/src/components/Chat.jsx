import { useState, useEffect, useRef, useCallback } from 'react'
import { sendMessage, getWeakWords, recordClick, recordSeenBatch } from '../api'

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

// A hoverable target-language word — shows translation on hover, records once per mount
function TargetWord({ target, native, language, token }) {
  const recorded = useRef(false)

  function handleMouseEnter() {
    if (!recorded.current) {
      recorded.current = true
      recordClick(token, target, native, language).catch(() => {})
    }
  }

  return (
    <span className="target-word" onMouseEnter={handleMouseEnter}>
      {target}
      <span className="native-tooltip">{native}</span>
    </span>
  )
}

// Renders a single chat message, handling {{target|native}} tokens
function ParsedMessage({ msg, language, token, onWordsRendered }) {
  const segments = parseTokens(msg.content)
  const renderedRef = useRef(false)

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

export default function Chat({ session, onLogout }) {
  const { token, profile } = session
  const [messages, setMessages] = useState([])
  const [weakWords, setWeakWords] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef(null)

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

  // Called when a new assistant message renders — record seen batch
  const handleWordsRendered = useCallback((words) => {
    recordSeenBatch(token, words).catch(() => {})
    // Refresh weak words after recording
    getWeakWords(token)
      .then(data => setWeakWords(data.words || []))
      .catch(() => {})
  }, [token])

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
        null,        // sourceText — not used in free chat
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
        <span className="chat-meta">
          {profile.target_lang} · Level {profile.level}
        </span>
        <button className="logout-btn" onClick={onLogout}>Log out</button>
      </header>

      <div className="messages-list">
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
            onWordsRendered={handleWordsRendered}
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
