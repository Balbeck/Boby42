import { useSyncExternalStore } from 'react'
import { messages } from './messages'

export { messages }

/** @import { Language, MessagesLocale, Messages } from './types/types.js' */

const KEY = 'language'
const listeners = new Set()

/**
 * Valeur de l'attribut `lang` du document pour chaque langue d'interface.
 * `'origin'` ne concerne que le texte des documents servis — l'interface, elle,
 * retombe sur le français (exactement comme `messages[language] ?? messages.fr`).
 *
 * @type {Record<Language, string>}
 */
const HTML_LANG = { fr: 'fr', en: 'en', origin: 'fr' }

/**
 * Lecture unique du stockage, au chargement du module. `localStorage` peut
 * **lever** (navigation privée stricte, stockage bloqué) : sans ce `try`, la
 * lecture ferait planter le premier rendu et blanchirait toute l'application.
 *
 * @returns {Language}
 */
function readStoredLanguage() {
  try {
    return /** @type {Language} */ (localStorage.getItem(KEY) || 'fr')
  } catch {
    return 'fr'
  }
}

/**
 * Langue sélectionnée, partagée entre les deux pages et persistée dans
 * `localStorage`. Une seule variable, pas de contexte React : les composants
 * lisent la valeur via `useLanguage()`, `LanguageSwitcher` la change via
 * `setLanguage()`.
 *
 * La valeur est **mise en cache ici** et non relue dans le stockage à chaque
 * appel : `getLanguage` est l'instantané passé à `useSyncExternalStore`, donc
 * appelé à chaque rendu de chaque composant abonné (y compris à chaque token
 * de la réponse en streaming).
 *
 * @type {Language}
 */
let language = readStoredLanguage()

/** Aligne `<html lang>` sur la langue d'interface courante. */
function syncDocumentLang() {
  document.documentElement.lang = HTML_LANG[language]
}

syncDocumentLang()

/** @returns {Language} */
function getLanguage() {
  return language
}

/**
 * Met à jour la langue (persiste + notifie toutes les pages montées).
 * @param {Language} lang
 */
export function setLanguage(lang) {
  language = lang
  try {
    localStorage.setItem(KEY, lang)
  } catch {
    // Stockage indisponible : la langue reste valable pour cette session.
  }
  syncDocumentLang()
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

/**
 * Les chaînes d'interface de la langue courante — la dérivation
 * `messages[language] ?? messages.fr` écrite une seule fois plutôt que recopiée
 * dans chaque page. `'origin'` (et toute valeur inconnue) retombe sur `fr`.
 *
 * @returns {Messages}
 */
export function useMessages() {
  const lang = useLanguage()
  return messages[/** @type {MessagesLocale} */ (lang)] ?? messages.fr
}
