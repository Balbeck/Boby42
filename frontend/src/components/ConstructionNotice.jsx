import Modal from './Modal'
import { messages, useLanguage } from '../i18n'

/**
 * Encart « section en construction », à poser sur n'importe quelle page en
 * chantier :
 *
 *   {show && <ConstructionNotice onClose={() => setShow(false)} />}
 *
 * Autonome : lit la langue lui-même, textes par défaut surchargeables via
 * `title` / `body` pour l'adapter à une autre page.
 *
 * @param {{ onClose: () => void, title?: string, body?: string }} props
 */
export default function ConstructionNotice({ onClose, title, body }) {
  const language = useLanguage()
  const t = messages[language] ?? messages.fr
  const heading = title ?? t.wipTitle
  const text = body ?? t.wipBody

  return (
    <Modal onClose={onClose} label={heading} closeLabel={t.close}>
      <div className="flex flex-col items-center gap-4 text-center">
        <h2 className="text-lg font-medium text-chat-text">{heading}</h2>
        <p className="text-sm leading-relaxed text-chat-text-muted">{text}</p>
      </div>
    </Modal>
  )
}
