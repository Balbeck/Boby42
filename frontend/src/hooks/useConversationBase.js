import { useCallback, useEffect, useRef, useState } from 'react'
import { sendFeedback } from '../services/feedbackApi'
import { getConversation } from '../services/historyApi'

/** @import { ArchivisteDocument, ConversationDetail } from '../types/types.js' */

/**
 * The minimal exchange shape this hook needs — both `Exchange` (`/chat`) and
 * `ArchivisteExchange` (`/archiviste`) satisfy it. `TExchange` is fixed per call
 * site by the page hook's own `toExchanges` return type, so each page keeps its
 * exact exchange type (with `answer` / `phase` on `/chat`, `queued` on
 * `/archiviste`) through this shared seam.
 *
 * @typedef {{
 *   id: string,
 *   question: string,
 *   documents: ArchivisteDocument[],
 *   loading: boolean,
 *   messageId?: string | null,
 *   rating?: -1 | 0 | 1,
 * }} ConversationExchange
 */

/**
 * Patch one document (matched by type **and** name) on one exchange.
 *
 * The match is on `type` **and** `name`, never `name` alone: a retrieval merges
 * the Notion and subject-PDF stores and the message components key their rows by
 * `` `${type}:${name}` ``, so an `md` and a `pdf` of the same basename can
 * coexist on screen — matched on the name alone, expanding one would expand both
 * and the first one's markdown would be written into both. Invisible today only
 * because no Notion basename currently collides with a subject-PDF basename
 * (frontend/CLAUDE.md). This copy used to be duplicated in each page hook and
 * the fix landed on one only — that is why the seam exists.
 *
 * @template {{ id: string, documents: ArchivisteDocument[] }} T
 * @param {T[]} exchanges
 * @param {string} exchangeId
 * @param {'md' | 'pdf'} docType
 * @param {string} docName
 * @param {Partial<ArchivisteDocument>} patch
 * @returns {T[]}
 */
function patchDocument(exchanges, exchangeId, docType, docName, patch) {
  return exchanges.map((exchange) => {
    if (exchange.id !== exchangeId) return exchange
    return /** @type {typeof exchange} */ ({
      ...exchange,
      documents: exchange.documents.map((doc) =>
        doc.type === docType && doc.name === docName ? { ...doc, ...patch } : doc,
      ),
    })
  })
}

/**
 * The conversation-UI plumbing shared by `useChat` and `useArchiviste`: the
 * exchange list and its ref mirror, the unsent draft, the conversation id, the
 * per-document lazy loading, 👍/👎 feedback and history reopening.
 *
 * **What stays in each page hook, on purpose:** the whole of `sendQuestion` (its
 * call sequence, its exchange shape, its streaming), the send queue, the abort
 * refs, and `stopGeneration` / `startNewConversation`'s queue-and-abort half.
 * The seam is drawn at "does this know how the page fetches?" — everything that
 * does stays out. `/chat` and `/archiviste` must be able to evolve their
 * retrieval independently. A full merge with an injected `run` callback was
 * considered and **rejected**: it would remove more duplication but impose one
 * common exchange shape on both pages (frontend/CLAUDE.md).
 *
 * `toExchanges` differs between the two pages by exactly two fields (`answer` and
 * `phase` exist only on `/chat`), so it is passed in rather than flagged; the
 * document-content fetch (`chatApi.fetchDocumentContent` vs
 * `archivisteApi.fetchDocument`, duplicated on purpose) is passed in too.
 *
 * @template {ConversationExchange} TExchange
 * @param {{
 *   fetchDocumentContent: (url: string) => Promise<{ name: string, content: string }>,
 *   toExchanges: (conversation: ConversationDetail) => TExchange[],
 * }} deps
 */
