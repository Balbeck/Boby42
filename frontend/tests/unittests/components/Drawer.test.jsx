import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import Drawer from '../../../src/components/Drawer'
import LabLogin from '../../../src/components/LabLogin'
import * as historyApi from '../../../src/services/historyApi'
import * as labApi from '../../../src/services/labApi'
import { messages } from '../../../src/messages'
import { AUTH } from '../../../src/auth'
import { conversationSummary } from '../../fixtures'

// Two gated surfaces.
//
// `Drawer` is DORMANT: `AUTH` is false, so `PersistentNav` never mounts it and
// nothing here runs in production today. It is not dead code — it is the
// history UI waiting for 42's OAuth2 — so it is tested like everything else,
// and the first test below pins the flag itself so the day it flips is a
// deliberate act rather than a surprise.
//
// `LabLogin` is live but behind /lab. Its one non-obvious behaviour: a failed
// login LEAVES the page rather than showing an error, because a wrong password
// and a disabled feature are indistinguishable from here and neither is worth
// a message that would confirm /lab exists.

const t = messages.fr

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/**
 * @param {Partial<import('../../../src/types/types.js').ConversationSummary>} [overrides]
 * @returns {import('../../../src/types/types.js').ConversationSummary}
 */
const conversation = (overrides = {}) => conversationSummary(overrides)

/** @param {Partial<React.ComponentProps<typeof Drawer>>} [props] */
function renderDrawer(props = {}) {
  const onClose = vi.fn()
  const onSelect = vi.fn()
  const onNew = vi.fn()
  const view = render(
    <Drawer
      open
      onClose={onClose}
      onSelect={onSelect}
      onNew={onNew}
      activeIds={{ chat: null, archiviste: null }}
      language="fr"
      t={t}
      {...props}
    />,
  )
  return { onClose, onSelect, onNew, ...view }
}

describe('the AUTH flag', () => {
  it('is still false — the drawer is dormant on purpose', () => {
    // Flipping it is a product decision (42 OAuth2), not a refactor. If this
    // fails, the flip was intended and this expectation moves with it.
    expect(AUTH).toBe(false)
  })
})

