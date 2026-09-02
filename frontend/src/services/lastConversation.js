const PREFIX = 'boby42.lastConversation.'

/**
 * Dernière conversation ouverte, **par page** — la seule chose persistée d'une
 * conversation côté navigateur : un id. Le contenu est toujours rechargé depuis
 * la base au montage (cf. `hooks/useChat.js` / `hooks/useArchiviste.js`), jamais
 * stocké ici. Un `localStorage` indisponible (navigation privée) fait
 * simplement perdre la restauration, sans casser la page.
 *
 * @param {'chat' | 'archiviste'} page
 * @returns {string | null}
 */
export function readLastConversation(page) {
  try {
    return localStorage.getItem(PREFIX + page)
  } catch {
    return null
  }
}

/**
 * @param {'chat' | 'archiviste'} page
 * @param {string | null} id - `null` efface l'entrée (nouvelle conversation)
 */
export function rememberConversation(page, id) {
  try {
    if (id) localStorage.setItem(PREFIX + page, id)
    else localStorage.removeItem(PREFIX + page)
  } catch {
    // pas de persistance disponible — sans conséquence
  }
}
