// Vitest setup, loaded before every suite (vite.config.js → test.setupFiles).
//
// Two jobs. The first is making jsdom behave like a browser enough for the
// components under test. The second — and the reason this file is longer than
// it looks like it should be — is that **nothing is allowed to fail quietly**.
//
// Three classes of silent failure were possible here, and all three actually
// happened while the suites were being written:
//
//   1. An unstubbed `fetch` escaped to the real one. jsdom threw
//      `ERR_INVALID_URL` on the relative path, React swallowed it inside an
//      effect, the test still PASSED — and vitest exited non-zero, so `make
//      test` failed on a fully green suite. See the network guard below.
//   2. React logged an `act(...)` warning, a duplicate-key warning or a bad
//      prop through `console.error`, and nobody read it: a test asserting on
//      the DOM passes regardless. See the console guard below.
//   3. A test forgot `vi.unstubAllGlobals()` and its fake `fetch` leaked into
//      the next file's first test. Undone here, not per suite.
//
// Every guard reports through a real assertion in `afterEach`, so the failure
// lands on the test that caused it, with the offending call named.

import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// ── jsdom gaps ──────────────────────────────────────────────────────────────
// Stubbed globally rather than per-suite so a new component test does not have
// to rediscover which one it tripped.

if (!window.matchMedia) {
  window.matchMedia = /** @type {any} */ ((/** @type {string} */ query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}

// React only treats `act()` as real when this flag is set. Without it every
// `act()` imported straight from 'react' (which two of the hook suites do)
// logs "The current testing environment is not configured to support act(...)"
// and does NOT flush effects the way the test assumes — the assertions passed
// anyway, so it went unnoticed until the console guard below started reading
// that output. `@testing-library/react`'s own `act` sets it per call; setting
// it here covers both import paths.
/** @type {any} */ (globalThis).IS_REACT_ACT_ENVIRONMENT = true

// recharts' <ResponsiveContainer> measures its parent with a ResizeObserver and
// renders NOTHING at 0×0 — which is every element in jsdom, since jsdom does no
// layout. Every chart would therefore be an empty <div> and the /lab dashboard
// suites would assert on nothing at all.
//
// The replacement below is the smallest thing that restores them: it does what
// the real container does — clone the chart child with a concrete width and
// height — and leaves the rest of recharts untouched, so the axes, bars, lines
// and tooltips under test are the real components.
vi.mock('recharts', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal())
  const { cloneElement } = await import('react')

  return {
    ...actual,
    ResponsiveContainer: (/** @type {{ children: any }} */ { children }) =>
      cloneElement(children, { width: 600, height: 300 }),
  }
})

// ── Guard 1: no unstubbed network ───────────────────────────────────────────

/** @type {string[]} calls that reached the guard during the current test */
const escapedCalls = []

/**
 * Stands in for the real `fetch` whenever a test has not replaced it.
 *
 * It REJECTS rather than throwing synchronously, so the code under test behaves
 * exactly as it would on a network failure — a component with a `.catch(() =>
 * {})` (the drawer, the nav) keeps rendering instead of tearing down the whole
 * tree and hiding which call was missing. The recorded call is what fails the
 * test, in `afterEach`.
 *
 * @param {any} input
 * @param {any} [init]
 * @returns {Promise<never>}
 */
function guardedFetch(input, init) {
  const method = (init && init.method) || 'GET'
  const url = typeof input === 'string' ? input : String((input && input.url) || input)
  escapedCalls.push(`${method} ${url}`)

  return Promise.reject(
    new Error(`[test] unstubbed network call: ${method} ${url}`),
  )
}

// ── Guard 2: no unread console output ───────────────────────────────────────

/** @type {string[]} console.error / console.warn output during the current test */
const consoleOutput = []

/** @param {unknown[]} args */
function describeArgs(args) {
  return args
    .map((arg) => (arg instanceof Error ? arg.message : typeof arg === 'string' ? arg : String(arg)))
    .join(' ')
}

beforeEach(() => {
  escapedCalls.length = 0
  consoleOutput.length = 0

  vi.stubGlobal('fetch', guardedFetch)

  // `src/` contains no console call at all (checked), so anything arriving here
  // comes from React or a library: an act() warning, a duplicate key, an
  // invalid prop, a state update after unmount. All of them are real defects in
  // the test or the component, and all of them are invisible to a DOM
  // assertion. A suite that genuinely expects console output opts out by
  // spying on it itself — that replaces this recorder for the rest of the test.
  for (const level of /** @type {const} */ (['error', 'warn'])) {
    vi.spyOn(console, level).mockImplementation((...args) => {
      consoleOutput.push(`console.${level}: ${describeArgs(args)}`)
    })
  }
})

afterEach(() => {
  // Unmount first: an effect cleanup can log or fetch too, and that has to be
  // attributed to the test that mounted it.
  cleanup()

  // Undo `vi.stubGlobal` (including each suite's own `stubFetch`) and every
  // `vi.spyOn`, so nothing leaks into the next test.
  vi.unstubAllGlobals()
  vi.restoreAllMocks()

  const problems = [...escapedCalls, ...consoleOutput]
  escapedCalls.length = 0
  consoleOutput.length = 0

  if (problems.length) {
    throw new Error(
      `${problems.length} unhandled problem(s) in this test — the assertions may still have passed:\n` +
        problems.map((p) => `  • ${p}`).join('\n') +
        '\n\nAn unstubbed network call means a component fetched something the test did not ' +
        'describe (stub it with stubFetch() or vi.spyOn(labApi, …)). Console output means React ' +
        'reported something the DOM assertions cannot see.',
    )
  }
})
