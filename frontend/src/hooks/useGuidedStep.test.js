import { cleanup, renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STEP_DURATIONS, useGuidedStep } from './useGuidedStep.js'

// The machine measures each step's minimum on-screen time with `Date.now()` and
// leaves it with a `setTimeout`. Faking timers alone would leave `Date.now()`
// on the real clock and the maths would never elapse — vitest's fake timers
// mock `Date` too, which is exactly what this needs.
beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** Advance the fake clock inside `act`, so the resulting re-render is flushed. */
function tick(ms = 0) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

/**
 * @param {'queued' | 'retrieving' | 'reading' | 'done' | 'error'} phase
 * @param {boolean} hasDocuments
 */
function render(phase, hasDocuments) {
  return renderHook(
    (/** @type {{ phase: any, hasDocuments: boolean }} */ props) =>
      useGuidedStep(props.phase, props.hasDocuments),
    { initialProps: { phase, hasDocuments } },
  )
}

describe('useGuidedStep', () => {
  it('starts a fresh retrieving exchange at intro and holds it for the minimum', () => {
    const { result } = render('retrieving', true)

    expect(result.current).toBe('intro')

    tick(STEP_DURATIONS.intro - 1)
    expect(result.current).toBe('intro')

    tick(1)
    expect(result.current).toBe('searching')
  })

  it('walks intro → searching → reading in order, one phase at a time', () => {
    const { result, rerender } = render('retrieving', true)

    expect(result.current).toBe('intro')

    tick(STEP_DURATIONS.intro)
    expect(result.current).toBe('searching')

    // 'searching' is the target while the backend is still retrieving: the step
    // waits there however long that takes, it does not run ahead to 'reading'.
    tick(STEP_DURATIONS.searching * 10)
    expect(result.current).toBe('searching')

    rerender({ phase: 'reading', hasDocuments: true })
    tick(STEP_DURATIONS.searching)
    expect(result.current).toBe('reading')
  })

  it('never walks backwards when the phase regresses', () => {
    const { result, rerender } = render('retrieving', true)

    tick(STEP_DURATIONS.intro)
    rerender({ phase: 'reading', hasDocuments: true })
    tick(STEP_DURATIONS.searching)
    expect(result.current).toBe('reading')

    rerender({ phase: 'retrieving', hasDocuments: true })
    tick(STEP_DURATIONS.reading * 5)
    expect(result.current).toBe('reading')
  })

  it('jumps straight to done when the stream starts, without waiting out the minimum', () => {
    const { result, rerender } = render('retrieving', true)

    // Still inside intro's 3 s floor — the first token must not sit behind it.
    tick(500)
    expect(result.current).toBe('intro')

    rerender({ phase: 'done', hasDocuments: true })
    tick()
    expect(result.current).toBe('done')
  })

  it('jumps to done from reading too, skipping the rest of reading’s minimum', () => {
    const { result, rerender } = render('reading', true)

    expect(result.current).toBe('reading')

    rerender({ phase: 'done', hasDocuments: true })
    tick()
    expect(result.current).toBe('done')
  })

  it('mounts an already-finished exchange at done, with no replay', () => {
    // A page switch re-mounts every Message; a finished one must not replay
    // intro → searching → reading before showing the answer it already has.
    const { result } = render('done', true)

    expect(result.current).toBe('done')

    tick(STEP_DURATIONS.intro + STEP_DURATIONS.searching + STEP_DURATIONS.reading)
    expect(result.current).toBe('done')
  })

  it('skips the reading step entirely when no document was found', () => {
    const { result, rerender } = render('retrieving', false)

    expect(result.current).toBe('intro')

    tick(STEP_DURATIONS.intro)
    expect(result.current).toBe('searching')

    // The backend reports 'reading', but with nothing to read the step stays put.
    rerender({ phase: 'reading', hasDocuments: false })
    tick(STEP_DURATIONS.searching + STEP_DURATIONS.reading)
    expect(result.current).toBe('searching')

    rerender({ phase: 'done', hasDocuments: false })
    tick()
    expect(result.current).toBe('done')
  })

  it('starts a queued exchange at queued and leaves it the instant its run starts', () => {
    const { result, rerender } = render('queued', true)

    expect(result.current).toBe('queued')

    tick(STEP_DURATIONS.intro * 2)
    expect(result.current).toBe('queued')

    rerender({ phase: 'retrieving', hasDocuments: true })
    tick(STEP_DURATIONS.queued)
    expect(result.current).toBe('intro')
  })
})

// ── The error path (F11) ────────────────────────────────────────────────────
// Not covered before, and it is the one branch with a deliberate *delay* rather
// than a jump: a failure during the intro still lets the intro finish its beat,
// so a 502 that comes back in 200 ms doesn't flash the animation and blow it
// away in the same frame. Every other transition into `error` is immediate.
describe('reaching the error step', () => {
  it('lets the intro finish its beat before showing the error', () => {
    const { result, rerender } = render('retrieving', true)
    expect(result.current).toBe('intro')

    // The failure arrives 500 ms in — the intro keeps the remaining 2.5 s.
    tick(500)
    rerender({ phase: 'error', hasDocuments: true })

    tick(STEP_DURATIONS.intro - 500 - 1)
    expect(result.current).toBe('intro')

    tick(1)
    expect(result.current).toBe('error')
  })

  it('does not add any wait when the intro is already over', () => {
    const { result, rerender } = render('retrieving', true)
    tick(STEP_DURATIONS.intro)
    expect(result.current).toBe('searching')

    rerender({ phase: 'error', hasDocuments: true })
    tick()
    expect(result.current).toBe('error')
  })

  it('mounts straight at error for an exchange revisited after a failure', () => {
    // A page switch and back must not replay the animation over a dead
    // exchange.
    const { result } = render('error', true)
    expect(result.current).toBe('error')
  })

  it('never leaves error, even if a later phase says otherwise', () => {
    // The machine is forward-only and `error` is terminal — a stale phase
    // update must not resurrect the beats under an error message.
    const { result, rerender } = render('error', true)

    rerender({ phase: 'done', hasDocuments: true })
    tick(STEP_DURATIONS.intro * 2)
    expect(result.current).toBe('error')
  })

  it('goes to error from reading with no extra delay', () => {
    const { result, rerender } = render('retrieving', true)
    tick(STEP_DURATIONS.intro)
    rerender({ phase: 'reading', hasDocuments: true })
    tick(STEP_DURATIONS.searching)
    expect(result.current).toBe('reading')

    rerender({ phase: 'error', hasDocuments: true })
    tick()
    expect(result.current).toBe('error')
  })
})
