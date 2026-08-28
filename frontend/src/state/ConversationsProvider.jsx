import { Outlet } from 'react-router-dom'
import { useChat as useChatState } from '../hooks/useChat'
import { useArchiviste as useArchivisteState } from '../hooks/useArchiviste'
import { ChatContext, ArchivisteContext } from './conversationsContext'

/**
 * Appelle `useChat()` / `useArchiviste()` **une seule fois**, au-dessus de
 * `<Routes>` (voir `main.jsx`). Comme le provider ne se démonte pas en changeant
 * de page, ce qu'un utilisateur a fait sur `/chat` ou `/archiviste` (échanges,
 * requête en cours) est retrouvé en revenant. Un refresh remonte le provider →
 * état vide, comportement voulu.
 *
 * Deux contextes distincts (un par page) plutôt qu'une valeur combinée : une
 * mise à jour du chat ne re-rend pas le consommateur archiviste.
 */
export function ConversationsProvider({ children }) {
  const chat = useChatState()
  const archiviste = useArchivisteState()
  return (
    <ChatContext.Provider value={chat}>
      <ArchivisteContext.Provider value={archiviste}>{children}</ArchivisteContext.Provider>
    </ChatContext.Provider>
  )
}

/**
 * Route de layout : monte `<ConversationsProvider>` une seule fois pour `/chat`
 * et `/archiviste` (via `<Outlet>`), donc l'état survit au passage d'une page à
 * l'autre. `/lab` est une route sœur, hors de ce provider.
 */
export function ConversationsLayout() {
  return (
    <ConversationsProvider>
      <Outlet />
    </ConversationsProvider>
  )
}
