// @ts-nocheck — the /lab payloads (labApi.table/tree/analytics*) arrive untyped
// from the backend; writing typedefs for them is a task of its own, and /lab is a
// single-user, password-gated admin page. Drop this line when they get typed.
import { useRef } from 'react'

/**
 * The whole chrome of the /lab page: a slim icon-only tab bar, top-left, in the
 * same visual language as components/PageSwitcher.jsx — a pill with a sliding
 * chat-green indicator behind the active icon. Quiet until engaged.
 *
 * Tabs are local LabApp state, not routes (one user, no need to deep-link).
 * English-only, like the rest of /lab.
 *
 * @param {{ active: 'connexion' | 'viz' | 'dbviz' | 'ollama', onChange: (id: string) => void }} props
 */

const TABS = [
  { id: 'connexion', icon: '🌞', label: 'Connexion' },
  { id: 'viz', icon: '🔬', label: 'Visualizations' },
  { id: 'dbviz', icon: '💾', label: 'Database viewer' },
  { id: 'ollama', icon: '💬', label: 'Ollama console' },
]

// One class per index — matches PageSwitcher's translate-x-8 step (w-8 cells).
const SLIDE = ['translate-x-0', 'translate-x-8', 'translate-x-16', 'translate-x-24']

export default function LabTabs({ active, onChange }) {
  const btnRefs = useRef([])
  const activeIndex = Math.max(0, TABS.findIndex((tab) => tab.id === active))

  function move(delta) {
    const next = (activeIndex + delta + TABS.length) % TABS.length
    onChange(TABS[next].id)
    btnRefs.current[next]?.focus()
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      move(1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      move(-1)
    }
  }

  return (
    <div
      role="tablist"
      aria-label="Lab sections"
      aria-orientation="horizontal"
      onKeyDown={handleKeyDown}
      className="fixed top-4 left-4 z-20 flex items-center rounded-full border border-chat-border bg-chat-surface p-1 shadow-sm shadow-black/20"
    >
      <span
        aria-hidden="true"
        className={`absolute top-1 bottom-1 left-1 w-8 rounded-full bg-chat-green shadow transition-transform duration-200 ease-out motion-reduce:transition-none ${SLIDE[activeIndex]}`}
      />
      {TABS.map((tab, index) => (
        <button
          key={tab.id}
          ref={(el) => (btnRefs.current[index] = el)}
          type="button"
          role="tab"
          aria-selected={index === activeIndex}
          aria-label={tab.label}
          tabIndex={index === activeIndex ? 0 : -1}
          onClick={() => onChange(tab.id)}
          className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-base transition-opacity duration-200 outline-none focus-visible:ring-2 focus-visible:ring-chat-green/70 motion-reduce:transition-none ${
            index === activeIndex ? 'opacity-100' : 'opacity-40 hover:opacity-70'
          }`}
        >
          <span aria-hidden="true">{tab.icon}</span>
        </button>
      ))}
    </div>
  )
}
