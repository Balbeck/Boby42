/**
 * Minimal display for the archiviste page: question, raw answer, and one
 * block per source showing its raw markdown content. No markdown rendering
 * yet — that's the next step, once the plumbing is confirmed end-to-end.
 *
 * @param {{ question: string, answer: string, sources?: import('../types/types.js').Source[], loading?: boolean }} props
 */
export default function ArchivisteMessage({ question, answer, sources = [], loading = false }) {
  return (
    <div className="flex flex-col gap-5 py-8">
      <div className="max-w-[85%] self-end rounded-2xl bg-chat-surface-2 px-4 py-3 text-chat-text">
        {question}
      </div>

      {loading ? (
        <div className="min-h-5 max-w-[85%] text-sm italic text-chat-text-muted">
          Je consulte la base documentaire de l'école...
        </div>
      ) : (
        <div className="flex max-w-[85%] flex-col gap-4">
          <div className="whitespace-pre-line leading-relaxed text-chat-text">{answer}</div>

          {sources.map((source) => (
            <div
              key={source.path}
              className="rounded-xl border border-chat-border bg-chat-surface p-4"
            >
              <div className="mb-2 text-sm font-medium text-chat-text-muted">{source.name}</div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-sans text-sm text-chat-text">
                {source.content}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
