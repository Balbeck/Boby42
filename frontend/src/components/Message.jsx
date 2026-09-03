import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import ArchivisteDocument from './ArchivisteDocument'
import FeedbackButtons from './FeedbackButtons'

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

// Minimum time each step stays on screen once entered, so the intro → searching
// → reading → answer sequence looks the same whether generation takes ~100 s
// (md context) or ~9 s (pdf-only: the prompt carries no document text). Without
// it a fast answer makes the documents and the answer land together and the
// "reading" step is never seen.
// `queued` is 0: an exchange waiting behind another must leave the step the
// instant its own run starts, with no minimum on-screen time.
const STEP_DURATIONS = { queued: 0, intro: 3000, searching: 1000, reading: 3000 }

/** @typedef {'queued' | 'intro' | 'searching' | 'reading' | 'done' | 'error'} GuidedStep */

/** @type {GuidedStep[]} */
const FULL_ORDER = ['queued', 'intro', 'searching', 'reading', 'done']
/** @type {GuidedStep[]} */
const NO_DOCUMENTS_ORDER = ['queued', 'intro', 'searching', 'done']

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
 * The source documents found for this question — the same count lines and
 * collapsible rows as `/archiviste`, shown before (and kept above) the answer.
 *
 * @param {{
 *   documents: import('../types/types.js').ArchivisteDocument[],
 *   onToggleDocument: (doc: import('../types/types.js').ArchivisteDocument) => void,
 *   t: import('../types/types.js').Messages,
 * }} props
 */
function DocumentsBlock({ documents, onToggleDocument, t }) {
  const mdDocs = documents.filter((doc) => doc.type !== 'pdf')
  const pdfDocs = documents.filter((doc) => doc.type === 'pdf')

  return (
    <div className="fade-in flex flex-col gap-3">
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
          onToggle={() => onToggleDocument(doc)}
          t={t}
        />
      ))}
    </div>
  )
}

/**
 * Drives the message through `queued → intro → searching → reading → done` as a
 * forward-only sequence. `phase` says how far the backend has got; the step
 * never skips ahead and never leaves a step before its minimum on-screen time
 * (counted from when it was entered, so a slow generation adds no extra wait).
 * With no documents found the `reading` step is dropped — nothing to read.
 * `queued` (F5) heads both orders and only ever shows for an exchange the send
 * queue is holding back; its minimum duration is 0, so it is left the instant
 * the phase moves to `retrieving`.
 *
 * @param {'queued' | 'retrieving' | 'reading' | 'done' | 'error'} phase
 * @param {boolean} hasDocuments
 * @returns {GuidedStep}
 */
function useGuidedStep(phase, hasDocuments) {
  const order = hasDocuments ? FULL_ORDER : NO_DOCUMENTS_ORDER

  const target =
    phase === 'queued' ? 'queued'
      : phase === 'error' ? 'error'
        : phase === 'done' ? 'done'
          : phase === 'reading' && hasDocuments ? 'reading'
            : 'searching'

  // Mount at the step matching the phase we're handed, so an exchange revisited
  // after a tab switch (already 'done' / 'error', or mid-generation 'reading')
  // shows its state at once instead of replaying intro → searching → reading.
  // Only a fresh 'retrieving' exchange starts the animated sequence.
  const [step, setStep] = useState(
    /** @returns {GuidedStep} */
    () =>
      phase === 'queued' ? 'queued'
        : phase === 'done' ? 'done'
          : phase === 'error' ? 'error'
            : phase === 'reading' && hasDocuments ? 'reading'
              : 'intro',
  )
  // Wall-clock time the current step was entered. Set from an effect (never
  // during render) so the minimum-duration maths below is measured from entry.
  const enteredAt = useRef(0)

  useEffect(() => {
    enteredAt.current = Date.now()
  }, [step])

  useEffect(() => {
    if (step === 'error' || step === target) return

    // The stream has started — show the answer now, don't sit through the
    // remaining minimum step durations.
    if (target === 'done') {
      const timer = setTimeout(() => setStep('done'), 0)
      return () => clearTimeout(timer)
    }

    if (target === 'error') {
      // let the intro play its fixed beat, then jump straight to the error
      const wait = step === 'intro'
        ? Math.max(0, STEP_DURATIONS.intro - (Date.now() - enteredAt.current))
        : 0
      const timer = setTimeout(() => setStep('error'), wait)
      return () => clearTimeout(timer)
    }

    const fromIdx = order.indexOf(step)
    const toIdx = order.indexOf(target)
    if (toIdx <= fromIdx) return

    // `step` is neither 'done' nor 'error' here (both return above), so it is
    // always one of STEP_DURATIONS' keys — asserted, no runtime branch added.
    const minimum = STEP_DURATIONS[/** @type {keyof typeof STEP_DURATIONS} */ (step)]
    const wait = Math.max(0, minimum - (Date.now() - enteredAt.current))
    const timer = setTimeout(() => setStep(order[fromIdx + 1]), wait)
    return () => clearTimeout(timer)
  }, [step, target, order])

  return step
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
          <DocumentsBlock documents={documents} onToggleDocument={onToggleDocument} t={t} />
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
