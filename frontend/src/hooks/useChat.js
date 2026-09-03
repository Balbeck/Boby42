import { useCallback, useEffect, useRef, useState } from 'react'
import { sendMessage, fetchChatDocuments, fetchDocumentContent } from '../services/chatApi'
import { sendFeedback } from '../services/feedbackApi'
import { getConversation } from '../services/historyApi'
import { useSendQueue } from './useSendQueue'

/** @import { Exchange, ArchivisteDocument, ConversationDetail, Language } from '../types/types.js' */

/**
 * Une conversation lue en base → les échanges que la page rend déjà. Les
 * messages arrivent à plat et chronologiques : chaque `user` est apparié au
 * `assistant` qui le suit.
 *
 * Deux points non négociables : les documents repartent
 * `{ loading: false, loaded: false, expanded: false }` — leur contenu n'est
 * jamais stocké et sera refetché au dépli, exactement comme après une réponse
 * fraîche ; et l'échange est marqué **`phase: 'done'`**, sinon la machine à
 * étapes de `Message.jsx` afficherait « je cherche… » sous une question
 * répondue il y a trois jours.
 *
 * @param {ConversationDetail} conversation
 * @returns {Exchange[]}
 */
function toExchanges(conversation) {
  /** @type {Exchange[]} */
  const exchanges = []

  conversation.messages.forEach((message, index) => {
    if (message.role !== 'user') return
    const next = conversation.messages[index + 1]
    const assistant = next && next.role === 'assistant' ? next : null

    exchanges.push({
      id: assistant?.id ?? message.id,
      question: message.content,
      answer: assistant?.content ?? '',
      documents: (assistant?.documents ?? []).map((doc) => ({
        name: doc.name,
        type: doc.type ?? 'md',
        // The column is nullable, but a logged row always carries the url the
        // backend built for it — asserted rather than defaulted, so no runtime
        // behaviour is added here.
        url: /** @type {string} */ (doc.url),
        score: doc.score ?? 0,
        loading: false,
        loaded: false,
        expanded: false,
      })),
      loading: false,
      phase: 'done',
      messageId: assistant?.id ?? null,
      rating: assistant?.rating ?? 0,
    })
  })

  return exchanges
}

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
  const [exchanges, setExchanges] = useState(/** @type {Exchange[]} */ ([]))
  // One send in flight plus at most one waiting (F5). `isSending` is **derived**
  // from the queue's depth rather than stored: the queue already owns that fact
  // and two sources of truth for it would drift.
  const { depth, isBusy, isFull, enqueue, clear } = useSendQueue()
  const isSending = depth > 0
  const isQueueFull = depth >= 2
  // Unsent input for this page. Lifted out of `ChatInput` so a /chat ↔
  // /archiviste switch (which unmounts the page) doesn't drop a half-typed
  // question; both branches of the page render the same value.
  const [draft, setDraft] = useState('')
  // The conversation this page's exchanges belong to (T4). `null` until the
  // first response comes back with one. Kept in a ref too so `sendQuestion`
  // stays referentially stable (same reason as `pendingIdRef`).
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
   * `notFoundText` is the UI-language "no document found" message, passed in by
   * the page (hooks hold no user-facing text). When phase 1 finds nothing the
   * backend skips the LLM and returns a fixed French fallback — we freeze this
   * localized version into the exchange instead, so it never re-translates on a
   * later language switch (session history is frozen text).
   *
   * @param {string} question
   * @param {Language} language
   * @param {string} [notFoundText]
   */
  const sendQuestion = useCallback(
    async (
      /** @type {string} */ question,
      /** @type {Language} */ language,
      /** @type {string | undefined} */ notFoundText,
    ) => {
    const trimmed = question.trim()
    if (!trimmed) return
    // Already one running and one waiting: refuse. Nothing is created and the
    // draft is left alone, so the user doesn't lose what they typed.
    if (isFull()) return

    const willWait = isBusy()

    setDraft('')

    const id = crypto.randomUUID()

    // ⚠️ The exchange must be in state **before** its run starts: the run's first
    // action is a setExchanges on this id, and an update targeting an exchange
    // that isn't in the list yet is silently lost (the symptom would be a
    // question stuck on "waiting" forever). Hence: decide the phase from the
    // queue's refs, append, *then* enqueue.
    setExchanges((prev) => [
      ...prev,
      {
        id,
        question: trimmed,
        documents: [],
        answer: '',
        loading: true,
        phase: willWait ? 'queued' : 'retrieving',
        messageId: null,
        rating: 0,
      },
    ])

    enqueue(async () => {
    // Leaving the waiting step (a no-op when this run started immediately).
    setExchanges((prev) =>
      prev.map((exchange) =>
        exchange.id === id ? { ...exchange, phase: 'retrieving' } : exchange,
      ),
    )

    pendingIdRef.current = id
    // One controller for the whole two-call flow — the stop button must cancel
    // whichever of retrieval / generation is in flight.
    const controller = new AbortController()
    abortControllerRef.current = controller

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
      // The answer streams in via `onToken`: the first fragment flips the
      // exchange to `phase: 'done'` so the text renders as it grows; the final
      // response below reconciles the full answer + attaches the messageId.
      const documents = sorted.map(({ name, type, score, url }) => ({ name, type, score, url }))
      let streaming = false
      const response = await sendMessage(trimmed, {
        signal: controller.signal,
        conversationId: conversationIdRef.current,
        language,
        documents,
        onToken: (_fragment, full) => {
          setExchanges((prev) =>
            prev.map((exchange) =>
              exchange.id === id
                ? {
                    ...exchange,
                    answer: full,
                    ...(streaming ? {} : { phase: 'done', loading: false }),
                  }
                : exchange,
            ),
          )
          streaming = true
        },
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
                answer:
                  sorted.length === 0 ? notFoundText ?? response.answer : response.answer,
                loading: false,
                phase: 'done',
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
            ? {
                ...exchange,
                error: /** @type {Error} */ (err).message,
                loading: false,
                phase: 'error',
              }
            : exchange,
        ),
      )
    } finally {
      if (pendingIdRef.current === id) {
        pendingIdRef.current = null
        abortControllerRef.current = null
      }
    }
    })
  }, [enqueue, isBusy, isFull])

  /**
   * A stop is a stop: it cancels the running generation **and** drops the
   * question waiting behind it. Both exchanges disappear, exactly as a single
   * stopped exchange does today.
   */
  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort()
    const id = pendingIdRef.current
    clear()
    setExchanges((prev) =>
      prev.filter((exchange) => exchange.id !== id && exchange.phase !== 'queued'),
    )
    pendingIdRef.current = null
    abortControllerRef.current = null
  }, [clear])

  /**
   * Lazy-load one matched document's content on first expand. Copied from
   * `useArchiviste.loadDocument`; PDFs are never fetched (the <iframe> loads the
   * url itself), and a loaded / loading row is a no-op.
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
  }, [])

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
   * fetch it, rebuild this page's exchanges from it and adopt its id so the next
   * question threads into the same conversation. Nothing is persisted — a
   * refresh always starts empty.
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
    clear()
    abortControllerRef.current = null
    pendingIdRef.current = null
    setExchanges([])
    setDraft('')
    conversationIdRef.current = null
    setConversationId(null)
  }, [clear])

  /**
   * Optimistic 👍 / 👎 on an exchange's answer. The rating flips instantly;
   * a failed request rolls it back silently (no dialog).
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
    toggleDocument,
    loadConversation,
    startNewConversation,
    draft,
    setDraft,
    isSending,
    isQueueFull,
    conversationId,
  }
}
