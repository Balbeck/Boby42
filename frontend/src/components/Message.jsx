import { useEffect, useState } from 'react'
import ArchivisteDocument from './ArchivisteDocument'
import FeedbackButtons from './FeedbackButtons'

const URL_REGEX = /(https?:\/\/[^\s]+)/g

/**
 * Splits text on URLs and turns them into clickable links.
 *
 * @param {string} text
 * @returns {(string | import('react').ReactNode)[]}
 */
function linkify(text) {
  return text.split(URL_REGEX).map((part, index) =>
    index % 2 === 1 ? (
      <a
        key={index}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="text-chat-green underline hover:no-underline"
      >
        42Doc
      </a>
    ) : (
      part
    ),
  )
}

const INTRO_DURATION = 3000
const DOTS = ['.', '..', '...']
const DOT_INTERVAL = 500

/** Toujours affiché en entier à durée fixe, quoi qu'il arrive côté réseau. */
function IntroStep({ text, onDone }) {
  useEffect(() => {
    const timer = setTimeout(onDone, INTRO_DURATION)
    return () => clearTimeout(timer)
  }, [onDone])

  return <AnimatedText text={text} />
}

function AnimatedText({ text }) {
  const [dotIndex, setDotIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setDotIndex((i) => (i + 1) % DOTS.length), DOT_INTERVAL)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="min-h-5 max-w-[85%] text-sm italic text-chat-text-muted">
      {text}
      {DOTS[dotIndex]}
    </div>
  )
}

/**
 * The source documents found for this question — the same count lines and
 * collapsible rows as `/archiviste`, shown before (and kept above) the answer.
 *
 * @param {{
 *   documents: import('../types/types.js').ArchivisteDocument[],
 *   onLoadDocument: (doc: import('../types/types.js').ArchivisteDocument) => void,
 *   t: object,
 * }} props
 */
function DocumentsBlock({ documents, onLoadDocument, t }) {
  const mdDocs = documents.filter((doc) => doc.type !== 'pdf')
  const pdfDocs = documents.filter((doc) => doc.type === 'pdf')

  return (
    <div className="flex flex-col gap-3">
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
      {[...mdDocs, ...pdfDocs].map((doc) => (
        <ArchivisteDocument
          key={`${doc.type}:${doc.name}`}
          document={doc}
          onExpand={() => onLoadDocument(doc)}
          t={t}
        />
      ))}
    </div>
  )
}

/**
 * @param {{
 *   question: string,
 *   answer: string,
 *   documents?: import('../types/types.js').ArchivisteDocument[],
 *   phase?: 'retrieving' | 'reading' | 'done' | 'error',
 *   error?: string,
 *   messageId?: string | null,
 *   rating?: -1 | 0 | 1,
 *   onRate?: (rating: -1 | 0 | 1, comment?: string) => void,
 *   onLoadDocument?: (doc: import('../types/types.js').ArchivisteDocument) => void,
 *   t: object,
 * }} props
 */
export default function Message({
  question,
  answer,
  documents = [],
  phase = 'retrieving',
  error,
  messageId,
  rating = 0,
  onRate,
  onLoadDocument,
  t,
}) {
  const [introDone, setIntroDone] = useState(false)

  const showDocuments = phase === 'reading' || phase === 'done'

  return (
    <div className="flex flex-col gap-5 py-8">
      <div className="max-w-[85%] self-end rounded-2xl bg-chat-surface-2 px-4 py-3 text-chat-text">
        {question}
      </div>
      {!introDone ? (
        <IntroStep text={t.intro} onDone={() => setIntroDone(true)} />
      ) : (
        <div className="flex max-w-[85%] flex-col gap-5">
          {phase === 'retrieving' && <AnimatedText text={t.searching} />}

          {showDocuments && (
            <DocumentsBlock documents={documents} onLoadDocument={onLoadDocument} t={t} />
          )}

          {phase === 'reading' && <AnimatedText text={t.chatReading} />}

          {phase === 'error' && (
            <div className="leading-relaxed text-chat-text">
              {t.errorPrefix}
              {error}
            </div>
          )}

          {phase === 'done' && (
            <div className="flex flex-col">
              <div className="whitespace-pre-line leading-relaxed text-chat-text">
                {linkify(answer)}
              </div>
              {messageId && onRate && (
                <FeedbackButtons rating={rating} onRate={onRate} t={t} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
