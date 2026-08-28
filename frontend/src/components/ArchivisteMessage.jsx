import ArchivisteDocument from './ArchivisteDocument'

/**
 * @param {{
 *   question: string,
 *   documents?: import('../types/types.js').ArchivisteDocument[],
 *   loading?: boolean,
 *   error?: string,
 *   onLoadDocument: (doc: import('../types/types.js').ArchivisteDocument) => void,
 *   t: object,
 * }} props
 */
export default function ArchivisteMessage({
  question,
  documents = [],
  loading = false,
  error,
  onLoadDocument,
  t,
}) {
  return (
    <div className="flex flex-col gap-5 py-8">
      <div className="max-w-[85%] self-end rounded-2xl bg-chat-surface-2 px-4 py-3 text-chat-text">
        {question}
      </div>

      {loading ? (
        <div className="min-h-5 max-w-[85%] text-sm italic text-chat-text-muted">
          {t.archivisteSearching}
        </div>
      ) : error ? (
        <div className="max-w-[85%] text-sm text-chat-text">
          {t.errorPrefix}
          {error}
        </div>
      ) : (
        <div className="flex max-w-[85%] flex-col gap-3">
          <div className="text-sm text-chat-text-muted">
            {documents.length > 0 ? t.documentsFound(documents.length) : t.noDocuments}
          </div>
          {documents.map((document) => (
            <ArchivisteDocument
              key={document.name}
              document={document}
              onExpand={() => onLoadDocument(document)}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  )
}
