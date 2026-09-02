/**
 * Le bouton du tiroir des conversations. Volontairement discret : trois traits
 * fins dans une pastille ronde de 40 px, cerclée d'un gris clair (plus léger
 * que la bordure des deux pastilles du coin opposé) et sans fond au repos. Ce
 * n'est pas une action principale : la page reste la conversation.
 *
 * @param {{ open: boolean, onClick: () => void, t: object }} props
 */
export default function HamburgerButton({ open, onClick, t }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={open ? t.menuClose : t.menuOpen}
      aria-expanded={open}
      className="flex h-10 w-10 items-center justify-center rounded-full border border-chat-text-muted/25 text-chat-text-muted transition-colors hover:border-chat-text-muted/40 hover:bg-chat-surface hover:text-chat-text focus-visible:ring-2 focus-visible:ring-chat-green focus-visible:outline-none"
    >
      <span className="flex w-4 flex-col gap-[3px]" aria-hidden>
        <span className="h-px w-full bg-current" />
        <span className="h-px w-full bg-current" />
        <span className="h-px w-full bg-current" />
      </span>
    </button>
  )
}
