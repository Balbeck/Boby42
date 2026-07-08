import { useCallback, useState } from 'react'

/** @import { Exchange } from '../types/types.js' */

const PLACEHOLDER_ANSWER = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
  'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.',
  'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum.',
  'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia.',
].join('\n')

export function useChat() {
  /** @type {[Exchange[], Function]} */
  const [exchanges, setExchanges] = useState([])

  const sendQuestion = useCallback((question) => {
    const trimmed = question.trim()
    if (!trimmed) return

    setExchanges((prev) => [
      ...prev,
      { id: crypto.randomUUID(), question: trimmed, answer: PLACEHOLDER_ANSWER },
    ])
  }, [])

  return { exchanges, sendQuestion }
}