export function useConversationBase({ fetchDocumentContent, toExchanges }) {
  const [exchanges, setExchanges] = useState(/** @type {TExchange[]} */ ([]))
  // Unsent input for this page. Lifted out of `ChatInput` so a /chat ↔
  // /archiviste switch (which unmounts the page) doesn't drop a half-typed
  // question; both branches of the page render the same value.
  const [draft, setDraft] = useState('')
  // The conversation this page's exchanges belong to (T4). `null` until the
  // first response comes back with one. Kept in a ref too so each page's
  // `sendQuestion` stays referentially stable.
  const [conversationId, setConversationId] = useState(/** @type {string | null} */ (null))
  const conversationIdRef = useRef(/** @type {string | null} */ (null))
  // Mirror of `exchanges` so `submitFeedback` can read the current messageId /
  // rating without a stale closure and without depending on `exchanges`.
  const exchangesRef = useRef(exchanges)
  useEffect(() => {
    exchangesRef.current = exchanges
  }, [exchanges])

  /**
   * Adopt the conversation id a response carried: set the ref (so the next send
   * threads into it synchronously) and the state (so the drawer's active marker
   * updates), but only when it actually changed. Both `sendQuestion`s inline
   * this today.
   *
   * @param {string | null | undefined} id
   */
  const adoptConversationId = useCallback(
    (/** @type {string | null | undefined} */ id) => {
      if (id && id !== conversationIdRef.current) {
        conversationIdRef.current = id
        setConversationId(id)
      }
    },
    [],
  )

  /**
   * Lazy-load one matched document's content on first expand. PDFs are never
   * fetched — the `<iframe>` loads `doc.url` itself, so the row is just marked
   * `loaded` and the no-op guard above holds on further expands. A loaded /
   * loading row is a no-op, so each doc is fetched at most once.
   *
   * @param {string} exchangeId
   * @param {ArchivisteDocument} doc
   */
  const loadDocument = useCallback(
    async (/** @type {string} */ exchangeId, /** @type {ArchivisteDocument} */ doc) => {
      if (doc.loaded || doc.loading) return

      if (doc.type === 'pdf') {
        setExchanges((prev) => patchDocument(prev, exchangeId, doc.type, doc.name, { loaded: true }))
        return
      }

      setExchanges((prev) => patchDocument(prev, exchangeId, doc.type, doc.name, { loading: true }))

      try {
        const { content } = await fetchDocumentContent(doc.url)
        setExchanges((prev) =>
          patchDocument(prev, exchangeId, doc.type, doc.name, {
            content,
            loading: false,
            loaded: true,
          }),
        )
      } catch (err) {
        setExchanges((prev) =>
          patchDocument(prev, exchangeId, doc.type, doc.name, {
            loading: false,
            error: /** @type {Error} */ (err).message,
          }),
        )
      }
    },
    [fetchDocumentContent],
  )

  /**
   * Fold / unfold one matched document. `expanded` lives on the document (not in
   * `ArchivisteDocument`) so an unfolded row survives a page switch; the first
   * unfold also triggers the lazy content load.
   *
   * @param {string} exchangeId
   * @param {ArchivisteDocument} doc
   */
  const toggleDocument = useCallback(
    (/** @type {string} */ exchangeId, /** @type {ArchivisteDocument} */ doc) => {
      const next = !doc.expanded
      setExchanges((prev) =>
        patchDocument(prev, exchangeId, doc.type, doc.name, { expanded: next }),
      )
      if (next) loadDocument(exchangeId, doc)
    },
    [loadDocument],
  )

  /**
   * Re-open a conversation on demand (the history drawer, when AUTH is on):
   * fetch it, rebuild this page's exchanges from it (via the injected
   * `toExchanges`) and adopt its id so the next question threads into the same
   * conversation. Nothing is persisted — a refresh always starts empty.
   *
   * @param {string} id
   */
  const loadConversation = useCallback(
    async (/** @type {string} */ id) => {
      const conversation = await getConversation(id)
      setExchanges(toExchanges(conversation))
      conversationIdRef.current = conversation.id
      setConversationId(conversation.id)
    },
    [toExchanges],
  )

  /**
   * Empty this page's state — a fresh thread, no draft. The queue-and-abort half
   * of "new conversation" stays in each page hook's `startNewConversation`,
   * which calls this after aborting anything in flight and clearing the queue.
   */
  const reset = useCallback(() => {
    setExchanges([])
    setDraft('')
    conversationIdRef.current = null
    setConversationId(null)
  }, [])

  /**
   * Optimistic 👍 / 👎 on an exchange's answer (or result list). The rating
   * flips in state immediately, then the request fires; any rejection rolls the
   * rating back with no dialog — feedback is a courtesy, an error popup would be
   * backwards. The current `messageId` is read through the `exchangesRef` mirror
   * so this stays referentially stable.
   *
   * @param {string} exchangeId
   * @param {-1 | 0 | 1} rating
   * @param {string} [comment] - only sent with a -1
   */
  const submitFeedback = useCallback(
    async (
      /** @type {string} */ exchangeId,
      /** @type {-1 | 0 | 1} */ rating,
      /** @type {string | undefined} */ comment,
    ) => {
      const exchange = exchangesRef.current.find((e) => e.id === exchangeId)
      if (!exchange || !exchange.messageId) return

      const previousRating = exchange.rating ?? 0
      setExchanges((prev) =>
        prev.map((e) => (e.id === exchangeId ? /** @type {typeof e} */ ({ ...e, rating }) : e)),
      )

      try {
        await sendFeedback(exchange.messageId, rating, comment)
      } catch {
        setExchanges((prev) =>
          prev.map((e) =>
            e.id === exchangeId ? /** @type {typeof e} */ ({ ...e, rating: previousRating }) : e,
          ),
        )
      }
    },
    [],
  )

  return {
    exchanges,
    setExchanges,
    exchangesRef,
    draft,
    setDraft,
    conversationId,
    conversationIdRef,
    adoptConversationId,
    patchDocument,
    loadDocument,
    toggleDocument,
    submitFeedback,
    loadConversation,
    reset,
  }
}
