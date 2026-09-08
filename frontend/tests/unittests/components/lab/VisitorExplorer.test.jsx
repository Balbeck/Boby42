import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import VisitorExplorer from '../../../../src/components/lab/VisitorExplorer'
import * as labApi from '../../../../src/services/labApi'

// The "By visitor" panel. It is the one screen in /lab built on NO endpoint of
// its own: there is no "conversations of one visitor" route, so it pulls the
// whole `conversations` table (capped at 1000 rows) and filters it client-side.
//
// Two consequences drive this suite:
//
//  1. that cap can bite silently. A visitor whose threads fell outside the 1000
//     most recent would show as "no conversations" — indistinguishable from a
//     visitor who really has none. The caveat lines are the only thing that
//     separates them, so they are asserted, not treated as decoration.
//  2. resolution has four outcomes (found / not found / list unavailable /
//     conversations failed) and each must SAY which one it is. `labApi` resolves
//     to `null` for a lapsed session, so "no data" and "no session" arrive
//     identically at this component.

const VISITORS = [
  { id: 1, anon_id: 'anon-old', first_seen_at: '2026-01-01T09:00:00.000Z', last_seen_at: '2026-02-01T09:00:00.000Z' },
  { id: 2, anon_id: 'anon-recent', first_seen_at: '2026-03-01T09:00:00.000Z', last_seen_at: '2026-03-08T09:00:00.000Z' },
  { id: 3, anon_id: null, first_seen_at: '2026-03-02T09:00:00.000Z', last_seen_at: '2026-03-05T09:00:00.000Z' },
]

const CONVERSATIONS = [
  { id: 'c1', visitor_id: 2, page: 'chat', title: 'où est le wifi', created_at: '2026-03-07T09:00:00.000Z', updated_at: '2026-03-08T09:00:00.000Z' },
  { id: 'c2', visitor_id: 2, page: 'archiviste', title: '', created_at: '2026-03-01T09:00:00.000Z', updated_at: '2026-03-02T09:00:00.000Z' },
  { id: 'c3', visitor_id: 99, page: 'chat', title: "quelqu'un d'autre", created_at: '2026-03-01T09:00:00.000Z', updated_at: '2026-03-03T09:00:00.000Z' },
]

const TREE = {
  conversation: { id: 'c1', page: 'chat', title: 'où est le wifi' },
  visitor: { id: 2, anon_id: 'anon-recent' },
  messages: [
    {
      id: 'm1', role: 'user', content: 'où est le wifi', language: 'fr',
      created_at: '2026-03-08T09:00:00.000Z', error_code: null, documents: [], feedback: null,
    },
    {
      id: 'm2', role: 'assistant', content: 'au 2e étage', language: 'fr',
      created_at: '2026-03-08T09:00:02.000Z', latency_ms: 1800, error_code: null,
      documents: [{ id: 1, position: 0, name: 'Wi-Fi', score: 0.9412, url: '/u/1', path: null }],
      feedback: { id: 9, rating: 1, comment: 'parfait' },
    },
  ],
  events: [],
}

/** @param {{ rows: any[], truncated?: boolean }} payload */
const tablePayload = ({ rows, truncated = false }) => ({
  name: 'x', columns: [], rows, rowCount: rows.length, truncated,
})

let writeText = vi.fn()

