// @ts-nocheck — the /lab payloads (labApi.table/tree/analytics*) arrive untyped
// from the backend; writing typedefs for them is a task of its own, and /lab is a
// single-user, password-gated admin page. Drop this line when they get typed.
import { Fragment, useEffect, useMemo, useState } from 'react'
import * as labApi from '../../services/labApi'
import { useKeyedResource } from '../../hooks/useKeyedResource'
import { Card, PageBadge } from './VizChrome'
import { fmtAgo, fmtInt, fmtMs } from './vizKit'
import { chipColor, fmtTimestamp } from './format'

/**
 * 🔬 dashboard section: an anonymous-visitor history explorer. Pick a visitor
 * from the dropdown (or paste an `anon_id` / numeric `visitors.id`) → the list
 * of that visitor's conversations, newest activity first → click one for its
 * exchanges, each row sortable (query length, response length, score, latency…)
 * and expandable to the full question / answer / documents / feedback.
 *
 * Built entirely from the existing `/lab-data/*` reads — no backend endpoint for
 * "conversations of one visitor" exists, so `labApi.table('conversations')` is
 * fetched and filtered client-side (capped at 1000 rows; a caveat shows when the
 * cap bites). English-only, like the rest of /lab.
 */


export default function VisitorExplorer() {
  const [visitors, setVisitors] = useState(/** @type {null | 'error' | object[]} */ (null))
  const [visitorsTrunc, setVisitorsTrunc] = useState(false)
  const [draft, setDraft] = useState('')
  const [selected, setSelected] = useState('') // anon_id or numeric id being explored
  // { key, value } — value 'notfound' | 'listerror' | 'error' | { visitor, rows, truncated }
  const [convosRes, setConvosRes] = useState(null)
  const [openConvo, setOpenConvo] = useState(null) // conversation id at level 2

  // The visitor list for the dropdown, newest activity first.
  useEffect(() => {
    let cancelled = false
    labApi.table('visitors').then((res) => {
      if (cancelled) return
      if (!res) {
        setVisitors('error')
        return
      }
      setVisitors(
        [...res.rows].sort((a, b) => ts(b.last_seen_at) - ts(a.last_seen_at)),
      )
      setVisitorsTrunc(Boolean(res.truncated))
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Resolve the selected id → a visitor row, then load & filter its
  // conversations. Every state write lands in a `.then` (a key mismatch is the
  // "loading" signal, so nothing needs pre-clearing).
  useEffect(() => {
    const id = selected.trim()
    if (!id || visitors === null) return // still loading — re-runs when the list lands

    let cancelled = false
    const list = Array.isArray(visitors) ? visitors : []
    let visitor = list.find((v) => v.anon_id === id || String(v.id) === id)
    if (!visitor && /^\d+$/.test(id)) visitor = { id: Number(id), anon_id: null }

    const load = visitor
      ? labApi.table('conversations').then((cres) => {
          if (!cres) return 'error'
          const rows = cres.rows
            .filter((c) => c.visitor_id === visitor.id)
            .sort((a, b) => ts(b.updated_at || b.created_at) - ts(a.updated_at || a.created_at))
          return { visitor, rows, truncated: Boolean(cres.truncated) }
        })
      : Promise.resolve(visitors === 'error' ? 'listerror' : 'notfound')

    load.then((value) => {
      if (cancelled) return
      setConvosRes({ key: id, value })
      setOpenConvo(null)
    })
    return () => {
      cancelled = true
    }
  }, [selected, visitors])

  // One conversation's subtree, when a row is opened: null = loading, 'error' =
  // failed, else the tree. Keyed on `openConvo`, so a stale previous-conversation
  // result is never shown and clearing `openConvo` yields null.
  const treeRes = useKeyedResource(
    () => labApi.tree(openConvo).then((t) => t ?? 'error'),
    openConvo || '',
  )

  const options = Array.isArray(visitors) ? visitors : []
  const selectValue = options.some((v) => (v.anon_id || String(v.id)) === selected)
    ? selected
    : ''
  const convosReady = convosRes && convosRes.key === selected.trim()
  const cv = convosReady ? convosRes.value : null

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-medium text-chat-text">Visitor history</h3>
        <p className="text-xs text-chat-text-muted">
          Pick or paste an anonymous visitor id to browse their conversations and drill into each exchange
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selectValue}
          onChange={(e) => {
            setSelected(e.target.value)
            setDraft(e.target.value)
          }}
          className="max-w-[28rem] rounded-md border border-chat-border bg-chat-surface px-2.5 py-1 text-sm text-chat-text focus:border-chat-green focus:outline-none"
        >
          <option value="">
            {visitors === null
              ? 'Loading visitors…'
              : visitors === 'error'
                ? 'Visitor list unavailable'
                : `— pick a visitor (${options.length}) —`}
          </option>
          {options.map((v) => (
            <option key={v.id} value={v.anon_id || String(v.id)}>
              {visitorOptionLabel(v)}
            </option>
          ))}
        </select>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            setSelected(draft.trim())
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="…or paste a visitor anon_id"
            className="w-[22rem] max-w-full rounded-md border border-chat-border bg-chat-surface px-2.5 py-1 font-mono text-xs text-chat-text placeholder:font-sans placeholder:text-chat-text-muted focus:border-chat-green focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-md border border-chat-border bg-chat-surface px-3 py-1 text-sm text-chat-text-muted hover:bg-chat-surface-2 hover:text-chat-text"
          >
            Load
          </button>
        </form>
      </div>

      {visitors === 'error' && (
        <p className="text-xs text-chat-error">
          Couldn&rsquo;t load the visitor list — you can still paste a numeric visitors.id.
        </p>
      )}
      {visitorsTrunc && (
        <p className="text-xs text-chat-text-muted">
          Showing the 1000 most recent visitors — paste an id to reach an older one.
        </p>
      )}

      {!selected.trim() && (
        <p className="text-sm text-chat-text-muted">Pick or paste a visitor to see their history.</p>
      )}

      {selected.trim() && !convosReady && (
        <p className="text-sm text-chat-text-muted">Loading history…</p>
      )}

      {cv === 'notfound' && <p className="text-sm text-chat-error">No visitor with that id.</p>}
      {cv === 'listerror' && (
        <p className="text-sm text-chat-error">
          Can&rsquo;t resolve that id — the visitor list didn&rsquo;t load. Paste a numeric visitors.id.
        </p>
      )}
      {cv === 'error' && (
        <p className="text-sm text-chat-error">Couldn&rsquo;t load this visitor&rsquo;s conversations.</p>
      )}

      {cv && typeof cv === 'object' && !openConvo && (
        <>
          <VisitorHeader visitor={cv.visitor} count={cv.rows.length} truncated={cv.truncated} />
          {cv.rows.length === 0 ? (
            <p className="text-sm text-chat-text-muted">This visitor has no conversations.</p>
          ) : (
            <SortableTable
              rows={cv.rows}
              rowKey={(c) => c.id}
              initialSort={{ key: 'updated_at', dir: 'desc' }}
              onRowClick={(c) => setOpenConvo(c.id)}
              columns={CONVO_COLUMNS}
            />
          )}
        </>
      )}

      {cv && typeof cv === 'object' && openConvo && (
        <>
          {treeRes === null && (
            <>
              <BackBtn onBack={() => setOpenConvo(null)} />
              <p className="text-sm text-chat-text-muted">Loading transcript…</p>
            </>
          )}
          {treeRes === 'error' && (
            <>
              <BackBtn onBack={() => setOpenConvo(null)} />
              <p className="text-sm text-chat-error">Couldn&rsquo;t load that conversation.</p>
            </>
          )}
          {treeRes && treeRes !== 'error' && (
            <ExchangesView tree={treeRes} onBack={() => setOpenConvo(null)} />
          )}
        </>
      )}
    </Card>
  )
}

/* ── level 1: conversations ────────────────────────────────────────────────── */

const CONVO_COLUMNS = [
  {
    key: 'page',
    label: 'Page',
    sort: 'text',
    get: (c) => c.page,
    render: (c) => <PageBadge page={c.page} />,
  },
  {
    key: 'title',
    label: 'Title',
    sort: 'text',
    get: (c) => c.title || '',
    className: 'max-w-[24rem] truncate',
    render: (c) => (
      <span className="text-chat-text" title={c.title || undefined}>
        {c.title || '(no title)'}
      </span>
    ),
  },
  {
    key: 'created_at',
    label: 'Created',
    sort: 'time',
    align: 'right',
    get: (c) => c.created_at,
    render: (c) => <span className="text-chat-text-muted">{fmtAgo(c.created_at)}</span>,
  },
  {
    key: 'updated_at',
    label: 'Updated',
    sort: 'time',
    align: 'right',
    get: (c) => c.updated_at,
    render: (c) => <span className="text-chat-text-muted">{fmtAgo(c.updated_at)}</span>,
  },
]

/** @param {{ visitor: object, count: number, truncated?: boolean }} props */
function VisitorHeader({ visitor, count, truncated }) {
  const label = visitor.anon_id || `#${visitor.id}`
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-chat-border bg-chat-surface/40 px-3 py-2 text-xs text-chat-text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
            style={{ backgroundColor: chipColor(label) }}
          />
          <button
            type="button"
            onClick={() => copy(label)}
            title={`${label} — click to copy`}
            className="rounded px-1 font-mono text-chat-text hover:bg-chat-surface-2"
          >
            {label}
          </button>
        </span>
        {visitor.first_seen_at && (
          <span>
            first seen <span className="tabular-nums">{fmtTimestamp(visitor.first_seen_at)}</span>
          </span>
        )}
        {visitor.last_seen_at && (
          <span>
            · last seen <span className="tabular-nums">{fmtTimestamp(visitor.last_seen_at)}</span>
          </span>
        )}
        <span>
          · {fmtInt(count)} conversation{count === 1 ? '' : 's'}
        </span>
      </div>
      {truncated && (
        <p className="text-xs text-chat-text-muted">
          Only the 1000 most recent conversations were scanned — an older one may be missing.
        </p>
      )}
    </div>
  )
}

/* ── level 2: exchanges of one conversation ───────────────────────────────── */

/** @param {{ tree: object, onBack: () => void }} props */
function ExchangesView({ tree, onBack }) {
  const exchanges = useMemo(() => pairExchanges(tree.messages || []), [tree])
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BackBtn onBack={onBack} />
        <span className="flex items-center gap-2 text-xs text-chat-text-muted">
          <PageBadge page={tree.conversation.page} />
          <span className="text-chat-text">
            &ldquo;{tree.conversation.title || '(no title)'}&rdquo;
          </span>
          · {fmtInt(exchanges.length)} exchange{exchanges.length === 1 ? '' : 's'}
        </span>
      </div>
      {exchanges.length === 0 ? (
        <p className="text-sm text-chat-text-muted">No messages in this conversation.</p>
      ) : (
        <SortableTable
          rows={exchanges}
          rowKey={(x) => x.key}
          initialSort={{ key: 'time', dir: 'desc' }}
          renderExpanded={(x) => <ExchangeDetail x={x} />}
          columns={EXCHANGE_COLUMNS}
        />
      )}
    </div>
  )
}

