import { useEffect, useState } from 'react'

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

const INTRO_TEXT = 'Laissez-moi voir ce que je peux faire'
const SEARCH_TEXT = "Je consulte la base documentaire de l'école"
const INTRO_DURATION = 3000
const DOTS = ['.', '..', '...']
const DOT_INTERVAL = 500

/** Toujours affiché en entier à durée fixe, quoi qu'il arrive côté réseau. */
function IntroStep({ onDone }) {
  useEffect(() => {
    const timer = setTimeout(onDone, INTRO_DURATION)
    return () => clearTimeout(timer)
  }, [onDone])

  return <AnimatedText text={INTRO_TEXT} />
}

/** Prend le relai tant que la réponse n'est pas revenue, une fois l'intro terminée. */
function WaitingStep() {
  return <AnimatedText text={SEARCH_TEXT} />
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
 * @param {{ question: string, answer: string, loading?: boolean }} props
 */
export default function Message({ question, answer, loading = false }) {
  const [introDone, setIntroDone] = useState(false)

  return (
    <div className="flex flex-col gap-5 py-8">
      <div className="max-w-[85%] self-end rounded-2xl bg-chat-surface-2 px-4 py-3 text-chat-text">
        {question}
      </div>
      {!introDone ? (
        <IntroStep onDone={() => setIntroDone(true)} />
      ) : loading ? (
        <WaitingStep />
      ) : (
        <div className="max-w-[85%] whitespace-pre-line leading-relaxed text-chat-text">
          {linkify(answer)}
        </div>
      )}
    </div>
  )
}
