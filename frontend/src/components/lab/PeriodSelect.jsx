import { PERIODS, windowFor } from './vizKit'

/**
 * The period selector driving every chart and the "period" figure on each tile:
 * 7 / 30 / 90 days / all, default 7. A segmented pill in the spirit of
 * LabTabs / PageSwitcher. It owns nothing — the active key + the resolved
 * `{ from, to }` live in the parent.
 *
 * @param {{ value: string, onChange: (win: { from: string, to: string, key: string }) => void }} props
 */
export default function PeriodSelect({ value, onChange }) {
  return (
    <div
      role="radiogroup"
      aria-label="Time range"
      className="inline-flex items-center rounded-full border border-chat-border bg-chat-surface p-1"
    >
      {PERIODS.map((p) => {
        const active = p.key === value
        return (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(windowFor(p.key))}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              active
                ? 'bg-chat-green text-chat-bg'
                : 'text-chat-text-muted hover:text-chat-text'
            }`}
          >
            {p.label}
          </button>
        )
      })}
    </div>
  )
}