beforeEach(() => {
  writeText = vi.fn()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(() => vi.restoreAllMocks())

/**
 * Stubs the two `labApi.table` reads this panel makes, by table name.
 *
 * @param {{ visitors?: any, conversations?: any, tree?: any }} [opts]
 */
function stub(/** @type {{ visitors?: any, conversations?: any, tree?: any }} */ {
  visitors = tablePayload({ rows: VISITORS }),
  conversations = tablePayload({ rows: CONVERSATIONS }),
  tree = TREE,
} = {}) {
  vi.spyOn(labApi, 'table').mockImplementation(async (/** @type {string} */ name) =>
    name === 'visitors' ? visitors : conversations,
  )
  vi.spyOn(labApi, 'tree').mockResolvedValue(tree)
}

/** Renders and selects a visitor from the dropdown. */
async function openVisitor(/** @type {string} */ value = 'anon-recent') {
  render(<VisitorExplorer />)
  await screen.findByRole('option', { name: /pick a visitor/ })
  await userEvent.selectOptions(screen.getByRole('combobox'), value)
  return screen.findByRole('table')
}

describe('VisitorExplorer — picking a visitor', () => {
  it('lists the visitors, most recently seen first', async () => {
    stub()
    render(<VisitorExplorer />)

    await screen.findByRole('option', { name: /pick a visitor \(3\)/ })
    const options = screen.getAllByRole('option').slice(1).map((o) => o.textContent)
    expect(options[0]).toContain('anon-rec…')
    // The row with no anon_id falls back to its numeric id.
    expect(options.some((o) => o?.startsWith('#3'))).toBe(true)
  })

  it('says it is loading before the list lands', async () => {
    stub()
    render(<VisitorExplorer />)

    expect(screen.getByRole('option', { name: 'Loading visitors…' })).toBeDefined()
    await screen.findByRole('option', { name: /pick a visitor/ })
  })

  it('invites a pick before anything is selected', async () => {
    stub()
    render(<VisitorExplorer />)

    expect(await screen.findByText('Pick or paste a visitor to see their history.')).toBeDefined()
  })

  it('keeps the paste box usable when the visitor list itself failed', async () => {
    // A lapsed session resolves to null here — the panel must say so and still
    // accept a numeric id, which needs no list to resolve.
    stub({ visitors: null })
    render(<VisitorExplorer />)

    expect(await screen.findByText(/you can still paste a numeric visitors.id/)).toBeDefined()
    expect(screen.getByRole('option', { name: 'Visitor list unavailable' })).toBeDefined()
  })

  it('warns when the visitor list itself hit the 1000-row cap', async () => {
    stub({ visitors: tablePayload({ rows: VISITORS, truncated: true }) })
    render(<VisitorExplorer />)

    expect(await screen.findByText(/Showing the 1000 most recent visitors/)).toBeDefined()
  })

  it('mirrors the picked id into the paste box', async () => {
    stub()
    await openVisitor()

    expect(/** @type {HTMLInputElement} */ (screen.getByPlaceholderText(/paste a visitor anon_id/)).value).toBe('anon-recent')
  })

  it('resolves a pasted anon_id, trimmed', async () => {
    stub()
    render(<VisitorExplorer />)
    await screen.findByRole('option', { name: /pick a visitor/ })

    await userEvent.type(screen.getByPlaceholderText(/paste a visitor anon_id/), '  anon-recent  ')
    await userEvent.click(screen.getByRole('button', { name: 'Load' }))

    expect(await screen.findByRole('table')).toBeDefined()
  })

  it('resolves a numeric visitors.id even when the list has no such row', async () => {
    // The escape hatch for a visitor older than the cap.
    stub({ conversations: tablePayload({ rows: [{ ...CONVERSATIONS[0], visitor_id: 4242 }] }) })
    render(<VisitorExplorer />)
    await screen.findByRole('option', { name: /pick a visitor/ })

    await userEvent.type(screen.getByPlaceholderText(/paste a visitor anon_id/), '4242')
    await userEvent.click(screen.getByRole('button', { name: 'Load' }))

    expect(await screen.findByText('#4242')).toBeDefined()
    expect(await screen.findByRole('table')).toBeDefined()
  })

  it('resets the dropdown when the pasted id is not one of its options', async () => {
    stub()
    render(<VisitorExplorer />)
    await screen.findByRole('option', { name: /pick a visitor/ })

    await userEvent.type(screen.getByPlaceholderText(/paste a visitor anon_id/), '4242')
    await userEvent.click(screen.getByRole('button', { name: 'Load' }))
    await screen.findByText('#4242')

    expect(/** @type {HTMLSelectElement} */ (screen.getByRole('combobox')).value).toBe('')
  })

  it('says the id is unknown rather than showing an empty history', async () => {
    stub()
    render(<VisitorExplorer />)
    await screen.findByRole('option', { name: /pick a visitor/ })

    await userEvent.type(screen.getByPlaceholderText(/paste a visitor anon_id/), 'nobody')
    await userEvent.click(screen.getByRole('button', { name: 'Load' }))

    expect(await screen.findByText('No visitor with that id.')).toBeDefined()
  })

  it('explains that an unresolvable id needs the numeric form when the list failed', async () => {
    // Distinct from "no visitor with that id": here we simply cannot tell.
    stub({ visitors: null })
    render(<VisitorExplorer />)
    await screen.findByText(/you can still paste a numeric visitors.id/)

    await userEvent.type(screen.getByPlaceholderText(/paste a visitor anon_id/), 'anon-recent')
    await userEvent.click(screen.getByRole('button', { name: 'Load' }))

    expect(await screen.findByText(/the visitor list didn’t load/)).toBeDefined()
  })

  it('says so when the conversations read fails', async () => {
    stub({ conversations: null })
    render(<VisitorExplorer />)
    await screen.findByRole('option', { name: /pick a visitor/ })

    await userEvent.selectOptions(screen.getByRole('combobox'), 'anon-recent')
    expect(await screen.findByText(/Couldn’t load this visitor’s conversations/)).toBeDefined()
  })

  it('shows a loading line while the history is being assembled', async () => {
    /** @type {(v: any) => void} */
    let resolve = () => {}
    vi.spyOn(labApi, 'table').mockImplementation(async (name) =>
      name === 'visitors'
        ? tablePayload({ rows: VISITORS })
        : new Promise((r) => { resolve = r }),
    )
    render(<VisitorExplorer />)
    await screen.findByRole('option', { name: /pick a visitor/ })

    await userEvent.selectOptions(screen.getByRole('combobox'), 'anon-recent')
    expect(await screen.findByText('Loading history…')).toBeDefined()

    resolve(tablePayload({ rows: CONVERSATIONS }))
    expect(await screen.findByRole('table')).toBeDefined()
  })

  it('ignores a history load that settles after unmount', async () => {
    // The resolve effect writes two pieces of state; without its cancelled
    // flag both would land on an unmounted component.
    /** @type {(v: any) => void} */
    let resolve = () => {}
    vi.spyOn(labApi, 'table').mockImplementation(async (name) =>
      name === 'visitors'
        ? tablePayload({ rows: VISITORS })
        : new Promise((r) => { resolve = r }),
    )
    const { unmount } = render(<VisitorExplorer />)
    await screen.findByRole('option', { name: /pick a visitor/ })
    await userEvent.selectOptions(screen.getByRole('combobox'), 'anon-recent')
    await screen.findByText('Loading history…')

    unmount()
    resolve(tablePayload({ rows: CONVERSATIONS }))
  })

  it('ignores a visitor list that settles after unmount', async () => {
    /** @type {(v: any) => void} */
    let resolve = () => {}
    vi.spyOn(labApi, 'table').mockReturnValue(new Promise((r) => { resolve = r }))
    const { unmount } = render(<VisitorExplorer />)

    unmount()
    resolve(tablePayload({ rows: VISITORS }))
  })
})

describe('VisitorExplorer — one visitor’s conversations', () => {
  it('shows the visitor header with both timestamps and a conversation count', async () => {
    stub()
    await openVisitor()

    // Scoped to the header: "last seen" also appears in every dropdown option.
    const header = /** @type {HTMLElement} */ (
      screen.getByTitle('anon-recent — click to copy').closest('div.flex-wrap')
    )
    expect(within(header).getByText(/first seen/)).toBeDefined()
    expect(within(header).getByText(/last seen/)).toBeDefined()
    expect(within(header).getByText(/2 conversations/)).toBeDefined()
  })

  it('singularises the count for a visitor with one thread', async () => {
    stub({ conversations: tablePayload({ rows: [CONVERSATIONS[0]] }) })
    await openVisitor()

    expect(screen.getByText(/1 conversation$/)).toBeDefined()
  })

  it('keeps only that visitor’s conversations', async () => {
    // The whole table is fetched; another visitor's thread leaking in would be
    // a privacy defect that looks like ordinary data.
    stub()
    await openVisitor()

    expect(screen.getByText('où est le wifi')).toBeDefined()
    expect(screen.queryByText("quelqu'un d'autre")).toBeNull()
  })

  it('labels a titleless conversation', async () => {
    stub()
    await openVisitor()

    expect(screen.getByText('(no title)')).toBeDefined()
  })

  it('sorts by every conversation column', async () => {
    // Each column carries its own `get`, invoked only while that column is the
    // active sort — an unsorted column's accessor never runs at all.
    stub()
    await openVisitor()
    const titles = () =>
      within(screen.getByRole('table'))
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.querySelectorAll('td')[1]?.textContent ?? '')

    await userEvent.click(screen.getByRole('columnheader', { name: /Page/ }))
    expect(titles()[0]).toBe('(no title)') // archiviste sorts before chat

    await userEvent.click(screen.getByRole('columnheader', { name: /Title/ }))
    // A missing title is read as '' and therefore EMPTY, so it sorts last —
    // not first alphabetically, which is what a plain string compare would do.
    expect(titles()[0]).toBe('où est le wifi')
    expect(titles().at(-1)).toBe('(no title)')

    await userEvent.click(screen.getByRole('columnheader', { name: /Created/ }))
    expect(titles()[0]).toBe('où est le wifi') // newest created first
  })

  it('opens on newest activity first', async () => {
    stub()
    await openVisitor()

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(rows[0].textContent).toContain('où est le wifi')
  })

  it('warns when the conversation scan hit the 1000-row cap', async () => {
    // Without this line, "this visitor has no conversations" could just mean
    // "their conversations are older than the 1000 rows we looked at".
    stub({ conversations: tablePayload({ rows: CONVERSATIONS, truncated: true }) })
    await openVisitor()

    expect(screen.getByText(/Only the 1000 most recent conversations were scanned/)).toBeDefined()
  })

  it('says a visitor has no conversations rather than showing an empty table', async () => {
    stub({ conversations: tablePayload({ rows: [] }) })
    render(<VisitorExplorer />)
    await screen.findByRole('option', { name: /pick a visitor/ })

    await userEvent.selectOptions(screen.getByRole('combobox'), 'anon-recent')
    expect(await screen.findByText('This visitor has no conversations.')).toBeDefined()
  })

  it('copies the full visitor label', async () => {
    stub()
    await openVisitor()

    await userEvent.click(screen.getByTitle('anon-recent — click to copy'))
    expect(writeText).toHaveBeenCalledWith('anon-recent')
  })

  it('survives a clipboard that refuses', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(() => { throw new Error('denied') }) },
      configurable: true,
    })
    stub()
    await openVisitor()

    await userEvent.click(screen.getByTitle('anon-recent — click to copy'))
    expect(screen.getByRole('table')).toBeDefined()
  })
})

