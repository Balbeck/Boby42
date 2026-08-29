// Small shared formatting helpers for the /lab db-viz components. Kept in one
// place so the grid and the relations explorer render ids and timestamps the
// same way — a given id gets the same colour chip in both.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Deterministic muted colour from a string — the same id always gets the same
 * chip, in the grid and in the explorer.
 *
 * @param {unknown} value
 * @returns {string} an `hsl(...)` colour
 */
function chipColor(value) {
  const str = String(value)
  let h = 0
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) | 0
  return `hsl(${Math.abs(h) % 360} 45% 62%)`
}

/**
 * Compact local timestamp: `2026-08-29 14:32:01`. Accepts a Date or an ISO
 * string; returns the input stringified if it isn't a valid date.
 *
 * @param {Date | string | number} value
 * @returns {string}
 */
function fmtTimestamp(value) {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export { UUID_RE, chipColor, fmtTimestamp }
