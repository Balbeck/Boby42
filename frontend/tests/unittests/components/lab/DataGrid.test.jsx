import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import DataGrid, { ChevronSelect } from '../../../../src/components/lab/DataGrid'

// The 💾 grid. It is purely presentational — no fetch — but it carries more
// logic than anything else in /lab: a per-column comparator chosen from the
// column's type, a filter across every column, client-side paging, and a cell
// renderer that dispatches on what the value actually IS.
//
// The through-line of this suite is that a WRONG answer here looks exactly like
// a right one. A grid sorted by the wrong comparator, or paging over the
// unfiltered set, still renders a plausible table of real rows — there is no
// crash and no empty state to notice. So the assertions are on order and on
// counts, not on "does it render".

/** @param {Partial<{ name: string, type: string, numeric: boolean }>} [overrides] */
function column(overrides = {}) {
  return { name: 'content', type: 'text', numeric: false, ...overrides }
}

const UUID_A = '11111111-2222-4333-8444-555555555555'
const UUID_B = '99999999-8888-4777-8666-555555555555'

/** The visible text of every body row, in render order. */
function bodyRows() {
  const table = screen.getByRole('table')
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.textContent ?? '')
}

/** The values of one column, in render order. */
function columnValues(/** @type {number} */ index) {
  const table = screen.getByRole('table')
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.querySelectorAll('td')[index + 1]?.textContent?.trim() ?? '')
}

let writeText = vi.fn()

