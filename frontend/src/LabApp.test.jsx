import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

import LabApp from './LabApp'
import * as labApi from './services/labApi'

// The /lab shell. Three things carry it and none is visible from the markup:
//
//  - the page fails CLOSED. `labApi.me()` resolves to `null` for both "no
//    session" (401) and "feature disabled" (404), and both must land on the
//    login popup — never on a half-rendered dashboard.
//  - the 💬 console stays MOUNTED across tab switches (hidden, not unmounted),
//    so its prompt, params and exchanges survive a trip to another tab. That is
//    a `hidden` class, which no "is it on screen" assertion would notice.
//  - the /ollama proxy key is fetched only once a session exists, and dropped
//    on logout.

beforeEach(() => {
  vi.spyOn(labApi, 'me').mockResolvedValue(null)
  vi.spyOn(labApi, 'ollamaKey').mockResolvedValue(null)
  vi.spyOn(labApi, 'logout').mockResolvedValue(/** @type {any} */ ({ ok: true }))
  vi.spyOn(labApi, 'login').mockResolvedValue({ ok: true, login: 'admin' })
  // Every panel the authenticated shell can mount.
  vi.spyOn(labApi, 'tables').mockResolvedValue([])
  vi.spyOn(labApi, 'table').mockResolvedValue(null)
  vi.spyOn(labApi, 'tree').mockResolvedValue(null)
  vi.spyOn(labApi, 'analyticsOverview').mockResolvedValue(null)
  vi.spyOn(labApi, 'analyticsUnmatched').mockResolvedValue({ items: [], total: 0 })
  vi.spyOn(labApi, 'analyticsConversations').mockResolvedValue({ items: [], total: 0 })
  vi.spyOn(labApi, 'analyticsConversation').mockResolvedValue(null)
})
afterEach(() => vi.restoreAllMocks())

const renderLab = () => render(<MemoryRouter initialEntries={['/lab']}><LabApp /></MemoryRouter>)

/** The signed-in shell, awaited. */
async function renderSignedIn() {
  vi.mocked(labApi.me).mockResolvedValue({ login: 'admin' })
  renderLab()
  await screen.findByRole('tablist', { name: 'Lab sections' })
}

describe('LabApp — signed out', () => {
  it('shows the greeting and the login popup when there is no session', async () => {
    renderLab()

    expect(await screen.findByLabelText('Identifiant')).toBeDefined()
    expect(screen.getAllByText('Bonjour 🎋 🌞').length).toBeGreaterThan(0)
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('shows the same thing when the gate is off — a 404 is indistinguishable', async () => {
    // Deliberate: the page must not confirm that /lab exists but is locked.
    vi.mocked(labApi.me).mockResolvedValue(null)
    renderLab()

    expect(await screen.findByLabelText('Identifiant')).toBeDefined()
  })

  it('shows only the greeting while the session check is in flight', async () => {
    /** @type {(v: any) => void} */
    let resolve = () => {}
    vi.mocked(labApi.me).mockReturnValue(new Promise((r) => { resolve = r }))
    renderLab()

    expect(screen.getByText('Bonjour 🎋 🌞')).toBeDefined()
    expect(screen.queryByLabelText('Identifiant')).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()

    resolve(null)
    await screen.findByLabelText('Identifiant')
  })

  it('leaves the greeting alone when the popup is dismissed', async () => {
    renderLab()
    await screen.findByLabelText('Identifiant')

    await userEvent.click(screen.getByRole('button', { name: 'Fermer' }))

    expect(screen.queryByLabelText('Identifiant')).toBeNull()
    expect(screen.getByText('Bonjour 🎋 🌞')).toBeDefined()
  })

  it('never asks for the proxy key without a session', async () => {
    renderLab()
    await screen.findByLabelText('Identifiant')

    expect(labApi.ollamaKey).not.toHaveBeenCalled()
  })

  it('re-checks the session after a successful login and opens the shell', async () => {
    renderLab()
    await screen.findByLabelText('Identifiant')

    vi.mocked(labApi.me).mockResolvedValue({ login: 'admin' })
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }))

    expect(await screen.findByRole('tablist', { name: 'Lab sections' })).toBeDefined()
  })
})

