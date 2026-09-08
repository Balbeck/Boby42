import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

import App from './App'
import ArchivisteApp from './ArchivisteApp'
import PersistentNav from './layout/PersistentNav'
import { ConversationsLayout } from './state/ConversationsProvider'
import { ChatContext, ArchivisteContext, useChat, useArchiviste } from './state/conversationsContext'
import { withNotionLink } from './notionLink'
import { NOTION_RTFM_URL, messages } from './messages'
import { setLanguage } from './i18n'
import * as chatApi from './services/chatApi'
import * as archivisteApi from './services/archivisteApi'

// The two student pages plus the shell that holds them. The pages are wired to
// a fake context rather than the real hooks: what is under test here is the
// WIRING (which prop of the page hook reaches which prop of which component,
// and which of the two layout branches renders), not the state machine — that
// has its own suites under hooks/.

const t = messages.fr

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  // i18n.js is a module-scoped store shared by every test in this file: the
  // language-switch test below would otherwise leave the whole suite in
  // English and every later `getByRole(name: <French string>)` would miss.
  setLanguage('fr')
})

/** A complete fake of what useChat / useArchiviste return. */
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

/** @param {Partial<any>} [overrides] */
function chatExchange(overrides = {}) {
  return {
    id: 'ex-1',
    question: 'où est le wifi',
    answer: 'au 2e étage',
    documents: [],
    loading: false,
    phase: 'done',
    messageId: 'msg-1',
    rating: 0,
    ...overrides,
  }
}

/** Renders a page with both contexts provided. */
function renderPage(
  /** @type {() => import('react').ReactNode} */ Page,
  /** @type {{ chat?: any, archiviste?: any }} */ { chat = fakeState(), archiviste = fakeState() } = {},
) {
  render(
    <MemoryRouter>
      <ChatContext.Provider value={chat}>
        <ArchivisteContext.Provider value={archiviste}>
          <Page />
        </ArchivisteContext.Provider>
      </ChatContext.Provider>
    </MemoryRouter>,
  )
  return { chat, archiviste }
}

