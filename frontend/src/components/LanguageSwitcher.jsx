import { useEffect, useRef, useState } from 'react'

const LANGUAGES = [
  { code: 'fr', flag: '🇫🇷', label: 'Français' },
  { code: 'en', flag: '🇬🇧', label: 'English' },
  { code: 'origin', flag: '🌏', label: 'Origin' },
]

/**
 * @param {{ language: string, onChange: (language: string) => void }} props
 */
export default function LanguageSwitcher({ language, onChange }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)
  const current = LANGUAGES.find((lang) => lang.code === language) ?? LANGUAGES[0]

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function handleSelect(code) {
    onChange(code)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-chat-border bg-chat-surface px-3 py-1.5 text-sm text-chat-text shadow-sm shadow-black/20 transition-colors hover:bg-chat-surface-2"
      >
        <span>{current.flag}</span>
        {open && <span>{current.label}</span>}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-3 w-3 text-chat-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M5 9l7 7 7-7" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-10 mt-2 min-w-full overflow-hidden rounded-lg border border-chat-border bg-chat-surface shadow-lg shadow-black/30"
        >
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              type="button"
              role="option"
              aria-selected={lang.code === language}
              onClick={() => handleSelect(lang.code)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm whitespace-nowrap transition-colors hover:bg-chat-surface-2 ${lang.code === language ? 'text-chat-green' : 'text-chat-text'
                }`}
            >
              <span>{lang.flag}</span>
              <span>{lang.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
