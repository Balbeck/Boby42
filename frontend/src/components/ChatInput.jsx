import { useState } from 'react'

/**
 * @param {{ onSend: (value: string) => void, autoFocus?: boolean }} props
 */
export default function ChatInput({ onSend, autoFocus = false }) {
  const [value, setValue] = useState('')

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (!value.trim()) return
      onSend(value)
      setValue('')
    }
  }

  return (
    <div className="w-full rounded-2xl border-2 border-chat-green/50 bg-chat-surface shadow-lg shadow-black/20 transition-colors focus-within:border-chat-green">
      <textarea
        autoFocus={autoFocus}
        rows={1}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Comment puis je vous aider ?"
        className="max-h-48 w-full resize-none bg-transparent px-5 py-4 text-chat-text placeholder:text-chat-text-muted focus:outline-none"
      />
    </div>
  )
}
