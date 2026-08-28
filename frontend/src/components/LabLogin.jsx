import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from './Modal'
import { login as apiLogin } from '../services/labApi'

/**
 * Login popup for /lab, rendered inside the generic Modal. Controlled
 * identifiant / mot de passe fields. Strings are hardcoded French for now.
 *
 * On a non-OK login (wrong credentials, or the feature is disabled) the app
 * leaves for the home page. On success the parent is told to re-check the
 * session and close the popup.
 *
 * @param {{ onClose: () => void, onSuccess: () => void }} props
 */
export default function LabLogin({ onClose, onSuccess }) {
  const navigate = useNavigate()
  const firstFieldRef = useRef(null)
  const [identifiant, setIdentifiant] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Runs after Modal's own focus effect (child effects fire before parent's),
  // so the identifiant field keeps focus.
  useEffect(() => {
    firstFieldRef.current?.focus()
  }, [])

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)

    const result = await apiLogin(identifiant, motDePasse).catch(() => ({ ok: false }))
    if (!result.ok) {
      navigate('/', { replace: true })
      return
    }
    onSuccess()
  }

  const fieldClass =
    'rounded-xl border border-chat-border bg-chat-surface-2 px-3 py-2 text-chat-text outline-none focus:border-chat-green'

  return (
    <Modal onClose={onClose} label="Connexion" closeLabel="Fermer">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <h2 className="text-lg font-medium text-chat-text">Connexion</h2>

        <label className="flex flex-col gap-1 text-sm text-chat-text-muted">
          Identifiant
          <input
            ref={firstFieldRef}
            type="text"
            value={identifiant}
            onChange={(event) => setIdentifiant(event.target.value)}
            autoComplete="username"
            className={fieldClass}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-chat-text-muted">
          Mot de passe
          <input
            type="password"
            value={motDePasse}
            onChange={(event) => setMotDePasse(event.target.value)}
            autoComplete="current-password"
            className={fieldClass}
          />
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 rounded-xl bg-chat-green px-4 py-2 font-medium text-chat-bg transition-opacity disabled:opacity-50"
        >
          Se connecter
        </button>
      </form>
    </Modal>
  )
}
