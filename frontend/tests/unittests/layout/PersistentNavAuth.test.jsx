import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

// `AUTH` is a module constant, so the two layouts cannot be exercised from one
// file — the mock has to be hoisted above the import. This file owns the
// `AUTH === true` half: the hamburger, the drawer, and the two callbacks that
// only exist to serve it (reopen a conversation on its own page, start a new
// thread on the current one). That whole branch is dormant in production until
// 42's OAuth2 lands, which is exactly why it needs a test — nobody will notice
// it rotting.
vi.mock('../../../src/auth', () => ({ AUTH: true }))

import PersistentNav from '../../../src/layout/PersistentNav'
import { ChatContext, ArchivisteContext } from '../../../src/state/conversationsContext'
import { setLanguage } from '../../../src/i18n'
import * as historyApi from '../../../src/services/historyApi'
import { messages } from '../../../src/messages'

const t = messages.fr

/**
 * The language switcher's trigger. It has no accessible NAME (only a flag and a
 * chevron), and with AUTH on the hamburger also carries `aria-expanded`, so
 * neither `name` nor `expanded` picks it out — the popup role does.
 */
const languageToggle = () =>
  /** @type {HTMLElement} */ (document.querySelector('[aria-haspopup="listbox"]'))

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(historyApi, 'listConversations').mockResolvedValue([])
})
afterEach(() => {
  vi.restoreAllMocks()
  setLanguage('fr')
})

function fakeState(overrides = {}) {
  return {
    exchanges: [],
    sendQuestion: vi.fn(),
    stopGeneration: vi.fn(),
    submitFeedback: vi.fn(),
    toggleDocument: vi.fn(),
    loadConversation: vi.fn(async () => {}),
    startNewConversation: vi.fn(),
    draft: '',
    setDraft: vi.fn(),
    isSending: false,
    isQueueFull: false,
    conversationId: null,
    ...overrides,
  }
}

function renderNav(
  /** @type {string} */ path = '/archiviste',
  /** @type {{ chat?: any, archiviste?: any }} */ states = {},
) {
  const chat = states.chat ?? fakeState()
  const archiviste = states.archiviste ?? fakeState()

  function Probe() {
    return <span data-testid="path">{useLocation().pathname}</span>
  }

  render(
    <MemoryRouter initialEntries={[path]}>
      <ChatContext.Provider value={chat}>
        <ArchivisteContext.Provider value={archiviste}>
          <Routes>
            <Route element={<PersistentNav />}>
              <Route path="/archiviste" element={<Probe />} />
              <Route path="/chat" element={<Probe />} />
            </Route>
          </Routes>
        </ArchivisteContext.Provider>
      </ChatContext.Provider>
    </MemoryRouter>,
  )
  return { chat, archiviste }
}

describe('PersistentNav with AUTH on', () => {
  it('mounts the hamburger and puts both switchers on the right', () => {
    renderNav()

    expect(screen.getByRole('button', { name: t.menuOpen })).toBeDefined()
    expect(screen.getByRole('button', { name: t.switchToChat })).toBeDefined()
    expect(languageToggle()).not.toBeNull()
  })

  it('opens and closes the drawer from the hamburger', async () => {
    renderNav()

    await userEvent.click(screen.getByRole('button', { name: t.menuOpen }))
    expect(screen.getByRole('complementary', { name: t.conversations })).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: t.menuClose }))
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('marks each page\'s active thread in the drawer', async () => {
    vi.spyOn(historyApi, 'listConversations').mockResolvedValue([
      { id: 'c1', page: 'chat', title: 'chat thread', updatedAt: new Date().toISOString(), messageCount: 2 },
    ])
    renderNav('/chat', { chat: fakeState({ conversationId: 'c1' }) })

    await userEvent.click(screen.getByRole('button', { name: t.menuOpen }))
    const row = await screen.findByRole('button', { name: /chat thread/ })
    expect(row.getAttribute('aria-current')).toBe('true')
  })

  it('reopens a conversation on its own page, navigating there first', async () => {
    // A chat conversation opened from /archiviste has to land on /chat, or the
    // exchanges would be restored into a page that never renders them.
    vi.spyOn(historyApi, 'listConversations').mockResolvedValue([
      { id: 'c1', page: 'chat', title: 'un fil chat', updatedAt: new Date().toISOString(), messageCount: 2 },
    ])
    const { chat, archiviste } = renderNav('/archiviste')

    await userEvent.click(screen.getByRole('button', { name: t.menuOpen }))
    await userEvent.click(await screen.findByText('un fil chat'))

    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/chat'))
    expect(chat.loadConversation).toHaveBeenCalledWith('c1')
    expect(archiviste.loadConversation).not.toHaveBeenCalled()
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('does not navigate when the conversation already belongs to the current page', async () => {
    vi.spyOn(historyApi, 'listConversations').mockResolvedValue([
      { id: 'c2', page: 'archiviste', title: 'un fil archiviste', updatedAt: new Date().toISOString(), messageCount: 1 },
    ])
    const { archiviste } = renderNav('/archiviste')

    await userEvent.click(screen.getByRole('button', { name: t.menuOpen }))
    await userEvent.click(await screen.findByText('un fil archiviste'))

    expect(screen.getByTestId('path').textContent).toBe('/archiviste')
    expect(archiviste.loadConversation).toHaveBeenCalledWith('c2')
  })

  it('swallows a failed reopen — a deleted conversation must not blank the app', async () => {
    vi.spyOn(historyApi, 'listConversations').mockResolvedValue([
      { id: 'c1', page: 'archiviste', title: 'disparu', updatedAt: new Date().toISOString(), messageCount: 1 },
    ])
    const archiviste = fakeState({
      loadConversation: vi.fn(async () => { throw new Error('Conversation not found') }),
    })
    renderNav('/archiviste', { archiviste })

    await userEvent.click(screen.getByRole('button', { name: t.menuOpen }))
    await userEvent.click(await screen.findByText('disparu'))

    await waitFor(() => expect(archiviste.loadConversation).toHaveBeenCalled())
    expect(screen.getByTestId('path').textContent).toBe('/archiviste')
  })

  it('starts a new thread on the CURRENT page, not the other one', async () => {
    const { chat, archiviste } = renderNav('/chat')

    await userEvent.click(screen.getByRole('button', { name: t.menuOpen }))
    await userEvent.click(screen.getByRole('button', { name: t.newConversation }))

    expect(chat.startNewConversation).toHaveBeenCalledTimes(1)
    expect(archiviste.startNewConversation).not.toHaveBeenCalled()
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('starts an archiviste thread when that is the current page', async () => {
    const { chat, archiviste } = renderNav('/archiviste')

    await userEvent.click(screen.getByRole('button', { name: t.menuOpen }))
    await userEvent.click(screen.getByRole('button', { name: t.newConversation }))

    expect(archiviste.startNewConversation).toHaveBeenCalledTimes(1)
    expect(chat.startNewConversation).not.toHaveBeenCalled()
  })

  it('closes the drawer from its own backdrop', async () => {
    renderNav()
    await userEvent.click(screen.getByRole('button', { name: t.menuOpen }))

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('still switches the interface language', async () => {
    renderNav()

    await userEvent.click(languageToggle())
    await userEvent.click(screen.getByRole('option', { name: /English/ }))

    expect(screen.getByRole('button', { name: messages.en.switchToChat })).toBeDefined()
  })
})
