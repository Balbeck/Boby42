import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import DocumentsBlock from './DocumentsBlock'
import FeedbackButtons from './FeedbackButtons'
import { useGuidedStep } from '../hooks/useGuidedStep'

/**
 * Markdown collapses single newlines into one paragraph, but a chat answer uses
 * them as line breaks. Turn every single newline into a hard break (two trailing
 * spaces). No lookbehind regex — `(?<!\n)` is a parse-time syntax error on
 * Safari < 16.4 and blanks the whole bundle.
 *
 * @param {string} text
 * @returns {string}
 */
const withHardBreaks = (text) =>
  text.split('\n\n').map((block) => block.split('\n').join('  \n')).join('\n\n')

/**
 * Custom `a` renderer: `remark-gfm` turns a bare URL into an autolink whose text
 * equals its href — those keep today's `42Doc` label; real markdown links keep
 * their own text.
 *
 * @param {{ href?: string, children?: import('react').ReactNode }} props
 */
function MarkdownLink({ href, children }) {
  const text = Array.isArray(children) ? children.join('') : children
  const label = typeof text === 'string' && text === href ? '42Doc' : children
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-chat-green underline hover:no-underline"
    >
      {label}
    </a>
  )
}

const DOTS = ['.', '..', '...']
const DOT_INTERVAL = 500

/** @param {{ text: string }} props */
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
 * @param {{
 *   question: string,
 *   answer: string,
 *   documents?: import('../types/types.js').ArchivisteDocument[],
 *   phase?: 'queued' | 'retrieving' | 'reading' | 'done' | 'error',
 *   error?: string,
 *   messageId?: string | null,
 *   rating?: -1 | 0 | 1,
 *   onRate?: (rating: -1 | 0 | 1, comment?: string) => void,
 *   onToggleDocument: (doc: import('../types/types.js').ArchivisteDocument) => void,
 *   t: import('../types/types.js').Messages,
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
  onToggleDocument,
  t,
}) {
  const step = useGuidedStep(phase, documents.length > 0)
  const showDocuments = (step === 'reading' || step === 'done') && documents.length > 0

  return (
    <div className="flex flex-col gap-5 py-8">
      <div className="max-w-[85%] self-end rounded-2xl bg-chat-surface-2 px-4 py-3 text-chat-text">
        {question}
      </div>
      <div className="flex max-w-[85%] flex-col gap-5">
        {/* Statique, sans points animés : les points d'`AnimatedText` disent
            « il se passe quelque chose » — ici, rien n'a encore commencé. */}
        {step === 'queued' && (
          <div className="min-h-5 max-w-[85%] text-sm italic text-chat-text-muted">
            {t.chatQueued}
          </div>
        )}
        {step === 'intro' && <AnimatedText text={t.intro} />}
        {step === 'searching' && <AnimatedText text={t.searching} />}

        {showDocuments && (
          <DocumentsBlock
            documents={documents}
            onToggleDocument={onToggleDocument}
            t={t}
            className="fade-in flex flex-col gap-3"
          />
        )}

        {step === 'reading' && <AnimatedText text={t.chatReading} />}

        {step === 'error' && (
          <div className="leading-relaxed text-chat-text">
            {t.errorPrefix}
            {error}
          </div>
        )}

        {step === 'done' && (
          <div className="fade-in flex flex-col">
            <div className="prose prose-invert prose-sm max-w-none prose-a:text-chat-green">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: MarkdownLink }}>
                {withHardBreaks(answer)}
              </ReactMarkdown>
            </div>
            {messageId && onRate && (
              <FeedbackButtons rating={rating} onRate={onRate} t={t} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
