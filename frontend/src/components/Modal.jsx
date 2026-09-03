import { useEffect, useRef } from 'react'

/**
 * Modale générique et réutilisable : fond assombri flouté, carte centrée.
 * Se ferme au clic sur le fond, sur la croix (coin haut-droit) ou avec Échap.
 * Ne connaît rien du contenu — on lui passe des `children`.
 *
 * @param {{
 *   onClose: () => void,
 *   children: import('react').ReactNode,
 *   label?: string,
 *   closeLabel: string,
 * }} props
 */
export default function Modal({ onClose, children, label, closeLabel }) {
  const closeRef = useRef(null)

  useEffect(() => {
    closeRef.current?.focus()

    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  return (
    <div
      className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
        className="card-in relative w-full max-w-md rounded-3xl border border-chat-border bg-chat-surface p-8 shadow-2xl shadow-black/40"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full text-chat-text-muted transition-colors hover:bg-chat-surface-2 hover:text-chat-text"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            className="h-4 w-4"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        {children}
      </div>
    </div>
  )
}
