// @ts-nocheck — the /lab payloads (labApi.table/tree/analytics*) arrive untyped
// from the backend; writing typedefs for them is a task of its own, and /lab is a
// single-user, password-gated admin page. Drop this line when they get typed.
import { useEffect, useState } from 'react'
import * as labApi from '../../services/labApi'
import { chipColor, fmtTimestamp } from './format'

/**
 * Follow one conversation through the normalised schema: pick it (from the
 * recent list, or paste a `conversations.id`) and see its whole subtree —
 * visitor, every message in order, each message's RAG documents and its
 * feedback, plus linked events — assembled server-side by foreign key in one
 * request (GET /lab-data/tree/:id).
 *
 * Read-only. English-only, like the rest of /lab.
 */


export default function RelationsExplorer() {
  const [convos, setConvos] = useState(null) // null loading | 'error' | rows[]
  const [draft, setDraft] = useState('')
  const [choice, setChoice] = useState('') // the id currently being explored
  const [result, setResult] = useState(null) // { id, tree } ; mismatch with choice = loading

  useEffect(() => {
    let cancelled = false
    labApi.table('conversations').then((res) => {
      if (!cancelled) setConvos(res ? res.rows : 'error')
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const id = choice.trim()
    if (!id) return
    let cancelled = false
    labApi.tree(id).then((tree) => {
      if (!cancelled) setResult({ id, tree: tree ?? null })
    })
    return () => {
      cancelled = true
    }
  }, [choice])

  const list = Array.isArray(convos) ? convos : []
  const loaded = result && result.id === choice.trim()
  const tree = loaded ? result.tree : null

  return (
    <div className="flex w-full max-w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={list.some((c) => c.id === choice) ? choice : ''}
          onChange={(e) => {
            setChoice(e.target.value)
            setDraft(e.target.value)
          }}
          className="max-w-[28rem] rounded-md border border-chat-border bg-chat-surface px-2.5 py-1 text-sm text-chat-text focus:border-chat-green focus:outline-none"
        >
          <option value="">
            {convos === null ? 'Loading conversations…' : `— pick a conversation (${list.length}) —`}
          </option>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {optionLabel(c)}
            </option>
          ))}
        </select>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            setChoice(draft.trim())
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="…or paste a conversations.id"
            className="w-[22rem] max-w-full rounded-md border border-chat-border bg-chat-surface px-2.5 py-1 font-mono text-xs text-chat-text placeholder:text-chat-text-muted placeholder:font-sans focus:border-chat-green focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-md border border-chat-border bg-chat-surface px-3 py-1 text-sm text-chat-text-muted hover:bg-chat-surface-2 hover:text-chat-text"
          >
            Load
          </button>
        </form>
      </div>

      {convos === 'error' && (
        <p className="text-xs text-chat-error">Couldn&rsquo;t load the conversation list — you can still paste an id.</p>
      )}

      {!choice.trim() && (
        <p className="text-sm text-chat-text-muted">Pick or paste a conversation to expand it.</p>
      )}

      {choice.trim() && !loaded && (
        <p className="text-sm text-chat-text-muted">Loading tree…</p>
      )}

      {loaded && !tree && (
        <p className="text-sm text-chat-error">No conversation with that id.</p>
      )}

      {tree && <Tree tree={tree} />}
    </div>
  )
}

/**
 * The one transcript renderer for a conversation subtree (visitor → messages →
 * documents / feedback, + events). Exported so the 🔬 tab's ConversationBrowser
 * reuses it rather than growing a third transcript view — no behaviour change
 * to the 💾 tab.
 *
 * @param {{ tree: { conversation: object, visitor: object | null, messages: object[], events: object[] } }} props
 */