describe('withNotionLink', () => {
  it('turns the fragment into a link to the RTFM Notion', () => {
    render(<p>{withNotionLink('Deux sources : RTFM - Notion (complet)', 'RTFM - Notion')}</p>)

    const link = screen.getByRole('link', { name: 'RTFM - Notion' })
    expect(link.getAttribute('href')).toBe(NOTION_RTFM_URL)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('keeps the text on both sides of the fragment', () => {
    const { container } = render(<p>{withNotionLink('avant MILIEU après', 'MILIEU')}</p>)
    expect(container.textContent).toBe('avant MILIEU après')
  })

  it('falls back to plain text when the fragment is absent', () => {
    // A locale without that key, or a reworded string — the disclaimer must
    // still render rather than disappear.
    render(<p>{withNotionLink('un texte sans le fragment', 'ABSENT')}</p>)

    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('un texte sans le fragment')).toBeDefined()
  })

  it('falls back when the fragment appears twice — the split is ambiguous', () => {
    render(<p>{withNotionLink('X puis X encore', 'X')}</p>)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('falls back on an empty fragment', () => {
    render(<p>{withNotionLink('un texte', '')}</p>)
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('the conversation contexts', () => {
  it('throw outside the provider rather than returning null', () => {
    // A null context would surface as "cannot read exchanges of null" deep in a
    // component; the explicit throw names the actual mistake.
    function Consumer() {
      useChat()
      return null
    }
    expect(() => render(<Consumer />)).toThrow(/ConversationsProvider/)
  })

  it('throw for the archiviste context too', () => {
    function Consumer() {
      useArchiviste()
      return null
    }
    expect(() => render(<Consumer />)).toThrow(/ConversationsProvider/)
  })

  it('hand back exactly what the provider was given', () => {
    const chat = fakeState({ draft: 'chat draft' })
    const archiviste = fakeState({ draft: 'archiviste draft' })

    /** @type {any} */
    let seen
    function Consumer() {
      seen = { chat: useChat(), archiviste: useArchiviste() }
      return null
    }
    render(
      <ChatContext.Provider value={chat}>
        <ArchivisteContext.Provider value={archiviste}>
          <Consumer />
        </ArchivisteContext.Provider>
      </ChatContext.Provider>,
    )

    expect(seen.chat).toBe(chat)
    expect(seen.archiviste).toBe(archiviste)
  })
})

describe('ConversationsLayout', () => {
  it('runs both state hooks once and renders the nav around the outlet', async () => {
    // The provider is what makes state survive a /chat ↔ /archiviste switch;
    // PersistentNav is its CHILD (it consumes the contexts, so it cannot be
    // the thing that renders them).
    vi.spyOn(chatApi, 'fetchChatDocuments').mockResolvedValue({ count: 0, documents: [] })

    render(
      <MemoryRouter initialEntries={['/archiviste']}>
        <Routes>
          <Route element={<ConversationsLayout />}>
            <Route path="/archiviste" element={<span>la page</span>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('la page')).toBeDefined()
    // The nav's own controls, mounted once above the outlet.
    expect(screen.getByRole('button', { name: t.switchToChat })).toBeDefined()
  })
})

describe('PersistentNav', () => {
  /** @param {string} path */
  function renderNav(
    /** @type {string} */ path = '/archiviste',
    /** @type {{ chat?: any, archiviste?: any }} */ states = {},
  ) {
    const chat = states.chat ?? fakeState()
    const archiviste = states.archiviste ?? fakeState()
    render(
      <MemoryRouter initialEntries={[path]}>
        <ChatContext.Provider value={chat}>
          <ArchivisteContext.Provider value={archiviste}>
            <Routes>
              <Route element={<PersistentNav />}>
                <Route path="/archiviste" element={<span>archiviste page</span>} />
                <Route path="/chat" element={<span>chat page</span>} />
              </Route>
            </Routes>
          </ArchivisteContext.Provider>
        </ChatContext.Provider>
      </MemoryRouter>,
    )
    return { chat, archiviste }
  }

  it('renders the outlet', () => {
    renderNav('/chat')
    expect(screen.getByText('chat page')).toBeDefined()
  })

  it('shows the pre-drawer layout while AUTH is false', () => {
    // No hamburger, no drawer: PageSwitcher alone on the left, the language
    // switcher alone on the right.
    renderNav()

    expect(screen.queryByRole('button', { name: t.menuOpen })).toBeNull()
    expect(screen.queryByRole('complementary', { name: t.conversations })).toBeNull()
    expect(screen.getByRole('button', { name: t.switchToChat })).toBeDefined()
    expect(screen.getByRole('button', { expanded: false })).toBeDefined()
  })

  it('switches the interface language through the shared store', async () => {
    renderNav()
    const before = screen.getByRole('button', { name: t.switchToChat })
    expect(before).toBeDefined()

    await userEvent.click(screen.getByRole('button', { expanded: false }))
    await userEvent.click(screen.getByRole('option', { name: /English/ }))

    expect(screen.getByRole('button', { name: messages.en.switchToChat })).toBeDefined()
  })

  it('restores each page\'s scroll position on the way back', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    renderNav('/archiviste')

    // Arriving on a page with no saved position scrolls to the top.
    expect(scrollTo).toHaveBeenCalledWith(0, 0)

    Object.defineProperty(window, 'scrollY', { value: 640, configurable: true })
    act(() => window.dispatchEvent(new Event('scroll')))

    await userEvent.click(screen.getByRole('button', { name: t.switchToChat }))
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0)

    await userEvent.click(screen.getByRole('button', { name: t.switchToArchiviste }))
    expect(scrollTo).toHaveBeenLastCalledWith(0, 640)
  })

  it('stops listening for scroll on unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(
      <MemoryRouter initialEntries={['/chat']}>
        <ChatContext.Provider value={fakeState()}>
          <ArchivisteContext.Provider value={fakeState()}>
            <Routes>
              <Route element={<PersistentNav />}>
                <Route path="/chat" element={<span>x</span>} />
              </Route>
            </Routes>
          </ArchivisteContext.Provider>
        </ChatContext.Provider>
      </MemoryRouter>,
    )
    unmount()

    expect(remove.mock.calls.some(([type]) => type === 'scroll')).toBe(true)
  })
})

describe('App — the /chat page', () => {
  it('shows the greeting and the composer before anything is asked', () => {
    renderPage(App)

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t.chatGreeting)
    expect(screen.getByRole('textbox')).toBeDefined()
    expect(screen.getByRole('link', { name: t.notionLinkLabel })).toBeDefined()
  })

  it('swaps the greeting for the exchanges once one exists', () => {
    renderPage(App, { chat: fakeState({ exchanges: [chatExchange()] }) })

    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(screen.getByText('où est le wifi')).toBeDefined()
    expect(screen.getByText('au 2e étage')).toBeDefined()
  })

  it('sends the question with the current language and the localized fallback text', async () => {
    const { chat } = renderPage(App, { chat: fakeState({ draft: 'où est le wifi' }) })
    await userEvent.click(screen.getByRole('button', { name: t.sendAria }))

    expect(chat.sendQuestion).toHaveBeenCalledWith('où est le wifi', 'fr', t.chatNotFound)
  })

  it('shows the construction notice on the first send only, per page load', async () => {
    // `wipSeen` is a module-level flag: it survives an <App> remount (the page
    // switch) but not a reload. Any earlier test in this file that clicked send
    // has already set it, so this one needs a FRESH module graph — and the
    // context module has to come from that same graph, or the provider below
    // would be a different object than the one the fresh App consumes.
    vi.resetModules()
    const [{ default: FreshApp }, freshContext] = await Promise.all([
      import('./App'),
      import('./state/conversationsContext'),
    ])

    const chat = fakeState({ draft: 'q' })
    render(
      <MemoryRouter>
        <freshContext.ChatContext.Provider value={chat}>
          <freshContext.ArchivisteContext.Provider value={fakeState()}>
            <FreshApp />
          </freshContext.ArchivisteContext.Provider>
        </freshContext.ChatContext.Provider>
      </MemoryRouter>,
    )

    await userEvent.click(screen.getByRole('button', { name: t.sendAria }))
    expect(screen.getByRole('dialog')).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: t.close }))
    expect(screen.queryByRole('dialog')).toBeNull()

    // Second send in the same page load: no notice.
    await userEvent.click(screen.getByRole('button', { name: t.sendAria }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(chat.sendQuestion).toHaveBeenCalledTimes(2)
  })

  it('wires the draft, the stop button and the queue state', async () => {
    const { chat } = renderPage(App, {
      chat: fakeState({ draft: 'q', isSending: true, isQueueFull: true }),
    })

    await userEvent.click(screen.getByRole('button', { name: t.stopAria }))
    expect(chat.stopGeneration).toHaveBeenCalledTimes(1)
    expect(screen.getByText(t.chatQueueFull)).toBeDefined()

    await userEvent.type(screen.getByRole('textbox'), 'x')
    expect(chat.setDraft).toHaveBeenCalled()
  })

  it('routes a rating and a document toggle back with the exchange id', async () => {
    const exchange = chatExchange({
      documents: [{
        name: 'Wi-Fi', type: 'md', url: '/u/1', score: 0.94,
        content: '', loading: false, loaded: false, expanded: false,
      }],
    })
    const { chat } = renderPage(App, { chat: fakeState({ exchanges: [exchange] }) })

    await userEvent.click(screen.getByRole('button', { name: t.feedbackUp }))
    expect(chat.submitFeedback).toHaveBeenCalledWith('ex-1', 1, undefined)

    await userEvent.click(screen.getByText('Wi-Fi'))
    expect(chat.toggleDocument).toHaveBeenCalledWith('ex-1', exchange.documents[0])
  })
})

describe('ArchivisteApp — the landing page', () => {
  it('shows its own title, tagline and placeholder', () => {
    renderPage(ArchivisteApp)

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t.archivisteTitle)
    expect(screen.getByText(t.archivisteTagline)).toBeDefined()
    expect(screen.getByPlaceholderText(t.archivisteInputPlaceholder)).toBeDefined()
  })

  it('sends with two arguments — there is no not-found text on this page', async () => {
    const { archiviste } = renderPage(ArchivisteApp, {
      archiviste: fakeState({ draft: 'des documents' }),
    })
    await userEvent.click(screen.getByRole('button', { name: t.sendAria }))

    expect(archiviste.sendQuestion).toHaveBeenCalledWith('des documents', 'fr')
  })

  it('never shows the construction notice — it is a /chat-only thing', async () => {
    renderPage(ArchivisteApp, { archiviste: fakeState({ draft: 'q' }) })
    await userEvent.click(screen.getByRole('button', { name: t.sendAria }))

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders the exchanges with their queued and error states', () => {
    renderPage(ArchivisteApp, {
      archiviste: fakeState({
        exchanges: [
          { id: 'a', question: 'première', documents: [], loading: true, queued: true, rating: 0 },
          { id: 'b', question: 'deuxième', documents: [], loading: false, error: 'boom', rating: 0 },
        ],
      }),
    })

    expect(screen.getByText(t.chatQueued)).toBeDefined()
    expect(screen.getByText(/Erreur\s*:\s*boom/)).toBeDefined()
  })

  it('routes a rating and a document toggle back with the exchange id', async () => {
    const documents = [{
      name: 'Wi-Fi', type: 'md', url: '/u/1', score: 0.94,
      content: '', loading: false, loaded: false, expanded: false,
    }]
    const { archiviste } = renderPage(ArchivisteApp, {
      archiviste: fakeState({
        exchanges: [{ id: 'ex-1', question: 'q', documents, loading: false, messageId: 'msg-1', rating: 0 }],
      }),
    })

    await userEvent.click(screen.getByRole('button', { name: t.feedbackDown }))
    expect(archiviste.submitFeedback).toHaveBeenCalledWith('ex-1', -1, undefined)

    await userEvent.click(screen.getByText('Wi-Fi'))
    expect(archiviste.toggleDocument).toHaveBeenCalledWith('ex-1', documents[0])
  })
})

describe('the two pages together', () => {
  it('keep separate drafts and separate exchanges', async () => {
    // They are two independent pages with two independent transports; a shared
    // page shell was considered and rejected.
    vi.spyOn(chatApi, 'fetchChatDocuments').mockResolvedValue({ count: 0, documents: [] })
    vi.spyOn(archivisteApi, 'search').mockResolvedValue({ count: 0, documents: [] })

    render(
      <MemoryRouter initialEntries={['/chat']}>
        <Routes>
          <Route element={<ConversationsLayout />}>
            <Route path="/chat" element={<App />} />
            <Route path="/archiviste" element={<ArchivisteApp />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    await userEvent.type(screen.getByRole('textbox'), 'brouillon chat')
    await userEvent.click(screen.getByRole('button', { name: t.switchToArchiviste }))

    // The archiviste draft is its own — empty.
    await waitFor(() => expect(screen.getByPlaceholderText(t.archivisteInputPlaceholder)).toBeDefined())
    expect(/** @type {HTMLTextAreaElement} */ (screen.getByRole('textbox')).value).toBe('')

    // …and the chat draft survived the switch.
    await userEvent.click(screen.getByRole('button', { name: t.switchToChat }))
    await waitFor(() =>
      expect(/** @type {HTMLTextAreaElement} */ (screen.getByRole('textbox')).value).toBe('brouillon chat'),
    )
  })
})
