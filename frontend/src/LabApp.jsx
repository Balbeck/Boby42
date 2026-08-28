import { useEffect, useState } from 'react'
import LabLogin from './components/LabLogin'
import { logout, me } from './services/labApi'

/**
 * The /lab page. Stands alone — outside ConversationsProvider and any shell
 * (no drawer, no page switcher, no language switcher). Two lines, hardcoded
 * French: the greeting always, "Bienvenue Hector" only with a valid session.
 *
 * On mount it asks GET /auth/lab/me: a session → show the second line; no
 * session (401) or feature disabled (404) → show the login popup.
 */
export default function LabApp() {
  const [status, setStatus] = useState('loading') // 'loading' | 'in' | 'out'
  const [showLogin, setShowLogin] = useState(false)

  useEffect(() => {
    let cancelled = false
    me().then((session) => {
      if (cancelled) return
      setStatus(session ? 'in' : 'out')
      setShowLogin(!session)
    })
    return () => {
      cancelled = true
    }
  }, [])

  function recheck() {
    me().then((session) => {
      setStatus(session ? 'in' : 'out')
      setShowLogin(!session)
    })
  }

  async function handleLogout() {
    await logout().catch(() => {})
    setStatus('out')
    setShowLogin(true)
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-chat-bg text-chat-text">
      <h1 className="text-3xl font-medium">Bonjour 🎋 🌞</h1>
      {status === 'in' && (
        <>
          <p className="text-lg text-chat-text-muted">Bienvenue Hector</p>
          <button
            type="button"
            onClick={handleLogout}
            className="text-sm text-chat-text-muted underline underline-offset-2 hover:text-chat-text"
          >
            Se déconnecter
          </button>
        </>
      )}
      {status === 'out' && showLogin && (
        <LabLogin onClose={() => setShowLogin(false)} onSuccess={recheck} />
      )}
    </div>
  )
}
