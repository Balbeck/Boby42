import { useCallback, useRef, useState } from 'react'
import { sendMessage } from '../services/chatApi'

/** @import { Exchange } from '../types/types.js' */

export function useChat() {
  /** @type {[Exchange[], Function]} */
  const [exchanges, setExchanges] = useState([])
  const [isSending, setIsSending] = useState(false)
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
      const { answer } = await sendMessage(trimmed, { signal: controller.signal })
      setExchanges((prev) =>
        prev.map((exchange) =>
          exchange.id === id ? { ...exchange, answer, loading: false } : exchange,
        ),
      )
    } catch (err) {
      if (err.name === 'AbortError') return
      setExchanges((prev) =>
        prev.map((exchange) =>
          exchange.id === id
            ? { ...exchange, answer: `Erreur : ${err.message}`, loading: false }
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

  return { exchanges, sendQuestion, stopGeneration, isSending }
}