beforeEach(() => {
  writeText = vi.fn()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('DataGrid — the frame', () => {
  it('says so instead of rendering an empty table when the schema is empty', () => {
    render(<DataGrid columns={[]} rows={[]} />)

    expect(screen.getByText('This table has no columns.')).toBeDefined()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('renders a header per column with a readable short type', () => {
    render(
      <DataGrid
        columns={[
          column({ name: 'id', type: 'uuid' }),
          column({ name: 'created_at', type: 'timestamp with time zone' }),
          column({ name: 'title', type: 'character varying' }),
          column({ name: 'score', type: 'double precision', numeric: true }),
          column({ name: 'page', type: 'enum_conversations_page' }),
          column({ name: 'ok', type: 'boolean' }),
          column({ name: 'mystery', type: undefined }),
        ]}
        rows={[]}
      />,
    )

    const headers = screen.getAllByRole('columnheader')
    expect(headers.map((h) => h.textContent)).toEqual([
      'iduuid',
      'created_attimestamptz',
      'titlevarchar',
      'scorefloat8',
      'pageenum',
      'okbool',
      'mystery—',
    ])
  })

  it('shows an empty-table note, and a different one when a filter hides everything', async () => {
    render(<DataGrid columns={[column()]} rows={[]} />)
    expect(screen.getByText('No rows yet.')).toBeDefined()

    await userEvent.type(screen.getByPlaceholderText('Filter rows…'), 'zzz')
    expect(screen.getByText('No rows match “zzz”.')).toBeDefined()
  })
})

describe('DataGrid — filtering', () => {
  const columns = [column({ name: 'name', type: 'text' }), column({ name: 'page', type: 'enum_x' })]
  const rows = [
    { name: 'Wi-Fi', page: 'chat' },
    { name: 'Badge perdu', page: 'archiviste' },
    { name: 'Alternance', page: 'chat' },
  ]

  it('matches across every column, case-insensitively', async () => {
    render(<DataGrid columns={columns} rows={rows} />)

    await userEvent.type(screen.getByPlaceholderText('Filter rows…'), 'ARCHIV')
    expect(bodyRows()).toHaveLength(1)
    expect(screen.getByText('Badge perdu')).toBeDefined()
  })

  it('reads out the visible slice and says what it was filtered from', async () => {
    render(<DataGrid columns={columns} rows={rows} />)
    expect(screen.getByText('1–3')).toBeDefined()

    await userEvent.type(screen.getByPlaceholderText('Filter rows…'), 'chat')
    expect(screen.getByText('1–2')).toBeDefined()
    expect(screen.getByText(/\(filtered from 3\)/)).toBeDefined()
  })

  it('ignores surrounding whitespace rather than matching nothing', async () => {
    render(<DataGrid columns={columns} rows={rows} />)

    await userEvent.type(screen.getByPlaceholderText('Filter rows…'), '  wi-fi  ')
    expect(bodyRows()).toHaveLength(1)
  })

  it('reads a null cell as empty and a Date as its ISO string when filtering', async () => {
    // The filter stringifies every cell of every row. A null would throw on
    // `.toLowerCase()` and a Date would match nothing useful — both are handled
    // before the comparison, and only a filter pass exercises that.
    render(
      <DataGrid
        columns={[column({ name: 'name', type: 'character varying' }), column({ name: 'when', type: 'timestamp with time zone' })]}
        rows={[
          { name: null, when: new Date('2026-03-08T10:00:00Z') },
          { name: 'Wi-Fi', when: null },
        ]}
      />,
    )

    await userEvent.type(screen.getByPlaceholderText('Filter rows…'), '2026-03-08')
    expect(bodyRows()).toHaveLength(1)
  })

  it('searches the rendered text of a JSON cell, not "[object Object]"', async () => {
    render(
      <DataGrid
        columns={[column({ name: 'payload', type: 'jsonb' })]}
        rows={[{ payload: { question: 'où est le wifi' } }, { payload: { question: 'autre' } }]}
      />,
    )

    await userEvent.type(screen.getByPlaceholderText('Filter rows…'), 'wifi')
    expect(bodyRows()).toHaveLength(1)
  })
})

describe('DataGrid — sorting', () => {
  // `character varying`, not `text`: a `text` column is matched by the
  // long-text kind and sorted BY LENGTH, which is the right behaviour there and
  // the wrong fixture for testing the asc/desc/off cycle.
  const columns = [column({ name: 'name', type: 'character varying' })]
  const rows = [{ name: 'banane' }, { name: 'abricot' }, { name: 'cerise' }]

  it('cycles a header ascending → descending → off, and says so through aria-sort', async () => {
    render(<DataGrid columns={columns} rows={rows} />)
    const header = screen.getByRole('columnheader', { name: /name/ })

    expect(header.getAttribute('aria-sort')).toBe('none')
    expect(columnValues(0)).toEqual(['banane', 'abricot', 'cerise'])

    await userEvent.click(header)
    expect(header.getAttribute('aria-sort')).toBe('ascending')
    expect(columnValues(0)).toEqual(['abricot', 'banane', 'cerise'])

    await userEvent.click(header)
    expect(header.getAttribute('aria-sort')).toBe('descending')
    expect(columnValues(0)).toEqual(['cerise', 'banane', 'abricot'])

    await userEvent.click(header)
    expect(header.getAttribute('aria-sort')).toBe('none')
    expect(columnValues(0)).toEqual(['banane', 'abricot', 'cerise'])
  })

  it('moves the sort to another column instead of adding a second one', async () => {
    render(
      <DataGrid
        columns={[column({ name: 'a', type: 'text' }), column({ name: 'b', type: 'text' })]}
        rows={[{ a: 'x', b: '2' }, { a: 'y', b: '1' }]}
      />,
    )

    await userEvent.click(screen.getByRole('columnheader', { name: /^a/ }))
    await userEvent.click(screen.getByRole('columnheader', { name: /^b/ }))

    expect(screen.getByRole('columnheader', { name: /^a/ }).getAttribute('aria-sort')).toBe('none')
    expect(screen.getByRole('columnheader', { name: /^b/ }).getAttribute('aria-sort')).toBe('ascending')
  })

  it('keeps NULL, undefined and empty last in BOTH directions', async () => {
    // Sorting empties to the top in descending order would bury every real row
    // under a wall of ∅ — and the table would still look sorted.
    render(
      <DataGrid
        columns={columns}
        rows={[{ name: 'b' }, { name: null }, { name: 'a' }, { name: '' }, {}]}
      />,
    )
    const header = screen.getByRole('columnheader', { name: /name/ })

    await userEvent.click(header)
    expect(columnValues(0).slice(0, 2)).toEqual(['a', 'b'])
    expect(columnValues(0).slice(2)).toEqual(['∅', '', '∅'])

    await userEvent.click(header)
    expect(columnValues(0).slice(0, 2)).toEqual(['b', 'a'])
    expect(columnValues(0).slice(2)).toEqual(['∅', '', '∅'])
  })
})

describe('DataGrid — the per-column comparators', () => {
  /**
   * Sorts one column ascending and returns the rendered order.
   *
   * @param {{ name: string, type?: string, numeric?: boolean }} col
   * @param {object[]} rows
   */
  async function sortedAsc(col, rows) {
    const view = render(<DataGrid columns={[col]} rows={rows} />)
    await userEvent.click(screen.getByRole('columnheader'))
    const values = columnValues(0)
    const hint = screen.getByRole('columnheader').textContent ?? ''
    view.unmount()
    return { values, hint }
  }

  it('sorts a numeric column numerically, not as text', async () => {
    // The failure this catches is the classic one: as strings, 100 sorts before 9.
    const { values, hint } = await sortedAsc(
      { name: 'latency_ms', type: 'integer', numeric: true },
      [{ latency_ms: 100 }, { latency_ms: 9 }, { latency_ms: 25 }],
    )
    expect(values).toEqual(['9', '25', '100'])
    expect(hint).toContain('low→high')
  })

  it('sorts timestamps chronologically', async () => {
    const { values, hint } = await sortedAsc(
      { name: 'created_at', type: 'timestamp with time zone' },
      [
        { created_at: '2026-03-08T10:00:00.000Z' },
        { created_at: '2026-01-02T10:00:00.000Z' },
        { created_at: '2026-02-05T10:00:00.000Z' },
      ],
    )
    expect(values.map((v) => v.slice(0, 7))).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(hint).toContain('oldest→')
  })

  it('sorts a rating column low to high, so the 👎 rows group first', async () => {
    const { values, hint } = await sortedAsc(
      { name: 'rating', type: 'smallint', numeric: true },
      [{ rating: 1 }, { rating: -1 }, { rating: 1 }],
    )
    expect(values).toEqual(['👎 −1', '👍 +1', '👍 +1'])
    expect(hint).toContain('low→high')
  })

  it('sorts booleans false-then-true, whatever shape the driver returned', async () => {
    const { values, hint } = await sortedAsc(
      { name: 'truncated', type: 'boolean' },
      [{ truncated: true }, { truncated: false }, { truncated: 't' }],
    )
    expect(values).toEqual(['false', 'true', 't'])
    expect(hint).toContain('low→high')
  })

  it('sorts a JSON column by size — the big payloads are the interesting ones', async () => {
    const { values, hint } = await sortedAsc({ name: 'payload', type: 'jsonb' }, [
      { payload: { a: 1, b: 2, c: 3 } },
      { payload: { a: 1 } },
      { payload: { a: 1, b: 2 } },
    ])
    expect(values.map((v) => v.length)).toEqual([...values.map((v) => v.length)].sort((x, y) => x - y))
    expect(hint).toContain('by size')
  })

  it('treats a column holding objects as JSON even when the type says otherwise', async () => {
    const { hint } = await sortedAsc({ name: 'anything', type: 'text' }, [
      { anything: { a: 1, b: 2 } },
      { anything: { a: 1 } },
    ])
    expect(hint).toContain('by size')
  })

  it('groups an enum column alphabetically', async () => {
    const { values, hint } = await sortedAsc({ name: 'page', type: 'enum_conversations_page' }, [
      { page: 'chat' },
      { page: 'archiviste' },
      { page: 'chat' },
    ])
    expect(values).toEqual(['archiviste', 'chat', 'chat'])
    expect(hint).toContain('grouped')
  })

  it('groups by name for the enum-ish columns that are not pg enums', async () => {
    const { hint } = await sortedAsc({ name: 'role', type: 'character varying' }, [
      { role: 'user' },
      { role: 'assistant' },
    ])
    expect(hint).toContain('grouped')
  })

  it('sorts long text by length — a one-word answer next to an essay', async () => {
    const { values, hint } = await sortedAsc({ name: 'content', type: 'text' }, [
      { content: 'une réponse de longueur moyenne' },
      { content: 'court' },
      { content: 'x'.repeat(200) },
    ])
    expect(values[0]).toBe('court')
    expect(values[2]).toHaveLength(200)
    expect(hint).toContain('by length')
  })

  it('falls back to A→Z for a plain short column of an unknown type', async () => {
    const { values, hint } = await sortedAsc({ name: 'anon_id', type: 'uuid-ish' }, [
      { anon_id: 'zeta' },
      { anon_id: 'alpha' },
    ])
    expect(values).toEqual(['alpha', 'zeta'])
    expect(hint).toContain('A→Z')
  })

  it('compares strings naturally, so item-10 comes after item-9', async () => {
    const { values } = await sortedAsc({ name: 'anon_id', type: 'uuid-ish' }, [
      { anon_id: 'item-10' },
      { anon_id: 'item-9' },
    ])
    expect(values).toEqual(['item-9', 'item-10'])
  })
})

describe('DataGrid — paging', () => {
  const columns = [column({ name: 'n', type: 'integer', numeric: true })]
  const rows = Array.from({ length: 120 }, (_, i) => ({ n: i + 1 }))

  it('shows the first page and its position', () => {
    render(<DataGrid columns={columns} rows={rows} />)

    expect(bodyRows()).toHaveLength(100)
    expect(screen.getByText('1–100')).toBeDefined()
    expect(screen.getByText('1 / 2')).toBeDefined()
  })

  it('walks forward and back, disabling the ends', async () => {
    render(<DataGrid columns={columns} rows={rows} />)
    const prev = screen.getByRole('button', { name: '‹ Prev' })
    const next = screen.getByRole('button', { name: 'Next ›' })

    expect(prev.hasAttribute('disabled')).toBe(true)

    await userEvent.click(next)
    expect(bodyRows()).toHaveLength(20)
    expect(screen.getByText('101–120')).toBeDefined()
    expect(next.hasAttribute('disabled')).toBe(true)

    await userEvent.click(prev)
    expect(screen.getByText('1–100')).toBeDefined()
  })

  it('changes the page size, and "all" turns paging off', async () => {
    render(<DataGrid columns={columns} rows={rows} />)
    const size = screen.getByRole('combobox')

    await userEvent.selectOptions(size, '50')
    expect(bodyRows()).toHaveLength(50)
    expect(screen.getByText('1 / 3')).toBeDefined()

    await userEvent.selectOptions(size, 'all')
    expect(bodyRows()).toHaveLength(120)
    expect(screen.getByText('1 / 1')).toBeDefined()
  })

  it('returns to page 1 when the filter, the sort or the page size changes', async () => {
    // Staying on page 3 of a set that now has one page shows an empty table of
    // real data — nothing errors, the operator just sees nothing.
    render(<DataGrid columns={columns} rows={rows} />)
    const next = screen.getByRole('button', { name: 'Next ›' })

    await userEvent.click(next)
    expect(screen.getByText('2 / 2')).toBeDefined()

    await userEvent.type(screen.getByPlaceholderText('Filter rows…'), '1')
    expect(screen.getByText(/^1 \//)).toBeDefined()

    await userEvent.clear(screen.getByPlaceholderText('Filter rows…'))
    await userEvent.click(next)
    await userEvent.click(screen.getByRole('columnheader'))
    expect(screen.getByText('1 / 2')).toBeDefined()

    await userEvent.click(next)
    await userEvent.selectOptions(screen.getByRole('combobox'), '50')
    expect(screen.getByText('1 / 3')).toBeDefined()
  })

  it('returns to page 1 when the table itself changes', async () => {
    const { rerender } = render(<DataGrid columns={columns} rows={rows} />)
    await userEvent.click(screen.getByRole('button', { name: 'Next ›' }))
    expect(screen.getByText('2 / 2')).toBeDefined()

    rerender(<DataGrid columns={columns} rows={rows.slice(0, 30)} />)
    expect(screen.getByText('1 / 1')).toBeDefined()
  })

  it('pages over the FILTERED set, not the fetched one', async () => {
    render(<DataGrid columns={columns} rows={rows} />)

    await userEvent.type(screen.getByPlaceholderText('Filter rows…'), '11')
    // 11, 110–119 → 11 rows, one page.
    expect(screen.getByText('1 / 1')).toBeDefined()
    expect(bodyRows()).toHaveLength(11)
  })
})

describe('DataGrid — the cell renderer', () => {
  /** @param {{ name: string, type?: string, numeric?: boolean }} col @param {unknown} value */
  function renderCell(col, value) {
    return render(<DataGrid columns={[col]} rows={[{ [col.name]: value }]} />)
  }

  it('renders NULL and undefined as ∅, never as "null"', () => {
    const { unmount } = renderCell({ name: 'x', type: 'text' }, null)
    expect(screen.getByText('∅')).toBeDefined()
    unmount()

    render(<DataGrid columns={[column({ name: 'x' })]} rows={[{}]} />)
    expect(screen.getByText('∅')).toBeDefined()
  })

  it('renders a rating as a thumb, and anything else through as-is', () => {
    const { unmount } = renderCell({ name: 'rating', numeric: true }, 1)
    expect(screen.getByText('👍 +1')).toBeDefined()
    unmount()

    const second = renderCell({ name: 'rating', numeric: true }, -1)
    expect(screen.getByText('👎 −1')).toBeDefined()
    second.unmount()

    renderCell({ name: 'rating', numeric: true }, 0)
    expect(screen.getByText('0')).toBeDefined()
  })

  it('renders a timestamp in local time and keeps the ISO on hover', () => {
    renderCell({ name: 'created_at', type: 'timestamp with time zone' }, '2026-03-08T10:00:00.000Z')

    const cell = screen.getByRole('button', { name: /2026-03-08/ })
    expect(cell.getAttribute('title')).toContain('2026-03-08T10:00:00.000Z')
    expect(cell.getAttribute('title')).toContain('local time')
  })

  it('renders a real Date object too', () => {
    renderCell({ name: 'created_at', type: 'timestamp with time zone' }, new Date('2026-03-08T10:00:00Z'))
    expect(screen.getByRole('button', { name: /2026-03-08/ })).toBeDefined()
  })

  it('leaves an unparseable timestamp as plain text instead of Invalid Date', () => {
    renderCell({ name: 'created_at', type: 'timestamp with time zone' }, 'not a date')
    expect(screen.getByText('not a date')).toBeDefined()
  })

  it('shortens a UUID and gives it a colour chip hashed from the full value', () => {
    // The chip is the only "same exchange" cue in a normalised schema — rows
    // sharing a conversation_id must share a colour, across tables.
    const { container, unmount } = renderCell({ name: 'id', type: 'uuid' }, UUID_A)
    const first = /** @type {HTMLElement} */ (container.querySelector('td span[style*="background"]'))
    expect(screen.getByRole('button', { name: `Copy id ${UUID_A}` }).textContent).toBe('11111111…')
    const colourA = first.style.backgroundColor
    unmount()

    const again = renderCell({ name: 'conversation_id', type: 'uuid' }, UUID_A)
    const sameId = /** @type {HTMLElement} */ (
      again.container.querySelector('td span[style*="background"]')
    )
    expect(sameId.style.backgroundColor).toBe(colourA)
    again.unmount()

    const other = renderCell({ name: 'id', type: 'uuid' }, UUID_B)
    const otherChip = /** @type {HTMLElement} */ (
      other.container.querySelector('td span[style*="background"]')
    )
    expect(otherChip.style.backgroundColor).not.toBe(colourA)
  })

  it('renders an object as one-line JSON with the full value on hover', () => {
    renderCell({ name: 'payload', type: 'jsonb' }, { question: 'où est le wifi', language: 'fr' })

    const cell = screen.getByRole('button', { name: /question/ })
    expect(cell.textContent).toBe('{"question":"où est le wifi","language":"fr"}')
    expect(cell.getAttribute('title')).toBe(cell.textContent)
  })

  it('renders a numeric value monospaced rather than as a copy button', () => {
    renderCell({ name: 'latency_ms', type: 'integer', numeric: true }, 1234)

    expect(screen.getByText('1234')).toBeDefined()
    expect(screen.queryByRole('button', { name: '1234' })).toBeNull()
  })

  it('badges an enum and an enum-ish column', () => {
    const { unmount } = renderCell({ name: 'page', type: 'enum_conversations_page' }, 'chat')
    expect(screen.getByText('chat')).toBeDefined()
    unmount()

    renderCell({ name: 'language', type: 'character varying' }, 'fr')
    expect(screen.getByText('fr')).toBeDefined()
  })

  it('keeps long text hoverable in full', () => {
    const long = 'x'.repeat(60)
    renderCell({ name: 'content', type: 'text' }, long)

    expect(screen.getByRole('button', { name: long }).getAttribute('title')).toBe(long)
  })

  it('adds no hover title to short text — there is nothing hidden', () => {
    renderCell({ name: 'content', type: 'text' }, 'court')
    expect(screen.getByRole('button', { name: 'court' }).getAttribute('title')).toBeNull()
  })
})

describe('DataGrid — copying', () => {
  const columns = [column({ name: 'id', type: 'uuid' }), column({ name: 'content', type: 'text' })]
  const rows = [{ id: UUID_A, content: 'une réponse' }]

  it('copies a cell value in full, not the shortened display', async () => {
    // The point of copying a UUID is to paste it into a WHERE clause; the eight
    // visible characters would be useless.
    render(<DataGrid columns={columns} rows={rows} />)

    await userEvent.click(screen.getByRole('button', { name: `Copy id ${UUID_A}` }))
    expect(writeText).toHaveBeenCalledWith(UUID_A)
  })

  it('copies a whole row as JSON', async () => {
    render(<DataGrid columns={columns} rows={rows} />)

    await userEvent.click(screen.getByRole('button', { name: 'Copy row as JSON' }))
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(rows[0]))
  })

  it('copies a JSON cell and a plain text cell', async () => {
    render(
      <DataGrid
        columns={[column({ name: 'payload', type: 'jsonb' }), column({ name: 'content', type: 'text' })]}
        rows={[{ payload: { a: 1 }, content: 'une réponse' }]}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: '{"a":1}' }))
    expect(writeText).toHaveBeenCalledWith('{"a":1}')

    await userEvent.click(screen.getByRole('button', { name: 'une réponse' }))
    expect(writeText).toHaveBeenLastCalledWith('une réponse')
  })

  it('copies a timestamp as its ISO string, not as the displayed local time', async () => {
    render(
      <DataGrid
        columns={[column({ name: 'created_at', type: 'timestamp with time zone' })]}
        rows={[{ created_at: '2026-03-08T10:00:00.000Z' }]}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /2026-03-08/ }))
    expect(writeText).toHaveBeenCalledWith('2026-03-08T10:00:00.000Z')
  })

  it('confirms through a polite live region, then clears it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<DataGrid columns={columns} rows={rows} />)

    const status = screen.getByRole('status')
    expect(status.textContent?.trim()).toBe('')

    await userEvent.click(screen.getByRole('button', { name: 'Copy row as JSON' }))
    expect(status.textContent).toBe('Copied ✓')

    act(() => vi.advanceTimersByTime(1300))
    expect(status.textContent?.trim()).toBe('')
  })

  it('still confirms when the clipboard refuses — the grid must not break', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(() => { throw new Error('denied') }) },
      configurable: true,
    })
    render(<DataGrid columns={columns} rows={rows} />)

    await userEvent.click(screen.getByRole('button', { name: 'Copy row as JSON' }))
    expect(screen.getByRole('status').textContent).toBe('Copied ✓')
  })

  it('clears its pending timer on unmount', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout')
    const { unmount } = render(<DataGrid columns={columns} rows={rows} />)

    await userEvent.click(screen.getByRole('button', { name: 'Copy row as JSON' }))
    unmount()

    expect(clearTimeoutSpy).toHaveBeenCalled()
  })
})

describe('ChevronSelect', () => {
  it('is a real <select> underneath — keyboard and screen reader intact', async () => {
    const onChange = vi.fn()
    render(
      <ChevronSelect value="b" onChange={onChange} aria-label="Pick one">
        <option value="a">A</option>
        <option value="b">B</option>
      </ChevronSelect>,
    )

    const select = screen.getByRole('combobox', { name: 'Pick one' })
    expect(/** @type {HTMLSelectElement} */ (select).value).toBe('b')

    await userEvent.selectOptions(select, 'a')
    expect(onChange).toHaveBeenCalled()
  })

  it('keeps the drawn chevron out of the accessibility tree', () => {
    const { container } = render(
      <ChevronSelect value="a" onChange={() => {}}>
        <option value="a">A</option>
      </ChevronSelect>,
    )

    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })
})
