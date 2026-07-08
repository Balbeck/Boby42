import { useEffect, useState } from 'react'

const PHRASE_1 = 'Laissez-moi voir ce que je peux faire'
const PHRASE_2 = "Je consulte la base documentaire de l'école"
const DOTS = ['.', '..', '...']
const STEP_DELAY = 500

function textForStep(step) {
  if (step < 6) return PHRASE_1 + DOTS[step % 3]
  if (step === 6) return ''
  return PHRASE_2 + DOTS[(step - 7) % 3]
}

function LoadingIndicator() {
  const [step, setStep] = useState(0)

  useEffect(() => {
    const timer = setTimeout(() => setStep((s) => s + 1), STEP_DELAY)
    return () => clearTimeout(timer)
  }, [step])

  return (
    <div className="min-h-5 max-w-[85%] text-sm italic text-chat-text-muted">
      {textForStep(step)}
    </div>
  )
}

/**
 * @param {{ question: string, answer: string, loading?: boolean }} props
 */
export default function Message({ question, answer, loading = false }) {
  return (
    <div className="flex flex-col gap-5 py-8">
      <div className="max-w-[85%] self-end rounded-2xl bg-chat-surface-2 px-4 py-3 text-chat-text">
        {question}
      </div>
      {loading ? (
        <LoadingIndicator />
      ) : (
        <div className="max-w-[85%] whitespace-pre-line leading-relaxed text-chat-text">
          {answer}
        </div>
      )}
    </div>
  )
}
