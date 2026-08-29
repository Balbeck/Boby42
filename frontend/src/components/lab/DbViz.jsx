import { useEffect, useState } from 'react'
import * as labApi from '../../services/labApi'
import DataGrid from './DataGrid'

/**
 * The 💾 db-viz tab: pick one of the interaction-logging tables, pull its whole
 * contents (up to the backend's safety cap) in one request, render it as a
 * sortable grid. Switching tables is one more fetch; everything else is
 * client-side. Read-only — nothing here writes.
 *
 * English-only, like the rest of /lab.
 */

// Warm muted red for hard errors — sits with the #1a1915 ground instead of a
// pure alert red. The only colour here outside the chat-* tokens.
const ERR = 'text-[#cf9186]'

export default function DbViz() {
  const [tables, setTables] = useState(null) // null = loading | 'error' | LabTableInfo[]
  const [selected, setSelected] = useState(null)
  // { name, payload } — payload is LabTableData, or null when the fetch failed.
  // A mismatch with `selected` (or absence) means "still loading".
  const [result, setResult] = useState(null)

  useEffect(() => {
    let cancelled = false
    labApi.tables().then((data) => {
      if (!cancelled) setTables(data ?? 'error')
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selected) return
    let cancelled = false
    labApi.table(selected).then((payload) => {
      if (!cancelled) setResult({ name: selected, payload: payload ?? null })
    })
    return () => {
      cancelled = true
    }
  }, [selected])

  if (tables === null) {
    return <p className="text-sm text-chat-text-muted">Loading tables…</p>
  }
  if (tables === 'error') {
    return (
      <p className={`text-sm ${ERR}`}>Couldn&rsquo;t load the table list. Check the backend is up.</p>
    )
  }

  const loaded = result && result.name === selected
  const data = loaded ? result.payload : null

  return (
    <div className="flex w-full max-w-full flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        {tables.map((t) => {
          const on = t.name === selected
          return (
            <button
              key={t.name}
              type="button"
              onClick={() => setSelected(t.name)}
              aria-pressed={on}
              className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                on
                  ? 'border-chat-green bg-chat-green/15 text-chat-text'
                  : 'border-chat-border bg-chat-surface text-chat-text-muted hover:bg-chat-surface-2 hover:text-chat-text'
              }`}
            >
              {t.name}
              <span className="ml-1.5 tabular-nums opacity-60">{t.rowCount}</span>
            </button>
          )
        })}
      </div>

      {!selected && (
        <p className="text-sm text-chat-text-muted">Pick a table to inspect its rows.</p>
      )}

      {selected && !loaded && (
        <p className="text-sm text-chat-text-muted">Loading {selected}…</p>
      )}

      {loaded && !data && (
        <p className={`text-sm ${ERR}`}>Couldn&rsquo;t load &ldquo;{selected}&rdquo;.</p>
      )}

      {data && (
        <div className="flex w-full max-w-full flex-col gap-2">
          <p className="text-xs text-chat-text-muted tabular-nums">
            {data.columns.length} columns · {data.rowCount} rows
            {data.truncated && ` · showing ${data.rows.length}`}
          </p>
          <DataGrid columns={data.columns} rows={data.rows} />
        </div>
      )}
    </div>
  )
}
