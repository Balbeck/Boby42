import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import DbViz from '../../../../src/components/lab/DbViz'
import RelationsExplorer, { Tree } from '../../../../src/components/lab/RelationsExplorer'
import ConversationBrowser from '../../../../src/components/lab/ConversationBrowser'
import * as labApi from '../../../../src/services/labApi'

// The 💾 tab and the two conversation views.
//
// All three sit on `useKeyedResource`, whose contract is three-valued: `null`
// while the current key is in flight, `'error'` when it failed, anything else
// is the data. `labApi` never throws — a 401 (session lapsed) and a 404 (gate
// off) both resolve to `null` — so each panel maps that to `'error'` itself and
// has to SAY something. A panel that renders nothing on a gated read looks
// exactly like a panel with no data, which is the failure these suites pin.

const UUID = '11111111-2222-4333-8444-555555555555'
const OTHER = '99999999-8888-4777-8666-555555555555'

/**
 * A conversation subtree as the backend assembles it. Typed `any` on the way
 * out: the tests mutate it to describe each edge case (a NULL score, an
 * error_code, an empty message list) and a literal's inferred type would refuse
 * every one of them.
 *
 * @param {Partial<any>} [overrides]
 * @returns {any}
 */
function treePayload(overrides = {}) {
  return {
    conversation: {
      id: UUID,
      page: 'chat',
      title: 'où est le wifi',
      created_at: '2026-03-08T09:00:00.000Z',
      updated_at: '2026-03-08T09:05:00.000Z',
    },
    visitor: { id: 3, anon_id: 'anon-3', last_seen_at: '2026-03-08T09:05:00.000Z' },
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'où est le wifi',
        created_at: '2026-03-08T09:00:00.000Z',
        latency_ms: null,
        error_code: null,
        documents: [],
        feedback: null,
      },
      {
        id: 'm2',
        role: 'assistant',
        content: 'au 2e étage',
        created_at: '2026-03-08T09:00:02.000Z',
        latency_ms: 1800,
        error_code: null,
        documents: [
          { id: 1, position: 0, name: 'Wi-Fi', score: 0.9412, url: '/u/1', path: null },
        ],
        feedback: { id: 9, rating: 1, comment: null },
      },
    ],
    events: [],
    ...overrides,
  }
}

let writeText = vi.fn()

