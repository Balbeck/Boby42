import { useCallback, useRef } from 'react'
import { search, fetchDocument } from '../services/archivisteApi'
import { useSendQueue } from './useSendQueue'
import { useConversationBase } from './useConversationBase'

/** @import { ArchivisteExchange, ConversationDetail, Language } from '../types/types.js' */

/**
 * Une conversation lue en base → les échanges de cette page. Même appariement
 * que côté chat (chaque `user` avec l'`assistant` qui le suit), mais la forme
 * diffère : ici pas de réponse ni de `phase`, seulement la liste de documents.
 * Les documents repartent `{ loading: false, loaded: false, expanded: false }` —
 * leur contenu n'est jamais stocké, il est refetché au dépli.
 *
 * Ce sont exactement les champs `answer` / `phase` en moins qui séparent ce
 * `toExchanges` de celui de `useChat.js` — d'où le passage en paramètre à
 * `useConversationBase`.
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

export function useArchiviste() {
  // Conversation-UI plumbing shared with `useChat` (exchange list + ref mirror,
  // draft, conversation id, per-doc lazy loading, feedback, history reopening).
  // Everything below — `sendQuestion`, the send queue, the abort refs,
  // `stopGeneration`, the queue-and-abort half of `startNewConversation` —
  // stays here because it knows how this page fetches. See useConversationBase.js.
  const {
    exchanges,
    setExchanges,
    draft,
    setDraft,
    conversationId,
    conversationIdRef,
    adoptConversationId,
    submitFeedback,
    toggleDocument,
    loadConversation,
    reset,
  } = useConversationBase({ fetchDocumentContent: fetchDocument, toExchanges })

  // Un envoi en vol plus au plus un en attente (F5), même primitive que
  // `useChat`. `isSending` est **dérivé** de la profondeur de la file : elle
  // possède déjà cette information, deux sources de vérité divergeraient.
  // Différence avec /chat : les échanges d'ici n'ont pas de `phase`, et cette
  // tâche n'en ajoute pas — l'attente est un booléen `queued` sur l'échange.
  const { depth, isBusy, isFull, enqueue, clear } = useSendQueue()
  const isSending = depth > 0
  const isQueueFull = depth >= 2
  const abortControllerRef = useRef(/** @type {AbortController | null} */ (null))
  const pendingIdRef = useRef(/** @type {string | null} */ (null))

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
      adoptConversationId(response.conversationId)
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
  }, [adoptConversationId, conversationIdRef, enqueue, isBusy, isFull, setDraft, setExchanges])

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
  }, [clear, setExchanges])

  /**
   * Empty the page: a fresh thread, no draft. Aborts anything in flight and
   * clears the queue, then hands the state reset to `useConversationBase`.
   */
  const startNewConversation = useCallback(() => {
    abortControllerRef.current?.abort()
    clear()
    abortControllerRef.current = null
    pendingIdRef.current = null
    reset()
  }, [clear, reset])

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
