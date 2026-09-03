import { createContext, useContext } from 'react'

/**
 * Contextes portant l'état des deux conversations (chat + archiviste). Ils sont
 * alimentés par `<ConversationsProvider>` (voir `ConversationsProvider.jsx`),
 * monté au-dessus de `<Routes>` : l'état survit donc à un changement de page
 * `/chat` ↔ `/archiviste`, mais pas à un refresh (pas de `localStorage` ici —
 * seule la langue est persistée).
 *
 * Fichier `.js` sans composant exporté, pour ne pas déclencher
 * `react-refresh/only-export-components` : le composant provider vit à part.
 */

/**
 * La valeur portée par chaque contexte : exactement ce que le hook d'état de la
 * page renvoie. Dérivée du hook (`ReturnType`) et non recopiée à la main, pour
 * qu'elle suive toute évolution de `useChat` / `useArchiviste`.
 *
 * @typedef {ReturnType<typeof import('../hooks/useChat').useChat>} ChatState
 * @typedef {ReturnType<typeof import('../hooks/useArchiviste').useArchiviste>} ArchivisteState
 */

export const ChatContext = createContext(/** @type {ChatState | null} */ (null))
export const ArchivisteContext = createContext(/** @type {ArchivisteState | null} */ (null))

/** État du chat, partagé entre les pages. */
export function useChat() {
  const ctx = useContext(ChatContext)
  if (ctx === null) throw new Error('useChat doit être utilisé dans <ConversationsProvider>')
  return ctx
}

/** État de l'archiviste, partagé entre les pages. */
export function useArchiviste() {
  const ctx = useContext(ArchivisteContext)
  if (ctx === null) throw new Error('useArchiviste doit être utilisé dans <ConversationsProvider>')
  return ctx
}