beforeEach(() => {
  writeText = vi.fn()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
// No `afterEach(() => vi.restoreAllMocks())` here, deliberately: a suite-level
// afterEach runs BEFORE setup.js's (vitest stacks them, last registered first),
// so restoring here un-stubs `labApi` while the components are still mounted —
// and anything that settles or mounts in that window calls the REAL module and
// escapes to the network guard, failing whichever test is current. setup.js
// restores every spy itself, after its `cleanup()`, which is the right order.

/** Every /lab read the panels under test can make, stubbed empty by default. */
function stubLab(/** @type {{ tables?: any, table?: any, tree?: any, conversations?: any, conversation?: any }} */ {
  tables = [],
  table = null,
  tree = null,
  conversations = { items: [], total: 0 },
  conversation = null,
} = {}) {
  vi.spyOn(labApi, 'tables').mockResolvedValue(tables)
  vi.spyOn(labApi, 'table').mockResolvedValue(table)
  vi.spyOn(labApi, 'tree').mockResolvedValue(tree)
  vi.spyOn(labApi, 'analyticsConversations').mockResolvedValue(conversations)
  vi.spyOn(labApi, 'analyticsConversation').mockResolvedValue(conversation)
}

describe('Tree — the shared transcript renderer', () => {
  it('renders the conversation header, the visitor and both messages', () => {
    render(<Tree tree={treePayload()} />)

    expect(screen.getByText('“où est le wifi”')).toBeDefined()
    expect(screen.getByText('chat')).toBeDefined()
    expect(screen.getByText(/anon-3/)).toBeDefined()
    expect(screen.getByText('👤 user')).toBeDefined()
    expect(screen.getByText('🤖 assistant')).toBeDefined()
    expect(screen.getByText('au 2e étage')).toBeDefined()
  })

  it('shows the assistant latency and hides it on the user turn', () => {
    render(<Tree tree={treePayload()} />)
    expect(screen.getByText('1800 ms')).toBeDefined()
    expect(screen.queryByText(/null ms/)).toBeNull()
  })

  it('omits the visitor block when the row is gone', () => {
    render(<Tree tree={treePayload({ visitor: null })} />)
    expect(screen.queryByText(/anon_id/)).toBeNull()
  })

  it('lists an assistant message\'s documents with position, score and url', () => {
    render(<Tree tree={treePayload()} />)

    expect(screen.getByText('📄 1 document')).toBeDefined()
    expect(screen.getByText('0.')).toBeDefined()
    expect(screen.getByText('Wi-Fi')).toBeDefined()
    expect(screen.getByText('score 0.94')).toBeDefined()
    expect(screen.getByText('/u/1')).toBeDefined()
  })

  it('pluralises the document count', () => {
    const tree = treePayload()
    tree.messages[1].documents.push({ id: 2, position: 1, name: 'Badge', score: null, url: null, path: '/abs/x' })
    render(<Tree tree={tree} />)

    expect(screen.getByText('📄 2 documents')).toBeDefined()
    // No score line for a NULL score, and the path stands in for a missing url.
    expect(screen.queryByText(/score NaN/)).toBeNull()
    expect(screen.getByText('/abs/x')).toBeDefined()
  })

  it('shows a 👍 with its comment, and says "no feedback" only on assistant turns', () => {
    const tree = treePayload()
    tree.messages[1].feedback = { id: 9, rating: -1, comment: 'hors sujet' }
    const { unmount } = render(<Tree tree={tree} />)
    expect(screen.getByText('👎 −1 — “hors sujet”')).toBeDefined()
    unmount()

    const unrated = treePayload()
    unrated.messages[1].feedback = null
    render(<Tree tree={unrated} />)
    expect(screen.getAllByText('no feedback')).toHaveLength(1)
  })

  it('truncates a very long message but keeps the whole text on hover', () => {
    const tree = treePayload()
    tree.messages[1].content = 'x'.repeat(700)
    render(<Tree tree={tree} />)

    const paragraph = screen.getByTitle('x'.repeat(700))
    expect(paragraph.textContent).toHaveLength(501)
    expect(paragraph.textContent?.endsWith('…')).toBe(true)
  })

  it('says "(no text)" for an empty assistant row — /archiviste has no answer', () => {
    const tree = treePayload()
    tree.messages[1].content = ''
    render(<Tree tree={tree} />)

    expect(screen.getByText('(no text)')).toBeDefined()
  })

  it('surfaces an error_code on the message that carries it', () => {
    const tree = treePayload()
    tree.messages[1].error_code = 'ollama_error'
    render(<Tree tree={tree} />)

    expect(screen.getByText('ollama_error')).toBeDefined()
  })

  it('lists linked events with their payload, and omits the block when there are none', () => {
    const { unmount } = render(<Tree tree={treePayload()} />)
    expect(screen.queryByText(/event/)).toBeNull()
    unmount()

    render(
      <Tree
        tree={treePayload({
          events: [
            { id: 5, type: 'no_match', created_at: '2026-03-08T09:00:03.000Z', payload: { question: 'q' } },
            { id: 6, type: 'no_match', created_at: '2026-03-08T09:00:04.000Z', payload: null },
          ],
        })}
      />,
    )
    expect(screen.getByText('⚡ 2 events')).toBeDefined()
    expect(screen.getByText('{"question":"q"}')).toBeDefined()
  })

  it('copies the full id from a chip, not the eight shown characters', async () => {
    render(<Tree tree={treePayload()} />)

    await userEvent.click(screen.getByTitle(`${UUID} — click to copy`))
    expect(writeText).toHaveBeenCalledWith(UUID)
  })

  it('survives a clipboard that refuses', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(() => { throw new Error('denied') }) },
      configurable: true,
    })
    render(<Tree tree={treePayload()} />)

    await userEvent.click(screen.getByTitle(`${UUID} — click to copy`))
    expect(screen.getByText('“où est le wifi”')).toBeDefined()
  })
})

