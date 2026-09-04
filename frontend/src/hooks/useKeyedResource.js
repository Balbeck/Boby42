import { useEffect, useRef, useState } from 'react'

/**
 * The keyed-fetch pattern the `/lab` components hand-rolled a dozen times: run
 * `fetcher()` whenever `key` changes, ignore a call whose `key` is no longer
 * current by the time it settles, and expose exactly three states through one
 * value.
 *
 * Semantics, unchanged from the copies it replaces:
 * - `null` — the current key's call is in flight (or `key` is falsy). Nothing is
 *   pre-emptied, so a key change never flashes an empty state before the new
 *   data lands.
 * - `'error'` — the call rejected. `labApi` resolves to `null` (not a throw) for
 *   an expected 401/404 on `/lab`, so a call site that wants to surface those as
 *   an error maps them itself (`.then((v) => v ?? 'error')`), exactly as the
 *   hand-written `v ?? 'error'` did.
 * - anything else — the value the current key's call resolved to.
 *
 * No retry, no cache, no refetch-on-focus: this hook is the single place those
 * could be added later without touching a call site.
 *
 * `fetcher` is read through a ref, so the effect depends on `key` alone — a call
 * site may pass a fresh inline arrow every render (as they all do) without
 * re-running the fetch.
 *
 * @template T
 * @param {() => Promise<T | 'error'>} fetcher invoked with no arguments on every key change
 * @param {string} key falsy skips the fetch and yields `null`
 * @returns {T | 'error' | null}
 */
export function useKeyedResource(fetcher, key) {
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  const [state, setState] = useState(
    /** @type {{ key: string, value: T | 'error' } | null} */ (null),
  )

  useEffect(() => {
    if (!key) return undefined
    let cancelled = false
    fetcherRef.current().then(
      (value) => {
        if (!cancelled) setState({ key, value })
      },
      () => {
        if (!cancelled) setState({ key, value: 'error' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [key])

  return state && state.key === key ? state.value : null
}
