import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import ChatInput from './ChatInput'
import Composer from './Composer'
import DocumentsBlock from './DocumentsBlock'
import ArchivisteDocument from './ArchivisteDocument'
import ArchivisteMessage from './ArchivisteMessage'
import FeedbackButtons from './FeedbackButtons'
import Message from './Message'
import { messages } from '../messages'
import { STEP_DURATIONS } from '../hooks/useGuidedStep'
import { archivisteDocument } from '../test/fixtures'

// The exchange surface: the composer, the document rows, the two message
// components. The assertions that matter here are the conditional ones — which
// branch renders for which state — because a wrong branch shows the user a
// plausible screen that is simply not what happened.

const t = messages.fr

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/**
 * @param {Partial<import('../types/types.js').ArchivisteDocument>} [overrides]
 * @returns {import('../types/types.js').ArchivisteDocument}
 */
const doc = (overrides = {}) => archivisteDocument(overrides)

describe('ChatInput', () => {
  /** @param {Partial<any>} [props] */
  function renderInput(props = {}) {
    const onChange = vi.fn()
    const onSend = vi.fn()
    const onStop = vi.fn()
    render(
      <ChatInput value="" onChange={onChange} onSend={onSend} onStop={onStop} t={t} {...props} />,
    )
    return { onChange, onSend, onStop }
  }

  it('is controlled — it renders the value it is given', () => {
    renderInput({ value: 'une question' })
    expect(/** @type {HTMLTextAreaElement} */ (screen.getByRole('textbox')).value).toBe('une question')
  })

  it('reports every keystroke upward rather than keeping local state', async () => {
    // The draft lives above the router so a /chat ↔ /archiviste switch does not
    // drop a half-typed question.
    const { onChange } = renderInput()
    await userEvent.type(screen.getByRole('textbox'), 'a')

    expect(onChange).toHaveBeenCalledWith('a')
  })

  it('uses the default placeholder, or an override', () => {
    const { unmount } = render(<ChatInput value="" onChange={() => {}} onSend={() => {}} t={t} />)
    expect(screen.getByPlaceholderText(t.chatInputPlaceholder)).toBeDefined()
    unmount()

    render(<ChatInput value="" onChange={() => {}} onSend={() => {}} placeholder="Autre" t={t} />)
    expect(screen.getByPlaceholderText('Autre')).toBeDefined()
  })

  it('disables send on an empty or whitespace-only value', () => {
    const { unmount } = render(<ChatInput value="   " onChange={() => {}} onSend={() => {}} t={t} />)
    expect(screen.getByRole('button', { name: t.sendAria }).hasAttribute('disabled')).toBe(true)
    unmount()

    render(<ChatInput value="q" onChange={() => {}} onSend={() => {}} t={t} />)
    expect(screen.getByRole('button', { name: t.sendAria }).hasAttribute('disabled')).toBe(false)
  })

  it('sends the untrimmed value — the hook trims it', () => {
    const { onSend } = renderInput({ value: '  une question  ' })
    screen.getByRole('button', { name: t.sendAria }).click()

    expect(onSend).toHaveBeenCalledWith('  une question  ')
  })

  it('sends on Enter and inserts a newline on Shift+Enter', async () => {
    const { onSend } = renderInput({ value: 'une question' })
    const textarea = screen.getByRole('textbox')

    await userEvent.type(textarea, '{Enter}')
    expect(onSend).toHaveBeenCalledTimes(1)

    await userEvent.type(textarea, '{Shift>}{Enter}{/Shift}')
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('shows the stop button instead of send while sending', async () => {
    const { onStop, onSend } = renderInput({ value: 'q', isSending: true })

    expect(screen.queryByRole('button', { name: t.sendAria })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: t.stopAria }))

    expect(onStop).toHaveBeenCalledTimes(1)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('refuses to send when the queue is full, by click AND by Enter', async () => {
    // Enter goes through handleSend too — a queue check on the button alone
    // would let the keyboard past it.
    const { onSend } = renderInput({ value: 'une question', queueFull: true })

    await userEvent.click(screen.getByRole('button', { name: t.sendAria }))
    await userEvent.type(screen.getByRole('textbox'), '{Enter}')

    expect(onSend).not.toHaveBeenCalled()
  })

  it('explains the refusal under the box', () => {
    const { unmount } = render(
      <ChatInput value="q" onChange={() => {}} onSend={() => {}} queueFull t={t} />,
    )
    expect(screen.getByText(t.chatQueueFull)).toBeDefined()
    unmount()

    render(<ChatInput value="q" onChange={() => {}} onSend={() => {}} t={t} />)
    expect(screen.queryByText(t.chatQueueFull)).toBeNull()
  })

  it('keeps typing possible with a full queue — the question is not lost', async () => {
    const { onChange } = renderInput({ value: 'q', queueFull: true })
    await userEvent.type(screen.getByRole('textbox'), 'x')

    expect(onChange).toHaveBeenCalled()
  })
})

describe('Composer', () => {
  it('renders the input and the disclaimer as one pair', () => {
    render(
      <Composer
        value="q"
        onChange={() => {}}
        onSend={() => {}}
        t={t}
        disclaimer="Deux sources indexées"
      />,
    )

    expect(screen.getByRole('textbox')).toBeDefined()
    expect(screen.getByText('Deux sources indexées')).toBeDefined()
  })

  it('forwards every input prop verbatim', async () => {
    const onSend = vi.fn()
    const onStop = vi.fn()
    render(
      <Composer
        value="q"
        onChange={() => {}}
        onSend={onSend}
        onStop={onStop}
        isSending
        placeholder="Autre"
        t={t}
        disclaimer="x"
      />,
    )

    expect(screen.getByPlaceholderText('Autre')).toBeDefined()
    await userEvent.click(screen.getByRole('button', { name: t.stopAria }))
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('forwards queueFull', () => {
    render(
      <Composer value="q" onChange={() => {}} onSend={() => {}} queueFull t={t} disclaimer="x" />,
    )
    expect(screen.getByText(t.chatQueueFull)).toBeDefined()
  })
})

describe('DocumentsBlock', () => {
  it('always shows both count lines, including zero', () => {
    // Front-computed, never backend text: the two families are always named so
    // an empty subject list reads as "we looked", not as "we did not look".
    render(<DocumentsBlock documents={[]} onToggleDocument={() => {}} t={t} className="x" />)

    expect(screen.getByText(t.chatDocsNotionLabel)).toBeDefined()
    expect(screen.getByText(t.chatDocsSubjectsLabel)).toBeDefined()
    expect(screen.getAllByText(t.chatDocsCount(0))).toHaveLength(2)
  })

  it('counts md and pdf rows separately', () => {
    render(
      <DocumentsBlock
        documents={[doc(), doc({ name: 'Badge' }), doc({ name: 'libft', type: 'pdf' })]}
        onToggleDocument={() => {}}
        t={t}
        className="x"
      />,
    )

    expect(screen.getByText(t.chatDocsCount(2))).toBeDefined()
    expect(screen.getByText(t.chatDocsCount(1))).toBeDefined()
  })

  it('renders md rows before pdf rows whatever the input order', () => {
    render(
      <DocumentsBlock
        documents={[doc({ name: 'libft', type: 'pdf' }), doc({ name: 'Wi-Fi' })]}
        onToggleDocument={() => {}}
        t={t}
        className="x"
      />,
    )

    const names = screen.getAllByRole('button').map((b) => within(b).getByText(/Wi-Fi|libft/).textContent)
    expect(names).toEqual(['Wi-Fi', 'libft'])
  })

  it('keys rows by type AND name, so a shared basename renders twice', () => {
    // Matching on the name alone would collapse them into one row (and React
    // would warn about a duplicate key).
    render(
      <DocumentsBlock
        documents={[doc({ name: 'libft', type: 'md' }), doc({ name: 'libft', type: 'pdf' })]}
        onToggleDocument={() => {}}
        t={t}
        className="x"
      />,
    )

    expect(screen.getAllByText('libft')).toHaveLength(2)
  })

  it('shows the empty message only when there is one AND nothing was found', () => {
    const { unmount } = render(
      <DocumentsBlock
        documents={[]}
        onToggleDocument={() => {}}
        t={t}
        className="x"
        emptyMessage={t.archivisteEmpty}
      />,
    )
    expect(screen.getByText(t.archivisteEmpty)).toBeDefined()
    unmount()

    render(
      <DocumentsBlock
        documents={[doc()]}
        onToggleDocument={() => {}}
        t={t}
        className="x"
        emptyMessage={t.archivisteEmpty}
      />,
    )
    expect(screen.queryByText(t.archivisteEmpty)).toBeNull()
  })

  it('omits the empty message entirely when the caller passes none', () => {
    render(<DocumentsBlock documents={[]} onToggleDocument={() => {}} t={t} className="x" />)
    expect(screen.queryByText(t.archivisteEmpty)).toBeNull()
  })

  it('replaces the container class wholesale — /chat keeps its fade-in', () => {
    const { container } = render(
      <DocumentsBlock documents={[]} onToggleDocument={() => {}} t={t} className="fade-in flex" />,
    )
    expect(/** @type {Element} */ (container.firstElementChild).className).toBe('fade-in flex')
  })

  it('renders the extra children slot after the rows', () => {
    render(
      <DocumentsBlock documents={[doc()]} onToggleDocument={() => {}} t={t} className="x">
        <span>slot</span>
      </DocumentsBlock>,
    )
    expect(screen.getByText('slot')).toBeDefined()
  })

  it('reports which document was toggled', async () => {
    const onToggleDocument = vi.fn()
    const rows = [doc(), doc({ name: 'Badge' })]
    render(<DocumentsBlock documents={rows} onToggleDocument={onToggleDocument} t={t} className="x" />)

    await userEvent.click(screen.getByText('Badge'))
    expect(onToggleDocument).toHaveBeenCalledWith(rows[1])
  })
})

describe('ArchivisteDocument', () => {
  it('is collapsed by default and shows the score to two decimals', () => {
    render(<ArchivisteDocument doc={doc()} onToggle={() => {}} t={t} />)

    expect(screen.getByText('0.94')).toBeDefined()
    expect(screen.queryByText(/./, { selector: '.prose' })).toBeNull()
  })

  it('treats a missing `expanded` as collapsed', () => {
    // `expanded` is optional on the type — a row that has never been touched
    // simply does not carry it.
    const rest = doc()
    delete rest.expanded
    render(<ArchivisteDocument doc={rest} onToggle={() => {}} t={t} />)
    expect(document.querySelector('.prose')).toBeNull()
  })

  it('takes `expanded` from the document, not from local state', () => {
    // A /chat ↔ /archiviste switch unmounts this component; local state would
    // silently re-fold every row the user opened.
    render(<ArchivisteDocument doc={doc({ expanded: true, content: 'du contenu' })} onToggle={() => {}} t={t} />)
    expect(screen.getByText('du contenu')).toBeDefined()
  })

  it('reports a toggle upward', async () => {
    const onToggle = vi.fn()
    render(<ArchivisteDocument doc={doc()} onToggle={onToggle} t={t} />)

    await userEvent.click(screen.getByRole('button'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('shows a loading line while the content is in flight', () => {
    render(<ArchivisteDocument doc={doc({ expanded: true, loading: true })} onToggle={() => {}} t={t} />)
    expect(screen.getByText(t.loading)).toBeDefined()
  })

  it('prefixes an error with the translated prefix', () => {
    // The hook stores the raw message; the prefix is added here so a language
    // switch re-renders it in the right language.
    render(
      <ArchivisteDocument
        doc={doc({ expanded: true, error: 'Document not found' })}
        onToggle={() => {}}
        t={t}
      />,
    )
    expect(screen.getByText(/Erreur\s*:\s*Document not found/)).toBeDefined()
  })

  it('renders markdown, including a GFM table', () => {
    render(
      <ArchivisteDocument
        doc={doc({ expanded: true, content: '# Titre\n\n| a | b |\n| - | - |\n| 1 | 2 |' })}
        onToggle={() => {}}
        t={t}
      />,
    )

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Titre')
    expect(screen.getByRole('table')).toBeDefined()
  })

  it('renders a PDF in an iframe with an escape hatch, and no markdown', () => {
    const pdf = doc({ name: 'libft', type: 'pdf', url: '/subjectspdf/libft.pdf', expanded: true })
    const { container } = render(<ArchivisteDocument doc={pdf} onToggle={() => {}} t={t} />)

    const iframe = container.querySelector('iframe')
    expect(iframe?.getAttribute('src')).toBe('/subjectspdf/libft.pdf')
    expect(iframe?.getAttribute('title')).toBe('libft')
    // Deliberately NOT sandboxed — a sandbox neutralises the browsers' built-in
    // PDF viewer (see frontend/CLAUDE.md).
    expect(iframe?.hasAttribute('sandbox')).toBe(false)

    const link = screen.getByRole('link', { name: t.openInNewTab })
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('never shows a loading line for a PDF — nothing is fetched for one', () => {
    const pdf = doc({ type: 'pdf', expanded: true, loading: true })
    render(<ArchivisteDocument doc={pdf} onToggle={() => {}} t={t} />)

    expect(screen.queryByText(t.loading)).toBeNull()
  })
})

describe('FeedbackButtons', () => {
  /** @param {Partial<any>} [props] */
  function renderFeedback(props = {}) {
    const onRate = vi.fn()
    const view = render(<FeedbackButtons rating={0} onRate={onRate} t={t} {...props} />)
    return { onRate, ...view }
  }

  it('starts unpressed', () => {
    renderFeedback()
    expect(screen.getByRole('button', { name: t.feedbackUp }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: t.feedbackDown }).getAttribute('aria-pressed')).toBe('false')
  })

  it('reflects the current rating through aria-pressed', () => {
    const { unmount } = renderFeedback({ rating: 1 })
    expect(screen.getByRole('button', { name: t.feedbackUp }).getAttribute('aria-pressed')).toBe('true')
    unmount()

    renderFeedback({ rating: -1 })
    expect(screen.getByRole('button', { name: t.feedbackDown }).getAttribute('aria-pressed')).toBe('true')
  })

  it('sends a thumbs up, and withdraws it on a second click', async () => {
    const { onRate, rerender } = renderFeedback()
    await userEvent.click(screen.getByRole('button', { name: t.feedbackUp }))
    expect(onRate).toHaveBeenCalledWith(1)

    rerender(<FeedbackButtons rating={1} onRate={onRate} t={t} />)
    await userEvent.click(screen.getByRole('button', { name: t.feedbackUp }))
    expect(onRate).toHaveBeenLastCalledWith(0)
  })

  it('reveals the comment field on a thumbs down', async () => {
    const { onRate } = renderFeedback()
    await userEvent.click(screen.getByRole('button', { name: t.feedbackDown }))

    expect(onRate).toHaveBeenCalledWith(-1)
    expect(screen.getByPlaceholderText(t.feedbackCommentPlaceholder)).toBeDefined()
  })

  it('shows no comment field on a thumbs up', async () => {
    renderFeedback()
    await userEvent.click(screen.getByRole('button', { name: t.feedbackUp }))

    expect(screen.queryByPlaceholderText(t.feedbackCommentPlaceholder)).toBeNull()
  })

  it('withdraws a thumbs down without reopening the field', async () => {
    const { onRate } = renderFeedback({ rating: -1 })
    await userEvent.click(screen.getByRole('button', { name: t.feedbackDown }))

    expect(onRate).toHaveBeenCalledWith(0)
    expect(screen.queryByPlaceholderText(t.feedbackCommentPlaceholder)).toBeNull()
  })

  it('re-sends the rating with the comment on submit, then hides the field', async () => {
    const { onRate } = renderFeedback()
    await userEvent.click(screen.getByRole('button', { name: t.feedbackDown }))
    await userEvent.type(screen.getByPlaceholderText(t.feedbackCommentPlaceholder), '  hors sujet  ')
    await userEvent.click(screen.getByRole('button', { name: t.feedbackCommentSend }))

    expect(onRate).toHaveBeenLastCalledWith(-1, 'hors sujet')
    expect(screen.queryByPlaceholderText(t.feedbackCommentPlaceholder)).toBeNull()
  })

  it('sends undefined rather than an empty comment', async () => {
    const { onRate } = renderFeedback()
    await userEvent.click(screen.getByRole('button', { name: t.feedbackDown }))
    await userEvent.click(screen.getByRole('button', { name: t.feedbackCommentSend }))

    expect(onRate).toHaveBeenLastCalledWith(-1, undefined)
  })

  it('drops the comment field when the rating changes from outside', async () => {
    // A silent rollback: the hook reverts the rating and the open comment box
    // would otherwise still be inviting a comment on a rating that is gone.
    const { onRate, rerender } = renderFeedback()
    await userEvent.click(screen.getByRole('button', { name: t.feedbackDown }))
    expect(screen.getByPlaceholderText(t.feedbackCommentPlaceholder)).toBeDefined()

    // The hook's optimistic update lands first…
    rerender(<FeedbackButtons rating={-1} onRate={onRate} t={t} />)
    expect(screen.getByPlaceholderText(t.feedbackCommentPlaceholder)).toBeDefined()

    // …then the request fails and the rating is rolled back.
    rerender(<FeedbackButtons rating={0} onRate={onRate} t={t} />)
    expect(screen.queryByPlaceholderText(t.feedbackCommentPlaceholder)).toBeNull()
  })

  it('keeps the field open when the rating settles on the same -1', async () => {
    const { onRate, rerender } = renderFeedback()
    await userEvent.click(screen.getByRole('button', { name: t.feedbackDown }))

    rerender(<FeedbackButtons rating={-1} onRate={onRate} t={t} />)
    expect(screen.getByPlaceholderText(t.feedbackCommentPlaceholder)).toBeDefined()
  })

  it('clears the typed comment when the field is dropped', async () => {
    const { onRate, rerender } = renderFeedback()
    await userEvent.click(screen.getByRole('button', { name: t.feedbackDown }))
    await userEvent.type(screen.getByPlaceholderText(t.feedbackCommentPlaceholder), 'texte')

    rerender(<FeedbackButtons rating={1} onRate={onRate} t={t} />)
    await userEvent.click(screen.getByRole('button', { name: t.feedbackDown }))

    expect(/** @type {HTMLInputElement} */ (screen.getByPlaceholderText(t.feedbackCommentPlaceholder)).value).toBe('')
  })
})

describe('ArchivisteMessage', () => {
  /** @param {Partial<any>} [props] */
  const renderMessage = (props = {}) =>
    render(<ArchivisteMessage question="où est le wifi" onToggleDocument={() => {}} t={t} {...props} />)

  it('always shows the question', () => {
    renderMessage()
    expect(screen.getByText('où est le wifi')).toBeDefined()
  })

  it('shows a static waiting line while queued, with no animated search line', () => {
    renderMessage({ queued: true, loading: true })

    expect(screen.getByText(t.chatQueued)).toBeDefined()
    expect(screen.queryByText(t.archivisteSearching)).toBeNull()
  })

  it('shows the searching line while loading', () => {
    renderMessage({ loading: true })
    expect(screen.getByText(t.archivisteSearching)).toBeDefined()
  })

  it('shows the prefixed error instead of the documents', () => {
    renderMessage({ error: 'Failed to search the document base', documents: [doc()] })

    expect(screen.getByText(/Erreur\s*:\s*Failed to search the document base/)).toBeDefined()
    expect(screen.queryByText('Wi-Fi')).toBeNull()
  })

  it('shows the documents and the empty message when there are none', () => {
    const { unmount } = renderMessage({ documents: [doc()] })
    expect(screen.getByText('Wi-Fi')).toBeDefined()
    unmount()

    renderMessage()
    expect(screen.getByText(t.archivisteEmpty)).toBeDefined()
  })

  it('mounts the feedback buttons only with a messageId AND a handler', () => {
    const { unmount } = renderMessage({ documents: [doc()] })
    expect(screen.queryByRole('button', { name: t.feedbackUp })).toBeNull()
    unmount()

    const second = renderMessage({ documents: [doc()], messageId: 'msg-1' })
    expect(screen.queryByRole('button', { name: t.feedbackUp })).toBeNull()
    second.unmount()

    renderMessage({ documents: [doc()], messageId: 'msg-1', onRate: () => {} })
    expect(screen.getByRole('button', { name: t.feedbackUp })).toBeDefined()
  })
})

describe('Message', () => {
  /** @param {Partial<any>} [props] */
  const renderMessage = (props = {}) =>
    render(
      <Message
        question="où est le wifi"
        answer=""
        onToggleDocument={() => {}}
        t={t}
        {...props}
      />,
    )

  it('shows a static line while queued', () => {
    renderMessage({ phase: 'queued' })

    expect(screen.getByText(t.chatQueued)).toBeDefined()
    expect(screen.queryByText(new RegExp(t.intro))).toBeNull()
  })

  it('opens on the intro beat for a fresh exchange', () => {
    renderMessage({ phase: 'retrieving' })
    expect(screen.getByText(new RegExp(t.intro))).toBeDefined()
  })

  it('mounts an already-finished exchange straight on the answer', () => {
    // Revisiting history must not replay intro → searching → reading.
    renderMessage({ phase: 'done', answer: 'au 2e étage' })

    expect(screen.getByText('au 2e étage')).toBeDefined()
    expect(screen.queryByText(new RegExp(t.intro))).toBeNull()
  })

  it('shows the documents alongside the answer', () => {
    renderMessage({ phase: 'done', answer: 'au 2e', documents: [doc()] })

    expect(screen.getByText('Wi-Fi')).toBeDefined()
    expect(screen.getByText(t.chatDocsNotionLabel)).toBeDefined()
  })

  it('shows no document block when nothing was found', () => {
    renderMessage({ phase: 'done', answer: 'rien', documents: [] })
    expect(screen.queryByText(t.chatDocsNotionLabel)).toBeNull()
  })

  it('mounts an errored exchange on the prefixed error', () => {
    renderMessage({ phase: 'error', error: 'Failed to get an answer from Ollama' })
    expect(screen.getByText(/Erreur\s*:\s*Failed to get an answer from Ollama/)).toBeDefined()
  })

  it('renders the answer as markdown', () => {
    renderMessage({ phase: 'done', answer: '# Titre\n\n- un\n- deux' })

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Titre')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('turns a single newline into a hard break instead of joining the lines', () => {
    // A chat answer uses single newlines as line breaks; plain markdown would
    // run them together into one paragraph.
    const { container } = renderMessage({ phase: 'done', answer: 'ligne un\nligne deux' })

    expect(container.querySelectorAll('br')).toHaveLength(1)
    expect(container.querySelectorAll('p')).toHaveLength(1)
  })

  it('keeps a blank line as a paragraph break', () => {
    const { container } = renderMessage({ phase: 'done', answer: 'para un\n\npara deux' })

    expect(container.querySelectorAll('p')).toHaveLength(2)
    expect(container.querySelectorAll('br')).toHaveLength(0)
  })

  it('labels a bare-URL autolink 42Doc, and leaves a real link alone', () => {
    const { unmount } = renderMessage({
      phase: 'done',
      answer: 'voir https://ft42.notion.site/rtfm-stud',
    })
    const auto = screen.getByRole('link')
    expect(auto.textContent).toBe('42Doc')
    expect(auto.getAttribute('href')).toBe('https://ft42.notion.site/rtfm-stud')
    expect(auto.getAttribute('rel')).toBe('noopener noreferrer')
    unmount()

    renderMessage({ phase: 'done', answer: '[le RTFM](https://ft42.notion.site/rtfm-stud)' })
    expect(screen.getByRole('link').textContent).toBe('le RTFM')
  })

  it('mounts the feedback buttons only on a done answer with a messageId and a handler', () => {
    const { unmount } = renderMessage({ phase: 'done', answer: 'a', messageId: 'msg-1' })
    expect(screen.queryByRole('button', { name: t.feedbackUp })).toBeNull()
    unmount()

    renderMessage({ phase: 'done', answer: 'a', messageId: 'msg-1', onRate: () => {} })
    expect(screen.getByRole('button', { name: t.feedbackUp })).toBeDefined()
  })

  it('animates the dots on the waiting beats', () => {
    vi.useFakeTimers()
    renderMessage({ phase: 'retrieving' })

    const first = screen.getByText(new RegExp(t.intro)).textContent
    act(() => vi.advanceTimersByTime(600))
    expect(screen.getByText(new RegExp(t.intro)).textContent).not.toBe(first)
  })

  it('walks the beats through to the answer', () => {
    vi.useFakeTimers()
    const { rerender } = render(
      <Message question="q" answer="" phase="retrieving" documents={[doc()]} onToggleDocument={() => {}} t={t} />,
    )
    expect(screen.getByText(new RegExp(t.intro))).toBeDefined()

    act(() => vi.advanceTimersByTime(STEP_DURATIONS.intro))
    expect(screen.getByText(new RegExp(t.searching))).toBeDefined()

    rerender(
      <Message question="q" answer="" phase="reading" documents={[doc()]} onToggleDocument={() => {}} t={t} />,
    )
    act(() => vi.advanceTimersByTime(STEP_DURATIONS.searching))
    expect(screen.getByText(new RegExp(t.chatReading))).toBeDefined()
    expect(screen.getByText('Wi-Fi')).toBeDefined()

    rerender(
      <Message question="q" answer="au 2e" phase="done" documents={[doc()]} onToggleDocument={() => {}} t={t} />,
    )
    act(() => vi.advanceTimersByTime(0))
    expect(screen.getByText('au 2e')).toBeDefined()
  })
})