describe('RelationsExplorer', () => {
  const CONVERSATIONS = {
    name: 'conversations',
    columns: [],
    rowCount: 2,
    truncated: false,
    rows: [
      { id: UUID, title: 'où est le wifi', page: 'chat', created_at: '2026-03-08T09:00:00.000Z' },
      { id: OTHER, title: '', page: 'archiviste', created_at: '2026-03-07T09:00:00.000Z' },
    ],
  }

  it('offers the recent conversations, labelled and counted', async () => {
    stubLab({ table: CONVERSATIONS })
    render(<RelationsExplorer />)

    expect(await screen.findByRole('option', { name: /pick a conversation \(2\)/ })).toBeDefined()
    expect(screen.getByRole('option', { name: /où est le wifi · chat/ })).toBeDefined()
    // A conversation with no title still gets a readable label.
    expect(screen.getByRole('option', { name: /\(no title\) · archiviste/ })).toBeDefined()
  })

  it('says it is loading the list before the rows land', async () => {
    stubLab({ table: CONVERSATIONS })
    render(<RelationsExplorer />)

    expect(screen.getByRole('option', { name: 'Loading conversations…' })).toBeDefined()
    // Awaited on purpose: the fetch settles after this assertion and its
    // setState would land outside act() — a warning the console guard turns
    // into a failure rather than letting it scroll past.
    await screen.findByRole('option', { name: /pick a conversation/ })
  })

  it('invites a pick before anything is selected', async () => {
    stubLab({ table: CONVERSATIONS })
    render(<RelationsExplorer />)

    expect(await screen.findByText('Pick or paste a conversation to expand it.')).toBeDefined()
  })

  it('loads a subtree when one is picked', async () => {
    stubLab({ table: CONVERSATIONS, tree: treePayload() })
    render(<RelationsExplorer />)
    await screen.findByRole('option', { name: /où est le wifi · chat/ })

    await userEvent.selectOptions(screen.getByRole('combobox'), UUID)

    expect(await screen.findByText('“où est le wifi”')).toBeDefined()
    expect(labApi.tree).toHaveBeenCalledWith(UUID)
  })

  it('mirrors the picked id into the paste box', async () => {
    stubLab({ table: CONVERSATIONS, tree: treePayload() })
    render(<RelationsExplorer />)
    await screen.findByRole('option', { name: /où est le wifi · chat/ })

    await userEvent.selectOptions(screen.getByRole('combobox'), UUID)
    expect(/** @type {HTMLInputElement} */ (screen.getByPlaceholderText(/paste a conversations.id/)).value).toBe(UUID)
  })

  it('loads a pasted id, trimmed', async () => {
    stubLab({ table: CONVERSATIONS, tree: treePayload() })
    render(<RelationsExplorer />)

    await userEvent.type(screen.getByPlaceholderText(/paste a conversations.id/), `  ${UUID}  `)
    await userEvent.click(screen.getByRole('button', { name: 'Load' }))

    await waitFor(() => expect(labApi.tree).toHaveBeenCalledWith(UUID))
  })

  it('resets the dropdown when the pasted id is not one of its options', async () => {
    // The select must not claim to have selected something it does not list.
    stubLab({ table: CONVERSATIONS, tree: treePayload() })
    render(<RelationsExplorer />)
    await screen.findByRole('option', { name: /où est le wifi · chat/ })

    await userEvent.type(screen.getByPlaceholderText(/paste a conversations.id/), 'some-other-id')
    await userEvent.click(screen.getByRole('button', { name: 'Load' }))

    expect(/** @type {HTMLSelectElement} */ (screen.getByRole('combobox')).value).toBe('')
  })

  it('says the id is unknown rather than showing an empty panel', async () => {
    stubLab({ table: CONVERSATIONS, tree: null })
    render(<RelationsExplorer />)

    await userEvent.type(screen.getByPlaceholderText(/paste a conversations.id/), 'nope')
    await userEvent.click(screen.getByRole('button', { name: 'Load' }))

    expect(await screen.findByText('No conversation with that id.')).toBeDefined()
  })

  it('keeps the paste box usable when the conversation list itself failed', async () => {
    // A gated or broken list must not take the whole panel down — pasting an id
    // is the fallback path.
    stubLab({ table: null, tree: treePayload() })
    render(<RelationsExplorer />)

    expect(await screen.findByText(/you can still paste an id/)).toBeDefined()

    await userEvent.type(screen.getByPlaceholderText(/paste a conversations.id/), UUID)
    await userEvent.click(screen.getByRole('button', { name: 'Load' }))
    expect(await screen.findByText('“où est le wifi”')).toBeDefined()
  })

  it('shows a loading line while the subtree is in flight', async () => {
    /** @type {(v: any) => void} */
    let resolve = () => {}
    vi.spyOn(labApi, 'table').mockResolvedValue(CONVERSATIONS)
    vi.spyOn(labApi, 'tree').mockReturnValue(new Promise((r) => { resolve = r }))
    render(<RelationsExplorer />)

    await userEvent.type(screen.getByPlaceholderText(/paste a conversations.id/), UUID)
    await userEvent.click(screen.getByRole('button', { name: 'Load' }))

    expect(await screen.findByText('Loading tree…')).toBeDefined()
    resolve(treePayload())
    expect(await screen.findByText('“où est le wifi”')).toBeDefined()
  })
})

