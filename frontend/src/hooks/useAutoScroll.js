import { useCallback, useEffect, useRef, useState } from 'react'

/** Scrolle automatiquement vers le bas dès que le contenu du conteneur change de taille. */
export function useAutoScroll() {
  const [container, setContainer] = useState(null)
  const bottomRef = useRef(null)
  const containerRef = useCallback((node) => setContainer(node), [])

  useEffect(() => {
    if (!container) return

    const scrollToBottom = () => bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })

    const observer = new ResizeObserver(scrollToBottom)
    observer.observe(container)

    return () => observer.disconnect()
  }, [container])

  return { containerRef, bottomRef }
}