const EXCHANGE_COLUMNS = [
  {
    key: 'time',
    label: 'Time',
    sort: 'time',
    align: 'right',
    get: (x) => x.time,
    render: (x) => <span className="text-chat-text-muted">{fmtAgo(x.time)}</span>,
  },
  {
    key: 'question',
    label: 'Question',
    sort: 'text',
    get: (x) => x.question,
    className: 'max-w-[20rem] truncate',
    render: (x) => (
      <span className="text-chat-text" title={x.question || undefined}>
        {x.question ? trunc(x.question, 80) : '—'}
      </span>
    ),
  },
  {
    key: 'qlen',
    label: 'Q len',
    sort: 'num',
    align: 'right',
    get: (x) => x.qlen,
    render: (x) => <span>{fmtInt(x.qlen)}</span>,
  },
  {
    key: 'answer',
    label: 'Answer',
    sort: 'text',
    get: (x) => x.answer,
    className: 'max-w-[20rem] truncate',
    render: (x) => (
      <span className="text-chat-text-muted" title={x.answer || undefined}>
        {x.answer ? trunc(x.answer, 80) : '—'}
      </span>
    ),
  },
  {
    key: 'alen',
    label: 'A len',
    sort: 'num',
    align: 'right',
    get: (x) => x.alen,
    render: (x) => <span>{x.alen ? fmtInt(x.alen) : '—'}</span>,
  },
  {
    key: 'score',
    label: 'Score',
    sort: 'num',
    align: 'right',
    get: (x) => x.score,
    render: (x) => <span>{x.score == null ? '—' : x.score.toFixed(2)}</span>,
  },
  {
    key: 'latency',
    label: 'Latency',
    sort: 'num',
    align: 'right',
    get: (x) => x.latency,
    render: (x) => <span>{x.latency == null ? '—' : fmtMs(x.latency)}</span>,
  },
  {
    key: 'rating',
    label: 'Rating',
    sort: 'num',
    align: 'right',
    get: (x) => x.rating,
    render: (x) => <span>{x.rating == null ? '–' : x.rating > 0 ? '👍' : '👎'}</span>,
  },
  {
    key: 'error',
    label: 'Error',
    sort: 'text',
    get: (x) => x.error || '',
    render: (x) =>
      x.error ? <span className="text-chat-error">{x.error}</span> : <span className="text-chat-text-muted">—</span>,
  },
]