describe('Drawer', () => {
  it('renders nothing when closed, and fetches nothing', () => {
    const list = vi.spyOn(historyApi, 'listConversations')
    const { container } = renderDrawer({ open: false })

    expect(container.firstChild).toBeNull()
    expect(list).not.toHaveBeenCalled()
  })

  it('loads the list on every open — so a new exchange shows with no subscription', async () => {
    const list = vi.spyOn(historyApi, 'listConversations').mockResolvedValue([])
    const { rerender, onClose, onSelect, onNew } = renderDrawer()

    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))

    /** @type {Omit<React.ComponentProps<typeof Drawer>, 'open'>} */
    const props = { onClose, onSelect, onNew, activeIds: { chat: null, archiviste: null }, language: 'fr', t }
    rerender(<Drawer open={false} {...props} />)
    rerender(<Drawer open {...props} />)

    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  })

  it('shows an empty state rather than a blank panel', async () => {
    vi.spyOn(historyApi, 'listConversations').mockResolvedValue([])
    renderDrawer()

    expect(await screen.findByText(t.conversationsEmpty)).toBeDefined()
  })

  it('stays on the empty state when the fetch fails — no error dialog', async () => {
    vi.spyOn(historyApi, 'listConversations').mockRejectedValue(new Error('boom'))
    renderDrawer()

    expect(await screen.findByText(t.conversationsEmpty)).toBeDefined()
  })

  it('lists the conversations with their page glyph', async () => {
    vi.spyOn(historyApi, 'listConversations').mockResolvedValue([
      conversation(),
      conversation({ id: 'conv-2', page: 'archiviste', title: 'des documents' }),
    ])
    renderDrawer()

    expect(await screen.findByText('où est le wifi')).toBeDefined()
    expect(screen.getByText('des documents')).toBeDefined()
    expect(screen.getByText('👨🏻‍🏭')).toBeDefined()
    expect(screen.getByText('🕵️‍♂️')).toBeDefined()
  })

  it('marks the active thread of each page independently', async () => {
    // `activeIds` is keyed by page, and the drawer mixes both pages' threads in
    // one list — so an archiviste row must not light up just because the chat
    // side has an active thread.
    //
    // The ids are distinct here on purpose: `conversations.id` is a UUID primary
    // key, so two rows can never share one. An earlier version of this test used
    // the same id twice to make the point and produced a React duplicate-key
    // warning — testing a state the schema cannot produce.
    vi.spyOn(historyApi, 'listConversations').mockResolvedValue([
      conversation({ id: 'c1', page: 'chat', title: 'chat thread' }),
      conversation({ id: 'c2', page: 'archiviste', title: 'archiviste thread' }),
    ])
    const { rerender, onClose, onSelect, onNew } = renderDrawer({
      activeIds: { chat: 'c1', archiviste: null },
    })

    await screen.findByText('chat thread')
    expect(screen.getByRole('button', { name: /chat thread/ }).getAttribute('aria-current')).toBe('true')
    expect(screen.getByRole('button', { name: /archiviste thread/ }).getAttribute('aria-current')).toBeNull()

    rerender(
      <Drawer
        open
        onClose={onClose}
        onSelect={onSelect}
        onNew={onNew}
        activeIds={{ chat: null, archiviste: 'c2' }}
        language="fr"
        t={t}
      />,
    )
    expect(screen.getByRole('button', { name: /chat thread/ }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('button', { name: /archiviste thread/ }).getAttribute('aria-current')).toBe('true')
  })

  it('reports the selected conversation whole', async () => {
    const row = conversation()
    vi.spyOn(historyApi, 'listConversations').mockResolvedValue([row])
    const { onSelect } = renderDrawer()

    await userEvent.click(await screen.findByText('où est le wifi'))
    expect(onSelect).toHaveBeenCalledWith(row)
  })

  it('offers a new conversation', async () => {
    vi.spyOn(historyApi, 'listConversations').mockResolvedValue([])
    const { onNew } = renderDrawer()

    await userEvent.click(screen.getByRole('button', { name: t.newConversation }))
    expect(onNew).toHaveBeenCalledTimes(1)
  })

  it('closes on the backdrop and on Escape', async () => {
    vi.spyOn(historyApi, 'listConversations').mockResolvedValue([])
    const { onClose, container } = renderDrawer()

    await userEvent.click(/** @type {Element} */ (container.firstElementChild))
    expect(onClose).toHaveBeenCalledTimes(1)

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('drops its key listener when closed', async () => {
    vi.spyOn(historyApi, 'listConversations').mockResolvedValue([])
    const { onClose, rerender, onSelect, onNew } = renderDrawer()

    rerender(
      <Drawer
        open={false}
        onClose={onClose}
        onSelect={onSelect}
        onNew={onNew}
        activeIds={{ chat: null, archiviste: null }}
        language="fr"
        t={t}
      />,
    )
    await userEvent.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('aborts the in-flight list when it closes', async () => {
    /** @type {AbortSignal | undefined} */
    let signal
    vi.spyOn(historyApi, 'listConversations').mockImplementation(async (options) => {
      signal = options?.signal
      return []
    })
    const { unmount } = renderDrawer()

    await waitFor(() => expect(signal).toBeDefined())
    unmount()
    expect(signal?.aborted).toBe(true)
  })

  it('is labelled for assistive technology', async () => {
    vi.spyOn(historyApi, 'listConversations').mockResolvedValue([])
    renderDrawer()

    expect(screen.getByRole('complementary', { name: t.conversations })).toBeDefined()
    // The mount fires a fetch that sets state when it resolves. Asserting and
    // returning without waiting leaves that update outside act(), which React
    // reports on the console and no DOM assertion can see.
    await screen.findByText(t.conversationsEmpty)
  })
})

describe('Drawer — the relative date', () => {
  /**
   * Renders one conversation updated `ms` ago and returns the meta line.
   * Unmounts before returning: several calls in one test would otherwise stack
   * three drawers in the same document and every query would find duplicates.
   */
  async function metaFor(/** @type {number} */ ms, /** @type {'fr'|'en'|'origin'} */ language = 'fr') {
    vi.spyOn(historyApi, 'listConversations').mockResolvedValue([
      conversation({ updatedAt: new Date(Date.now() - ms).toISOString() }),
    ])
    const { unmount } = renderDrawer({ language })
    const title = await screen.findByText('où est le wifi')
    const meta = /** @type {Element} */ (title.nextElementSibling).textContent
    unmount()
    return meta
  }

  it('says "just now" under a minute', async () => {
    expect(await metaFor(30_000)).toBe(t.justNow)
  })

  it('counts minutes, hours and days', async () => {
    expect(await metaFor(30 * 60_000)).toMatch(/30/)
    expect(await metaFor(3 * 3_600_000)).toMatch(/3/)
    expect(await metaFor(5 * 86_400_000)).toMatch(/5/)
  })

  it('falls back to a short date past a month', async () => {
    const meta = await metaFor(60 * 86_400_000)
    expect(meta).not.toMatch(/ago|il y a/)
    expect(meta.length).toBeGreaterThan(0)
  })

  it('formats in English for the English locale, French otherwise', async () => {
    // `style: 'narrow'` renders "3h ago" in English and "-3 h" in French — the
    // digit and the unit letter are the same in both, so the English direction
    // word is the only thing that distinguishes them.
    const english = await metaFor(3 * 3_600_000, 'en')
    const french = await metaFor(3 * 3_600_000, 'fr')
    expect(english).toMatch(/ago/)
    expect(french).not.toMatch(/ago/)

    // 'origin' is a document choice, not a UI locale — it falls back to French.
    expect(await metaFor(3 * 3_600_000, 'origin')).toBe(french)
  })

  it('renders an empty meta line for an unparseable date instead of "Invalid Date"', async () => {
    vi.spyOn(historyApi, 'listConversations').mockResolvedValue([
      conversation({ updatedAt: 'not a date' }),
    ])
    renderDrawer()

    const title = await screen.findByText('où est le wifi')
    expect(/** @type {Element} */ (title.nextElementSibling).textContent).toBe('')
  })
})

describe('LabLogin', () => {
  /** LabLogin navigates, so it needs a router. */
  async function renderLogin() {
    const { MemoryRouter, Routes, Route, useLocation } = await import('react-router-dom')
    const onClose = vi.fn()
    const onSuccess = vi.fn()

    function Probe() {
      return <span data-testid="path">{useLocation().pathname}</span>
    }

    render(
      <MemoryRouter initialEntries={['/lab']}>
        <LabLogin onClose={onClose} onSuccess={onSuccess} />
        <Routes>
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    )
    return { onClose, onSuccess }
  }

  it('focuses the identifiant field, not the modal close button', async () => {
    // Child effects run before the parent's, so this has to win the race with
    // Modal's own focus call — otherwise the operator tabs before typing.
    await renderLogin()
    expect(document.activeElement).toBe(screen.getByLabelText('Identifiant'))
  })

  it('sends what was typed', async () => {
    const login = vi.spyOn(labApi, 'login').mockResolvedValue({ ok: true, login: 'admin' })
    await renderLogin()

    await userEvent.type(screen.getByLabelText('Identifiant'), 'admin')
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'secret')
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }))

    expect(login).toHaveBeenCalledWith('admin', 'secret')
  })

  it('masks the password field', async () => {
    await renderLogin()
    expect(screen.getByLabelText('Mot de passe').getAttribute('type')).toBe('password')
  })

  it('tells the parent on success and stays on /lab', async () => {
    vi.spyOn(labApi, 'login').mockResolvedValue({ ok: true, login: 'admin' })
    const { onSuccess } = await renderLogin()

    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('path').textContent).toBe('/lab')
  })

  it('leaves for the home page on bad credentials, with no error message', async () => {
    // A wrong password and a disabled feature look identical from here, and
    // neither deserves a message that confirms /lab exists.
    vi.spyOn(labApi, 'login').mockResolvedValue({ ok: false })
    const { onSuccess } = await renderLogin()

    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }))

    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/'))
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('leaves the same way when the request itself throws', async () => {
    vi.spyOn(labApi, 'login').mockRejectedValue(new Error('network down'))
    await renderLogin()

    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/'))
  })

  it('refuses a double submit while one is in flight', async () => {
    /** @type {(v: any) => void} */
    let resolve = () => {}
    const login = vi.spyOn(labApi, 'login').mockReturnValue(new Promise((r) => { resolve = r }))
    await renderLogin()

    const submit = screen.getByRole('button', { name: 'Se connecter' })
    await userEvent.click(submit)
    expect(submit.hasAttribute('disabled')).toBe(true)

    await userEvent.click(submit)
    expect(login).toHaveBeenCalledTimes(1)

    resolve({ ok: true })
  })

  it('closes through the modal', async () => {
    const { onClose } = await renderLogin()
    await userEvent.click(screen.getByRole('button', { name: 'Fermer' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
