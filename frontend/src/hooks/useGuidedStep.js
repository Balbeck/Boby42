import { useEffect, useRef, useState } from 'react'

// Minimum time each step stays on screen once entered, so the intro → searching
// → reading → answer sequence looks the same whether generation takes ~100 s
// (md context) or ~9 s (pdf-only: the prompt carries no document text). Without
// it a fast answer makes the documents and the answer land together and the
// "reading" step is never seen.
// `queued` is 0: an exchange waiting behind another must leave the step the
// instant its own run starts, with no minimum on-screen time.
export const STEP_DURATIONS = { queued: 0, intro: 3000, searching: 1000, reading: 3000 }

/** @typedef {'queued' | 'intro' | 'searching' | 'reading' | 'done' | 'error'} GuidedStep */

/** @type {GuidedStep[]} */
export const FULL_ORDER = ['queued', 'intro', 'searching', 'reading', 'done']
/** @type {GuidedStep[]} */
export const NO_DOCUMENTS_ORDER = ['queued', 'intro', 'searching', 'done']

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
 * Lives in `hooks/` rather than in `Message.jsx` (F10) so a test can import it:
 * exporting a hook from a component file trips `react-refresh/only-export-components`.
 *
 * @param {'queued' | 'retrieving' | 'reading' | 'done' | 'error'} phase
 * @param {boolean} hasDocuments
 * @returns {GuidedStep}
 */
export function useGuidedStep(phase, hasDocuments) {
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