export function Tree({ tree }) {
  const { conversation, visitor, messages, events } = tree

  return (
    <div className="rounded-lg border border-chat-border bg-chat-surface/40 p-4 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <IdChip id={conversation.id} label="conversation" />
        <Badge>{conversation.page}</Badge>
        <span className="text-chat-text">“{conversation.title}”</span>
      </div>
      <div className="mt-1 text-xs text-chat-text-muted tabular-nums">
        created {fmtTimestamp(conversation.created_at)} · updated {fmtTimestamp(conversation.updated_at)}
      </div>
      {visitor && (
        <div className="mt-1 text-xs text-chat-text-muted">
          visitor #{visitor.id} · anon_id{' '}
          <span className="font-mono">{visitor.anon_id}</span> · last seen{' '}
          <span className="tabular-nums">{fmtTimestamp(visitor.last_seen_at)}</span>
        </div>
      )}

      <ul className="mt-3 flex flex-col gap-3 border-l border-chat-border pl-4">
        {messages.map((m) => (
          <li key={m.id} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <Badge>{m.role === 'assistant' ? '🤖 assistant' : '👤 user'}</Badge>
              <span className="text-xs text-chat-text-muted tabular-nums">{fmtTimestamp(m.created_at)}</span>
              {m.role === 'assistant' && m.latency_ms != null && (
                <span className="text-xs text-chat-text-muted tabular-nums">{m.latency_ms} ms</span>
              )}
              {m.error_code && <span className="text-xs text-chat-error">{m.error_code}</span>}
              <IdChip id={m.id} />
            </div>

            {m.content ? (
              <p className="whitespace-pre-wrap text-chat-text" title={m.content.length > 500 ? m.content : undefined}>
                {m.content.length > 500 ? `${m.content.slice(0, 500)}…` : m.content}
              </p>
            ) : (
              <p className="text-chat-text-muted">(no text)</p>
            )}

            {m.documents.length > 0 && (
              <ul className="ml-1 flex flex-col gap-0.5 border-l border-chat-border/50 pl-3 text-xs text-chat-text-muted">
                <li>📄 {m.documents.length} document{m.documents.length > 1 ? 's' : ''}</li>
                {m.documents.map((d) => (
                  <li key={d.id} className="flex flex-wrap gap-x-2">
                    <span className="tabular-nums">{d.position}.</span>
                    <span className="text-chat-text">{d.name}</span>
                    {d.score != null && <span className="tabular-nums">score {Number(d.score).toFixed(2)}</span>}
                    {(d.url || d.path) && <span className="truncate opacity-70">{d.url || d.path}</span>}
                  </li>
                ))}
              </ul>
            )}

            {m.feedback ? (
              <p className={`ml-1 text-xs ${m.feedback.rating > 0 ? 'text-chat-green' : 'text-chat-error'}`}>
                {m.feedback.rating > 0 ? '👍 +1' : '👎 −1'}
                {m.feedback.comment ? ` — “${m.feedback.comment}”` : ''}
              </p>
            ) : m.role === 'assistant' ? (
              <p className="ml-1 text-xs text-chat-text-muted">no feedback</p>
            ) : null}
          </li>
        ))}
      </ul>

      {events.length > 0 && (
        <div className="mt-3 flex flex-col gap-0.5 border-l border-chat-border pl-4 text-xs text-chat-text-muted">
          <span>⚡ {events.length} event{events.length > 1 ? 's' : ''}</span>
          {events.map((ev) => (
            <div key={ev.id} className="flex flex-wrap gap-x-2">
              <span className="text-chat-text">{ev.type}</span>
              <span className="tabular-nums">{fmtTimestamp(ev.created_at)}</span>
              {ev.payload && (
                <span className="truncate font-mono opacity-70">{JSON.stringify(ev.payload)}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** @param {{ id: string, label?: string }} props */
function IdChip({ id, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {label && <span className="text-chat-text-muted">{label}</span>}
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
        style={{ backgroundColor: chipColor(id) }}
      />
      <button
        type="button"
        onClick={() => {
          try {
            navigator.clipboard?.writeText(String(id))
          } catch {
            /* clipboard unavailable */
          }
        }}
        title={`${id} — click to copy`}
        className="rounded px-1 font-mono text-xs text-chat-text-muted hover:bg-chat-surface-2 hover:text-chat-text"
      >
        {String(id).slice(0, 8)}
        <span className="opacity-50">…</span>
      </button>
    </span>
  )
}

/** @param {{ children: import('react').ReactNode }} props */
function Badge({ children }) {
  return (
    <span className="rounded bg-chat-surface-2 px-1.5 py-0.5 text-[11px] tracking-wide text-chat-text lowercase">
      {children}
    </span>
  )
}

/** @param {{ id: string, title?: string, page?: string, created_at?: string }} c */
function optionLabel(c) {
  const title = (c.title || '(no title)').slice(0, 44)
  return `${title} · ${c.page} · ${fmtTimestamp(c.created_at)}`
}
