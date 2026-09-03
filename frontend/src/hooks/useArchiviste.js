import { useCallback, useEffect, useRef, useState } from 'react'
import { search, fetchDocument } from '../services/archivisteApi'
import { sendFeedback } from '../services/feedbackApi'
import { getConversation } from '../services/historyApi'

/** @import { ArchivisteExchange, ArchivisteDocument, ConversationDetail, Language } from '../types/types.js' */

/**
 * Une conversation lue en base → les échanges de cette page. Même appariement
 * que côté chat (chaque `user` avec l'`assistant` qui le suit), mais la forme
 * diffère : ici pas de réponse ni de `phase`, seulement la liste de documents.
 * Les documents repartent `{ loading: false, loaded: false, expanded: false }` —
 * leur contenu n'est jamais stocké, il est refetché au dépli.
 *
 * @param {ConversationDetail} conversation
 * @returns {ArchivisteExchange[]}
 */
function toExchanges(conversation) {
  /** @type {ArchivisteExchange[]} */
  const exchanges = []

  conversation.messages.forEach((message, index) => {
    if (message.role !== 'user') return
    const next = conversation.messages[index + 1]
    const assistant = next && next.role === 'assistant' ? next : null

    exchanges.push({
      id: assistant?.id ?? message.id,
      question: message.content,
      documents: (assistant?.documents ?? []).map((doc) => ({
        name: doc.name,
        type: doc.type ?? 'md',
        // La colonne est nullable, mais une ligne journalisée porte toujours
        // l'url construite par le backend — assertion de type, aucun garde-fou
        // ajouté à l'exécution.
        url: /** @type {string} */ (doc.url),
        score: doc.score ?? 0,
        loading: false,
        loaded: false,
        expanded: false,
      })),
      loading: false,
      messageId: assistant?.id ?? null,
      rating: assistant?.rating ?? 0,
    })
  })

  return exchanges
}

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
  const [exchanges, setExchanges] = useState(/** @type {ArchivisteExchange[]} */ ([]))
  const [isSending, setIsSending] = useState(false)
  // Unsent input for this page — lifted out of `ChatInput` so a page switch
  // doesn't drop a half-typed search (same as useChat).
  const [draft, setDraft] = useState('')
  // The conversation this page's searches belong to (T4). `null` until the
  // first response carries one; kept in a ref too so `sendQuestion` stays
  // referentially stable.
  const [conversationId, setConversationId] = useState(/** @type {string | null} */ (null))
  const conversationIdRef = useRef(/** @type {string | null} */ (null))
  const abortControllerRef = useRef(/** @type {AbortController | null} */ (null))
  const pendingIdRef = useRef(/** @type {string | null} */ (null))
  // Mirror of `exchanges` so `submitFeedback` can read the current messageId /
  // rating without a stale closure and without depending on `exchanges`.
  const exchangesRef = useRef(exchanges)
  useEffect(() => {
    exchangesRef.current = exchanges
  }, [exchanges])

  /**
   * @param {string} question
   * @param {Language} language
   */
  const sendQuestion = useCallback(
    async (/** @type {string} */ question, /** @type {Language} */ language) => {
    const trimmed = question.trim()
    if (!trimmed) return

    setDraft('')

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
      if (/** @type {Error} */ (err).name === 'AbortError') return
      setExchanges((prev) =>
        prev.map((exchange) =>
          exchange.id === id
            ? { ...exchange, loading: false, error: /** @type {Error} */ (err).message }
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
   * @param {string} exchangeId
   * @param {ArchivisteDocument} doc
   */
  const loadDocument = useCallback(
    async (/** @type {string} */ exchangeId, /** @type {ArchivisteDocument} */ doc) => {
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
          error: /** @type {Error} */ (err).message,
        }),
      )
    }
  }, [])

  /**
   * Fold / unfold one document. `expanded` lives on the document (not in
   * `ArchivisteDocument`) so an unfolded row survives a page switch; the first
   * unfold also triggers the lazy content load.
   *
   * @param {string} exchangeId
   * @param {ArchivisteDocument} doc
   */
  const toggleDocument = useCallback(
    (/** @type {string} */ exchangeId, /** @type {ArchivisteDocument} */ doc) => {
      const next = !doc.expanded
      setExchanges((prev) => patchDocument(prev, exchangeId, doc.name, { expanded: next }))
      if (next) loadDocument(exchangeId, doc)
    },
    [loadDocument],
  )

  /**
   * Re-open a conversation on demand (the history drawer, when AUTH is on):
   * fetch it, rebuild this page's exchanges and adopt its id so the next search
   * threads into it. Nothing is persisted — a refresh always starts empty.
   *
   * @param {string} id
   */
  const loadConversation = useCallback(async (/** @type {string} */ id) => {
    const conversation = await getConversation(id)
    setExchanges(toExchanges(conversation))
    conversationIdRef.current = conversation.id
    setConversationId(conversation.id)
  }, [])

  /** Empty the page: a fresh thread, no draft. */
  const startNewConversation = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    pendingIdRef.current = null
    setIsSending(false)
    setExchanges([])
    setDraft('')
    conversationIdRef.current = null
    setConversationId(null)
  }, [])

  /**
   * Optimistic 👍 / 👎 on a search's result list (attached to its assistant
   * message). Flips instantly; a failed request rolls back silently.
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
    toggleDocument,
    loadConversation,
    startNewConversation,
    draft,
    setDraft,
    conversationId,
  }
}
