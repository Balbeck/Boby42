export default function Disclaimer({ children }) {
  return (
    <p className="mt-4 text-center text-xs italic text-white">
      {children ?? (
        <>
          Boby42 est un assistant administratif qui répond à partir du RTFM et du
          Notion du Bocal.
          <br></br>Il est encore en formation et peut se tromper -
          Vérifiez ce qu'il vous conte 🤖 !
        </>
      )}
    </p>
  )
}
