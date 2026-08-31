import { NOTION_RTFM_URL } from './messages'

/**
 * Rend `text` en transformant la première occurrence de `fragment` en lien vers
 * le Notion « RTFM - stud » de 42. Retombe sur le texte brut si `fragment` n'est
 * pas présent une fois exactement (langue sans entrée, texte modifié).
 * Utilisé par les deux disclaimers (`/chat` et `/archiviste`).
 *
 * @param {string} text
 * @param {string} fragment
 * @returns {import('react').ReactNode}
 */
export function withNotionLink(text, fragment) {
  const parts = fragment ? text.split(fragment) : [text]
  if (parts.length !== 2) return text
  return (
    <>
      {parts[0]}
      <a
        href={NOTION_RTFM_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-chat-green"
      >
        {fragment}
      </a>
      {parts[1]}
    </>
  )
}
