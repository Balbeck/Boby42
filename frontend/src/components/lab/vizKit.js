// Shared constants + pure formatters for the 🔬 dashboard. No JSX here so the
// file stays lint-clean under react-refresh (components live in VizChrome.jsx).
//
// Palette: the dataviz skill's dark categorical slots, validated against the
// #1a1915 surface (blue / aqua / orange all-pairs PASS; red is a reserved
// status colour, shipped with a label). The brand green (--color-chat-green)
// stays on the UI chrome — tabs, buttons, focus — never on a data mark.

export const SERIES = {
  blue: '#3987e5',
  aqua: '#199e70',
  orange: '#d95926',
  red: '#e66767',
}

// Role → colour. Same scale everywhere (counts / ratios), one axis per chart.
export const C = {
  total: SERIES.blue,
  chat: SERIES.aqua,
  archiviste: SERIES.orange,
  active: SERIES.blue,
  new: SERIES.orange,
  noMatch: SERIES.red,
  bar: SERIES.blue,
}

export const AXIS = '#a39e93' // --color-chat-text-muted
export const GRID = '#3d3a34' // --color-chat-border

/** Shared recharts axis props for a recessive, label-light look. */
export const axisProps = {
  stroke: AXIS,
  tick: { fill: AXIS, fontSize: 11 },
  tickLine: false,
  axisLine: false,
}

const NF = new Intl.NumberFormat('en-US')

/** @param {number | null | undefined} n */
export const fmtInt = (n) => (n == null || Number.isNaN(n) ? '—' : NF.format(Math.round(n)))

/** @param {number | null | undefined} n — one decimal */
export const fmtNum1 = (n) => (n == null || Number.isNaN(n) ? '—' : n.toFixed(1))

/** @param {number | null | undefined} x — a 0–1 ratio as a percent */
export const fmtPct = (x) => (x == null || Number.isNaN(x) ? '—' : `${(x * 100).toFixed(1)}%`)

/** @param {number | null | undefined} ms */
export const fmtMs = (ms) => {
  if (ms == null || Number.isNaN(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`
}

/** 'YYYY-MM-DD' → 'MM-DD' for a dense axis. */
export const shortDay = (iso) => (typeof iso === 'string' ? iso.slice(5) : iso)

/** A relative "3h ago" / "2d ago" / date, for list rows. */
export const fmtAgo = (iso) => {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`
  return new Date(iso).toISOString().slice(0, 10)
}

export const PERIODS = [
  { key: '7', label: '7d', days: 7 },
  { key: '30', label: '30d', days: 30 },
  { key: '90', label: '90d', days: 90 },
  { key: 'all', label: 'All', days: null },
]

/**
 * Turn a period key into an explicit ISO window the API takes. "all" sends a
 * `from` a decade back (the backend also accepts an absent `from`).
 *
 * @param {string} key
 * @returns {{ from: string, to: string, key: string }}
 */
export function windowFor(key) {
  const to = new Date()
  const period = PERIODS.find((p) => p.key === key) || PERIODS[0]
  const days = period.days ?? 3650
  const from = new Date(to.getTime() - days * 86400 * 1000)
  return { from: from.toISOString(), to: to.toISOString(), key: period.key }
}
