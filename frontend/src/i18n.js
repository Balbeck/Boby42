import { useSyncExternalStore } from 'react'

export { messages } from './messages'

const KEY = 'language'
const listeners = new Set()

/**
 * Langue sélectionnée, partagée entre les deux pages et persistée dans
 * `localStorage`. Une seule variable, pas de contexte React : les composants
 * lisent la valeur via `useLanguage()`, `LanguageSwitcher` la change via
 * `setLanguage()`.
 *
 * @returns {'fr' | 'en' | 'origin'}
 */
function getLanguage() {
  return /** @type {'fr' | 'en' | 'origin'} */ (localStorage.getItem(KEY) || 'fr')
}

/**
 * Met à jour la langue (persiste + notifie toutes les pages montées).
 * @param {'fr' | 'en' | 'origin'} lang
 */
export function setLanguage(lang) {
  localStorage.setItem(KEY, lang)
  listeners.forEach((fn) => fn())
}

/** Langue courante, re-rendue à chaque `setLanguage()`. */
export function useLanguage() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    getLanguage,
  )
}
