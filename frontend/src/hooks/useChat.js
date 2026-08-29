import { useCallback, useRef, useState } from 'react'
import { sendMessage } from '../services/chatApi'

/** @import { Exchange } from '../types/types.js' */

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

  const sendQuestion = useCallback(async (question) => {
    const trimmed = question.trim()
    if (!trimmed) return

    const id = crypto.randomUUID()
    pendingIdRef.current = id
    const controller = new AbortController()
    abortControllerRef.current = controller

    setExchanges((prev) => [...prev, { id, question: trimmed, answer: '', loading: true }])
    setIsSending(true)

    try {
      const response = await sendMessage(trimmed, {
        signal: controller.signal,
        conversationId: conversationIdRef.current,
      })
      if (response.conversationId && response.conversationId !== conversationIdRef.current) {
        conversationIdRef.current = response.conversationId
        setConversationId(response.conversationId)
      }
      setExchanges((prev) =>
        prev.map((exchange) =>
          exchange.id === id
            ? { ...exchange, answer: response.answer, loading: false }
            : exchange,
        ),
      )
    } catch (err) {
      if (err.name === 'AbortError') return
      setExchanges((prev) =>
        prev.map((exchange) =>
          exchange.id === id
            ? { ...exchange, error: err.message, loading: false }
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

  return { exchanges, sendQuestion, stopGeneration, isSending, conversationId }
}
