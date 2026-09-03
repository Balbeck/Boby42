import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Un document trouvé, replié par défaut. Le contenu n'est chargé (via onToggle)
 * qu'au premier dépli — jamais rechargé ensuite (doc.loaded reste true).
 * Composant présentational partagé par /archiviste et /chat.
 *
 * `expanded` est porté par le document lui-même (état des hooks, au-dessus du
 * router) et non par un `useState` local : un aller-retour /chat ↔ /archiviste
 * démonte ce composant, et un document déplié doit le rester.
 *
 * @param {{
 *   doc: import('../types/types.js').ArchivisteDocument,
 *   onToggle: () => void,
 *   t: import('../types/types.js').Messages,
 * }} props
 */
export default function ArchivisteDocument({ doc, onToggle, t }) {
  const expanded = doc.expanded ?? false

  return (
    <div className="rounded-xl border border-chat-border bg-chat-surface">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="text-sm font-medium text-chat-text">{doc.name}</span>
        <span className="flex items-center gap-3 text-xs text-chat-text-muted">
          {doc.score.toFixed(2)}
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
          {doc.type === 'pdf' ? (
            <div className="flex flex-col gap-2">
              {/* ⚠️ Pas de `sandbox` ici, et c'est délibéré (F4). L'attribut a été
                  essayé (`sandbox="allow-same-origin"`) puis retiré : un cadre
                  bac-à-sable neutralise la visionneuse PDF intégrée des
                  navigateurs Chromium (bug Chromium 413851 « Sandbox breaks PDF
                  rendering » — Chrome sert un document HTML portant un plugin,
                  que le bac à sable bloque) ; Safari a le même comportement, et
                  pdf.js (Firefox) est lui aussi piloté par du script. Le risque
                  couvert est de toute façon nul ici : le PDF vient de notre
                  propre backend, servi par `GET /subjectspdf/:file` derrière une
                  liste blanche. */}
              <iframe
                src={doc.url}
                title={doc.name}
                className="h-[70vh] w-full rounded-lg border border-chat-border bg-white"
              />
              <a
                href={doc.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-chat-green underline"
              >
                {t.openInNewTab}
              </a>
            </div>
          ) : doc.loading ? (
            <div className="text-sm italic text-chat-text-muted">{t.loading}</div>
          ) : doc.error ? (
            <div className="text-sm text-chat-text">
              {t.errorPrefix}
              {doc.error}
            </div>
          ) : (
            <div className="prose prose-invert prose-sm max-w-none prose-a:text-chat-green">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
