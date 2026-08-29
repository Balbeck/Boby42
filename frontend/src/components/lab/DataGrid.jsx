import { useEffect, useMemo, useRef, useState } from 'react'
import { UUID_RE, chipColor, fmtTimestamp } from './format'

/**
 * Presentational grid for one raw table. The interaction-logging schema is
 * normalised — an exchange is spread across conversations / messages /
 * message_documents / events / message_feedback and linked only by UUIDs — so
 * the job here is to make those raw rows scannable without a join:
 *
 *   • UUIDs render short + monospace, each with a colour chip hashed from the
 *     full value → rows sharing a conversation_id / message_id share a colour,
 *     and that colour is stable when you switch tables. That is the "same
 *     exchange" cue, done on the display side only.
 *   • timestamps → compact local `YYYY-MM-DD HH:MM:SS` (full ISO on hover)
 *   • objects (events.payload) → one-line JSON (full value on hover)
 *   • enums (role, page, rating…) → quiet badges; rating → 👍 / 👎
 *   • any cell click copies its raw value; the ⧉ in the first column copies the
 *     whole row as JSON — for pasting straight into a SQL WHERE clause
 *   • one free-text filter across all columns; header click sorts (asc → desc →
 *     off), always on the raw value
 *
 * The grid scrolls inside its own box; the page body never scrolls sideways.
 *
 * @param {{ columns: Array<{ name: string, type?: string, numeric?: boolean }>, rows: object[] }} props
 */

const ENUMISH = new Set(['role', 'page', 'type', 'error_code', 'language'])

