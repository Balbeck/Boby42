import { useCallback, useEffect, useRef, useState } from 'react'
import { sendMessage, fetchChatDocuments, fetchDocumentContent } from '../services/chatApi'
import { sendFeedback } from '../services/feedbackApi'

/** @import { Exchange, ArchivisteDocument } from '../types/types.js' */

/**
 * Patch one document (matched by type + name) on one exchange. Copied from
 * `useArchiviste.js` — the two pages keep separate state hooks on purpose
 * (frontend/CLAUDE.md); the chat rows can carry the same md/pdf name, hence the
 * type-and-name match rather than name alone.
 *
 * @param {Exchange[]} exchanges
 * @param {string} exchangeId
 * @param {'md' | 'pdf'} docType
 * @param {string} docName
 * @param {Partial<ArchivisteDocument>} patch
 */
function patchDocument(exchanges, exchangeId, docType, docName, patch) {
  return exchanges.map((exchange) => {
    if (exchange.id !== exchangeId) return exchange
    return {
      ...exchange,
      documents: exchange.documents.map((doc) =>
        doc.type === docType && doc.name === docName ? { ...doc, ...patch } : doc,
      ),
    }
  })
}

export function useChat() {
  /** @type {[Exchange[], Function]} */
  const [exchanges, setExchanges] = useState([])
  const [isSending, setIsSending] = useState(false)
  // The conversation this page's exchanges belong to (T4). `null` until the
  // first response comes back with one. Kept in a ref too so `sendQuestion`
  // stays referentially stable (same reason as `pendingIdRef`).
  const [conversationId, setConversationId] = useState(null)
  const conversationIdRef = useRef(null)
  const abortControllerRef = useRef(null)
  const pendingIdRef = useRef(null)
  // Mirror of `exchanges` so `submitFeedback` can read the current messageId /
  // rating without a stale closure and without depending on `exchanges`.
  const exchangesRef = useRef(exchanges)
  useEffect(() => {
    exchangesRef.current = exchanges
  }, [exchanges])

  const sendQuestion = useCallback(async (question, language) => {
    const trimmed = question.trim()
    if (!trimmed) return

    const id = crypto.randomUUID()
    pendingIdRef.current = id
    // One controller for the whole two-call flow — the stop button must cancel
    // whichever of retrieval / generation is in flight.
    const controller = new AbortController()
    abortControllerRef.current = controller

    setExchanges((prev) => [
      ...prev,
      {
        id,
        question: trimmed,
        documents: [],
        answer: '',
        loading: true,
        phase: 'retrieving',
        messageId: null,
        rating: 0,
      },
    ])
    setIsSending(true)

    try {
      // Phase 1 — retrieval only (~2 s), shown while the model works.
      const { documents: rawDocs } = await fetchChatDocuments(trimmed, language, {
        signal: controller.signal,
      })
      const sorted = [...rawDocs]
        .sort((a, b) => b.score - a.score)
        .map((doc) => ({ ...doc, loading: false, loaded: false }))

      setExchanges((prev) =>
        prev.map((exchange) =>
          exchange.id === id
            ? { ...exchange, documents: sorted, phase: 'reading' }
            : exchange,
        ),
      )

      // Phase 2 — generation. Always runs, even with an empty list: the backend
      // then returns its no-documents fallback (no LLM call) and still logs the
      // exchange + returns the messageId the feedback buttons need.
      const documents = sorted.map(({ name, type, score, url }) => ({ name, type, score, url }))
      const response = await sendMessage(trimmed, {
        signal: controller.signal,
        conversationId: conversationIdRef.current,
        language,
        documents,
      })
      if (response.conversationId && response.conversationId !== conversationIdRef.current) {
        conversationIdRef.current = response.conversationId
        setConversationId(response.conversationId)
      }
      setExchanges((prev) =>
        prev.map((exchange) =>
          exchange.id === id
            ? {
                ...exchange,
                answer: response.answer,
                loading: false,
                phase: 'done',
                messageId: response.messageId ?? null,
              }
            : exchange,
        ),
      )
    } catch (err) {
      if (err.name === 'AbortError') return
      setExchanges((prev) =>
        prev.map((exchange) =>
          exchange.id === id
            ? { ...exchange, error: err.message, loading: false, phase: 'error' }
            : exchange,
        ),
      )
    } finally {
      if (pendingIdRef.current === id) {
        setIsSending(false)
        pendingIdRef.current = null
        abortControllerRef.current = null
      }
    }
  }, [])

  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort()
    const id = pendingIdRef.current
    setExchanges((prev) => prev.filter((exchange) => exchange.id !== id))
    setIsSending(false)
    pendingIdRef.current = null
    abortControllerRef.current = null
  }, [])

  /**
   * Lazy-load one matched document's content on first expand. Copied from
   * `useArchiviste.loadDocument`; PDFs are never fetched (the <iframe> loads the
   * url itself), and a loaded / loading row is a no-op.
   *
   * @param {string} exchangeId
   * @param {ArchivisteDocument} doc
   */
  const loadDocument = useCallback(async (exchangeId, doc) => {
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
          error: err.message,
        }),
      )
    }
  }, [])

  /**
   * Optimistic 👍 / 👎 on an exchange's answer. The rating flips instantly;
   * a failed request rolls it back silently (no dialog).
   *
   * @param {string} exchangeId
   * @param {-1 | 0 | 1} rating
   * @param {string} [comment] - only sent with a -1
   */
  const submitFeedback = useCallback(async (exchangeId, rating, comment) => {
    const exchange = exchangesRef.current.find((e) => e.id === exchangeId)
    if (!exchange || !exchange.messageId) return

    const previousRating = exchange.rating ?? 0
    setExchanges((prev) =>
      prev.map((e) => (e.id === exchangeId ? { ...e, rating } : e)),
    )

    try {
      await sendFeedback(exchange.messageId, rating, comment)
    } catch {
      setExchanges((prev) =>
        prev.map((e) => (e.id === exchangeId ? { ...e, rating: previousRating } : e)),
      )
    }
  }, [])

  return { exchanges, sendQuestion, stopGeneration, submitFeedback, loadDocument, isSending, conversationId }
}
