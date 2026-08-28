import { useLocation, useNavigate } from 'react-router-dom'

const OPTIONS = [
  { path: '/archiviste', flag: '🕵️‍♂️' },
  { path: '/chat', flag: '👨🏻‍🏭' },
]

/**
 * @param {{ t: object }} props
 */
export default function PageSwitcher({ t }) {
  const location = useLocation()
  const navigate = useNavigate()
  const activeIndex = location.pathname === '/chat' ? 1 : 0

  function handleToggle() {
    navigate(OPTIONS[activeIndex === 0 ? 1 : 0].path)
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label={activeIndex === 0 ? t.switchToChat : t.switchToArchiviste}
      className="relative flex items-center rounded-full border border-chat-border bg-chat-surface p-1 shadow-sm shadow-black/20 transition-colors hover:bg-chat-surface-2"
    >
      <span
        className={`absolute top-1 bottom-1 left-1 w-8 rounded-full bg-chat-green shadow transition-transform duration-200 ease-out ${activeIndex === 1 ? 'translate-x-8' : 'translate-x-0'
          }`}
      />
      {OPTIONS.map((option, index) => (
        <span
          key={option.path}
          className={`relative z-10 flex h-8 w-8 items-center justify-center text-base transition-opacity duration-200 ${index === activeIndex ? 'opacity-100' : 'opacity-40'
            }`}
        >
          {option.flag}
        </span>
      ))}
    </button>
  )
}
