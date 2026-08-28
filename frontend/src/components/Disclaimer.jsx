/**
 * Bas de page. Le texte est fourni par la page via `children` (déjà traduit) ;
 * `whitespace-pre-line` rend les `\n` du texte comme des sauts de ligne.
 *
 * @param {{ children: import('react').ReactNode }} props
 */
export default function Disclaimer({ children }) {
  return (
    <p className="mt-4 text-center text-xs italic whitespace-pre-line text-white">
      {children}
    </p>
  )
}
