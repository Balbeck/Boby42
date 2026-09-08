import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, render, screen } from '@testing-library/react'

// i18n.js is a module-scoped store, not a React context — so it is read at
// import time and cached. Every test that cares about the initial value has to
// reload the module, which is why `loadI18n` exists rather than a plain import.
//
// The two properties worth pinning: the cache (`getLanguage` is the snapshot
// `useSyncExternalStore` calls on EVERY render of EVERY subscriber, including
// once per streamed token — re-reading localStorage there would be a real cost),
// and that a blocked localStorage degrades instead of blanking the app.

/** Fresh module, with whatever localStorage is currently set up. */
async function loadI18n() {
  vi.resetModules()
  return import('./i18n')
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.lang = ''
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the stored language', () => {
  it('defaults to fr when nothing is stored', async () => {
    const { useLanguage } = await loadI18n()
    const { result } = renderHook(() => useLanguage())

    expect(result.current).toBe('fr')
  })

  it('reads the stored value at import time', async () => {
    localStorage.setItem('language', 'en')
    const { useLanguage } = await loadI18n()
    const { result } = renderHook(() => useLanguage())

    expect(result.current).toBe('en')
  })

  it('falls back to fr when localStorage throws', async () => {
    // Strict private browsing. Without the try/catch the read happens during
    // module evaluation and the whole app fails to boot — a white page.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })

    const { useLanguage } = await loadI18n()
    const { result } = renderHook(() => useLanguage())
    expect(result.current).toBe('fr')
  })
})

describe('setLanguage', () => {
  it('updates every subscribed component at once', async () => {
    // One store, both pages: switching on /archiviste has to be visible on
    // /chat without a reload.
    const { useLanguage, setLanguage } = await loadI18n()
    const a = renderHook(() => useLanguage())
    const b = renderHook(() => useLanguage())

    act(() => setLanguage('en'))

    expect(a.result.current).toBe('en')
    expect(b.result.current).toBe('en')
  })

  it('persists the choice', async () => {
    const { setLanguage } = await loadI18n()
    act(() => setLanguage('en'))

    expect(localStorage.getItem('language')).toBe('en')
  })

  it('keeps working for the session when the write throws', async () => {
    const { useLanguage, setLanguage } = await loadI18n()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    const { result } = renderHook(() => useLanguage())
    act(() => setLanguage('en'))

    expect(result.current).toBe('en')
  })

  it('unsubscribes on unmount, so a stale component is never notified', async () => {
    const { useLanguage, setLanguage } = await loadI18n()
    const { unmount } = renderHook(() => useLanguage())
    unmount()

    expect(() => act(() => setLanguage('en'))).not.toThrow()
  })
})

describe('the document lang attribute', () => {
  it('is set at import time', async () => {
    localStorage.setItem('language', 'en')
    await loadI18n()

    expect(document.documentElement.lang).toBe('en')
  })

  it('follows a switch', async () => {
    const { setLanguage } = await loadI18n()
    act(() => setLanguage('en'))
    expect(document.documentElement.lang).toBe('en')

    act(() => setLanguage('fr'))
    expect(document.documentElement.lang).toBe('fr')
  })

  it('maps `origin` to fr — origin is a document choice, not a UI locale', async () => {
    const { setLanguage } = await loadI18n()
    act(() => setLanguage('origin'))

    expect(document.documentElement.lang).toBe('fr')
  })
})

describe('useMessages', () => {
  it('returns the locale bundle for the current language', async () => {
    const { useMessages, setLanguage, messages } = await loadI18n()
    const { result } = renderHook(() => useMessages())

    expect(result.current).toBe(messages.fr)
    act(() => setLanguage('en'))
    expect(result.current).toBe(messages.en)
  })

  it('falls back to fr for `origin`, which has no bundle of its own', async () => {
    const { useMessages, setLanguage, messages } = await loadI18n()
    const { result } = renderHook(() => useMessages())

    act(() => setLanguage('origin'))
    expect(result.current).toBe(messages.fr)
  })

  it('falls back to fr for a value stored by an older build', async () => {
    localStorage.setItem('language', 'de')
    const { useMessages, messages } = await loadI18n()
    const { result } = renderHook(() => useMessages())

    expect(result.current).toBe(messages.fr)
  })

  it('re-renders a consumer when the language changes', async () => {
    const { useMessages, setLanguage, messages } = await loadI18n()

    // Not every key differs between bundles — `chatGreeting` and
    // `chatDocsNotionLabel` are byte-identical in fr and en, so picking one of
    // those would make this pass without any re-render at all. Guarded, so the
    // day `chatTagline` gets translated to the same string this test says so
    // instead of going quietly useless.
    expect(messages.fr.chatTagline).not.toBe(messages.en.chatTagline)

    function Probe() {
      const t = useMessages()
      return <span data-testid="tagline">{t.chatTagline}</span>
    }
    render(<Probe />)
    expect(screen.getByTestId('tagline').textContent).toBe(messages.fr.chatTagline)

    act(() => setLanguage('en'))
    expect(screen.getByTestId('tagline').textContent).toBe(messages.en.chatTagline)
  })
})

describe('the messages bundles', () => {
  it('exports fr and en with identical key sets', async () => {
    // A key present in one bundle only renders `undefined` in the other — an
    // invisible hole that no render test would catch either.
    const { messages } = await loadI18n()

    expect(Object.keys(messages.fr).sort()).toEqual(Object.keys(messages.en).sort())
  })

  it('has no empty string in either bundle', async () => {
    const { messages } = await loadI18n()

    for (const [locale, bundle] of Object.entries(messages)) {
      for (const [key, value] of Object.entries(bundle)) {
        if (typeof value === 'string') {
          expect(value.length, `${locale}.${key} is empty`).toBeGreaterThan(0)
        }
      }
    }
  })

  it('keeps the function-valued entries callable in both locales', async () => {
    const { messages } = await loadI18n()

    const en = /** @type {Record<string, unknown>} */ (messages.en)
    for (const [key, value] of Object.entries(messages.fr)) {
      if (typeof value === 'function') {
        expect(typeof en[key], `${key} is a function in fr only`).toBe('function')
        expect(typeof value(2)).toBe('string')
        expect(typeof (/** @type {(n: number) => string} */ (en[key]))(2)).toBe('string')
      }
    }
  })
})
