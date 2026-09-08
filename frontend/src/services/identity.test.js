import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// identity.js is one function, and it is the single point of attribution for the
// whole app: every logged interaction hangs off the UUID it returns. What is
// worth pinning is stability (the same browser must not become two visitors) and
// that a blocked localStorage — private mode, a hardened profile, a student
// clearing storage — degrades to an in-memory id rather than throwing and
// taking the send with it.

const STORAGE_KEY = 'boby42.visitorId'

/** Fresh module per test — the fallback id is cached in module scope. */
async function loadIdentity() {
  vi.resetModules()
  return import('./identity')
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getVisitorId', () => {
  it('creates a UUID on first call and persists it', async () => {
    const { getVisitorId } = await loadIdentity()

    const id = getVisitorId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(id)
  })

  it('returns the same id on every later call', async () => {
    const { getVisitorId } = await loadIdentity()
    expect(getVisitorId()).toBe(getVisitorId())
  })

  it('reuses an id already in localStorage instead of minting a new one', async () => {
    // The whole point: a returning student stays the same `visitors` row across
    // reloads, so their history and their ratings keep belonging to them.
    localStorage.setItem(STORAGE_KEY, 'existing-id')
    const { getVisitorId } = await loadIdentity()

    expect(getVisitorId()).toBe('existing-id')
  })

  it('ignores an empty stored value and mints a real one', async () => {
    localStorage.setItem(STORAGE_KEY, '')
    const { getVisitorId } = await loadIdentity()

    const id = getVisitorId()
    expect(id).not.toBe('')
    expect(localStorage.getItem(STORAGE_KEY)).toBe(id)
  })
})

describe('when localStorage is unavailable', () => {
  /** Private mode / a blocked profile: every access throws. */
  function blockStorage() {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
  }

  it('still returns an id instead of throwing', async () => {
    // A throw here would propagate through every API module — the student
    // could not send a single question because their browser blocks storage.
    blockStorage()
    const { getVisitorId } = await loadIdentity()

    expect(getVisitorId()).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('keeps that id stable for the session, in memory', async () => {
    blockStorage()
    const { getVisitorId } = await loadIdentity()

    expect(getVisitorId()).toBe(getVisitorId())
  })

  it('falls back when only the write throws, not the read', async () => {
    // Safari's quota behaviour: getItem works, setItem does not.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const { getVisitorId } = await loadIdentity()

    const first = getVisitorId()
    expect(first).toMatch(/^[0-9a-f-]{36}$/i)
    expect(getVisitorId()).toBe(first)
  })
})
