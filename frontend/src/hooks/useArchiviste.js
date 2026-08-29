import { useCallback, useEffect, useRef, useState } from 'react'
import { search, fetchDocument } from '../services/archivisteApi'
import { sendFeedback } from '../services/feedbackApi'

/** @import { ArchivisteExchange, ArchivisteDocument } from '../types/types.js' */

/**
 * @param {ArchivisteExchange[]} exchanges
 * @param {string} exchangeId
 * @param {string} docName
 * @param {Partial<ArchivisteDocument>} patch
 */
function patchDocument(exchanges, exchangeId, docName, patch) {
  return exchanges.map((exchange) => {
    if (exchange.id !== exchangeId) return exchange
    return {
      ...exchange,
      documents: exchange.documents.map((doc) =>
        doc.name === docName ? { ...doc, ...patch } : doc,
      ),
    }
  })
}

export function useArchiviste() {
  /** @type {[ArchivisteExchange[], Function]} */
  const [exchanges, setExchanges] = useState([])
  const [isSending, setIsSending] = useState(false)
  // The conversation this page's searches belong to (T4). `null` until the
  // first response carries one; kept in a ref too so `sendQuestion` stays
  // referentially stable.
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
    const controller = new AbortController()
    abortControllerRef.current = controller

    setExchanges((prev) => [
      ...prev,
      { id, question: trimmed, documents: [], loading: true, messageId: null, rating: 0 },
    ])
    setIsSending(true)

    try {
      const response = await search(trimmed, language, {
        signal: controller.signal,
        conversationId: conversationIdRef.current,
      })
      if (response.conversationId && response.conversationId !== conversationIdRef.current) {
        conversationIdRef.current = response.conversationId
        setConversationId(response.conversationId)
      }
      const sorted = [...response.documents]
        .sort((a, b) => b.score - a.score)
        .map((doc) => ({ ...doc, loading: false, loaded: false }))

      setExchanges((prev) =>
        prev.map((exchange) =>
          exchange.id === id
            ? {
                ...exchange,
                documents: sorted,
                loading: false,
                messageId: response.messageId ?? null,
              }
            : exchange,
        ),
      )
    } catch (err) {
      if (err.name === 'AbortError') return
      setExchanges((prev) =>
        prev.map((exchange) =>
          exchange.id === id ? { ...exchange, loading: false, error: err.message } : exchange,
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
   * @param {string} exchangeId
   * @param {ArchivisteDocument} doc
   */
  const loadDocument = useCallback(async (exchangeId, doc) => {
    if (doc.loaded || doc.loading) return

    // PDFs aren't fetched as JSON — the <iframe> loads doc.url itself. Just mark
    // it loaded so the no-op guard above holds on further expands.
    if (doc.type === 'pdf') {
      setExchanges((prev) => patchDocument(prev, exchangeId, doc.name, { loaded: true }))
      return
    }

    setExchanges((prev) => patchDocument(prev, exchangeId, doc.name, { loading: true }))

    try {
      const { content } = await fetchDocument(doc.url)
      setExchanges((prev) =>
        patchDocument(prev, exchangeId, doc.name, { content, loading: false, loaded: true }),
      )
    } catch (err) {
      setExchanges((prev) =>
        patchDocument(prev, exchangeId, doc.name, {
          loading: false,
          error: err.message,
        }),
      )
    }
  }, [])

  /**
   * Optimistic 👍 / 👎 on a search's result list (attached to its assistant
   * message). Flips instantly; a failed request rolls back silently.
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

  return {
    exchanges,
    sendQuestion,
    stopGeneration,
    submitFeedback,
    isSending,
    loadDocument,
    conversationId,
  }
}
