import { useState } from 'react'

/**
 * Un document trouvé, replié par défaut. Le contenu n'est chargé (via onExpand)
 * qu'au premier dépli — jamais rechargé ensuite (doc.loaded reste true).
 *
 * @param {{ document: import('../types/types.js').ArchivisteDocument, onExpand: () => void }} props
 */
export default function ArchivisteDocument({ document, onExpand }) {
  const [expanded, setExpanded] = useState(false)

  function handleToggle() {
    const next = !expanded
    setExpanded(next)
    if (next) onExpand()
  }

  return (
    <div className="rounded-xl border border-chat-border bg-chat-surface">
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="text-sm font-medium text-chat-text">{document.name}</span>
        <span className="flex items-center gap-3 text-xs text-chat-text-muted">
          {document.score.toFixed(2)}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
          >
            <path d="M5 9l7 7 7-7" />
          </svg>
        </span>
      </button>

      {expanded && (
        <div className="border-t border-chat-border px-4 py-3">
          {document.loading ? (
            <div className="text-sm italic text-chat-text-muted">Chargement...</div>
          ) : (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words font-sans text-sm text-chat-text">
              {document.content}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
