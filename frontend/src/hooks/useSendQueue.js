import { useCallback, useRef, useState } from 'react'

/**
 * A one-deep, strictly **sequential** run queue: one run in flight plus at most
 * one waiting. A third `enqueue` is refused.
 *
 * Generic on purpose — no JSX, no network, no knowledge of either page. Both
 * `useChat` and `useArchiviste` keep their own whole `sendQuestion` (their
 * retrieval pipelines differ) and only call into this primitive.
 *
 * **Why sequential rather than concurrent**: two `sendQuestion`s running at once
 * both leave with `conversationIdRef.current === null`, so the backend creates
 * **two separate conversations** and whichever response lands second overwrites
 * the id — the thread breaks at the data level, not just visually. On top of
 * that, two simultaneous generations against one Ollama are slower than the same
 * two run one after the other.
 *
 * **Why depth 2**: with a ~100 s generation, a third question would be answered
 * five minutes later, long after the user has forgotten asking it.
 *
 * @returns {{
 *   depth: number,
 *   isBusy: () => boolean,
 *   isFull: () => boolean,
 *   enqueue: (run: () => Promise<void>) => boolean,
 *   clear: () => void,
 * }}
 */
export function useSendQueue() {
  // The queue itself lives in refs (read synchronously inside `sendQuestion`,
  // before any re-render); `depth` is the state mirror the UI renders from —
  // 0 idle, 1 running, 2 running plus one waiting.
  const [depth, setDepth] = useState(0)
  const runningRef = useRef(false)
  const waitingRef = useRef(/** @type {(() => Promise<void>) | null} */ (null))
  // Bumped by `clear()`. A run that was aborted still settles a moment later;
  // without this counter its completion handler would promote the waiting
  // question that the stop button was supposed to drop.
  const generationRef = useRef(0)

  /** Is a run in flight? */
  const isBusy = useCallback(() => runningRef.current, [])

  /** Is a run in flight **and** one already waiting? */
  const isFull = useCallback(() => runningRef.current && waitingRef.current !== null, [])

  const start = useCallback(
    /**
     * Named function expression so it can promote the next run by calling
     * itself, without a ref dance.
     *
     * @param {() => Promise<void>} run
     */
    function start(run) {
      runningRef.current = true
      setDepth(waitingRef.current ? 2 : 1)
      const generation = generationRef.current

      run()
        .catch(() => {
          // The run owns its own error handling (both hooks write the failure
          // onto their exchange). Swallowed here only so a rejection can't
          // surface as an unhandled promise rejection.
        })
        .finally(() => {
          if (generation !== generationRef.current) return
          const next = waitingRef.current
          waitingRef.current = null
          if (next) {
            start(next)
          } else {
            runningRef.current = false
            setDepth(0)
          }
        })
    },
    [],
  )

  /**
   * Start `run` if nothing is in flight, else keep it as the waiting one.
   *
   * @param {() => Promise<void>} run
   * @returns {boolean} `false` when the queue was already full (nothing taken)
   */
  const enqueue = useCallback(
    (/** @type {() => Promise<void>} */ run) => {
      if (!runningRef.current) {
        start(run)
        return true
      }
      if (!waitingRef.current) {
        waitingRef.current = run
        setDepth(2)
        return true
      }
      return false
    },
    [start],
  )

  /**
   * Drop the waiting run and mark nothing in flight — a stop is a stop. The
   * generation bump is what keeps the in-flight run, when it finally settles,
   * from resurrecting the question this call just dropped.
   */
  const clear = useCallback(() => {
    generationRef.current += 1
    waitingRef.current = null
    runningRef.current = false
    setDepth(0)
  }, [])

  return { depth, isBusy, isFull, enqueue, clear }
}
