import { useMemo, useState } from 'react'

/**
 * Presentational sortable grid. Sorting is the only interaction — a header click
 * cycles that column asc → desc → none. No search, no column toggles, no
 * pagination (all cheap to add later against the same in-memory rows).
 *
 * The whole grid scrolls inside its own box; the page body never scrolls
 * sideways. `null` / `undefined` show as a muted ∅; an object / array cell
 * (events.payload) is one-line JSON with the full value on hover.
 *
 * @param {{ columns: Array<{ name: string, type?: string, numeric?: boolean }>, rows: object[] }} props
 */
export default function DataGrid({ columns, rows }) {
  const [sort, setSort] = useState({ col: null, dir: null }) // dir: 'asc' | 'desc' | null

  const view = useMemo(() => {
    if (!sort.col || !sort.dir) return rows
    const copy = [...rows]
    copy.sort((a, b) => {
      const cmp = compare(a[sort.col], b[sort.col])
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [rows, sort])

  function cycle(name) {
    setSort((s) => {
      if (s.col !== name) return { col: name, dir: 'asc' }
      if (s.dir === 'asc') return { col: name, dir: 'desc' }
      return { col: null, dir: null }
    })
  }

  if (!columns.length) {
    return <p className="text-sm text-chat-text-muted">This table has no columns.</p>
  }

  return (
    <div className="max-h-[70vh] overflow-auto rounded-lg border border-chat-border">
      <table className="min-w-full border-collapse text-left text-sm">
        <thead className="sticky top-0 z-10 bg-chat-surface-2">
          <tr>
            {columns.map((col) => {
              const on = sort.col === col.name
              return (
                <th
                  key={col.name}
                  scope="col"
                  aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  onClick={() => cycle(col.name)}
                  title={col.type}
                  className={`cursor-pointer border-b border-chat-border px-3 py-2 font-medium whitespace-nowrap select-none transition-colors hover:text-chat-text ${
                    on ? 'text-chat-green' : 'text-chat-text-muted'
                  } ${col.numeric ? 'text-right' : ''}`}
                >
                  {col.name}
                  <span aria-hidden="true" className="ml-1 inline-block w-2 text-chat-green">
                    {on ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {view.length === 0 && (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-6 text-center text-sm text-chat-text-muted"
              >
                No rows yet.
              </td>
            </tr>
          )}
          {view.map((row, i) => (
            <tr key={i} className="odd:bg-chat-surface/30 hover:bg-chat-surface-2/50">
              {columns.map((col) => {
                const cell = format(row[col.name])
                return (
                  <td
                    key={col.name}
                    title={cell.title}
                    className={`max-w-[22rem] truncate border-b border-chat-border/40 px-3 py-1.5 align-top ${
                      cell.muted ? 'text-chat-text-muted' : 'text-chat-text'
                    } ${col.numeric ? 'text-right tabular-nums' : ''}`}
                  >
                    {cell.text}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * @param {unknown} value
 * @returns {{ text: string, title: string | undefined, muted: boolean }}
 */
function format(value) {
  if (value === null || value === undefined) return { text: '∅', title: undefined, muted: true }
  if (value instanceof Date) {
    const iso = value.toISOString()
    return { text: iso, title: iso, muted: false }
  }
  if (typeof value === 'object') {
    const json = JSON.stringify(value)
    return { text: json, title: json, muted: false }
  }
  const text = String(value)
  return { text, title: text.length > 60 ? text : undefined, muted: false }
}

/** Empty values sort after non-empty (so first in desc); dates and numbers numeric, the rest natural-string. */
function compare(a, b) {
  const aEmpty = a === null || a === undefined
  const bEmpty = b === null || b === undefined
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}
