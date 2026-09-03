// @ts-nocheck — the /lab payloads (labApi.table/tree/analytics*) arrive untyped
// from the backend; writing typedefs for them is a task of its own, and /lab is a
// single-user, password-gated admin page. Drop this line when they get typed.
import { fmtInt, fmtMs, fmtNum1, fmtPct } from './vizKit'

/**
 * The counter row: the five figures Hector named (total / archiviste / chat
 * requests, 👍, 👎) plus derived tiles (no-match rate, active visitors, p95 chat
 * latency, avg messages / conversation). Each shows the selected-period value
 * big and an all-time reference small.
 *
 * @param {{ totals: { range: object, allTime: object } | null }} props
 */
export default function StatTiles({ totals }) {
  if (!totals) return null
  const { range: r, allTime: a } = totals

  const tiles = [
    { label: 'Total requests', value: fmtInt(r.requests), sub: `${fmtInt(a.requests)} all-time` },
    { label: 'Chat requests', value: fmtInt(r.requestsChat), sub: `${fmtInt(a.requestsChat)} all-time` },
    {
      label: 'Archiviste requests',
      value: fmtInt(r.requestsArchiviste),
      sub: `${fmtInt(a.requestsArchiviste)} all-time`,
    },
    { label: '👍 helpful', value: fmtInt(r.thumbsUp), sub: `${fmtInt(a.thumbsUp)} all-time` },
    { label: '👎 not helpful', value: fmtInt(r.thumbsDown), sub: `${fmtInt(a.thumbsDown)} all-time` },
    {
      label: 'No-match rate',
      value: fmtPct(r.noMatchRate),
      sub: `${fmtInt(r.noMatch)} of ${fmtInt(r.requests)} · ${fmtPct(a.noMatchRate)} all-time`,
    },
    {
      label: 'Active visitors',
      value: fmtInt(r.activeVisitors),
      sub: `${fmtInt(a.activeVisitors)} all-time`,
    },
    {
      label: 'p95 chat latency',
      value: fmtMs(r.chatLatencyP95),
      sub: `p50 ${fmtMs(r.chatLatencyP50)} · max ${fmtMs(r.chatLatencyMax)}`,
    },
    {
      label: 'Msgs / conversation',
      value: fmtNum1(r.avgMessagesPerConversation),
      sub: `${fmtInt(r.conversations)} conversations`,
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="flex flex-col gap-1 rounded-xl border border-chat-border bg-chat-surface/60 p-3.5"
        >
          <span className="text-xs text-chat-text-muted">{t.label}</span>
          <span className="text-2xl font-semibold tabular-nums text-chat-text">{t.value}</span>
          <span className="text-[11px] tabular-nums text-chat-text-muted">{t.sub}</span>
        </div>
      ))}
    </div>
  )
}
