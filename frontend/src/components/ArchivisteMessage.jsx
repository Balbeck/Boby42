import ArchivisteDocument from './ArchivisteDocument'
import FeedbackButtons from './FeedbackButtons'

/**
 * @param {{
 *   question: string,
 *   documents?: import('../types/types.js').ArchivisteDocument[],
 *   loading?: boolean,
 *   queued?: boolean,
 *   error?: string,
 *   messageId?: string | null,
 *   rating?: -1 | 0 | 1,
 *   onRate?: (rating: -1 | 0 | 1, comment?: string) => void,
 *   onToggleDocument: (doc: import('../types/types.js').ArchivisteDocument) => void,
 *   t: import('../types/types.js').Messages,
 * }} props
 */
export default function ArchivisteMessage({
  question,
  documents = [],
  loading = false,
  queued = false,
  error,
  messageId,
  rating = 0,
  onRate,
  onToggleDocument,
  t,
}) {
  return (
    <div className="flex flex-col gap-5 py-8">
      <div className="max-w-[85%] self-end rounded-2xl bg-chat-surface-2 px-4 py-3 text-chat-text">
        {question}
      </div>

      {queued ? (
        // Statique, sans points animés : la recherche n'a pas encore commencé.
        <div className="min-h-5 max-w-[85%] text-sm italic text-chat-text-muted">
          {t.chatQueued}
        </div>
      ) : loading ? (
        <div className="min-h-5 max-w-[85%] text-sm italic text-chat-text-muted">
          {t.archivisteSearching}
        </div>
      ) : error ? (
        <div className="max-w-[85%] text-sm text-chat-text">
          {t.errorPrefix}
          {error}
        </div>
      ) : (
        (() => {
          const mdDocs = documents.filter((doc) => doc.type !== 'pdf')
          const pdfDocs = documents.filter((doc) => doc.type === 'pdf')

          return (
            <div className="flex max-w-[85%] flex-col gap-3">
              <div className="flex flex-col gap-1 text-xs text-chat-text-muted">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-medium italic text-chat-text">{t.chatDocsNotionLabel}</span>
                  <span aria-hidden>·</span>
                  <span>{t.chatDocsCount(mdDocs.length)}</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="font-medium italic text-chat-text">{t.chatDocsSubjectsLabel}</span>
                  <span aria-hidden>·</span>
                  <span>{t.chatDocsCount(pdfDocs.length)}</span>
                </div>
              </div>
              {documents.length === 0 && (
                <p className="text-xs italic text-chat-text-muted">{t.archivisteEmpty}</p>
              )}
              {[...mdDocs, ...pdfDocs].map((document) => (
                <ArchivisteDocument
                  key={`${document.type ?? 'md'}:${document.name}`}
                  document={document}
                  onToggle={() => onToggleDocument(document)}
                  t={t}
                />
              ))}
              {messageId && onRate && (
                <FeedbackButtons rating={rating} onRate={onRate} t={t} />
              )}
            </div>
          )
        })()
      )}
    </div>
  )
}
