/**
 * Drapeau d'authentification — provisoire.
 *
 * Il n'y a pas encore de vraie auth utilisateur : tant que `AUTH` est `false`,
 * l'app cache le hamburger et le tiroir d'historique (`Drawer`) et revient au
 * layout précédent (le `PageSwitcher` en haut à gauche).
 *
 * À passer à `true` — ou à remplacer par un vrai contrôle de session — le jour
 * où l'auth des comptes 42 (OAuth2) sera en place.
 */
export const AUTH = false
