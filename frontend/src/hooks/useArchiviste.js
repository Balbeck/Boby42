import { useCallback, useEffect, useRef, useState } from 'react'
import { search, fetchDocument } from '../services/archivisteApi'
import { sendFeedback } from '../services/feedbackApi'
import { getConversation } from '../services/historyApi'
import { useSendQueue } from './useSendQueue'

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
 * Patch un document (apparié par type **et** nom) d'un échange. Même
 * appariement que `useChat.js` : une recherche fusionne les deux magasins et
 * `ArchivisteMessage` clé ses lignes par `` `${type}:${name}` ``, donc un `md`
 * et un `pdf` de même nom peuvent coexister à l'écran — sur le nom seul,
 * déplier l'un déplierait les deux et le markdown du premier serait écrit dans
 * les deux.
 *
 * @param {ArchivisteExchange[]} exchanges
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

export function useArchiviste() {
  const [exchanges, setExchanges] = useState(/** @type {ArchivisteExchange[]} */ ([]))
  // Un envoi en vol plus au plus un en attente (F5), même primitive que
  // `useChat`. `isSending` est **dérivé** de la profondeur de la file : elle
  // possède déjà cette information, deux sources de vérité divergeraient.
  // Différence avec /chat : les échanges d'ici n'ont pas de `phase`, et cette
  // tâche n'en ajoute pas — l'attente est un booléen `queued` sur l'échange.
  const { depth, isBusy, isFull, enqueue, clear } = useSendQueue()
  const isSending = depth > 0
  const isQueueFull = depth >= 2
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
    // Déjà une recherche en vol et une en attente : on refuse. Rien n'est créé
    // et le brouillon est laissé tel quel, l'utilisateur ne perd pas sa saisie.
    if (isFull()) return

    const willWait = isBusy()

    setDraft('')

    const id = crypto.randomUUID()

    // ⚠️ L'échange doit être dans l'état **avant** que son run démarre : la
    // première action du run est un setExchanges sur cet id, et une mise à jour
    // qui vise un échange absent de la liste est perdue en silence (symptôme :
    // une question bloquée sur « en attente » pour toujours). D'où l'ordre :
    // décider depuis les refs de la file, ajouter, *puis* enfiler.
    setExchanges((prev) => [
      ...prev,
      {
        id,
        question: trimmed,
        documents: [],
        loading: true,
        ...(willWait ? { queued: true } : {}),
        messageId: null,
        rating: 0,
      },
    ])

    enqueue(async () => {
    // Sortie de l'attente (sans effet si le run a démarré tout de suite).
    setExchanges((prev) =>
      prev.map((exchange) =>
        exchange.id === id ? { ...exchange, queued: false } : exchange,
      ),
    )

    pendingIdRef.current = id
    const controller = new AbortController()
    abortControllerRef.current = controller

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
        pendingIdRef.current = null
        abortControllerRef.current = null
      }
    }
    })
  }, [enqueue, isBusy, isFull])

  /**
   * Un stop est un stop : il annule la recherche en cours **et** abandonne
   * celle qui attendait derrière. Les deux échanges disparaissent, comme un
   * échange stoppé disparaît déjà aujourd'hui.
   */
  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort()
    const id = pendingIdRef.current
    clear()
    setExchanges((prev) =>
      prev.filter((exchange) => exchange.id !== id && !exchange.queued),
    )
    pendingIdRef.current = null
    abortControllerRef.current = null
  }, [clear])

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
      setExchanges((prev) => patchDocument(prev, exchangeId, doc.type, doc.name, { loaded: true }))
      return
    }

    setExchanges((prev) => patchDocument(prev, exchangeId, doc.type, doc.name, { loading: true }))

    try {
      const { content } = await fetchDocument(doc.url)
      setExchanges((prev) =>
        patchDocument(prev, exchangeId, doc.type, doc.name, { content, loading: false, loaded: true }),
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
      setExchanges((prev) =>
        patchDocument(prev, exchangeId, doc.type, doc.name, { expanded: next }),
      )
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
    clear()
    abortControllerRef.current = null
    pendingIdRef.current = null
    setExchanges([])
    setDraft('')
    conversationIdRef.current = null
    setConversationId(null)
  }, [clear])

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
    isQueueFull,
    toggleDocument,
    loadConversation,
    startNewConversation,
    draft,
    setDraft,
    conversationId,
  }
}
