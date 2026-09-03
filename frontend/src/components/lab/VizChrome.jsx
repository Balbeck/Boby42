// @ts-nocheck — the /lab payloads (labApi.table/tree/analytics*) arrive untyped
// from the backend; writing typedefs for them is a task of its own, and /lab is a
// single-user, password-gated admin page. Drop this line when they get typed.
// (axis props for recharts live in vizKit.js so this file exports components only)

/**
 * Presentational building blocks shared across the 🔬 dashboard. Components
 * only — keeps the file lint-clean under react-refresh. English-only, like the
 * rest of /lab; styled with the chat-* tokens.
 */

/** A panel card — the one surface every chart / list sits on. */
export function Card({ children, className = '' }) {
  return (
    <div
      className={`rounded-xl border border-chat-border bg-chat-surface/60 p-4 ${className}`}
    >
      {children}
    </div>
  )
}

/** A small uppercase section heading, matching DbViz's labels. */
export function SectionLabel({ children }) {
  return (
    <span className="text-xs font-medium tracking-wide text-chat-text-muted uppercase">
      {children}
    </span>
  )
}

/**
 * A titled chart frame: heading + optional hint, a fixed-height plot area, and a
 * built-in empty state. `empty` short-circuits the plot.
 *
 * @param {{ title: string, hint?: string, empty?: boolean, legend?: import('react').ReactNode, children: import('react').ReactNode }} props
 */
export function ChartCard({ title, hint, empty, legend, children }) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-medium text-chat-text">{title}</h3>
          {hint && <p className="text-xs text-chat-text-muted">{hint}</p>}
        </div>
        {legend}
      </div>
      {empty ? <Empty /> : <div className="h-56 w-full">{children}</div>}
    </Card>
  )
}

/** The one empty-state note, so every chart says the same thing. */
export function Empty({ label = 'No data in this period' }) {
  return (
    <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-chat-border">
      <p className="text-xs text-chat-text-muted">{label}</p>
    </div>
  )
}

/**
 * A direct-label legend row — identity is never colour-alone.
 *
 * @param {{ items: Array<{ label: string, color: string }> }} props
 */
export function MiniLegend({ items }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5 text-xs text-chat-text-muted">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-[2px]"
            style={{ backgroundColor: it.color }}
          />
          {it.label}
        </span>
      ))}
    </div>
  )
}

/**
 * Recharts tooltip content — one card, chat-surface-2 ground, one row per
 * series with its swatch + value.
 *
 * @param {{ active?: boolean, payload?: any[], label?: string, valueFormat?: (v: number) => string }} props
 */
export function VizTooltip({ active, payload, label, valueFormat }) {
  if (!active || !payload || !payload.length) return null
  const fmt = valueFormat || ((v) => v)
  return (
    <div className="rounded-lg border border-chat-border bg-chat-surface-2 px-3 py-2 text-xs shadow-lg shadow-black/30">
      <div className="mb-1 font-medium text-chat-text tabular-nums">{label}</div>
      <ul className="flex flex-col gap-0.5">
        {payload.map((p) => (
          <li key={p.dataKey} className="flex items-center gap-2 text-chat-text-muted">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-[2px]"
              style={{ backgroundColor: p.color || p.stroke || p.fill }}
            />
            <span>{p.name}</span>
            <span className="ml-auto tabular-nums text-chat-text">
              {p.value == null ? '—' : fmt(p.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A page badge — chat / archiviste / (unlinked). */
export function PageBadge({ page }) {
  return (
    <span className="rounded bg-chat-surface-2 px-1.5 py-0.5 text-[11px] tracking-wide text-chat-text-muted lowercase">
      {page || '—'}
    </span>
  )
}

/**
 * Prev / next pager with a "start–end of total" readout.
 *
 * @param {{ offset: number, limit: number, total: number, onPrev: () => void, onNext: () => void }} props
 */
export function Pager({ offset, limit, total, onPrev, onNext }) {
  const start = total === 0 ? 0 : offset + 1
  const end = Math.min(offset + limit, total)
  return (
    <div className="flex items-center gap-2 text-xs text-chat-text-muted">
      <span className="tabular-nums">
        {start}–{end} of {total}
      </span>
      <button
        type="button"
        onClick={onPrev}
        disabled={offset === 0}
        className="rounded border border-chat-border px-2 py-0.5 hover:bg-chat-surface-2 hover:text-chat-text disabled:opacity-40 disabled:hover:bg-transparent"
      >
        Prev
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={end >= total}
        className="rounded border border-chat-border px-2 py-0.5 hover:bg-chat-surface-2 hover:text-chat-text disabled:opacity-40 disabled:hover:bg-transparent"
      >
        Next
      </button>
    </div>
  )
}