describe('VisitorExplorer — the exchanges of one conversation', () => {
  /** Opens the first conversation row. */
  async function openConversation() {
    stub()
    await openVisitor()
    await userEvent.click(screen.getByText('où est le wifi'))
    return screen.findByRole('button', { name: '← Back to conversations' })
  }

  it('loads the subtree and pairs each question with its answer', async () => {
    await openConversation()

    expect(labApi.tree).toHaveBeenCalledWith('c1')
    expect(screen.getByText(/1 exchange$/)).toBeDefined()
    expect(screen.getByText('où est le wifi', { selector: 'span.text-chat-text' })).toBeDefined()
  })

  it('comes back to the conversation list', async () => {
    await openConversation()

    await userEvent.click(screen.getByRole('button', { name: '← Back to conversations' }))
    expect(await screen.findByText(/2 conversations/)).toBeDefined()
  })

  it('shows a loading line, with a way back, while the subtree is in flight', async () => {
    /** @type {(v: any) => void} */
    let resolve = () => {}
    vi.spyOn(labApi, 'table').mockImplementation(async (name) =>
      name === 'visitors' ? tablePayload({ rows: VISITORS }) : tablePayload({ rows: CONVERSATIONS }),
    )
    vi.spyOn(labApi, 'tree').mockReturnValue(new Promise((r) => { resolve = r }))
    await openVisitor()

    await userEvent.click(screen.getByText('où est le wifi'))
    expect(await screen.findByText('Loading transcript…')).toBeDefined()
    expect(screen.getByRole('button', { name: '← Back to conversations' })).toBeDefined()

    resolve(TREE)
    expect(await screen.findByText(/1 exchange$/)).toBeDefined()
  })

  it('says the transcript failed, and the way back works from there', async () => {
    stub({ tree: null })
    await openVisitor()

    await userEvent.click(screen.getByText('où est le wifi'))
    expect(await screen.findByText('Couldn’t load that conversation.')).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: '← Back to conversations' }))
    expect(await screen.findByText(/2 conversations/)).toBeDefined()
  })

  it('lets the operator back out while the transcript is still loading', async () => {
    // Its own BackBtn, distinct from the one in the loaded view — a stuck
    // request must not trap the operator on a spinner.
    /** @type {(v: any) => void} */
    let resolve = () => {}
    vi.spyOn(labApi, 'table').mockImplementation(async (name) =>
      name === 'visitors' ? tablePayload({ rows: VISITORS }) : tablePayload({ rows: CONVERSATIONS }),
    )
    vi.spyOn(labApi, 'tree').mockReturnValue(new Promise((r) => { resolve = r }))
    await openVisitor()

    await userEvent.click(screen.getByText('où est le wifi'))
    await screen.findByText('Loading transcript…')

    await userEvent.click(screen.getByRole('button', { name: '← Back to conversations' }))
    expect(await screen.findByText(/2 conversations/)).toBeDefined()

    resolve(TREE)
  })

  it('says so when a conversation has no messages at all', async () => {
    stub({ tree: { ...TREE, messages: [] } })
    await openVisitor()

    await userEvent.click(screen.getByText('où est le wifi'))
    expect(await screen.findByText('No messages in this conversation.')).toBeDefined()
  })

  it('summarises each exchange: lengths, best score, latency and rating', async () => {
    await openConversation()

    const row = within(screen.getByRole('table')).getAllByRole('row')[1]
    // 14-char question, 11-char answer, best document score, 1.8 s, 👍.
    expect(within(row).getByText('14')).toBeDefined()
    expect(within(row).getByText('11')).toBeDefined()
    expect(within(row).getByText('0.94')).toBeDefined()
    expect(within(row).getByText('1.8 s')).toBeDefined()
    expect(within(row).getByText('👍')).toBeDefined()
  })

  it('expands a row into the full question, answer, documents and feedback', async () => {
    await openConversation()

    await userEvent.click(within(screen.getByRole('table')).getAllByRole('row')[1])

    expect(screen.getByText('Question · fr')).toBeDefined()
    expect(screen.getByText(/Answer · 1.8 s/)).toBeDefined()
    expect(screen.getByText('1 document')).toBeDefined()
    expect(screen.getByText('score 0.94')).toBeDefined()
    expect(screen.getByText('👍 +1 — “parfait”')).toBeDefined()
  })

  it('folds the row back on a second click', async () => {
    await openConversation()
    const row = () => within(screen.getByRole('table')).getAllByRole('row')[1]

    await userEvent.click(row())
    expect(screen.getByText('Question · fr')).toBeDefined()

    await userEvent.click(row())
    expect(screen.queryByText('Question · fr')).toBeNull()
  })

  it('fills in the blanks of a half-finished exchange', async () => {
    // A question whose generation failed: no answer, no documents, an error
    // code, no rating. Every column has to degrade to a dash rather than NaN.
    stub({
      tree: {
        ...TREE,
        messages: [
          { id: 'm1', role: 'user', content: 'une question', language: null, created_at: '2026-03-08T09:00:00.000Z', error_code: null, documents: [], feedback: null },
          { id: 'm2', role: 'assistant', content: '', language: null, created_at: '2026-03-08T09:00:01.000Z', latency_ms: null, error_code: 'ollama_error', documents: [], feedback: null },
        ],
      },
    })
    await openVisitor()
    await userEvent.click(screen.getByText('où est le wifi'))
    await screen.findByRole('button', { name: '← Back to conversations' })

    const row = within(screen.getByRole('table')).getAllByRole('row')[1]
    expect(within(row).getByText('ollama_error')).toBeDefined()
    expect(within(row).getAllByText('—').length).toBeGreaterThanOrEqual(3)
    expect(within(row).getByText('–')).toBeDefined()

    await userEvent.click(row)
    expect(screen.getByText('(no answer)')).toBeDefined()
    expect(screen.getByText('no feedback')).toBeDefined()
  })

  it('keeps an orphan user turn and an orphan assistant turn as their own rows', async () => {
    stub({
      tree: {
        ...TREE,
        messages: [
          { id: 'm1', role: 'user', content: 'sans réponse', language: null, created_at: '2026-03-08T09:00:00.000Z', error_code: null, documents: [], feedback: null },
          { id: 'm2', role: 'user', content: 'une autre', language: null, created_at: '2026-03-08T09:00:01.000Z', error_code: null, documents: [], feedback: null },
          { id: 'm3', role: 'assistant', content: 'réponse', language: null, created_at: '2026-03-08T09:00:02.000Z', latency_ms: null, error_code: null, documents: [], feedback: null },
          { id: 'm4', role: 'assistant', content: 'orpheline', language: null, created_at: '2026-03-08T09:00:03.000Z', latency_ms: null, error_code: null, documents: [], feedback: null },
        ],
      },
    })
    await openVisitor()
    await userEvent.click(screen.getByText('où est le wifi'))

    expect(await screen.findByText(/3 exchanges$/)).toBeDefined()
    expect(screen.getByText('orpheline')).toBeDefined()
  })

  it('truncates a long question in the table but keeps it whole on hover', async () => {
    const long = 'x'.repeat(200)
    stub({
      tree: {
        ...TREE,
        messages: [
          { id: 'm1', role: 'user', content: long, language: null, created_at: '2026-03-08T09:00:00.000Z', error_code: null, documents: [], feedback: null },
        ],
      },
    })
    await openVisitor()
    await userEvent.click(screen.getByText('où est le wifi'))
    await screen.findByRole('button', { name: '← Back to conversations' })

    const cell = screen.getByTitle(long)
    expect(cell.textContent).toHaveLength(81)
    expect(cell.textContent?.endsWith('…')).toBe(true)
  })
})

