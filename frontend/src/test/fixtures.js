// Typed builders for the payload shapes the suites hand to hooks and
// components.
//
// They exist so the test files stay type-checked like the rest of `src/`. A
// hand-written object literal in a test is almost always *partially* right —
// `type: 'md'` widens to `string`, an optional-looking field is actually
// required — and the usual escape is a file-level type-check suppression, which
// switches off checking for the whole suite including the parts that would have
// caught a real mistake. A builder pays that cost once, in one place that
// declares its return type, and every call site stays checked.
//
// ⚠️ Do not name that suppression directive in prose anywhere near the top of a
// file: TypeScript reads it out of a leading comment and applies it. Writing it
// here as an explanation silently switched off checking for THIS file.
//
// Each builder returns a COMPLETE object, exactly as the backend sends it: the
// tests that care about a missing field say so explicitly by overriding it.

/** @import { ArchivisteDocument, ConversationSummary, ConversationMessage, ConversationDetail } from '../types/types.js' */

/**
 * One matched document as it sits in an exchange — unloaded and collapsed, the
 * state a fresh retrieval or a reopened conversation produces.
 *
 * @param {Partial<ArchivisteDocument>} [overrides]
 * @returns {ArchivisteDocument}
 */
export function archivisteDocument(overrides = {}) {
  return {
    name: 'Wi-Fi',
    type: 'md',
    url: '/BaseDocumentaire/fr/Notion/Wi-Fi.md',
    score: 0.9412,
    content: '',
    loading: false,
    loaded: false,
    expanded: false,
    ...overrides,
  }
}

/**
 * One display row as `POST /chat/documents` and `POST /archiviste` return it —
 * no UI state yet, that is added by the hook.
 *
 * @param {Partial<{ name: string, score: number, type: 'md' | 'pdf', url: string }>} [overrides]
 * @returns {{ name: string, score: number, type: 'md' | 'pdf', url: string }}
 */
export function documentRow(overrides = {}) {
  return {
    name: 'Wi-Fi',
    type: 'md',
    score: 0.94,
    url: '/BaseDocumentaire/fr/Notion/Wi-Fi.md',
    ...overrides,
  }
}

/**
 * One row of `GET /conversations` — what the history drawer lists.
 *
 * @param {Partial<ConversationSummary>} [overrides]
 * @returns {ConversationSummary}
 */
export function conversationSummary(overrides = {}) {
  return {
    id: 'conv-1',
    page: 'chat',
    title: 'où est le wifi',
    updatedAt: new Date().toISOString(),
    messageCount: 4,
    ...overrides,
  }
}

/**
 * One message of `GET /conversations/:id`. Every field the route documents is
 * present — a partial literal here is what the type check exists to reject.
 *
 * @param {Partial<ConversationMessage>} [overrides]
 * @returns {ConversationMessage}
 */
export function conversationMessage(overrides = {}) {
  return {
    id: 'm1',
    role: 'user',
    content: 'où est le wifi',
    language: 'fr',
    createdAt: '2026-03-01T10:00:00.000Z',
    errorCode: null,
    documentCount: null,
    rating: null,
    documents: [],
    ...overrides,
  }
}

/**
 * A whole reopened conversation. `messages` defaults to one exchange (a user
 * question and the assistant answer that follows it), which is the pairing the
 * two `toExchanges` implementations are built on.
 *
 * @param {Partial<ConversationDetail>} [overrides]
 * @returns {ConversationDetail}
 */
export function conversationDetail(overrides = {}) {
  return {
    id: 'conv-7',
    page: 'chat',
    title: 'où est le wifi',
    messages: [
      conversationMessage({ id: 'm1', role: 'user', content: 'où est le wifi' }),
      conversationMessage({ id: 'm2', role: 'assistant', content: 'au 2e', documentCount: 0 }),
    ],
    ...overrides,
  }
}

/**
 * A document reference as `GET /conversations/:id` returns it — by reference
 * only, never with content (the frontend re-fetches it lazily on expand).
 *
 * @param {Partial<{ name: string, type: 'md' | 'pdf' | null, url: string | null, score: number | null }>} [overrides]
 * @returns {{ name: string, type: 'md' | 'pdf' | null, url: string | null, score: number | null }}
 */
export function loggedDocument(overrides = {}) {
  return {
    name: 'Wi-Fi',
    type: 'md',
    url: '/BaseDocumentaire/fr/Notion/Wi-Fi.md',
    score: 0.94,
    ...overrides,
  }
}
