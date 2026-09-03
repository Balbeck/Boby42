import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import PageSwitcher from '../components/PageSwitcher'
import LanguageSwitcher from '../components/LanguageSwitcher'
import HamburgerButton from '../components/HamburgerButton'
import Drawer from '../components/Drawer'
import { useChat, useArchiviste } from '../state/conversationsContext'
import { useLanguage, useMessages, setLanguage } from '../i18n'
import { AUTH } from '../auth'

/**
 * La navigation qui ne se démonte jamais : rendue **une seule fois** par la
 * route de layout (`ConversationsLayout`), au-dessus de `<Outlet />`.
 *
 * Elle porte tout ce qui doit survivre à une bascule /chat ↔ /archiviste :
 * - la barre haute (PageSwitcher + LanguageSwitcher, en haut à **droite** — le
 *   coin haut-gauche est au hamburger), rendue ici et nulle part ailleurs ;
 * - le tiroir d'historique et son état d'ouverture ;
 * - la position de scroll de chaque page.
 *
 * Tant que `AUTH` (`../auth`) est `false` — pas encore de vraie auth 42 —, le
 * hamburger et le tiroir sont masqués et l'on revient au layout précédent : le
 * PageSwitcher en haut à **gauche**, le LanguageSwitcher seul en haut à droite.
 * L'état du tiroir reste en place, dormant, pour un simple retour à `true`.
 *
 * Elle est **à l'intérieur** de `ConversationsProvider` : c'est ce qui lui
 * permet de lire `useChat()` / `useArchiviste()` — un composant ne peut pas
 * consommer le contexte qu'il rend lui-même.
 */
export default function PersistentNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const chat = useChat()
  const archiviste = useArchiviste()
  const language = useLanguage()
  const t = useMessages()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const page = location.pathname === '/chat' ? 'chat' : 'archiviste'

  // Position de scroll par page. Enregistrée en continu (le pathname courant
  // est lu dans une ref : l'écouteur n'est monté qu'une fois), restaurée dans un
  // effet de layout — avant la peinture, donc sans saut visible.
  // ⚠️ Sans le garde-fou du premier callback de `useAutoScroll`, l'observateur
  // de la page rescrollerait aussitôt en bas et écraserait cette restauration.
  const scrollPositions = useRef(new Map())
  const pathRef = useRef(location.pathname)

  useEffect(() => {
    const onScroll = () => scrollPositions.current.set(pathRef.current, window.scrollY)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useLayoutEffect(() => {
    pathRef.current = location.pathname
    window.scrollTo(0, scrollPositions.current.get(location.pathname) ?? 0)
  }, [location.pathname])

  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  /** Rouvrir une conversation, sur la page à laquelle elle appartient. */
  const openConversation = useCallback(
    (/** @type {import('../types/types.js').ConversationSummary} */ conversation) => {
      const target = conversation.page === 'chat' ? chat : archiviste
      if (location.pathname !== `/${conversation.page}`) navigate(`/${conversation.page}`)
      target.loadConversation(conversation.id).catch(() => {})
      setDrawerOpen(false)
    },
    [chat, archiviste, location.pathname, navigate],
  )

  /** Nouveau fil sur la page **courante**. */
  const startNew = useCallback(() => {
    ;(page === 'chat' ? chat : archiviste).startNewConversation()
    setDrawerOpen(false)
  }, [page, chat, archiviste])

  return (
    <>
      {AUTH ? (
        <>
          <div className="fixed top-4 left-4 z-30">
            <HamburgerButton open={drawerOpen} onClick={() => setDrawerOpen((prev) => !prev)} t={t} />
          </div>
          <div className="fixed top-4 right-4 z-20 flex items-center gap-2">
            <PageSwitcher t={t} />
            <LanguageSwitcher language={language} onChange={setLanguage} />
          </div>

          <Drawer
            open={drawerOpen}
            onClose={closeDrawer}
            onSelect={openConversation}
            onNew={startNew}
            activeIds={{ chat: chat.conversationId, archiviste: archiviste.conversationId }}
            language={language}
            t={t}
          />
        </>
      ) : (
        <>
          <div className="fixed top-4 left-4 z-20">
            <PageSwitcher t={t} />
          </div>
          <div className="fixed top-4 right-4 z-20">
            <LanguageSwitcher language={language} onChange={setLanguage} />
          </div>
        </>
      )}

      <Outlet />
    </>
  )
}