describe('LabApp — signed in', () => {
  it('opens on the connexion tab', async () => {
    await renderSignedIn()

    expect(screen.getByText('Bienvenue Hector')).toBeDefined()
    expect(screen.getByRole('tab', { name: 'Connexion' }).getAttribute('aria-selected')).toBe('true')
  })

  it('fetches the /ollama proxy key once a session exists', async () => {
    await renderSignedIn()
    await waitFor(() => expect(labApi.ollamaKey).toHaveBeenCalledTimes(1))
  })

  it('switches to the dashboard tab', async () => {
    await renderSignedIn()

    await userEvent.click(screen.getByRole('tab', { name: 'Visualizations' }))

    expect(await screen.findByRole('heading', { name: 'Usage' })).toBeDefined()
    expect(screen.queryByText('Bienvenue Hector')).toBeNull()
  })

  it('switches to the database tab', async () => {
    vi.mocked(labApi.tables).mockResolvedValue([{ name: 'conversations', columns: [], rowCount: 3 }])
    await renderSignedIn()

    await userEvent.click(screen.getByRole('tab', { name: 'Database viewer' }))

    expect(await screen.findByRole('option', { name: 'conversations — 3 rows' })).toBeDefined()
    expect(screen.queryByText('Bienvenue Hector')).toBeNull()
  })

  it('keeps the 💬 console mounted across tab switches, merely hidden', async () => {
    // Unmounting it would silently drop the prompt, the params and the whole
    // exchange history every time the operator looks at another tab.
    await renderSignedIn()

    // Located through the panel's own content rather than by position: with no
    // proxy key it renders its "unavailable" note, and that node's `pt-20`
    // ancestor is the wrapper carrying the `hidden` class.
    const panelWrapper = () => {
      const note = screen.getByText(/Ollama proxy unavailable/)
      return /** @type {HTMLElement} */ (note.closest('div[class*="pt-20"]'))
    }

    expect(panelWrapper().className).toContain('hidden')

    await userEvent.click(screen.getByRole('tab', { name: 'Ollama console' }))
    expect(panelWrapper().className).not.toContain('hidden')

    await userEvent.click(screen.getByRole('tab', { name: 'Connexion' }))
    expect(panelWrapper().className).toContain('hidden')
  })

  it('signs out back to the login popup and forgets the proxy key', async () => {
    await renderSignedIn()

    vi.mocked(labApi.me).mockResolvedValue(null)
    await userEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }))

    expect(await screen.findByLabelText('Identifiant')).toBeDefined()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(labApi.logout).toHaveBeenCalledTimes(1)
  })

  it('signs out even when the logout request fails', async () => {
    // The cookie may already be gone; leaving the operator stuck on a dead
    // dashboard would be worse than dropping them at the login popup.
    await renderSignedIn()
    vi.mocked(labApi.logout).mockRejectedValue(new Error('network down'))

    await userEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }))

    expect(await screen.findByLabelText('Identifiant')).toBeDefined()
  })

  it('ignores a session check that settles after unmount', async () => {
    /** @type {(v: any) => void} */
    let resolve = () => {}
    vi.mocked(labApi.me).mockReturnValue(new Promise((r) => { resolve = r }))
    const { unmount } = renderLab()

    unmount()
    resolve({ login: 'admin' })
    // No state update on an unmounted component — the cancelled flag covers it.
  })

  it('ignores a proxy-key fetch that settles after unmount', async () => {
    /** @type {(v: any) => void} */
    let resolve = () => {}
    vi.mocked(labApi.ollamaKey).mockReturnValue(new Promise((r) => { resolve = r }))
    vi.mocked(labApi.me).mockResolvedValue({ login: 'admin' })
    const { unmount } = renderLab()
    await screen.findByRole('tablist')

    unmount()
    resolve('a-key')
  })
})
