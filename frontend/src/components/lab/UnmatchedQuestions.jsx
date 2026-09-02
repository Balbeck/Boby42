import { useEffect, useState } from 'react'
import * as labApi from '../../services/labApi'
import { Card, PageBadge, Pager } from './VizChrome'
import { fmtAgo, fmtInt } from './vizKit'

const PAGE_SIZE = 25
const ERR = 'text-[#cf9186]'

/**
 * The list of what the document base is missing: every `no_match` question in
 * the period, newest first, tagged by page — with a copy affordance per row and
 * a "Copy all" that pulls the whole filtered list to the clipboard.
 *
 * Follows the dashboard period (parent remounts this via `key` on a period
 * change); pagination and the page filter are its own.
 *
 * @param {{ range: { from: string, to: string } }} props
 */
export default function UnmatchedQuestions({ range }) {
  const [pageFilter, setPageFilter] = useState('') // '' | 'chat' | 'archiviste'
  const [offset, setOffset] = useState(0)
  const [res, setRes] = useState(null) // { key, value } — value 'error' | { items, total }
  const [copied, setCopied] = useState('') // id of the just-copied row, or 'ALL'

  const key = `${range.from}|${range.to}|${pageFilter}|${offset}`

  useEffect(() => {
    let cancelled = false
    labApi
      .analyticsUnmatched({
        from: range.from,
        to: range.to,
        limit: PAGE_SIZE,
        offset,
        page: pageFilter || undefined,
      })
      .then((v) => {
        if (!cancelled) {
          setRes({
            key: `${range.from}|${range.to}|${pageFilter}|${offset}`,
            value: v ?? 'error',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [range.from, range.to, pageFilter, offset])

  const loading = !res || res.key !== key
  const data = loading ? null : res.value
  const items = data && data !== 'error' ? data.items : []
  const total = data && data !== 'error' ? data.total : 0

  async function copyText(text, id) {
    try {
      await navigator.clipboard?.writeText(text)
      setCopied(id)
      setTimeout(() => setCopied(''), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  async function copyAll() {
    const all = await labApi.analyticsUnmatched({
      from: range.from,
      to: range.to,
      limit: 1000,
      offset: 0,
      page: pageFilter || undefined,
    })
    const lines = (all?.items || []).map((it) => it.question || '').filter(Boolean)
    if (lines.length) copyText(lines.join('\n'), 'ALL')
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-medium text-chat-text">Unmatched questions</h3>
          <p className="text-xs text-chat-text-muted">
            Questions that returned zero documents — the gaps in the base
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={pageFilter}
            onChange={(e) => {
              setPageFilter(e.target.value)
              setOffset(0)
            }}
            className="rounded-md border border-chat-border bg-chat-surface px-2 py-1 text-xs text-chat-text focus:border-chat-green focus:outline-none"
          >
            <option value="">All pages</option>
            <option value="chat">chat</option>
            <option value="archiviste">archiviste</option>
          </select>
          <button
            type="button"
            onClick={copyAll}
            disabled={total === 0}
            className="rounded-md border border-chat-border px-2.5 py-1 text-xs text-chat-text-muted hover:bg-chat-surface-2 hover:text-chat-text disabled:opacity-40"
          >
            {copied === 'ALL' ? 'Copied ✓' : `Copy all (${fmtInt(total)})`}
          </button>
        </div>
      </div>

      {loading && <p className="text-sm text-chat-text-muted">Loading…</p>}
      {data === 'error' && <p className={`text-sm ${ERR}`}>Couldn’t load the unmatched list.</p>}

      {data && data !== 'error' && (
        <>
          {items.length === 0 ? (
            <p className="text-sm text-chat-text-muted">
              No unmatched questions in this period — nothing missing.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-chat-border">
              {items.map((it) => (
                <li key={it.id} className="flex items-start gap-3 py-2.5">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="text-sm text-chat-text">{it.question || '(empty question)'}</p>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-chat-text-muted">
                      <PageBadge page={it.page} />
                      {it.language && <span className="uppercase">{it.language}</span>}
                      <span className="tabular-nums">{fmtAgo(it.createdAt)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyText(it.question || '', it.id)}
                    title="Copy this question"
                    className="shrink-0 rounded px-2 py-1 text-xs text-chat-text-muted hover:bg-chat-surface-2 hover:text-chat-text"
                  >
                    {copied === it.id ? 'Copied ✓' : 'Copy'}
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