export default function DataGrid({ columns, rows }) {
  const [sort, setSort] = useState({ col: null, dir: null }) // dir: 'asc' | 'desc' | null
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(0)

  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  const view = useMemo(() => {
    const q = query.trim().toLowerCase()
    let out = q
      ? rows.filter((row) => columns.some((c) => cellText(row[c.name]).toLowerCase().includes(q)))
      : rows
    if (sort.col && sort.dir) {
      out = [...out].sort((a, b) => {
        const cmp = compare(a[sort.col], b[sort.col])
        return sort.dir === 'asc' ? cmp : -cmp
      })
    }
    return out
  }, [rows, columns, query, sort])

  function cycle(name) {
    setSort((s) => {
      if (s.col !== name) return { col: name, dir: 'asc' }
      if (s.dir === 'asc') return { col: name, dir: 'desc' }
      return { col: null, dir: null }
    })
  }

  function copy(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    try {
      navigator.clipboard?.writeText(text)
    } catch {
      /* clipboard unavailable — nothing useful to do */
    }
    setToast('Copied ✓')
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 1200)
  }

  if (!columns.length) {
    return <p className="text-sm text-chat-text-muted">This table has no columns.</p>
  }

  return (
    <div className="flex w-full max-w-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter rows…"
          className="w-56 rounded-md border border-chat-border bg-chat-surface px-2.5 py-1 text-sm text-chat-text placeholder:text-chat-text-muted focus:border-chat-green focus:outline-none"
        />
        <span className="text-xs text-chat-text-muted tabular-nums">
          {view.length}
          {query.trim() && ` / ${rows.length}`} rows
        </span>
        <span
          role="status"
          aria-live="polite"
          className={`text-xs text-chat-green transition-opacity duration-200 motion-reduce:transition-none ${toast ? 'opacity-100' : 'opacity-0'}`}
        >
          {toast ?? ' '}
        </span>
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-lg border border-chat-border">
        <table className="min-w-full border-collapse text-left align-top">
          <thead className="sticky top-0 z-10 bg-chat-surface-2">
            <tr>
              <th className="w-9 border-b border-chat-border px-1" aria-hidden="true" />
              {columns.map((col) => {
                const on = sort.col === col.name
                return (
                  <th
                    key={col.name}
                    scope="col"
                    aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    onClick={() => cycle(col.name)}
                    title="Click to sort"
                    className={`cursor-pointer border-b border-chat-border px-2.5 py-2 whitespace-nowrap select-none transition-colors hover:text-chat-text ${
                      on ? 'text-chat-green' : 'text-chat-text-muted'
                    } ${col.numeric ? 'text-right' : 'text-left'}`}
                  >
                    <span className="text-sm font-medium">{col.name}</span>
                    <span aria-hidden="true" className="ml-1 inline-block w-2 text-chat-green">
                      {on ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                    </span>
                    <span className="mt-0.5 block text-[10px] font-normal lowercase text-chat-text-muted">
                      {col.type || '—'}
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
                  colSpan={columns.length + 1}
                  className="px-3 py-6 text-center text-sm text-chat-text-muted"
                >
                  {query.trim() ? `No rows match “${query.trim()}”.` : 'No rows yet.'}
                </td>
              </tr>
            )}
            {view.map((row, i) => (
              <tr
                key={row.id ?? i}
                className="odd:bg-chat-surface/30 hover:bg-chat-surface-2/50"
              >
                <td className="border-b border-chat-border/40 px-1 py-1 align-top">
                  <button
                    type="button"
                    title="Copy row as JSON"
                    aria-label="Copy row as JSON"
                    onClick={() => copy(JSON.stringify(row))}
                    className="rounded px-1 text-chat-text-muted hover:bg-chat-surface-2 hover:text-chat-text"
                  >
                    ⧉
                  </button>
                </td>
                {columns.map((col) => (
                  <td
                    key={col.name}
                    className={`max-w-[30rem] border-b border-chat-border/40 px-2.5 py-1 align-top text-xs ${
                      col.numeric ? 'text-right' : 'text-left'
                    }`}
                  >
                    <Cell column={col} value={row[col.name]} onCopy={copy} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * One cell, rendered by what the value actually is.
 *
 * @param {{ column: { name: string, type?: string, numeric?: boolean }, value: unknown, onCopy: (v: unknown) => void }} props
 */
function Cell({ column, value, onCopy }) {
  if (value === null || value === undefined) {
    return <span className="text-chat-text-muted">∅</span>
  }

  const type = String(column.type || '')

  if (column.name === 'rating') {
    const n = Number(value)
    return <span className="font-mono">{n > 0 ? '👍 +1' : n < 0 ? '👎 −1' : String(value)}</span>
  }

  const asDate =
    value instanceof Date
      ? value
      : type.startsWith('timestamp') && typeof value === 'string' && !Number.isNaN(Date.parse(value))
        ? new Date(value)
        : null
  if (asDate) {
    const iso = asDate.toISOString()
    return (
      <button
        type="button"
        onClick={() => onCopy(iso)}
        title={`${iso}  ·  shown in local time`}
        className="rounded px-1 font-mono text-chat-text-muted hover:bg-chat-surface-2 hover:text-chat-text"
      >
        {fmtTimestamp(asDate)}
      </button>
    )
  }

  if (typeof value === 'string' && UUID_RE.test(value)) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
          style={{ backgroundColor: chipColor(value) }}
        />
        <button
          type="button"
          onClick={() => onCopy(value)}
          title={value}
          aria-label={`Copy ${column.name} ${value}`}
          className="rounded px-1 font-mono text-chat-text-muted hover:bg-chat-surface-2 hover:text-chat-text"
        >
          {value.slice(0, 8)}
          <span className="opacity-50">…</span>
        </button>
      </span>
    )
  }

  if (typeof value === 'object') {
    const json = JSON.stringify(value)
    return (
      <button
        type="button"
        onClick={() => onCopy(json)}
        title={json}
        className="block max-w-[30rem] truncate rounded px-1 text-left font-mono hover:bg-chat-surface-2 hover:text-chat-text"
      >
        {json}
      </button>
    )
  }

  if (column.numeric && /^-?\d+(\.\d+)?$/.test(String(value))) {
    return <span className="font-mono tabular-nums">{String(value)}</span>
  }

  if (type.startsWith('enum_') || ENUMISH.has(column.name)) {
    return (
      <span className="inline-block max-w-[16rem] truncate rounded bg-chat-surface-2 px-1.5 py-0.5 align-bottom text-[11px] tracking-wide text-chat-text lowercase">
        {String(value)}
      </span>
    )
  }

  const text = String(value)
  return (
    <button
      type="button"
      onClick={() => onCopy(text)}
      title={text.length > 48 ? text : undefined}
      className="block max-w-[30rem] truncate rounded px-1 text-left hover:bg-chat-surface-2 hover:text-chat-text"
    >
      {text}
    </button>
  )
}

/** Stringify a value the way the filter and sort see it. */
function cellText(v) {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Empty sorts after non-empty; dates and numbers numeric, the rest natural-string. */
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
