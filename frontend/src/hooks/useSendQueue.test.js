import { cleanup, renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { useSendQueue } from './useSendQueue.js'

afterEach(cleanup)

/**
 * A run whose settling this test controls, so the ordering is deterministic
 * rather than dependent on microtask timing.
 *
 * @returns {{ run: () => Promise<void>, started: () => boolean, settle: () => Promise<void>, fail: () => Promise<void> }}
 */
function deferredRun() {
  let started = false
  /** @type {() => void} */
  let resolve
  /** @type {(err: Error) => void} */
  let reject
  /** @type {Promise<void>} */
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })

  return {
    run: () => {
      started = true
      return promise
    },
    started: () => started,
    // `act` + `await` so the queue's `.finally` handler and the `setDepth` it
    // performs are both flushed before the assertion that follows.
    settle: async () => {
      await act(async () => {
        resolve()
        await promise
      })
    },
    fail: async () => {
      await act(async () => {
        reject(new Error('generation failed'))
        await promise.catch(() => {})
      })
    },
  }
}

describe('useSendQueue', () => {
  it('starts the first run immediately', () => {
    const { result } = renderHook(() => useSendQueue())
    const a = deferredRun()

    expect(result.current.isBusy()).toBe(false)

    act(() => {
      expect(result.current.enqueue(a.run)).toBe(true)
    })

    expect(a.started()).toBe(true)
    expect(result.current.isBusy()).toBe(true)
    expect(result.current.isFull()).toBe(false)
    expect(result.current.depth).toBe(1)
  })

  it('accepts a second run, holds it, and refuses a third', () => {
    const { result } = renderHook(() => useSendQueue())
    const a = deferredRun()
    const b = deferredRun()
    const c = deferredRun()

    act(() => {
      result.current.enqueue(a.run)
      expect(result.current.enqueue(b.run)).toBe(true)
    })

    expect(b.started()).toBe(false)
    expect(result.current.isFull()).toBe(true)
    expect(result.current.depth).toBe(2)

    act(() => {
      expect(result.current.enqueue(c.run)).toBe(false)
    })

    expect(c.started()).toBe(false)
    expect(result.current.depth).toBe(2)
  })

  it('starts the waiting run when the first one settles', async () => {
    const { result } = renderHook(() => useSendQueue())
    const a = deferredRun()
    const b = deferredRun()

    act(() => {
      result.current.enqueue(a.run)
      result.current.enqueue(b.run)
    })
    expect(b.started()).toBe(false)

    await a.settle()

    expect(b.started()).toBe(true)
    expect(result.current.isBusy()).toBe(true)
    expect(result.current.depth).toBe(1)

    await b.settle()

    expect(result.current.isBusy()).toBe(false)
    expect(result.current.depth).toBe(0)
  })

  it('starts the waiting run even when the first one rejects', async () => {
    // Both hooks write their own failure onto their exchange; a rejected send
    // must still hand the queue over, or the second question never leaves.
    const { result } = renderHook(() => useSendQueue())
    const a = deferredRun()
    const b = deferredRun()

    act(() => {
      result.current.enqueue(a.run)
      result.current.enqueue(b.run)
    })

    await a.fail()

    expect(b.started()).toBe(true)
    expect(result.current.depth).toBe(1)
  })

  it('does not resurrect the waiting run when the aborted one settles after clear()', async () => {
    // The stop button drops the waiting question, but the aborted run still
    // settles a moment later — without the generation counter its completion
    // handler would promote exactly the question the stop was meant to drop.
    const { result } = renderHook(() => useSendQueue())
    const a = deferredRun()
    const b = deferredRun()

    act(() => {
      result.current.enqueue(a.run)
      result.current.enqueue(b.run)
    })

    act(() => {
      result.current.clear()
    })

    expect(result.current.isBusy()).toBe(false)
    expect(result.current.isFull()).toBe(false)
    expect(result.current.depth).toBe(0)

    await a.settle()

    expect(b.started()).toBe(false)
    expect(result.current.isBusy()).toBe(false)
    expect(result.current.depth).toBe(0)
  })

  it('takes a fresh run right after clear(), even before the aborted one settles', async () => {
    const { result } = renderHook(() => useSendQueue())
    const a = deferredRun()
    const next = deferredRun()

    act(() => {
      result.current.enqueue(a.run)
      result.current.clear()
      expect(result.current.enqueue(next.run)).toBe(true)
    })

    expect(next.started()).toBe(true)
    expect(result.current.depth).toBe(1)

    // The abandoned run settling must not disturb the new one.
    await a.settle()

    expect(result.current.isBusy()).toBe(true)
    expect(result.current.depth).toBe(1)
  })
})
