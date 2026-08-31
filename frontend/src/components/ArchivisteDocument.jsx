import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Un document trouvé, replié par défaut. Le contenu n'est chargé (via onExpand)
 * qu'au premier dépli — jamais rechargé ensuite (doc.loaded reste true).
 * Composant présentational partagé par /archiviste et /chat.
 *
 * @param {{
 *   document: import('../types/types.js').ArchivisteDocument,
 *   onExpand: () => void,
 *   t: object,
 * }} props
 */
export default function ArchivisteDocument({ document, onExpand, t }) {
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
          {document.type === 'pdf' ? (
            <div className="flex flex-col gap-2">
              <iframe
                src={document.url}
                title={document.name}
                className="h-[70vh] w-full rounded-lg border border-chat-border bg-white"
              />
              <a
                href={document.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-chat-green underline"
              >
                {t.openInNewTab}
              </a>
            </div>
          ) : document.loading ? (
            <div className="text-sm italic text-chat-text-muted">{t.loading}</div>
          ) : document.error ? (
            <div className="text-sm text-chat-text">
              {t.errorPrefix}
              {document.error}
            </div>
          ) : (
            <div className="prose prose-invert prose-sm max-w-none prose-a:text-chat-green">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{document.content}</ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
