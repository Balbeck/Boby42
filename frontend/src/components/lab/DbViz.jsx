// @ts-nocheck — the /lab payloads (labApi.table/tree/analytics*) arrive untyped
// from the backend; writing typedefs for them is a task of its own, and /lab is a
// single-user, password-gated admin page. Drop this line when they get typed.
import { useState } from 'react'
import * as labApi from '../../services/labApi'
import { useKeyedResource } from '../../hooks/useKeyedResource'
import DataGrid, { ChevronSelect } from './DataGrid'
import RelationsExplorer from './RelationsExplorer'

/**
 * The 💾 db-viz tab: pick one interaction-logging table, pull its whole contents
 * (up to the backend's safety cap) in one request, render it as a sortable,
 * filterable grid. Switching tables is one more fetch; everything else is
 * client-side. Read-only — nothing here writes.
 *
 * Each table gets a one-line hint naming its join keys, since the schema is
 * normalised and the raw rows don't show how they relate. English-only.
 */

// How each table relates to the others — backticks mark column names.
const TABLE_HINTS = {
  visitors:
    'One row per anonymous browser. `anon_id` is the id the frontend keeps in localStorage. Pointed at by `conversations.visitor_id` and `events.visitor_id`.',
  conversations:
    'One thread on one `page` (chat | archiviste). Its `id` groups every message below it. `visitor_id` → visitors.',
  messages:
    'Two rows per exchange: `role` user, then assistant. `conversation_id` → conversations. The assistant row `id` is what documents and feedback point to.',
  message_documents:
    'RAG sources / matched docs for one assistant message. `message_id` → messages, `position` = display order. Never stores content.',
  events:
    'Append-only log. First use: a `no_match` row per empty /archiviste search — `payload` (JSON) holds the question.',
  message_feedback:
    'One 👍 / 👎 per assistant message. `message_id` → messages (unique). `rating` is -1 or 1; `comment` only kept on -1.',
}

/** Render a hint string, wrapping `backtick` spans as <code>. */
function renderHint(text) {
  return text.split(/`([^`]+)`/).map((part, i) =>
    i % 2 === 1 ? (
      <code
        key={i}
        className="rounded bg-chat-surface-2 px-1 py-0.5 font-mono text-[0.7rem] text-chat-text"
      >
        {part}
      </code>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}

export default function DbViz() {
  const [selected, setSelected] = useState(null)

  // null = loading, 'error' = failed, else LabTableInfo[].
  const tables = useKeyedResource(() => labApi.tables().then((d) => d ?? 'error'), 'tables')

  // null = loading, 'error' = failed, else the selected table's LabTableData.
  const data = useKeyedResource(
    () => labApi.table(selected).then((p) => p ?? 'error'),
    selected || '',
  )

  if (tables === null) {
    return <p className="text-sm text-chat-text-muted">Loading tables…</p>
  }
  if (tables === 'error') {
    return (
      <p className="text-sm text-chat-error">Couldn&rsquo;t load the table list. Check the backend is up.</p>
    )
  }

  return (
    <div className="flex w-full max-w-full flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span className="text-xs tracking-wide text-chat-text-muted uppercase">Table</span>
        <div className="self-start">
          <ChevronSelect
            value={selected ?? ''}
            onChange={(e) => setSelected(e.target.value || null)}
            className="max-w-[22rem] py-1.5 pr-9 pl-2.5 font-mono text-sm"
          >
            <option value="">— pick a table —</option>
            {tables.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name} — {t.rowCount} rows
              </option>
            ))}
          </ChevronSelect>
        </div>
        {selected && TABLE_HINTS[selected] && (
          <p className="max-w-3xl text-xs leading-relaxed text-chat-text-muted">
            {renderHint(TABLE_HINTS[selected])}
          </p>
        )}
      </div>

      {!selected && (
        <p className="text-sm text-chat-text-muted">Pick a table to inspect its rows.</p>
      )}

      {selected && data === null && (
        <p className="text-sm text-chat-text-muted">Loading {selected}…</p>
      )}

      {selected && data === 'error' && (
        <p className="text-sm text-chat-error">Couldn&rsquo;t load &ldquo;{selected}&rdquo;.</p>
      )}

      {data && data !== 'error' && (
        <div className="flex w-full max-w-full flex-col gap-2">
          <p className="text-xs text-chat-text-muted tabular-nums">
            {data.columns.length} columns · {data.rowCount} rows
            {data.truncated && ` · showing ${data.rows.length}`}
          </p>
          <DataGrid columns={data.columns} rows={data.rows} />
        </div>
      )}

      <div className="mt-2 flex flex-col gap-2 border-t border-chat-border pt-5">
        <span className="text-xs tracking-wide text-chat-text-muted uppercase">Relations explorer</span>
        <p className="max-w-3xl text-xs text-chat-text-muted">
          Pick a conversation and follow its whole subtree — messages, their RAG documents,
          feedback, events — assembled by foreign key in one request.
        </p>
        <RelationsExplorer />
      </div>
    </div>
  )
}
