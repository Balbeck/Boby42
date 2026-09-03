/**
 * Champ de saisie **contrôlé** : `value` / `onChange` vivent au-dessus du
 * router (un brouillon par page, cf. `hooks/useChat.js` / `hooks/useArchiviste.js`),
 * pour qu'une bascule /chat ↔ /archiviste ne perde pas un message non envoyé.
 * Chaque page rend ce composant dans deux branches (vide / démarrée) : les deux
 * lisent et écrivent le même brouillon.
 *
 * @param {{
 *   value: string,
 *   onChange: (value: string) => void,
 *   onSend: (value: string) => void,
 *   onStop?: () => void,
 *   isSending?: boolean,
 *   autoFocus?: boolean,
 *   placeholder?: string,
 *   t: import('../types/types.js').Messages,
 * }} props
 */
export default function ChatInput({
  value,
  onChange,
  onSend,
  onStop,
  isSending = false,
  autoFocus = false,
  placeholder,
  t,
}) {
  const canSend = value.trim().length > 0

  function handleSend() {
    if (!canSend) return
    // Le brouillon est vidé par l'appelant (à l'envoi), pas ici : il ne
    // s'agit plus d'un état local.
    onSend(value)
  }

  /** @param {import('react').KeyboardEvent<HTMLTextAreaElement>} event */
  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="relative w-full rounded-2xl border-2 border-chat-green/50 bg-chat-surface shadow-lg shadow-black/20 transition-colors focus-within:border-chat-green">
      <textarea
        autoFocus={autoFocus}
        rows={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? t.chatInputPlaceholder}
        className="max-h-48 w-full resize-none bg-transparent py-4 pr-14 pl-5 text-chat-text placeholder:text-chat-text-muted focus:outline-none"
      />

      {isSending ? (
        <button
          type="button"
          onClick={onStop}
          aria-label={t.stopAria}
          className="absolute right-3 bottom-3 flex h-9 w-9 items-center justify-center rounded-full bg-chat-green text-chat-bg transition-colors hover:bg-chat-green/80"
        >
          <span className="h-3 w-3 rounded-[3px] bg-chat-bg" />
        </button>
      ) : (
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          aria-label={t.sendAria}
          className={`absolute right-3 bottom-3 flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
            canSend
              ? 'bg-chat-green text-chat-bg hover:bg-chat-green/80'
              : 'cursor-not-allowed bg-chat-surface-2 text-chat-text-muted'
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <path d="M12 19V5" />
            <path d="M5 12l7-7 7 7" />
          </svg>
        </button>
      )}
    </div>
  )
}