/** @param {{ x: object }} props */
function ExchangeDetail({ x }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-chat-border bg-chat-surface-2/60 p-3 text-sm">
      <div>
        <div className="mb-1 text-xs font-medium tracking-wide text-chat-text-muted uppercase">
          Question{x.language ? ` · ${x.language}` : ''}
        </div>
        <p className="whitespace-pre-wrap text-chat-text">{x.question || '(no text)'}</p>
      </div>
      <div>
        <div className="mb-1 text-xs font-medium tracking-wide text-chat-text-muted uppercase">
          Answer{x.latency != null ? ` · ${fmtMs(x.latency)}` : ''}
          {x.error ? ` · ${x.error}` : ''}
        </div>
        <p className="whitespace-pre-wrap text-chat-text">{x.answer || '(no answer)'}</p>
      </div>
      {x.docs.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium tracking-wide text-chat-text-muted uppercase">
            {x.docs.length} document{x.docs.length > 1 ? 's' : ''}
          </div>
          <ul className="flex flex-col gap-0.5 text-xs text-chat-text-muted">
            {x.docs.map((d) => (
              <li key={d.id} className="flex flex-wrap gap-x-2">
                <span className="tabular-nums">{d.position}.</span>
                <span className="text-chat-text">{d.name}</span>
                {d.score != null && (
                  <span className="tabular-nums">score {Number(d.score).toFixed(2)}</span>
                )}
                {(d.url || d.path) && <span className="truncate opacity-70">{d.url || d.path}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div
        className={`text-xs ${
          x.rating == null ? 'text-chat-text-muted' : x.rating > 0 ? 'text-chat-green' : 'text-chat-error'
        }`}
      >
        {x.rating == null ? 'no feedback' : x.rating > 0 ? '👍 +1' : '👎 −1'}
        {x.comment ? ` — “${x.comment}”` : ''}
      </div>
    </div>
  )
}

/* ── the sortable table ───────────────────────────────────────────────────── */

/**
 * A small type-aware sortable table. Click a header to sort by that column
 * (numeric / chronological / alpha per `col.sort`); empty values always sort
 * last, whichever direction. Either `onRowClick` (navigate) or `renderExpanded`
 * (toggle an inline detail row) — not both.
 *
 * @param {{
 *   columns: Array<{ key: string, label: string, get: (row: any) => any, sort?: 'num' | 'time' | 'text', align?: 'right', className?: string, render?: (row: any) => import('react').ReactNode }>,
 *   rows: any[],
 *   rowKey: (row: any) => string,
 *   initialSort: { key: string, dir: 'asc' | 'desc' },
 *   onRowClick?: (row: any) => void,
 *   renderExpanded?: (row: any) => import('react').ReactNode,
 * }} props
 */
function SortableTable({ columns, rows, rowKey, initialSort, onRowClick, renderExpanded }) {
  const [sort, setSort] = useState(initialSort)
  const [expanded, setExpanded] = useState(null)
  const canExpand = typeof renderExpanded === 'function'

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key) || columns[0]
    const dir = sort.dir === 'desc' ? -1 : 1
    const kind = col.sort || 'text'
    const empty = (v) => v == null || v === ''
    return [...rows].sort((a, b) => {
      const va = col.get(a)
      const vb = col.get(b)
      if (empty(va) && empty(vb)) return 0
      if (empty(va)) return 1
      if (empty(vb)) return -1
      let cmp
      if (kind === 'num') cmp = Number(va) - Number(vb)
      else if (kind === 'time') cmp = new Date(va).getTime() - new Date(vb).getTime()
      else cmp = String(va).localeCompare(String(vb))
      return cmp * dir
    })
  }, [rows, columns, sort])

  function toggle(col) {
    setSort((s) =>
      s.key === col.key
        ? { key: col.key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key: col.key, dir: col.sort === 'num' || col.sort === 'time' ? 'desc' : 'asc' },
    )
  }

  return (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-chat-border">
            {columns.map((col) => {
              const active = sort.key === col.key
              return (
                <th
                  key={col.key}
                  onClick={() => toggle(col)}
                  className={`cursor-pointer px-2 py-1.5 text-xs font-medium whitespace-nowrap text-chat-text-muted select-none hover:text-chat-text ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  }`}
                >
                  {col.label}
                  <span className="ml-1 opacity-70">
                    {active ? (sort.dir === 'asc' ? '↑' : '↓') : ''}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const k = rowKey(row)
            const isOpen = expanded === k
            const clickable = Boolean(onRowClick) || canExpand
            return (
              <Fragment key={k}>
                <tr
                  onClick={
                    clickable
                      ? () => {
                          if (onRowClick) onRowClick(row)
                          else setExpanded(isOpen ? null : k)
                        }
                      : undefined
                  }
                  className={`border-b border-chat-border/60 ${
                    clickable ? 'cursor-pointer hover:bg-chat-surface-2' : ''
                  } ${isOpen ? 'bg-chat-surface-2' : ''}`}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-2 py-1.5 align-top ${
                        col.align === 'right' ? 'text-right tabular-nums' : ''
                      } ${col.className || ''}`}
                    >
                      {col.render ? col.render(row) : String(col.get(row) ?? '—')}
                    </td>
                  ))}
                </tr>
                {canExpand && isOpen && (
                  <tr className="border-b border-chat-border/60">
                    <td colSpan={columns.length} className="px-2 py-2">
                      {renderExpanded(row)}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

/** @param {{ onBack: () => void }} props */
function BackBtn({ onBack }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="self-start rounded-md border border-chat-border px-2.5 py-1 text-xs text-chat-text-muted hover:bg-chat-surface-2 hover:text-chat-text"
    >
      ← Back to conversations
    </button>
  )
}

/** ms since epoch for an ISO string / Date, 0 when unparseable. */
function ts(value) {
  const t = new Date(value).getTime()
  return Number.isNaN(t) ? 0 : t
}

function trunc(s, n) {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

function copy(text) {
  try {
    navigator.clipboard?.writeText(String(text))
  } catch {
    /* clipboard unavailable */
  }
}

/** @param {{ id: number, anon_id: string | null, last_seen_at?: string }} v */
function visitorOptionLabel(v) {
  const id = v.anon_id ? `${v.anon_id.slice(0, 8)}…` : `#${v.id}`
  return v.last_seen_at ? `${id} · last seen ${fmtAgo(v.last_seen_at)}` : id
}

/**
 * Pair a chronological message list into exchanges (user → the assistant reply
 * that follows). A user turn with no answer, or a stray assistant turn, still
 * becomes its own row.
 *
 * @param {object[]} messages
 */
function pairExchanges(messages) {
  const pairs = []
  for (const m of messages) {
    if (m.role === 'user') {
      pairs.push({ user: m, assistant: null })
    } else {
      const last = pairs[pairs.length - 1]
      if (last && !last.assistant) last.assistant = m
      else pairs.push({ user: null, assistant: m })
    }
  }
  return pairs.map(({ user: u, assistant: a }, i) => {
    const docs = (a && a.documents) || []
    const scores = docs.map((d) => Number(d.score)).filter((n) => !Number.isNaN(n))
    return {
      key: (u && u.id) || (a && a.id) || `x${i}`,
      time: (u && u.created_at) || (a && a.created_at),
      question: (u && u.content) || '',
      qlen: u && u.content ? u.content.length : 0,
      answer: (a && a.content) || '',
      alen: a && a.content ? a.content.length : 0,
      score: scores.length ? Math.max(...scores) : null,
      latency: a && a.latency_ms != null ? Number(a.latency_ms) : null,
      rating: a && a.feedback ? Number(a.feedback.rating) : null,
      error: (a && a.error_code) || (u && u.error_code) || null,
      language: (u && u.language) || (a && a.language) || null,
      comment: a && a.feedback ? a.feedback.comment : null,
      docs,
    }
  })
}
