const STORAGE_KEY = 'boby42.visitorId'

/** In-memory fallback when localStorage is unavailable (private mode, blocked). */
let memoryId = null

/**
 * Stable anonymous id for this browser. Read once from localStorage, created on
 * first call. Sent to the backend as `visitorId` so every interaction is
 * attributed to an anonymous `visitors` row — no login involved.
 *
 * @returns {string}
 */
export function getVisitorId() {
  try {
    const existing = localStorage.getItem(STORAGE_KEY)
    if (existing) return existing
    const created = crypto.randomUUID()
    localStorage.setItem(STORAGE_KEY, created)
    return created
  } catch {
    if (!memoryId) memoryId = crypto.randomUUID()
    return memoryId
  }
}
