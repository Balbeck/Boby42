import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

import Disclaimer from '../../../src/components/Disclaimer'
import HamburgerButton from '../../../src/components/HamburgerButton'
import PageSwitcher from '../../../src/components/PageSwitcher'
import Modal from '../../../src/components/Modal'
import ConstructionNotice from '../../../src/components/ConstructionNotice'
import LanguageSwitcher from '../../../src/components/LanguageSwitcher'
import { messages } from '../../../src/messages'

// The page chrome. Mostly presentational, so the assertions stay on behaviour a
// user can perform — a click, a key, focus — rather than on class names, which
// would break on every Tailwind edit without catching anything.

const t = messages.fr

describe('Disclaimer', () => {
  it('renders whatever the page hands it', () => {
    render(<Disclaimer>Deux sources indexées</Disclaimer>)
    expect(screen.getByText('Deux sources indexées')).toBeDefined()
  })

  it('renders a node, not just a string — the Notion link goes through here', () => {
    render(<Disclaimer><a href="/x">RTFM</a></Disclaimer>)
    expect(screen.getByRole('link', { name: 'RTFM' })).toBeDefined()
  })
})

describe('HamburgerButton', () => {
  it('announces "open" when the drawer is closed, and the reverse', () => {
    const { rerender } = render(<HamburgerButton open={false} onClick={() => {}} t={t} />)
    expect(screen.getByRole('button', { name: t.menuOpen }).getAttribute('aria-expanded')).toBe('false')

    rerender(<HamburgerButton open onClick={() => {}} t={t} />)
    expect(screen.getByRole('button', { name: t.menuClose }).getAttribute('aria-expanded')).toBe('true')
  })

  it('calls onClick', async () => {
    const onClick = vi.fn()
    render(<HamburgerButton open={false} onClick={onClick} t={t} />)

    await userEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('PageSwitcher', () => {
  /** Renders the switcher at `path` and exposes the current location. */
  function renderAt(/** @type {string} */ path) {
    function Probe() {
      return <span data-testid="path">{useLocation().pathname}</span>
    }
    return render(
      <MemoryRouter initialEntries={[path]}>
        <PageSwitcher t={t} />
        <Routes>
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('offers to switch to chat when on archiviste', () => {
    renderAt('/archiviste')
    expect(screen.getByRole('button', { name: t.switchToChat })).toBeDefined()
  })

  it('offers to switch to archiviste when on chat', () => {
    renderAt('/chat')
    expect(screen.getByRole('button', { name: t.switchToArchiviste })).toBeDefined()
  })

  it('derives the active side from the URL, not from local state', async () => {
    // So back/forward and a direct URL entry are correct with no extra wiring.
    renderAt('/archiviste')
    await userEvent.click(screen.getByRole('button'))

    expect(screen.getByTestId('path').textContent).toBe('/chat')
    expect(screen.getByRole('button', { name: t.switchToArchiviste })).toBeDefined()
  })

  it('navigates back on a second click', async () => {
    renderAt('/chat')
    await userEvent.click(screen.getByRole('button'))

    expect(screen.getByTestId('path').textContent).toBe('/archiviste')
  })

  it('treats any unknown path as the archiviste side', () => {
    // The catch-all route redirects there anyway; the switcher must agree.
    renderAt('/')
    expect(screen.getByRole('button', { name: t.switchToChat })).toBeDefined()
  })

  it('titles both sides', () => {
    renderAt('/archiviste')
    const button = screen.getByRole('button')
    expect(within(button).getByTitle(t.pageSwitchArchiviste)).toBeDefined()
    expect(within(button).getByTitle(t.pageSwitchChat)).toBeDefined()
  })
})

describe('Modal', () => {
  it('renders its children in a labelled dialog', () => {
    render(<Modal onClose={() => {}} label="Titre" closeLabel={t.close}>contenu</Modal>)

    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-label')).toBe('Titre')
    expect(within(dialog).getByText('contenu')).toBeDefined()
  })

  it('focuses the close button on mount, so Escape and Tab start somewhere sane', () => {
    render(<Modal onClose={() => {}} closeLabel={t.close}>x</Modal>)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: t.close }))
  })

  it('closes on the close button', async () => {
    const onClose = vi.fn()
    render(<Modal onClose={onClose} closeLabel={t.close}>x</Modal>)

    await userEvent.click(screen.getByRole('button', { name: t.close }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    render(<Modal onClose={onClose} closeLabel={t.close}>x</Modal>)

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores other keys', async () => {
    // Not Enter: the close button holds focus on mount, so Enter would activate
    // it and this would pass for the wrong reason.
    const onClose = vi.fn()
    render(<Modal onClose={onClose} closeLabel={t.close}>x</Modal>)

    await userEvent.keyboard('{ArrowDown}')
    await userEvent.keyboard('a')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on a backdrop click but not on a click inside the card', async () => {
    const onClose = vi.fn()
    const { container } = render(<Modal onClose={onClose} closeLabel={t.close}>contenu</Modal>)

    await userEvent.click(screen.getByText('contenu'))
    expect(onClose).not.toHaveBeenCalled()

    await userEvent.click(/** @type {Element} */ (container.firstElementChild))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('locks body scroll while open and restores it exactly on unmount', () => {
    document.body.style.overflow = 'scroll'
    const { unmount } = render(<Modal onClose={() => {}} closeLabel={t.close}>x</Modal>)

    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    // Restored to what it WAS, not blanked — otherwise a page that set its own
    // overflow silently loses it every time a modal opens.
    expect(document.body.style.overflow).toBe('scroll')
    document.body.style.overflow = ''
  })

  it('removes its key listener on unmount', async () => {
    const onClose = vi.fn()
    const { unmount } = render(<Modal onClose={onClose} closeLabel={t.close}>x</Modal>)
    unmount()

    await userEvent.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('ConstructionNotice', () => {
  it('uses the translated defaults', () => {
    render(<ConstructionNotice onClose={() => {}} />)

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(t.wipTitle)
    // The body carries a `\n` (rendered `whitespace-pre-line`), so it is matched
    // on its own text content rather than through the normalising text matcher.
    expect(screen.getByRole('dialog').textContent).toContain(t.wipBody)
  })

  it('accepts an override for another page', () => {
    render(<ConstructionNotice onClose={() => {}} title="Bientôt" body="Patience" />)

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Bientôt')
    expect(screen.getByText('Patience')).toBeDefined()
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Bientôt')
  })

  it('closes through the modal it wraps', async () => {
    const onClose = vi.fn()
    render(<ConstructionNotice onClose={onClose} />)

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('LanguageSwitcher', () => {
  it('shows the current flag with the menu closed', () => {
    render(<LanguageSwitcher language="en" onChange={() => {}} />)

    const toggle = screen.getByRole('button', { expanded: false })
    expect(toggle.textContent).toContain('🇬🇧')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('falls back to French for an unknown code', () => {
    render(<LanguageSwitcher language={/** @type {any} */ ('de')} onChange={() => {}} />)
    expect(screen.getByRole('button').textContent).toContain('🇫🇷')
  })

  it('opens the list and marks the current option selected', async () => {
    render(<LanguageSwitcher language="origin" onChange={() => {}} />)
    await userEvent.click(screen.getByRole('button'))

    const options = screen.getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['🇫🇷Français', '🇬🇧English', '🌏Origin'])
    expect(options[2].getAttribute('aria-selected')).toBe('true')
  })

  it('reveals the current label only while open', async () => {
    render(<LanguageSwitcher language="fr" onChange={() => {}} />)
    const toggle = screen.getByRole('button', { expanded: false })
    expect(toggle.textContent).not.toContain('Français')

    await userEvent.click(toggle)
    expect(screen.getByRole('button', { expanded: true }).textContent).toContain('Français')
  })

  it('reports the chosen language and closes', async () => {
    const onChange = vi.fn()
    render(<LanguageSwitcher language="fr" onChange={onChange} />)

    await userEvent.click(screen.getByRole('button'))
    await userEvent.click(screen.getByRole('option', { name: /English/ }))

    expect(onChange).toHaveBeenCalledWith('en')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('is purely controlled — it does not change its own display', async () => {
    // The parent owns the language (PersistentNav calls setLanguage); a
    // switcher that also kept local state would show a value the app is not on.
    render(<LanguageSwitcher language="fr" onChange={() => {}} />)

    await userEvent.click(screen.getByRole('button'))
    await userEvent.click(screen.getByRole('option', { name: /English/ }))

    expect(screen.getByRole('button').textContent).toContain('🇫🇷')
  })

  it('toggles closed on a second click of the trigger', async () => {
    render(<LanguageSwitcher language="fr" onChange={() => {}} />)
    const toggle = screen.getByRole('button')

    await userEvent.click(toggle)
    expect(screen.getByRole('listbox')).toBeDefined()

    await userEvent.click(screen.getByRole('button', { expanded: true }))
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('closes on a click outside', async () => {
    render(
      <div>
        <LanguageSwitcher language="fr" onChange={() => {}} />
        <button type="button">ailleurs</button>
      </div>,
    )

    await userEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByRole('listbox')).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: 'ailleurs' }))
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('stays open on a click inside its own container', async () => {
    render(<LanguageSwitcher language="fr" onChange={() => {}} />)
    await userEvent.click(screen.getByRole('button', { expanded: false }))

    await userEvent.click(screen.getByRole('listbox'))
    expect(screen.getByRole('listbox')).toBeDefined()
  })

  it('mounts the outside-click listener only while open', async () => {
    // A `mousedown` listener living for the life of the page, on every mounted
    // page, for a menu that is closed 99 % of the time.
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')

    render(<LanguageSwitcher language="fr" onChange={() => {}} />)
    expect(add.mock.calls.filter(([type]) => type === 'mousedown')).toHaveLength(0)

    await userEvent.click(screen.getByRole('button'))
    expect(add.mock.calls.filter(([type]) => type === 'mousedown')).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { expanded: true }))
    expect(remove.mock.calls.filter(([type]) => type === 'mousedown')).toHaveLength(1)

    add.mockRestore()
    remove.mockRestore()
  })
})
