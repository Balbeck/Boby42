import { Card, Empty } from './VizChrome'
import { C, fmtInt } from './vizKit'

/**
 * The most-returned documents in the window — a compact horizontal-bar list
 * (name, times returned, mean score). Not a recharts chart: a bar per row is
 * lighter and denser here.
 *
 * @param {{ docs: Array<{ name: string, type: string | null, count: number, avgScore: number | null }> }} props
 */
export default function TopDocuments({ docs }) {
  const rows = docs || []
  const max = rows.reduce((m, d) => Math.max(m, d.count), 0) || 1

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-medium text-chat-text">Top documents</h3>
        <p className="text-xs text-chat-text-muted">Most often returned, this period</p>
      </div>

      {rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="max-w-full overflow-x-auto">
          <ul className="flex min-w-[360px] flex-col gap-1.5">
            {rows.map((d) => (
              <li key={`${d.type}:${d.name}`} className="flex items-center gap-3 text-xs">
                <span className="w-32 shrink-0 truncate text-chat-text sm:w-44" title={d.name}>
                  {d.name}
                </span>
                <span className="w-7 shrink-0 text-chat-text-muted uppercase">{d.type || 'md'}</span>
                <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-chat-surface-2">
                  <span
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{ width: `${(d.count / max) * 100}%`, backgroundColor: C.bar }}
                  />
                </span>
                <span className="w-8 shrink-0 text-right tabular-nums text-chat-text">
                  {fmtInt(d.count)}
                </span>
                <span className="w-12 shrink-0 text-right tabular-nums text-chat-text-muted">
                  {d.avgScore == null ? '—' : d.avgScore.toFixed(3)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