describe('VisitorExplorer — the sortable table', () => {
  async function openConversation() {
    stub({
      tree: {
        ...TREE,
        messages: [
          { id: 'm1', role: 'user', content: 'court', language: null, created_at: '2026-03-08T09:00:00.000Z', error_code: null, documents: [], feedback: null },
          { id: 'm2', role: 'assistant', content: 'a', language: null, created_at: '2026-03-08T09:00:01.000Z', latency_ms: 300, error_code: null, documents: [], feedback: null },
          { id: 'm3', role: 'user', content: 'une question beaucoup plus longue', language: null, created_at: '2026-03-08T09:01:00.000Z', error_code: null, documents: [], feedback: null },
          { id: 'm4', role: 'assistant', content: 'bb', language: null, created_at: '2026-03-08T09:01:01.000Z', latency_ms: 9000, error_code: null, documents: [], feedback: null },
          { id: 'm5', role: 'user', content: 'moyenne', language: null, created_at: '2026-03-08T09:02:00.000Z', error_code: null, documents: [], feedback: null },
          { id: 'm6', role: 'assistant', content: 'ccc', language: null, created_at: '2026-03-08T09:02:01.000Z', latency_ms: null, error_code: null, documents: [], feedback: null },
        ],
      },
    })
    await openVisitor()
    await userEvent.click(screen.getByText('où est le wifi'))
    await screen.findByRole('button', { name: '← Back to conversations' })
  }

  /** The first cell text of every body row that is not an expanded detail. */
  const questions = () =>
    within(screen.getByRole('table'))
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.querySelectorAll('td')[1]?.textContent ?? '')
      .filter(Boolean)

  it('opens newest-first on the time column', async () => {
    await openConversation()
    expect(questions()[0]).toBe('moyenne')
  })

  it('sorts a numeric column high-to-low on the first click', async () => {
    // A "Q len" or "Latency" column is asked about to find the extremes; the
    // useful end is the top.
    await openConversation()

    await userEvent.click(screen.getByRole('columnheader', { name: /Q len/ }))
    expect(questions()).toEqual(['une question beaucoup plus longue', 'moyenne', 'court'])
  })

  it('flips the direction on a second click of the same column', async () => {
    await openConversation()
    const header = screen.getByRole('columnheader', { name: /Q len/ })

    await userEvent.click(header)
    await userEvent.click(header)
    expect(questions()).toEqual(['court', 'moyenne', 'une question beaucoup plus longue'])
  })

  it('sorts a text column A→Z on the first click', async () => {
    await openConversation()

    await userEvent.click(screen.getByRole('columnheader', { name: /Question/ }))
    expect(questions()).toEqual(['court', 'moyenne', 'une question beaucoup plus longue'])
  })

  it('keeps an empty value last whichever way it sorts', async () => {
    // One exchange has no latency; it must not lead the ranking in either
    // direction just because it is null.
    await openConversation()
    const header = screen.getByRole('columnheader', { name: /Latency/ })

    await userEvent.click(header)
    expect(questions().at(-1)).toBe('moyenne')

    await userEvent.click(header)
    expect(questions().at(-1)).toBe('moyenne')
  })

  it('sorts by every exchange column', async () => {
    await openConversation()

    for (const label of [/Answer/, /A len/, /Score/, /Rating/, /Error/]) {
      await userEvent.click(screen.getByRole('columnheader', { name: label }))
      expect(questions()).toHaveLength(3)
    }
  })

  it('keeps two equally-empty values in a stable order', async () => {
    // Both null: the comparator returns 0 rather than picking arbitrarily —
    // otherwise the table reshuffles on every re-render.
    await openConversation()

    await userEvent.click(screen.getByRole('columnheader', { name: /Score/ }))
    const first = questions()
    await userEvent.click(screen.getByRole('columnheader', { name: /Score/ }))
    expect(questions()).toEqual(first)
  })

  it('marks the sorted column with a direction arrow', async () => {
    await openConversation()
    const header = screen.getByRole('columnheader', { name: /Q len/ })

    await userEvent.click(header)
    expect(header.textContent).toContain('↓')

    await userEvent.click(header)
    expect(header.textContent).toContain('↑')
  })
})
