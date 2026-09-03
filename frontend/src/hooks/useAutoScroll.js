import { useCallback, useEffect, useRef, useState } from 'react'

/** Scrolle automatiquement vers le bas dès que le contenu du conteneur change de taille. */
export function useAutoScroll() {
  const [container, setContainer] = useState(/** @type {Element | null} */ (null))
  const bottomRef = useRef(/** @type {HTMLDivElement | null} */ (null))
  const containerRef = useCallback((/** @type {Element | null} */ node) => setContainer(node), [])

  useEffect(() => {
    if (!container) return

    // ⚠️ Un ResizeObserver déclenche un premier callback dès qu'il observe, sans
    // qu'aucune taille n'ait changé. En revenant sur une page ce callback-là
    // écraserait la position de scroll tout juste restaurée (voir
    // `layout/PersistentNav.jsx`) : on l'ignore, seuls les vrais changements de
    // contenu scrollent. Coût accepté : sur une page vierge, le tout premier
    // échange ne force plus le scroll au montage — il tient à l'écran, et tout
    // agrandissement ultérieur (la réponse qui arrive) scrolle bien.
    let first = true
    const scrollToBottom = () => {
      if (first) {
        first = false
        return
      }
      bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
    }

    const observer = new ResizeObserver(scrollToBottom)
    observer.observe(container)

    return () => observer.disconnect()
  }, [container])

  return { containerRef, bottomRef }
}
