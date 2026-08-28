import { useCallback, useRef, useState } from 'react'
import { search, fetchDocument } from '../services/archivisteApi'

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
  const abortControllerRef = useRef(null)
  const pendingIdRef = useRef(null)

  const sendQuestion = useCallback(async (question, language) => {
    const trimmed = question.trim()
    if (!trimmed) return

    const id = crypto.randomUUID()
    pendingIdRef.current = id
    const controller = new AbortController()
    abortControllerRef.current = controller

    setExchanges((prev) => [...prev, { id, question: trimmed, documents: [], loading: true }])
    setIsSending(true)

    try {
      const { documents } = await search(trimmed, language, { signal: controller.signal })
      const sorted = [...documents]
        .sort((a, b) => b.score - a.score)
        .map((doc) => ({ ...doc, loading: false, loaded: false }))

      setExchanges((prev) =>
        prev.map((exchange) =>
          exchange.id === id ? { ...exchange, documents: sorted, loading: false } : exchange,
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
   * @param {string} language - 'fr' | 'en'
   */
  const loadDocument = useCallback(async (exchangeId, doc, language) => {
    if (doc.loaded || doc.loading) return

    setExchanges((prev) => patchDocument(prev, exchangeId, doc.name, { loading: true }))

    try {
      const { content } = await fetchDocument(doc.url, language)
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

  return { exchanges, sendQuestion, stopGeneration, isSending, loadDocument }
}
