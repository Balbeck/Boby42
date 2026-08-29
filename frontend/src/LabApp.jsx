import { useEffect, useState } from 'react'
import LabLogin from './components/LabLogin'
import LabTabs from './components/lab/LabTabs'
import DbViz from './components/lab/DbViz'
import { logout, me } from './services/labApi'

/**
 * The /lab page. Stands alone — outside ConversationsProvider and any shell.
 *
 * On mount it asks GET /auth/lab/me: a session → the 3-tab shell below; no
 * session (401) or feature disabled (404) → the login popup, unchanged.
 *
 * When authenticated, a slim icon-only tab bar (LabTabs) switches three local
 * panels — tabs are component state, not routes:
 *   🌞 connexion  — the greeting + logout (behaviour unchanged)
 *   🔬 viz        — placeholder; reserved home of the future analytics dashboard
 *   💾 dbviz      — raw read-only view of the interaction-logging tables
 *
 * English-only, by the same call as the rest of /lab.
 */
export default function LabApp() {
  const [status, setStatus] = useState('loading') // 'loading' | 'in' | 'out'
  const [showLogin, setShowLogin] = useState(false)
  const [tab, setTab] = useState('connexion') // 'connexion' | 'viz' | 'dbviz'

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

  // Authenticated: the tab shell.
  if (status === 'in') {
    return (
      <div className="min-h-svh bg-chat-bg text-chat-text">
        <LabTabs active={tab} onChange={setTab} />
        {tab === 'dbviz' ? (
          <div className="px-4 pt-20 pb-10">
            <DbViz />
          </div>
        ) : (
          <div className="flex min-h-svh flex-col items-center justify-center gap-3 px-4 text-center">
            {tab === 'connexion' && <ConnexionPanel onLogout={handleLogout} />}
            {tab === 'viz' && (
              <p className="text-chat-text-muted">📉 📈 Visualizations to come 🏞️</p>
            )}
          </div>
        )}
      </div>
    )
  }

  // Loading / signed-out: unchanged — greeting always, login popup when out.
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-chat-bg text-chat-text">
      <h1 className="text-3xl font-medium">Bonjour 🎋 🌞</h1>
      {status === 'out' && showLogin && (
        <LabLogin onClose={() => setShowLogin(false)} onSuccess={recheck} />
      )}
    </div>
  )
}

/**
 * The 🌞 tab — the original authenticated body, unchanged. `Bienvenue Hector` is
 * a hardcoded literal, not the login value.
 *
 * @param {{ onLogout: () => void }} props
 */
function ConnexionPanel({ onLogout }) {
  return (
    <>
      <h1 className="text-3xl font-medium">Bonjour 🎋 🌞</h1>
      <p className="text-lg text-chat-text-muted">Bienvenue Hector</p>
      <button
        type="button"
        onClick={onLogout}
        className="text-sm text-chat-text-muted underline underline-offset-2 hover:text-chat-text"
      >
        Se déconnecter
      </button>
    </>
  )
}
