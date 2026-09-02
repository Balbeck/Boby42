import { useEffect, useState } from 'react'
import LabLogin from './components/LabLogin'
import LabTabs from './components/lab/LabTabs'
import DbViz from './components/lab/DbViz'
import VizDashboard from './components/lab/VizDashboard'
import OllamaPanel from './components/lab/OllamaPanel'
import { logout, me, ollamaKey } from './services/labApi'

/**
 * The /lab page. Stands alone — outside ConversationsProvider and any shell.
 *
 * On mount it asks GET /auth/lab/me: a session → the 4-tab shell below; no
 * session (401) or feature disabled (404) → the login popup, unchanged.
 *
 * When authenticated, a slim icon-only tab bar (LabTabs) switches four local
 * panels — tabs are component state, not routes:
 *   🌞 connexion  — the greeting + logout (behaviour unchanged)
 *   🔬 viz        — the usage dashboard + conversation browser (VizDashboard)
 *   💾 dbviz      — raw read-only view of the interaction-logging tables
 *   💬 ollama     — bare console straight onto the backend's /ollama/* proxy
 *
 * English-only, by the same call as the rest of /lab.
 */
export default function LabApp() {
  const [status, setStatus] = useState('loading') // 'loading' | 'in' | 'out'
  const [showLogin, setShowLogin] = useState(false)
  const [tab, setTab] = useState('connexion') // 'connexion' | 'viz' | 'dbviz' | 'ollama'
  // The /ollama proxy key, fetched once we have a session; null when the proxy
  // is off (OLLAMA_PROXY_KEY unset → 404) or the session lapsed.
  const [proxyKey, setProxyKey] = useState(/** @type {string | null} */ (null))

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

  // Pull the /ollama proxy key once a session is established.
  useEffect(() => {
    if (status !== 'in') return
    let cancelled = false
    ollamaKey().then((k) => !cancelled && setProxyKey(k))
    return () => {
      cancelled = true
    }
  }, [status])

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
    setProxyKey(null)
  }

  // Authenticated: the tab shell.
  if (status === 'in') {
    return (
      <div className="min-h-svh bg-chat-bg text-chat-text">
        <LabTabs active={tab} onChange={setTab} />

        {/* Kept mounted across tab switches (just hidden) so the 💬 console —
            its exchanges, draft prompt and params — survives navigating away
            and back. A full page reload still clears it. */}
        <div className={`px-4 pt-20 pb-10 ${tab === 'ollama' ? '' : 'hidden'}`}>
          <OllamaPanel apiKey={proxyKey} />
        </div>

        {tab === 'viz' && (
          <div className="px-4 pt-20 pb-10">
            <VizDashboard />
          </div>
        )}

        {tab === 'dbviz' && (
          <div className="px-4 pt-20 pb-10">
            <DbViz />
          </div>
        )}

        {tab === 'connexion' && (
          <div className="flex min-h-svh flex-col items-center justify-center gap-3 px-4 text-center">
            <ConnexionPanel onLogout={handleLogout} />
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
