import { useState } from 'react'
import Auth from './components/Auth'
import Chat from './components/Chat'
import './App.css'

export default function App() {
  const [session, setSession] = useState(() => {
    const token = localStorage.getItem('token')
    const profile = localStorage.getItem('profile')
    if (token && profile) return { token, profile: JSON.parse(profile) }
    return null
  })

  function handleLogin(token, profile) {
    localStorage.setItem('token', token)
    localStorage.setItem('profile', JSON.stringify(profile))
    setSession({ token, profile })
  }

  function handleLogout() {
    localStorage.removeItem('token')
    localStorage.removeItem('profile')
    setSession(null)
  }

  function handleProfileChange(updates) {
    const updated = {
      ...session.profile,
      ...(updates.level !== undefined ? { level: updates.level } : {}),
      ...(updates.target_language !== undefined ? { target_lang: updates.target_language } : {}),
    }
    localStorage.setItem('profile', JSON.stringify(updated))
    setSession(s => ({ ...s, profile: updated }))
  }

  if (!session) return <Auth onLogin={handleLogin} />
  return <Chat session={session} onLogout={handleLogout} onProfileChange={handleProfileChange} />
}
