import { useCallback, useState } from 'react'
import { sendMessage } from '../services/chatApi'

/** @import { Exchange } from '../types/types.js' */

export function useChat() {
  /** @type {[Exchange[], Function]} */
  const [exchanges, setExchanges] = useState([])

  const sendQuestion = useCallback(async (question) => {
    const trimmed = question.trim()
    if (!trimmed) return

    const id = crypto.randomUUID()
    setExchanges((prev) => [...prev, { id, question: trimmed, answer: '', loading: true }])

    try {
      const { answer } = await sendMessage(trimmed)
      setExchanges((prev) =>
        prev.map((exchange) =>
          exchange.id === id ? { ...exchange, answer, loading: false } : exchange,
        ),
      )
    } catch (err) {
      setExchanges((prev) =>
        prev.map((exchange) =>
          exchange.id === id
            ? { ...exchange, answer: `Erreur : ${err.message}`, loading: false }
            : exchange,
        ),
      )
    }
  }, [])

  return { exchanges, sendQuestion }
}
