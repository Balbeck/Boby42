import { useEffect, useState } from 'react'
import { listConversations } from '../services/historyApi'

/** @import { ConversationSummary } from '../types/types.js' */

// Les mêmes glyphes que PageSwitcher : une ligne d'historique doit se lire
// comme la page à laquelle elle appartient.
const PAGE_GLYPH = { archiviste: '🕵️‍♂️', chat: '👨🏻‍🏭' }

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Date relative courte ("il y a 3 h", "5 d ago"). `Intl.RelativeTimeFormat`
 * suffit — pas de dépendance de dates pour une ligne de méta.
 *
 * @param {string} iso
 * @param {'fr' | 'en' | 'origin'} language
 * @param {object} t
 * @returns {string}
 */
function relativeDate(iso, language, t) {
  const elapsed = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(elapsed)) return ''
  if (elapsed < MINUTE) return t.justNow

  const locale = language === 'en' ? 'en' : 'fr'
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'narrow' })

  const ago = (value, unit) => format.format(-Math.round(value), unit)
  if (elapsed < HOUR) return ago(elapsed / MINUTE, 'minute')
  if (elapsed < DAY) return ago(elapsed / HOUR, 'hour')
  if (elapsed < 30 * DAY) return ago(elapsed / DAY, 'day')
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
}

/**
 * Le tiroir d'historique : bouton « nouvelle conversation » puis les
 * conversations de ce navigateur, plus récente d'abord.
 *
 * Il **recouvre** la page (fond assombri) au lieu de la pousser : à un quart de
 * l'écran, pousser reflowerait la colonne centrée et ferait sauter la lecture
 * latéralement à chaque ouverture.
 *
 * La liste est (re)chargée à chaque ouverture — donc après chaque nouvel
 * échange, sans avoir à s'abonner à quoi que ce soit.
 *
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   onSelect: (conversation: ConversationSummary) => void,
 *   onNew: () => void,
 *   activeIds: { chat: string | null, archiviste: string | null },
 *   language: 'fr' | 'en' | 'origin',
 *   t: object,
 * }} props
 */
export default function Drawer({ open, onClose, onSelect, onNew, activeIds, language, t }) {
  /** @type {[ConversationSummary[], Function]} */
  const [conversations, setConversations] = useState([])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    listConversations({ signal: controller.signal })
      .then(setConversations)
      .catch(() => {})
    return () => controller.abort()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      <div
        className="overlay-in fixed inset-0 z-30 bg-black/50"
        onClick={onClose}
        aria-hidden
      />
      <aside
        aria-label={t.conversations}
        className="drawer-in fixed inset-y-0 left-0 z-40 flex w-[85vw] max-w-sm flex-col border-r border-chat-border bg-chat-surface md:w-1/4 md:min-w-[280px]"
      >
        <div className="flex flex-col gap-3 px-3 pt-4 pb-3">
          <button
            type="button"
            onClick={onNew}
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-chat-text transition-colors hover:bg-chat-surface-2 focus-visible:ring-2 focus-visible:ring-chat-green focus-visible:outline-none"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              className="h-4 w-4 text-chat-green"
              aria-hidden
            >
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            {t.newConversation}
          </button>
          <div className="h-px bg-chat-border" />
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {conversations.length === 0 ? (
            <p className="px-3 py-2 text-sm text-chat-text-muted">{t.conversationsEmpty}</p>
          ) : (
            <ul className="flex flex-col">
              {conversations.map((conversation) => {
                const active = activeIds[conversation.page] === conversation.id
                return (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(conversation)}
                      aria-current={active ? 'true' : undefined}
                      className={`relative flex w-full items-start gap-2.5 rounded-lg py-2.5 pr-3 pl-3 text-left transition-colors hover:bg-chat-surface-2 focus-visible:ring-2 focus-visible:ring-chat-green focus-visible:outline-none ${
                        active ? 'bg-chat-green/10' : ''
                      }`}
                    >
                      {/* Le fil courant : un trait, pas un aplat coloré. */}
                      {active && (
                        <span
                          className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-chat-green"
                          aria-hidden
                        />
                      )}
                      <span className="pt-px text-sm leading-5" aria-hidden>
                        {PAGE_GLYPH[conversation.page]}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span
                          className={`truncate text-sm leading-5 text-chat-text ${
                            active ? 'font-medium' : ''
                          }`}
                        >
                          {conversation.title}
                        </span>
                        <span className="text-[11px] text-chat-text-muted">
                          {relativeDate(conversation.updatedAt, language, t)}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </nav>
      </aside>
    </>
  )
}