describe('DbViz', () => {
  const TABLES = [
    { name: 'conversations', columns: [], rowCount: 12 },
    { name: 'messages', columns: [], rowCount: 40 },
    { name: 'nosuchhint', columns: [], rowCount: 1 },
  ]
  /** What the explorer underneath reads for its own picker. */
  const CONVERSATIONS_TABLE = {
    name: 'conversations',
    columns: [],
    rowCount: 0,
    truncated: false,
    rows: [],
  }
  const TABLE_DATA = {
    name: 'conversations',
    columns: [{ name: 'id', type: 'uuid', nullable: false, numeric: false }],
    rows: [{ id: UUID }],
    rowCount: 12,
    truncated: false,
  }

  it('shows a loading line, then the table picker with row counts', async () => {
    stubLab({ tables: TABLES })
    render(<DbViz />)

    expect(screen.getByText('Loading tables…')).toBeDefined()
    expect(await screen.findByRole('option', { name: 'conversations — 12 rows' })).toBeDefined()
    expect(screen.getByRole('option', { name: 'messages — 40 rows' })).toBeDefined()

    // The table list landing is also what mounts the RelationsExplorer under the
    // grid, which immediately reads `conversations` for its own picker. Returning
    // here would leave that read in flight — it then settles outside the test,
    // where the spies are already gone. Wait for its picker to settle.
    await screen.findByText('— pick a conversation (0) —')
  })

  it('says the list could not be loaded, and renders nothing else', async () => {
    stubLab({ tables: null })
    render(<DbViz />)

    expect(await screen.findByText(/Couldn’t load the table list/)).toBeDefined()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('invites a pick and reads no table until one is made', async () => {
    stubLab({ tables: TABLES })
    render(<DbViz />)

    expect(await screen.findByText('Pick a table to inspect its rows.')).toBeDefined()
    // Settling the explorer's own read before asserting: without it the loop
    // below can run over an empty call list and pass vacuously.
    await screen.findByText('— pick a conversation (0) —')

    // `table` IS called once — by the RelationsExplorer mounted underneath, for
    // its own conversation list. What must not happen is a read of a table the
    // operator never picked.
    expect(vi.mocked(labApi.table).mock.calls).toHaveLength(1)
    for (const [name] of vi.mocked(labApi.table).mock.calls) {
      expect(name).toBe('conversations')
    }
  })

  it('loads the picked table and renders its grid with a count line', async () => {
    stubLab({ tables: TABLES, table: TABLE_DATA })
    render(<DbViz />)
    await screen.findByRole('option', { name: /conversations/ })

    await userEvent.selectOptions(screen.getAllByRole('combobox')[0], 'conversations')

    expect(await screen.findByText('1 columns · 12 rows')).toBeDefined()
    expect(screen.getByRole('table')).toBeDefined()
  })

  it('says how many rows the cap actually returned when the slice is truncated', async () => {
    // Without this the operator reads "10000 rows" and believes they are all on
    // screen — the grid's own filter and sort then lie about the whole table.
    stubLab({
      tables: TABLES,
      table: { ...TABLE_DATA, rowCount: 50000, truncated: true },
    })
    render(<DbViz />)
    await screen.findByRole('option', { name: /conversations/ })

    await userEvent.selectOptions(screen.getAllByRole('combobox')[0], 'conversations')
    expect(await screen.findByText('1 columns · 50000 rows · showing 1')).toBeDefined()
  })

  it('explains how the picked table joins to the others, rendering column names as code', async () => {
    stubLab({ tables: TABLES, table: TABLE_DATA })
    const { container } = render(<DbViz />)
    await screen.findByRole('option', { name: /conversations/ })

    await userEvent.selectOptions(screen.getAllByRole('combobox')[0], 'conversations')

    expect(await screen.findByText(/One thread on one/)).toBeDefined()
    const codes = [...container.querySelectorAll('code')].map((c) => c.textContent)
    expect(codes).toContain('page')
    expect(codes).toContain('visitor_id')
  })

  it('omits the hint for a table it has no note for', async () => {
    stubLab({ tables: TABLES, table: { ...TABLE_DATA, name: 'nosuchhint' } })
    const { container } = render(<DbViz />)
    await screen.findByRole('option', { name: /nosuchhint/ })

    await userEvent.selectOptions(screen.getAllByRole('combobox')[0], 'nosuchhint')
    await screen.findByRole('table')

    expect(container.querySelectorAll('code')).toHaveLength(0)
  })

  it('says which table failed rather than showing an empty grid', async () => {
    stubLab({ tables: TABLES, table: null })
    render(<DbViz />)
    await screen.findByRole('option', { name: /conversations/ })

    await userEvent.selectOptions(screen.getAllByRole('combobox')[0], 'conversations')
    expect(await screen.findByText(/Couldn’t load “conversations”/)).toBeDefined()
  })

  it('shows a per-table loading line while the rows are in flight', async () => {
    // `messages` rather than `conversations`: the RelationsExplorer mounted
    // underneath reads the `conversations` table for its own picker, so both
    // panels would print "Loading conversations…" and the query would be
    // ambiguous — a real property of this screen, not a test artefact.
    /** @type {(v: any) => void} */
    let resolve = () => {}
    vi.spyOn(labApi, 'tables').mockResolvedValue(TABLES)
    vi.spyOn(labApi, 'table').mockImplementation((name) =>
      name === 'messages'
        ? new Promise((r) => { resolve = r })
        : Promise.resolve(CONVERSATIONS_TABLE),
    )
    render(<DbViz />)
    await screen.findByRole('option', { name: 'messages — 40 rows' })

    await userEvent.selectOptions(screen.getAllByRole('combobox')[0], 'messages')
    expect(await screen.findByText('Loading messages…')).toBeDefined()

    resolve({ ...TABLE_DATA, name: 'messages' })
    expect(await screen.findByRole('table')).toBeDefined()
  })

  it('goes back to the invitation when the picker is cleared', async () => {
    stubLab({ tables: TABLES, table: TABLE_DATA })
    render(<DbViz />)
    await screen.findByRole('option', { name: /conversations/ })

    await userEvent.selectOptions(screen.getAllByRole('combobox')[0], 'conversations')
    await screen.findByRole('table')

    await userEvent.selectOptions(screen.getAllByRole('combobox')[0], '')
    expect(screen.getByText('Pick a table to inspect its rows.')).toBeDefined()
  })

  it('always mounts the relations explorer under the grid', async () => {
    stubLab({ tables: TABLES })
    render(<DbViz />)

    expect(await screen.findByText('Relations explorer')).toBeDefined()
    expect(screen.getByPlaceholderText(/paste a conversations.id/)).toBeDefined()
    await screen.findByText('— pick a conversation (0) —')
  })
})

describe('ConversationBrowser', () => {
  /**
   * The arguments of the most recent list call. A call that never happened
   * should fail here loudly rather than read as `undefined`.
   *
   * @returns {any}
   */
  function lastListCall() {
    const call = vi.mocked(labApi.analyticsConversations).mock.calls.at(-1)
    if (!call) throw new Error('expected analyticsConversations to have been called')
    return call[0]
  }

  const ITEMS = [
    { id: UUID, page: 'chat', title: 'où est le wifi', messageCount: 4, hasNegativeFeedback: false, updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() },
    { id: OTHER, page: 'archiviste', title: '', messageCount: 2, hasNegativeFeedback: true, updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() },
  ]

  it('lists every thread with its page, count and age', async () => {
    stubLab({ conversations: { items: ITEMS, total: 2 } })
    render(<ConversationBrowser />)

    expect(await screen.findByText('où est le wifi')).toBeDefined()
    expect(screen.getByText('(no title)')).toBeDefined()
    expect(screen.getByText('4 msg')).toBeDefined()

    // Scoped to the list: 'chat' is also an <option> in the page filter above.
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]).getByText('chat')).toBeDefined()
    expect(within(rows[1]).getByText('archiviste')).toBeDefined()
  })

  it('flags a thread holding a thumbs-down answer', async () => {
    stubLab({ conversations: { items: ITEMS, total: 2 } })
    render(<ConversationBrowser />)
    await screen.findByText('où est le wifi')

    expect(screen.getByTitle('has a 👎 answer')).toBeDefined()
  })

  it('defaults to all time — no date bound is sent', async () => {
    stubLab({ conversations: { items: [], total: 0 } })
    render(<ConversationBrowser />)

    await waitFor(() => expect(labApi.analyticsConversations).toHaveBeenCalled())
    expect(vi.mocked(labApi.analyticsConversations).mock.calls[0][0]).toEqual({
      from: undefined, to: undefined, limit: 20, offset: 0, page: undefined,
    })
  })

  it('turns the two date fields into a full-day window', async () => {
    // `to` has to reach the end of its day, or the last day of the range comes
    // back empty and the filter silently loses a day.
    stubLab({ conversations: { items: [], total: 0 } })
    render(<ConversationBrowser />)
    await waitFor(() => expect(labApi.analyticsConversations).toHaveBeenCalled())

    await userEvent.type(screen.getByLabelText('from'), '2026-03-01')
    await userEvent.type(screen.getByLabelText('to'), '2026-03-08')

    await waitFor(() =>
      expect(lastListCall()).toMatchObject({
        from: '2026-03-01T00:00:00Z',
        to: '2026-03-08T23:59:59Z',
      }),
    )
  })

  it('filters by page and returns to the first page on every filter change', async () => {
    stubLab({ conversations: { items: ITEMS, total: 60 } })
    render(<ConversationBrowser />)
    await screen.findByText('où est le wifi')

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(lastListCall().offset).toBe(20))

    await userEvent.selectOptions(screen.getByRole('combobox'), 'archiviste')
    await waitFor(() =>
      expect(lastListCall()).toMatchObject({ page: 'archiviste', offset: 0 }),
    )
  })

  it('pages backwards without going below zero', async () => {
    stubLab({ conversations: { items: ITEMS, total: 60 } })
    render(<ConversationBrowser />)
    await screen.findByText('où est le wifi')

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(lastListCall().offset).toBe(20))

    await userEvent.click(screen.getByRole('button', { name: 'Prev' }))
    await waitFor(() => expect(lastListCall().offset).toBe(0))
  })

  it('hides the pager when everything fits on one page', async () => {
    stubLab({ conversations: { items: ITEMS, total: 2 } })
    render(<ConversationBrowser />)
    await screen.findByText('où est le wifi')

    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
  })

  it('says nothing matches rather than showing a blank card', async () => {
    stubLab({ conversations: { items: [], total: 0 } })
    render(<ConversationBrowser />)

    expect(await screen.findByText('No conversations match this filter.')).toBeDefined()
  })

  it('surfaces a failed list', async () => {
    stubLab({ conversations: null })
    render(<ConversationBrowser />)

    expect(await screen.findByText('Couldn’t load conversations.')).toBeDefined()
  })

  it('shows a loading line first', async () => {
    stubLab({ conversations: { items: [], total: 0 } })
    render(<ConversationBrowser />)

    expect(screen.getByText('Loading…')).toBeDefined()
    await screen.findByText('No conversations match this filter.')
  })

  it('opens one transcript and comes back to the list', async () => {
    stubLab({ conversations: { items: ITEMS, total: 2 }, conversation: treePayload() })
    render(<ConversationBrowser />)

    await userEvent.click(await screen.findByText('où est le wifi'))
    expect(await screen.findByText('“où est le wifi”')).toBeDefined()
    expect(labApi.analyticsConversation).toHaveBeenCalledWith(UUID)

    await userEvent.click(screen.getByRole('button', { name: '← Back to list' }))
    expect(await screen.findByText('4 msg')).toBeDefined()
  })

  it('shows a loading line then an error when the transcript fails', async () => {
    stubLab({ conversations: { items: ITEMS, total: 2 }, conversation: null })
    render(<ConversationBrowser />)

    await userEvent.click(await screen.findByText('où est le wifi'))
    expect(await screen.findByText('Couldn’t load that conversation.')).toBeDefined()
  })

  it('reuses the shared Tree rather than growing a third transcript view', async () => {
    // Same renderer as the 💾 relations explorer: the assistant's documents and
    // its 👍/👎 show here too, with no duplicated markup to drift.
    stubLab({ conversations: { items: ITEMS, total: 2 }, conversation: treePayload() })
    render(<ConversationBrowser />)

    await userEvent.click(await screen.findByText('où est le wifi'))
    await screen.findByText('“où est le wifi”')

    expect(screen.getByText('📄 1 document')).toBeDefined()
    expect(screen.getByText('👍 +1')).toBeDefined()
  })
})
