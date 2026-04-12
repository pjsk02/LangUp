import { useState } from 'react'
import { login, signup } from '../api'

const LANGUAGES = [
  { value: 'Spanish', label: 'Spanish' },
  { value: 'French', label: 'French' },
  { value: 'Japanese', label: 'Japanese' },
  { value: 'Mandarin', label: 'Mandarin' },
  { value: 'German', label: 'German' },
  { value: 'Korean', label: 'Korean' },
  { value: 'Portuguese', label: 'Portuguese' },
  { value: 'Italian', label: 'Italian' },
]

export default function Auth({ onLogin }) {
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [targetLanguage, setTargetLanguage] = useState('Spanish')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      let data
      if (mode === 'login') {
        data = await login(email, password)
      } else {
        data = await signup(email, password, targetLanguage)
      }
      // data.token + data.user from backend
      const profile = {
        native_lang: 'English',
        target_lang: data.user?.target_language || targetLanguage,
        level: data.user?.level || 1,
      }
      onLogin(data.token, profile)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">LangUp</h1>
        <p className="auth-subtitle">Learn languages through conversation</p>

        <div className="auth-tabs">
          <button
            className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => { setMode('login'); setError('') }}
          >
            Log in
          </button>
          <button
            className={`auth-tab ${mode === 'signup' ? 'active' : ''}`}
            onClick={() => { setMode('signup'); setError('') }}
          >
            Sign up
          </button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </label>

          {mode === 'signup' && (
            <label>
              Target language
              <select
                value={targetLanguage}
                onChange={e => setTargetLanguage(e.target.value)}
              >
                {LANGUAGES.map(l => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </label>
          )}

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  )
}
