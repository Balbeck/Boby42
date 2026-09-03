// @ts-nocheck — the /lab payloads (labApi.table/tree/analytics*) arrive untyped
// from the backend; writing typedefs for them is a task of its own, and /lab is a
// single-user, password-gated admin page. Drop this line when they get typed.
import { Card } from './VizChrome'
import { fmtInt, SERIES } from './vizKit'

/**
 * The two small categorical splits — language and error code — each as a single
 * 100%-stacked bar with a labelled legend. Low-ceremony; they answer "what's the
 * mix" without a full chart.
 *
 * @param {{ languages: Array<{ language: string, count: number }>, errors: Array<{ code: string, count: number }> }} props
 */
export default function Breakdowns({ languages, errors }) {
  return (
    <Card className="flex flex-col gap-4">
      <SplitRow title="Languages" rows={normalise(languages, 'language')} />
      <SplitRow title="Errors" rows={normalise(errors, 'code')} okKey="ok" />
    </Card>
  )
}

// Fixed slot order so a category keeps its colour as counts change.
const SLOTS = [SERIES.blue, SERIES.aqua, SERIES.orange, SERIES.red, '#a39e93']

/** @param {Array<Record<string, any>>} rows @param {string} key */
function normalise(rows, key) {
  return (rows || []).map((r) => ({ label: r[key], count: r.count }))
}

/**
 * @param {{ title: string, rows: Array<{ label: string, count: number }>, okKey?: string }} props
 */
function SplitRow({ title, rows, okKey }) {
  const total = rows.reduce((s, r) => s + r.count, 0)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-chat-text">{title}</h3>
        <span className="text-xs tabular-nums text-chat-text-muted">{fmtInt(total)} total</span>
      </div>

      {total === 0 ? (
        <p className="text-xs text-chat-text-muted">Nothing recorded in this period.</p>
      ) : (
        <>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-chat-surface-2">
            {rows.map((r, i) => (
              <span
                key={r.label}
                className="h-full"
                style={{
                  width: `${(r.count / total) * 100}%`,
                  backgroundColor:
                    okKey && r.label === okKey ? SERIES.aqua : SLOTS[i % SLOTS.length],
                }}
                title={`${r.label} · ${r.count}`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {rows.map((r, i) => (
              <span
                key={r.label}
                className="flex items-center gap-1.5 text-xs text-chat-text-muted"
              >
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-[2px]"
                  style={{
                    backgroundColor:
                      okKey && r.label === okKey ? SERIES.aqua : SLOTS[i % SLOTS.length],
                  }}
                />
                {r.label}
                <span className="tabular-nums text-chat-text">{fmtInt(r.count)}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
