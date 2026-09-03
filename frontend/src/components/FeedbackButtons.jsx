import { useState } from 'react'

/**
 * Two quiet 👍 / 👎 buttons under a completed answer. `aria-pressed` reflects the
 * current rating; clicking the active one withdraws it. A 👎 reveals one
 * optional single-line comment field — submitting re-sends the same rating with
 * the comment. The parent only mounts this once an answer is complete and a
 * `messageId` exists, so nothing shows while loading.
 *
 * @param {{
 *   rating: -1 | 0 | 1,
 *   onRate: (rating: -1 | 0 | 1, comment?: string) => void,
 *   t: import('../types/types.js').Messages,
 * }} props
 */
export default function FeedbackButtons({ rating, onRate, t }) {
  const [showComment, setShowComment] = useState(false)
  const [comment, setComment] = useState('')
  // Adjust state when `rating` changes from outside (a silent rollback, or
  // hydration): if it's no longer a 👎, drop the comment field. React-sanctioned
  // "adjust state during render" pattern — no effect.
  const [prevRating, setPrevRating] = useState(rating)
  if (rating !== prevRating) {
    setPrevRating(rating)
    if (rating !== -1 && showComment) {
      setShowComment(false)
      setComment('')
    }
  }

  function handleUp() {
    onRate(rating === 1 ? 0 : 1)
  }

  function handleDown() {
    if (rating === -1) {
      onRate(0)
      return
    }
    onRate(-1)
    setShowComment(true)
  }

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  function handleSubmitComment(event) {
    event.preventDefault()
    onRate(-1, comment.trim() || undefined)
    setShowComment(false)
  }

  const iconClass = 'h-4 w-4'

  return (
    <div className="flex flex-col gap-2 pt-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={handleUp}
          aria-pressed={rating === 1}
          aria-label={t.feedbackUp}
          className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:text-chat-text ${
            rating === 1 ? 'text-chat-green' : 'text-chat-text-muted'
          }`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={iconClass}>
            <path d="M7 10v12" />
            <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={handleDown}
          aria-pressed={rating === -1}
          aria-label={t.feedbackDown}
          className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:text-chat-text ${
            rating === -1 ? 'text-chat-green' : 'text-chat-text-muted'
          }`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={iconClass}>
            <path d="M17 14V2" />
            <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
          </svg>
        </button>
      </div>

      {showComment && (
        <form onSubmit={handleSubmitComment} className="flex items-center gap-2">
          <input
            type="text"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={500}
            autoFocus
            placeholder={t.feedbackCommentPlaceholder}
            className="w-full max-w-md rounded-md border border-chat-border bg-chat-surface px-3 py-1.5 text-sm text-chat-text placeholder:text-chat-text-muted focus:border-chat-green focus:outline-none"
          />
          <button
            type="submit"
            aria-label={t.feedbackCommentSend}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-chat-text-muted transition-colors hover:text-chat-text"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={iconClass}>
              <path d="M12 19V5" />
              <path d="M5 12l7-7 7 7" />
            </svg>
          </button>
        </form>
      )}
    </div>
  )
}
