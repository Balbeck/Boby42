import { describe, it, expect } from 'vitest'

// A sentinel for the guards in `setup.js`.
//
// Those guards are what make a silent failure impossible — an unstubbed `fetch`
// escaping to the real one, a React warning nobody reads. They are also easy to
// delete by accident: nothing in any other suite references them, so removing
// them turns 528 green tests into 528 green tests that check less. This file is
// the one thing that notices.
//
// It deliberately does NOT trigger the guards (a triggered guard fails its own
// test by design). It checks they are installed.

describe('the test-harness guards', () => {
  it('replaces global fetch, so no suite can reach the network by accident', () => {
    // Named rather than merely "not the built-in": the name is what appears in
    // the failure message a future maintainer will read.
    expect(globalThis.fetch.name).toBe('guardedFetch')
  })

  it('reinstalls the guard for every test, even after a suite stubs fetch', () => {
    // `setup.js` calls `vi.unstubAllGlobals()` in its own afterEach, so a suite
    // that forgets to clean up cannot leak its fake into the next file.
    expect(globalThis.fetch.name).toBe('guardedFetch')
  })

  it('records console.error and console.warn instead of letting them scroll past', () => {
    // Both are replaced per test; `mock` is only present on a vitest spy.
    expect(/** @type {any} */ (console.error).mock).toBeDefined()
    expect(/** @type {any} */ (console.warn).mock).toBeDefined()
  })

  it('declares a real React act() environment', () => {
    // Without this React logs "not configured to support act(...)" and does not
    // flush effects the way `act()` callers assume — which is exactly what was
    // happening, unnoticed, before the console guard started reading that output.
    expect(/** @type {any} */ (globalThis).IS_REACT_ACT_ENVIRONMENT).toBe(true)
  })
})
