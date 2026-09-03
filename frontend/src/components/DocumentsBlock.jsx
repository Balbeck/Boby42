import ArchivisteDocument from './ArchivisteDocument'

/**
 * The source documents found for a question: the two `label · count` lines, an
 * optional empty-state message, then the collapsible rows — `md` first, `pdf`
 * after. Shared verbatim by `/chat` (`Message.jsx`) and `/archiviste`
 * (`ArchivisteMessage.jsx`); only the wrapper differed between the two copies.
 *
 * `className` is passed whole by the caller and **replaces** the container's
 * classes entirely (so `/chat` keeps its `.fade-in`). `emptyMessage` renders
 * only when it is given and `documents` is empty. `children` is an extra slot
 * after the rows — `/archiviste` puts its feedback buttons there, `/chat`
 * renders them elsewhere.
 *
 * @param {{
 *   documents: import('../types/types.js').ArchivisteDocument[],
 *   onToggleDocument: (doc: import('../types/types.js').ArchivisteDocument) => void,
 *   t: import('../types/types.js').Messages,
 *   className: string,
 *   emptyMessage?: string,
 *   children?: import('react').ReactNode,
 * }} props
 */
export default function DocumentsBlock({
  documents,
  onToggleDocument,
  t,
  className,
  emptyMessage,
  children,
}) {
  const mdDocs = documents.filter((doc) => doc.type !== 'pdf')
  const pdfDocs = documents.filter((doc) => doc.type === 'pdf')

  return (
    <div className={className}>
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
      {documents.length === 0 && emptyMessage && (
        <p className="text-xs italic text-chat-text-muted">{emptyMessage}</p>
      )}
      {[...mdDocs, ...pdfDocs].map((doc) => (
        <ArchivisteDocument
          key={`${doc.type}:${doc.name}`}
          doc={doc}
          onToggle={() => onToggleDocument(doc)}
          t={t}
        />
      ))}
      {children}
    </div>
  )
}
