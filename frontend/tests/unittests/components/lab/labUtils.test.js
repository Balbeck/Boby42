import { describe, it, expect, afterEach, vi } from 'vitest'

import { UUID_RE, chipColor, fmtTimestamp } from '../../../../src/components/lab/format'
import { fmtInt, fmtNum1, fmtPct, fmtMs, shortDay, fmtAgo, windowFor, PERIODS, C, SERIES, axisProps, GRID } from '../../../../src/components/lab/vizKit'
import { PARAM_GROUPS, buildRequestBody } from '../../../../src/components/lab/ollamaParams'

// The three pure modules behind /lab. They are formatters and a catalogue, so
// the tests are mostly about the edge inputs a live database actually produces:
// a null aggregate (Postgres returns NULL for an average over nothing), a
// timestamp that will not parse, a form field left blank.

afterEach(() => vi.useRealTimers())

describe('format — chipColor', () => {
  it('is deterministic, so the same id gets the same chip in grid and explorer', () => {
    expect(chipColor('conv-1')).toBe(chipColor('conv-1'))
  })

  it('separates different ids', () => {
    expect(chipColor('conv-1')).not.toBe(chipColor('conv-2'))
  })

  it('always produces a valid hsl string, even for the empty string', () => {
    for (const value of ['', 'x', 'a'.repeat(200), '💾']) {
      expect(chipColor(value)).toMatch(/^hsl\(\d{1,3} 45% 62%\)$/)
    }
  })

  it('never emits a negative hue — the hash overflows into negatives', () => {
    // `(h * 31 + c) | 0` wraps into negative 32-bit values on any string of a
    // few characters; without Math.abs the css is silently invalid.
    for (const value of ['conversation', 'message_documents', 'a-long-uuid-like-string']) {
      const hue = Number((chipColor(value).match(/hsl\((\d+)/) || [])[1])
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
    }
  })

  it('stringifies a non-string value rather than throwing', () => {
    expect(chipColor(42)).toMatch(/^hsl\(/)
    expect(chipColor(null)).toMatch(/^hsl\(/)
  })
})

describe('format — fmtTimestamp', () => {
  it('renders a Date as a compact local timestamp', () => {
    expect(fmtTimestamp(new Date(2026, 7, 29, 14, 32, 1))).toBe('2026-08-29 14:32:01')
  })

  it('zero-pads every component', () => {
    expect(fmtTimestamp(new Date(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02 03:04:05')
  })

  it('accepts an ISO string, which is what the API sends', () => {
    const iso = new Date(2026, 7, 29, 14, 32, 1).toISOString()
    expect(fmtTimestamp(iso)).toBe('2026-08-29 14:32:01')
  })

  it('returns the input stringified when it will not parse', () => {
    // A grid cell must show whatever is in the column, not "Invalid Date".
    expect(fmtTimestamp('not a date')).toBe('not a date')
    // Deliberately outside the declared parameter type — that is the case
    // under test: whatever the grid holds, it must not print "Invalid Date".
    expect(fmtTimestamp(/** @type {any} */ (undefined))).toBe('undefined')
    // `null` is NOT in that bucket: `new Date(null)` is the epoch, a valid
    // date. A NULL timestamptz therefore renders as 1970 rather than as the
    // raw value — surprising, but it is what the grid shows today.
    expect(fmtTimestamp(/** @type {any} */ (null))).toMatch(/^1970-01-01 /)
  })
})

describe('format — UUID_RE', () => {
  it('matches a real conversation id in either case', () => {
    expect(UUID_RE.test('11111111-2222-4333-8444-555555555555')).toBe(true)
    expect(UUID_RE.test('AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE')).toBe(true)
  })

  it('rejects near-misses', () => {
    for (const value of ['', 'not-a-uuid', '11111111-2222-4333-8444-55555555555', '11111111222243338444555555555555']) {
      expect(UUID_RE.test(value)).toBe(false)
    }
  })
})

describe('vizKit — the number formatters', () => {
  it('fmtInt rounds and groups', () => {
    expect(fmtInt(1234)).toBe('1,234')
    expect(fmtInt(1234.6)).toBe('1,235')
    expect(fmtInt(0)).toBe('0')
  })

  it('fmtNum1 keeps one decimal', () => {
    expect(fmtNum1(3.456)).toBe('3.5')
    expect(fmtNum1(3)).toBe('3.0')
  })

  it('fmtPct turns a 0–1 ratio into a percent', () => {
    expect(fmtPct(0.2)).toBe('20.0%')
    expect(fmtPct(0)).toBe('0.0%')
    expect(fmtPct(1)).toBe('100.0%')
  })

  it('fmtMs switches from ms to s, and loses the decimal past 10 s', () => {
    expect(fmtMs(0)).toBe('0 ms')
    expect(fmtMs(999)).toBe('999 ms')
    expect(fmtMs(1000)).toBe('1.0 s')
    expect(fmtMs(1234)).toBe('1.2 s')
    expect(fmtMs(9999)).toBe('10.0 s')
    expect(fmtMs(10000)).toBe('10 s')
    expect(fmtMs(125400)).toBe('125 s')
  })

  it('renders an em dash for null / undefined / NaN, never 0 or NaN', () => {
    // Postgres returns NULL for an average over nothing and for a percentile
    // with no rows. Printing "0 ms" or "NaN%" there is a false statement about
    // the system, which is worse than an empty tile.
    for (const fmt of [fmtInt, fmtNum1, fmtPct, fmtMs]) {
      expect(fmt(null)).toBe('—')
      expect(fmt(undefined)).toBe('—')
      expect(fmt(NaN)).toBe('—')
    }
  })
})

describe('vizKit — shortDay', () => {
  it('drops the year for a dense axis', () => {
    expect(shortDay('2026-03-08')).toBe('03-08')
  })

  it('passes a non-string through untouched', () => {
    expect(shortDay(undefined)).toBeUndefined()
    expect(shortDay(42)).toBe(42)
  })
})

describe('vizKit — fmtAgo', () => {
  /** @param {string} now */
  function at(now) {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(now))
  }

  it('says "just now" under a minute', () => {
    at('2026-03-08T12:00:00Z')
    expect(fmtAgo('2026-03-08T11:59:30Z')).toBe('just now')
  })

  it('counts minutes, then hours, then days', () => {
    at('2026-03-08T12:00:00Z')
    expect(fmtAgo('2026-03-08T11:30:00Z')).toBe('30m ago')
    expect(fmtAgo('2026-03-08T09:00:00Z')).toBe('3h ago')
    expect(fmtAgo('2026-03-06T12:00:00Z')).toBe('2d ago')
  })

  it('falls back to a plain date past a week', () => {
    at('2026-03-08T12:00:00Z')
    expect(fmtAgo('2026-01-15T12:00:00Z')).toBe('2026-01-15')
  })

  it('returns an empty string on an unparseable date', () => {
    expect(fmtAgo('nope')).toBe('')
    expect(fmtAgo(undefined)).toBe('')
    // Same epoch quirk as fmtTimestamp: `new Date(null)` parses, so a null
    // lands in 1970 rather than in the empty-string guard.
    expect(fmtAgo(null)).toBe('1970-01-01')
  })
})

describe('vizKit — windowFor', () => {
  it('builds an ISO window of the requested span', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-08T12:00:00Z'))

    const window = windowFor('30')
    expect(window.to).toBe('2026-03-08T12:00:00.000Z')
    expect(window.from).toBe('2026-02-06T12:00:00.000Z')
    expect(window.key).toBe('30')
  })

  it('turns "all" into a decade rather than an absent bound', () => {
    // The backend accepts an absent `from`, but sending one keeps the request
    // shape identical across every period — one code path, not two.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-08T12:00:00Z'))

    const window = windowFor('all')
    const days = (new Date(window.to).getTime() - new Date(window.from).getTime()) / 86400e3
    expect(days).toBe(3650)
    expect(window.key).toBe('all')
  })

  it('falls back to the first period on an unknown key', () => {
    expect(windowFor('nope').key).toBe('7')
    expect(windowFor(/** @type {any} */ (undefined)).key).toBe('7')
  })

  it('covers every period the selector offers', () => {
    for (const period of PERIODS) {
      expect(windowFor(period.key).key).toBe(period.key)
    }
  })
})

describe('vizKit — the palette', () => {
  it('assigns every chart role a colour from the validated set', () => {
    const allowed = new Set(Object.values(SERIES))
    for (const [role, colour] of Object.entries(C)) {
      expect(allowed.has(colour), `${role} uses an off-palette colour`).toBe(true)
    }
  })

  it('never puts the brand green on a data mark', () => {
    // The brand green belongs to the chrome (tabs, buttons, focus). A data
    // series wearing it reads as "the app", not "this number".
    for (const colour of Object.values(C)) {
      expect(colour.toLowerCase()).not.toBe('#00babc')
    }
  })

  it('exposes recessive axis props and a grid colour', () => {
    expect(axisProps.tickLine).toBe(false)
    expect(axisProps.axisLine).toBe(false)
    expect(GRID).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe('ollamaParams — the catalogue', () => {
  const all = PARAM_GROUPS.flatMap((g) => g.params)

  it('has unique parameter names across every group', () => {
    // A duplicate would make one group's input silently overwrite another's in
    // the flat `values` state.
    const names = all.map((p) => p.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('gives every param a known scope and type', () => {
    for (const param of all) {
      expect(['root', 'options']).toContain(param.scope)
      expect(['int', 'float', 'bool', 'text', 'textarea', 'list', 'select']).toContain(param.type)
    }
  })

  it('gives every select its options', () => {
    for (const param of all.filter((p) => p.type === 'select')) {
      expect(Array.isArray(param.options)).toBe(true)
      expect(param.options ?? []).toHaveLength(4)
    }
  })

  it('keeps `stream` at the root, not inside options', () => {
    // Ollama reads `stream` off the body; nested in `options` it is silently
    // ignored and the console would hang waiting for tokens that never stream.
    expect(all.find((p) => p.name === 'stream')?.scope).toBe('root')
  })
})

describe('ollamaParams — buildRequestBody', () => {
  /**
   * `buildRequestBody` is declared `@returns {object}` (it assembles a raw
   * Ollama body, whose shape depends on which knobs the user set), so the field
   * reads below need a concrete view of it.
   *
   * @param {string} model
   * @param {string} prompt
   * @param {Record<string, string | boolean>} values
   * @returns {Record<string, any>}
   */
  const build = (model, prompt, values) =>
    /** @type {Record<string, any>} */ (buildRequestBody(model, prompt, values))

  it('sends only model, prompt and an explicit stream:false when nothing is set', () => {
    // Every omitted field is Ollama applying its own default — which is the
    // console's whole premise, since the placeholders advertise those defaults.
    expect(build('mistral:latest', 'hello', {})).toEqual({
      model: 'mistral:latest',
      prompt: 'hello',
      stream: false,
    })
  })

  it('routes root params to the body and option params under options', () => {
    const body = build('m', 'p', { system: 'be terse', temperature: '0.2' })

    expect(body.system).toBe('be terse')
    expect(body.options).toEqual({ temperature: 0.2 })
  })

  it('omits `options` entirely when no option was set', () => {
    expect('options' in build('m', 'p', { system: 'x' })).toBe(false)
  })

  it('coerces int and float fields to numbers', () => {
    const body = build('m', 'p', { num_ctx: '8192', temperature: '0.15' })

    expect(body.options.num_ctx).toBe(8192)
    expect(body.options.temperature).toBe(0.15)
  })

  it('drops a numeric field that will not parse instead of sending NaN', () => {
    // `{"temperature": null}` is what JSON.stringify makes of NaN, and Ollama
    // rejects the whole request over it.
    const body = build('m', 'p', { temperature: 'warm' })
    expect('options' in body).toBe(false)
  })

  it('keeps a zero, which is a meaningful value for seed and temperature', () => {
    const body = build('m', 'p', { seed: '0', temperature: '0' })
    expect(body.options).toEqual({ seed: 0, temperature: 0 })
  })

  it('sends a boolean only when checked', () => {
    expect(build('m', 'p', { raw: true }).raw).toBe(true)
    expect('raw' in build('m', 'p', { raw: false })).toBe(false)
    expect('raw' in build('m', 'p', {})).toBe(false)
  })

  it('lets stream:true override the default', () => {
    expect(build('m', 'p', { stream: true }).stream).toBe(true)
  })

  it('splits a stop list on newlines and commas, trimming each', () => {
    expect(build('m', 'p', { stop: '###\n, END ,\n\n<|eot|>' }).options.stop).toEqual([
      '###',
      'END',
      '<|eot|>',
    ])
  })

  it('drops a stop list that is only separators', () => {
    expect('options' in build('m', 'p', { stop: ' , \n , ' })).toBe(false)
  })

  it('coerces the mirostat select to an int, and drops its empty default', () => {
    expect(build('m', 'p', { mirostat: '2' }).options.mirostat).toBe(2)
    expect('options' in build('m', 'p', { mirostat: '' })).toBe(false)
  })

  it('drops empty strings, null and undefined alike', () => {
    // `null` / `undefined` are outside the declared value type on purpose: an
    // untouched field arrives as one of them from the form state.
    const body = build('m', 'p', /** @type {any} */ ({ system: '', format: null, keep_alive: undefined }))

    expect('system' in body).toBe(false)
    expect('format' in body).toBe(false)
    expect('keep_alive' in body).toBe(false)
  })

  it('keeps text fields as strings', () => {
    const body = build('m', 'p', { keep_alive: '5m', format: 'json' })
    expect(body.keep_alive).toBe('5m')
    expect(body.format).toBe('json')
  })

  it('ignores a value for a name the catalogue does not know', () => {
    const body = build('m', 'p', { not_a_param: 'x' })
    expect('not_a_param' in body).toBe(false)
  })
})
