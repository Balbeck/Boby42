import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

import { useKeyedResource } from '../../../src/hooks/useKeyedResource'

// The keyed-fetch primitive behind nine /lab call sites. Two properties carry
// the whole thing and neither is visible from the code's shape:
//
//   1. a settled call whose key is stale is DISCARDED — switch period twice
//      quickly and the slower first response must not overwrite the second.
//      The bug it prevents is a dashboard silently showing the wrong window.
//   2. nothing is pre-emptied on a key change — the hook returns null (loading)
//      rather than flashing an empty state between two populated ones.

/** A promise plus its resolve/reject, so a test controls when a call settles. */
function deferred() {
  /** @type {(value?: any) => void} */
  let resolve = () => {}
  /** @type {(reason?: any) => void} */
  let reject = () => {}
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useKeyedResource', () => {
  it('returns null while the first call is in flight', () => {
    const { promise } = deferred()
    const { result } = renderHook(() => useKeyedResource(() => promise, 'k1'))

    expect(result.current).toBeNull()
  })

  it('returns the resolved value', async () => {
    const { result } = renderHook(() => useKeyedResource(async () => ({ rows: [1] }), 'k1'))

    await waitFor(() => expect(result.current).toEqual({ rows: [1] }))
  })

  it("returns 'error' when the call rejects", async () => {
    const { result } = renderHook(() => useKeyedResource(async () => { throw new Error('boom') }, 'k1'))

    await waitFor(() => expect(result.current).toBe('error'))
  })

  it('passes a resolved sentinel straight through — labApi maps its own 401/404', async () => {
    // labApi resolves to null rather than throwing for an expected 401/404, so
    // call sites do `.then((v) => v ?? 'error')`. The hook must not second-guess
    // that.
    const { result } = renderHook(() => useKeyedResource(async () => 'error', 'k1'))

    await waitFor(() => expect(result.current).toBe('error'))
  })

  it('does not fetch at all when the key is falsy', () => {
    const fetcher = vi.fn(async () => 'value')
    const { result } = renderHook(() => useKeyedResource(fetcher, ''))

    expect(fetcher).not.toHaveBeenCalled()
    expect(result.current).toBeNull()
  })

  it('fetches once per key, not once per render', async () => {
    const fetcher = vi.fn(async () => 'value')
    const { result, rerender } = renderHook(({ key }) => useKeyedResource(fetcher, key), {
      initialProps: { key: 'k1' },
    })

    await waitFor(() => expect(result.current).toBe('value'))
    rerender({ key: 'k1' })
    rerender({ key: 'k1' })

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('ignores a fresh inline fetcher — the effect depends on the key alone', async () => {
    // Every call site passes a new arrow each render. Depending on `fetcher`
    // would re-fetch on every keystroke elsewhere in the component.
    let calls = 0
    const { result, rerender } = renderHook(
      ({ key }) => useKeyedResource(async () => { calls += 1; return 'value' }, key),
      { initialProps: { key: 'k1' } },
    )

    await waitFor(() => expect(result.current).toBe('value'))
    rerender({ key: 'k1' })
    rerender({ key: 'k1' })

    expect(calls).toBe(1)
  })

  it('re-fetches when the key changes', async () => {
    const fetcher = vi.fn(async () => 'value')
    const { rerender, result } = renderHook(({ key }) => useKeyedResource(fetcher, key), {
      initialProps: { key: 'k1' },
    })

    await waitFor(() => expect(result.current).toBe('value'))
    rerender({ key: 'k2' })

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  })

  it('returns null between two keys instead of showing the old value', async () => {
    // Not "keep the stale value" and not "flash empty": null means loading, and
    // the panels render a spinner rather than a wrong number or a blank.
    const first = deferred()
    const second = deferred()
    let next = first.promise

    const { result, rerender } = renderHook(({ key }) => useKeyedResource(() => next, key), {
      initialProps: { key: 'k1' },
    })

    await act(async () => {
      first.resolve('one')
      await first.promise
    })
    expect(result.current).toBe('one')

    next = second.promise
    rerender({ key: 'k2' })
    expect(result.current).toBeNull()
  })

  it('discards a stale response that settles after the key moved on', async () => {
    // The race this hook exists for: click 7d then 30d quickly, 7d answers
    // last. Without the key check the dashboard shows 7 days of data under a
    // "30d" selection, with nothing on screen saying so.
    const slow = deferred()
    const fast = deferred()
    let next = slow.promise

    const { result, rerender } = renderHook(({ key }) => useKeyedResource(() => next, key), {
      initialProps: { key: '7' },
    })

    next = fast.promise
    rerender({ key: '30' })

    await act(async () => {
      fast.resolve('thirty')
      await fast.promise
    })
    expect(result.current).toBe('thirty')

    await act(async () => {
      slow.resolve('seven')
      await slow.promise
    })
    expect(result.current).toBe('thirty')
  })

  it('discards a stale rejection too', async () => {
    const slow = deferred()
    const fast = deferred()
    let next = slow.promise

    const { result, rerender } = renderHook(({ key }) => useKeyedResource(() => next, key), {
      initialProps: { key: '7' },
    })

    next = fast.promise
    rerender({ key: '30' })
    await act(async () => {
      fast.resolve('thirty')
      await fast.promise
    })

    await act(async () => {
      slow.reject(new Error('boom'))
      await slow.promise.catch(() => {})
    })
    expect(result.current).toBe('thirty')
  })

  it('ignores a response that settles after unmount', async () => {
    const pending = deferred()
    const { unmount } = renderHook(() => useKeyedResource(() => pending.promise, 'k1'))

    unmount()
    await act(async () => {
      pending.resolve('value')
      await pending.promise
    })
    // No "setState on an unmounted component" — the cancelled flag covers it.
  })

  it('returns null again when the key becomes falsy', async () => {
    const { result, rerender } = renderHook(({ key }) => useKeyedResource(async () => 'value', key), {
      initialProps: { key: 'k1' },
    })

    await waitFor(() => expect(result.current).toBe('value'))
    rerender({ key: '' })

    expect(result.current).toBeNull()
  })
})
