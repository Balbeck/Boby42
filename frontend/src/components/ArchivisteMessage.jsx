import DocumentsBlock from './DocumentsBlock'
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
        <DocumentsBlock
          documents={documents}
          onToggleDocument={onToggleDocument}
          t={t}
          className="flex max-w-[85%] flex-col gap-3"
          emptyMessage={t.archivisteEmpty}
        >
          {messageId && onRate && (
            <FeedbackButtons rating={rating} onRate={onRate} t={t} />
          )}
        </DocumentsBlock>
      )}
    </div>
  )
}
