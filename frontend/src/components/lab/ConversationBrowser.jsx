// @ts-nocheck — the /lab payloads (labApi.table/tree/analytics*) arrive untyped
// from the backend; writing typedefs for them is a task of its own, and /lab is a
// single-user, password-gated admin page. Drop this line when they get typed.
import { useState } from 'react'
import * as labApi from '../../services/labApi'
import { useKeyedResource } from '../../hooks/useKeyedResource'
import { Card, PageBadge, Pager } from './VizChrome'
import { fmtAgo, fmtInt } from './vizKit'
import { Tree } from './RelationsExplorer'

const PAGE_SIZE = 20

/**
 * Admin-wide conversation browser: a filterable, paginated list (by page, by
 * creation date) → the full transcript of one conversation, rendered with the
 * shared `Tree` from RelationsExplorer (each answer's documents + 👍/👎).
 *
 * Independent of the dashboard period — it owns its own filter bar and defaults
 * to all time.
 */
export default function ConversationBrowser() {
  const [pageFilter, setPageFilter] = useState('')
  const [fromDay, setFromDay] = useState('')
  const [toDay, setToDay] = useState('')
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState(null) // conversation id

  const listKey = `${pageFilter}|${fromDay}|${toDay}|${offset}`

  // null = loading, 'error' = failed, else { items, total } for this page.
  const list = useKeyedResource(
    () =>
      labApi
        .analyticsConversations({
          from: fromDay ? `${fromDay}T00:00:00Z` : undefined,
          to: toDay ? `${toDay}T23:59:59Z` : undefined,
          limit: PAGE_SIZE,
          offset,
          page: pageFilter || undefined,
        })
        .then((v) => v ?? 'error'),
    listKey,
  )

  // null = loading, 'error' = failed, else the selected conversation's subtree.
  const detail = useKeyedResource(
    () => labApi.analyticsConversation(selected).then((t) => t ?? 'error'),
    selected || '',
  )

  const listLoading = list === null
  const items = list && list !== 'error' ? list.items : []
  const total = list && list !== 'error' ? list.total : 0

  function resetTo(setter) {
    return (e) => {
      setter(e.target.value)
      setOffset(0)
    }
  }

  if (selected) {
    return (
      <Card className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="self-start rounded-md border border-chat-border px-2.5 py-1 text-xs text-chat-text-muted hover:bg-chat-surface-2 hover:text-chat-text"
        >
          ← Back to list
        </button>
        {detail === null && <p className="text-sm text-chat-text-muted">Loading transcript…</p>}
        {detail === 'error' && (
          <p className="text-sm text-chat-error">Couldn’t load that conversation.</p>
        )}
        {detail && detail !== 'error' && (
          <div className="max-w-full overflow-x-auto">
            <Tree tree={detail} />
          </div>
        )}
      </Card>
    )
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-medium text-chat-text">Conversations</h3>
          <p className="text-xs text-chat-text-muted">Every thread, newest activity first</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={pageFilter}
            onChange={resetTo(setPageFilter)}
            className="rounded-md border border-chat-border bg-chat-surface px-2 py-1 text-chat-text focus:border-chat-green focus:outline-none"
          >
            <option value="">All pages</option>
            <option value="chat">chat</option>
            <option value="archiviste">archiviste</option>
          </select>
          <label className="flex items-center gap-1 text-chat-text-muted">
            from
            <input
              type="date"
              value={fromDay}
              onChange={resetTo(setFromDay)}
              className="rounded-md border border-chat-border bg-chat-surface px-2 py-1 text-chat-text focus:border-chat-green focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-1 text-chat-text-muted">
            to
            <input
              type="date"
              value={toDay}
              onChange={resetTo(setToDay)}
              className="rounded-md border border-chat-border bg-chat-surface px-2 py-1 text-chat-text focus:border-chat-green focus:outline-none"
            />
          </label>
        </div>
      </div>

      {listLoading && <p className="text-sm text-chat-text-muted">Loading…</p>}
      {list === 'error' && <p className="text-sm text-chat-error">Couldn’t load conversations.</p>}

      {list && list !== 'error' && (
        <>
          {items.length === 0 ? (
            <p className="text-sm text-chat-text-muted">No conversations match this filter.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-chat-border">
              {items.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(c.id)}
                    className="flex w-full items-center gap-3 py-2.5 text-left hover:opacity-80"
                  >
                    <PageBadge page={c.page} />
                    <span className="min-w-0 flex-1 truncate text-sm text-chat-text" title={c.title}>
                      {c.title || '(no title)'}
                    </span>
                    {c.hasNegativeFeedback && (
                      <span title="has a 👎 answer" className="shrink-0 text-xs">
                        👎
                      </span>
                    )}
                    <span className="hidden shrink-0 tabular-nums text-xs text-chat-text-muted sm:inline">
                      {fmtInt(c.messageCount)} msg
                    </span>
                    <span className="shrink-0 tabular-nums text-xs text-chat-text-muted">
                      {fmtAgo(c.updatedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {total > PAGE_SIZE && (
            <Pager
              offset={offset}
              limit={PAGE_SIZE}
              total={total}
              onPrev={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              onNext={() => setOffset((o) => o + PAGE_SIZE)}
            />
          )}
        </>
      )}
    </Card>
  )
}
