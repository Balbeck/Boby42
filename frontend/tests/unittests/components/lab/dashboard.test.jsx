import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Card, SectionLabel, ChartCard, Empty, MiniLegend, VizTooltip, PageBadge, Pager } from '../../../../src/components/lab/VizChrome'
import StatTiles from '../../../../src/components/lab/StatTiles'
import PeriodSelect from '../../../../src/components/lab/PeriodSelect'
import TimeSeries from '../../../../src/components/lab/TimeSeries'
import ScoreHistogram from '../../../../src/components/lab/ScoreHistogram'
import TopDocuments from '../../../../src/components/lab/TopDocuments'
import Breakdowns from '../../../../src/components/lab/Breakdowns'
import LabTabs from '../../../../src/components/lab/LabTabs'
import UnmatchedQuestions from '../../../../src/components/lab/UnmatchedQuestions'
import VizDashboard from '../../../../src/components/lab/VizDashboard'
import * as labApi from '../../../../src/services/labApi'
import { C, SERIES } from '../../../../src/components/lab/vizKit'

// The 🔬 dashboard. Charts are rendered for real (recharts' ResponsiveContainer
// is replaced in the test setup, since jsdom does no layout), so the assertions
// stay on the parts a wrong render actually breaks: which EMPTY state shows,
// what the tiles read, and whether a control reports the right value upward.
//
// The recurring theme is the empty state. Every panel here can legitimately have
// nothing to show, and "zero" must look different from "broken" — a chart drawn
// flat at 0 reads as real data.

const RANGE = { from: '2026-03-01T00:00:00.000Z', to: '2026-03-08T00:00:00.000Z', key: '7' }

/**
 * The first argument of a spy's most recent call. `mock.calls.at(-1)` is
 * `T | undefined` and every read below would need its own guard otherwise —
 * a call that never happened should fail here, loudly, not read as `undefined`.
 *
 * @param {import('vitest').MockInstance<any>} spy
 * @returns {any}
 */
function lastCall(spy) {
  const call = spy.mock.calls.at(-1)
  if (!call) throw new Error('expected the spy to have been called')
  return call[0]
}

beforeEach(() => {
  vi.restoreAllMocks()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('VizChrome', () => {
  it('Card and SectionLabel render their children', () => {
    render(<Card className="extra"><span>contenu</span></Card>)
    expect(screen.getByText('contenu')).toBeDefined()

    render(<SectionLabel>Trends</SectionLabel>)
    expect(screen.getByText('Trends')).toBeDefined()
  })

  it('ChartCard shows the title, the optional hint and the legend', () => {
    render(
      <ChartCard title="Daily volume" hint="Exchanges per day" legend={<span>légende</span>}>
        <span>le graphe</span>
      </ChartCard>,
    )

    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Daily volume')
    expect(screen.getByText('Exchanges per day')).toBeDefined()
    expect(screen.getByText('légende')).toBeDefined()
    expect(screen.getByText('le graphe')).toBeDefined()
  })

  it('ChartCard replaces the plot with the empty note when empty', () => {
    render(<ChartCard title="Vide" empty><span>le graphe</span></ChartCard>)

    expect(screen.queryByText('le graphe')).toBeNull()
    expect(screen.getByText('No data in this period')).toBeDefined()
  })

  it('ChartCard omits the hint when there is none', () => {
    const { container } = render(<ChartCard title="T"><span>x</span></ChartCard>)
    expect(container.querySelectorAll('p')).toHaveLength(0)
  })

  it('Empty takes a custom label', () => {
    render(<Empty label="Rien ici" />)
    expect(screen.getByText('Rien ici')).toBeDefined()
  })

  it('MiniLegend labels every series — identity is never colour alone', () => {
    // A colour-only legend is unreadable for a colour-blind operator, and this
    // dashboard's palette has an aqua and a green that read alike.
    render(<MiniLegend items={[{ label: 'chat', color: C.chat }, { label: 'archiviste', color: C.archiviste }]} />)

    expect(screen.getByText('chat')).toBeDefined()
    expect(screen.getByText('archiviste')).toBeDefined()
  })

  it('VizTooltip renders nothing unless recharts says it is active with data', () => {
    const { container, rerender } = render(<VizTooltip active={false} payload={[{ dataKey: 'x', value: 1 }]} />)
    expect(container.firstChild).toBeNull()

    rerender(<VizTooltip active payload={[]} />)
    expect(container.firstChild).toBeNull()

    rerender(<VizTooltip active payload={undefined} />)
    expect(container.firstChild).toBeNull()
  })

  it('VizTooltip lists one row per series, with the label and a formatted value', () => {
    render(
      <VizTooltip
        active
        label="03-08"
        payload={[
          { dataKey: 'total', name: 'total', value: 1234, color: C.total },
          { dataKey: 'chat', name: 'chat', value: 12, stroke: C.chat },
        ]}
        valueFormat={(v) => `${v} ex`}
      />,
    )

    expect(screen.getByText('03-08')).toBeDefined()
    expect(screen.getByText('1234 ex')).toBeDefined()
    expect(screen.getByText('12 ex')).toBeDefined()
  })

  it('VizTooltip renders a null value as an em dash and needs no formatter', () => {
    render(<VizTooltip active label="03-08" payload={[{ dataKey: 'a', name: 'a', value: null }, { dataKey: 'b', name: 'b', value: 7 }]} />)

    expect(screen.getByText('—')).toBeDefined()
    expect(screen.getByText('7')).toBeDefined()
  })

  it('PageBadge shows the page, or an em dash for an unlinked event', () => {
    const { rerender } = render(<PageBadge page="chat" />)
    expect(screen.getByText('chat')).toBeDefined()

    rerender(<PageBadge page={null} />)
    expect(screen.getByText('—')).toBeDefined()
  })
})

describe('VizChrome — Pager', () => {
  /** @param {Partial<any>} props */
  function renderPager(props) {
    const onPrev = vi.fn()
    const onNext = vi.fn()
    render(<Pager offset={0} limit={25} total={100} onPrev={onPrev} onNext={onNext} {...props} />)
    return { onPrev, onNext }
  }

  it('reads "1–25 of 100" on the first page', () => {
    renderPager({})
    expect(screen.getByText('1–25 of 100')).toBeDefined()
  })

  it('reads "0–0 of 0" rather than "1–0" when there is nothing', () => {
    renderPager({ total: 0 })
    expect(screen.getByText('0–0 of 0')).toBeDefined()
  })

  it('caps the end at the total on the last, partial page', () => {
    renderPager({ offset: 75, total: 80 })
    expect(screen.getByText('76–80 of 80')).toBeDefined()
  })

  it('disables Prev on the first page and Next on the last', () => {
    const { unmount } = render(<Pager offset={0} limit={25} total={100} onPrev={() => {}} onNext={() => {}} />)
    expect(screen.getByRole('button', { name: 'Prev' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(false)
    unmount()

    render(<Pager offset={75} limit={25} total={100} onPrev={() => {}} onNext={() => {}} />)
    expect(screen.getByRole('button', { name: 'Prev' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true)
  })

  it('reports both moves', async () => {
    const { onPrev, onNext } = renderPager({ offset: 25 })

    await userEvent.click(screen.getByRole('button', { name: 'Prev' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(onPrev).toHaveBeenCalledTimes(1)
    expect(onNext).toHaveBeenCalledTimes(1)
  })
})

describe('StatTiles', () => {
  const TOTALS = {
    range: {
      requests: 120, requestsChat: 80, requestsArchiviste: 40,
      thumbsUp: 12, thumbsDown: 3, noMatch: 6, noMatchRate: 0.05,
      activeVisitors: 25, conversations: 40, avgMessagesPerConversation: 3.5,
      chatLatencyP50: 1200, chatLatencyP95: 4800, chatLatencyMax: 9000,
    },
    allTime: {
      requests: 5000, requestsChat: 3000, requestsArchiviste: 2000,
      thumbsUp: 400, thumbsDown: 60, noMatch: 250, noMatchRate: 0.05,
      activeVisitors: 900, conversations: 1500, avgMessagesPerConversation: 3.2,
      chatLatencyP50: 1300, chatLatencyP95: 5000, chatLatencyMax: 20000,
    },
  }

  it('renders nothing at all while the payload is missing', () => {
    // Not a row of dashes: an unloaded dashboard must not look like a dashboard
    // reporting zeros.
    const { container } = render(<StatTiles totals={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the nine tiles with their period value and an all-time reference', () => {
    render(<StatTiles totals={TOTALS} />)

    expect(screen.getByText('Total requests')).toBeDefined()
    expect(screen.getByText('120')).toBeDefined()
    expect(screen.getByText('5,000 all-time')).toBeDefined()
    expect(screen.getAllByText(/all-time/).length).toBeGreaterThanOrEqual(5)
  })

  it('formats the rate, the latency and the average with their own units', () => {
    render(<StatTiles totals={TOTALS} />)

    expect(screen.getByText('5.0%')).toBeDefined()
    expect(screen.getByText('4.8 s')).toBeDefined()
    expect(screen.getByText('3.5')).toBeDefined()
    expect(screen.getByText('6 of 120 · 5.0% all-time')).toBeDefined()
    expect(screen.getByText('p50 1.2 s · max 9.0 s')).toBeDefined()
  })

  it('shows an em dash rather than 0 for a null aggregate', () => {
    // Postgres returns NULL for a percentile over no rows — "0 ms" would be a
    // false claim about the system's latency.
    render(
      <StatTiles
        totals={{
          range: { ...TOTALS.range, noMatchRate: null, chatLatencyP95: null, avgMessagesPerConversation: null },
          allTime: TOTALS.allTime,
        }}
      />,
    )

    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
  })
})

describe('PeriodSelect', () => {
  it('renders the four periods as a radiogroup', () => {
    render(<PeriodSelect value="7" onChange={() => {}} />)

    const group = screen.getByRole('radiogroup', { name: 'Time range' })
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['7d', '30d', '90d', 'All'])
  })

  it('marks the active period', () => {
    render(<PeriodSelect value="30" onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: '30d' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: '7d' }).getAttribute('aria-checked')).toBe('false')
  })

  it('reports a resolved window, not just the key — the parent needs both bounds', async () => {
    const onChange = vi.fn()
    render(<PeriodSelect value="7" onChange={onChange} />)

    await userEvent.click(screen.getByRole('radio', { name: '90d' }))

    const [win] = onChange.mock.calls[0]
    expect(win.key).toBe('90')
    expect(new Date(win.to).getTime() - new Date(win.from).getTime()).toBe(90 * 86400e3)
  })

  it('owns nothing — clicking does not change what it displays', async () => {
    render(<PeriodSelect value="7" onChange={() => {}} />)
    await userEvent.click(screen.getByRole('radio', { name: 'All' }))

    expect(screen.getByRole('radio', { name: '7d' }).getAttribute('aria-checked')).toBe('true')
  })
})

describe('TimeSeries', () => {
  const SERIES_DEF = [
    { key: 'total', label: 'total', color: C.total },
    { key: 'chat', label: 'chat', color: C.chat },
  ]

  it('draws the chart when there is data', () => {
    const { container } = render(
      <TimeSeries
        title="Daily volume"
        hint="Exchanges per day"
        data={[{ day: '2026-03-01', total: 5, chat: 3 }, { day: '2026-03-02', total: 7, chat: 4 }]}
        series={SERIES_DEF}
      />,
    )

    expect(screen.queryByText('No data in this period')).toBeNull()
    expect(container.querySelector('.recharts-line')).not.toBeNull()
  })

  it('shows the empty state for an all-zero series, not a flat line at zero', () => {
    // A gap-filled series is all-zero on a quiet week. Drawing it makes "no
    // traffic" look like "traffic measured at zero", which is a different claim.
    render(
      <TimeSeries
        title="Daily volume"
        data={[{ day: '2026-03-01', total: 0, chat: 0 }, { day: '2026-03-02', total: 0, chat: 0 }]}
        series={SERIES_DEF}
      />,
    )
    expect(screen.getByText('No data in this period')).toBeDefined()
  })

  it('shows the empty state for null values and for no data at all', () => {
    const { unmount } = render(<TimeSeries title="T" data={[{ day: 'd', total: null, chat: null }]} series={SERIES_DEF} />)
    expect(screen.getByText('No data in this period')).toBeDefined()
    unmount()

    const second = render(<TimeSeries title="T" data={[]} series={SERIES_DEF} />)
    expect(screen.getByText('No data in this period')).toBeDefined()
    second.unmount()

    // `null` / `undefined` are outside the declared prop type on purpose — a
    // failed overview hands the panels exactly that, and an empty state is the
    // required behaviour rather than a crash.
    render(<TimeSeries title="T" data={/** @type {any} */ (null)} series={SERIES_DEF} />)
    expect(screen.getByText('No data in this period')).toBeDefined()
  })

  it('draws as soon as ONE point of ONE series is non-zero', () => {
    const { container } = render(
      <TimeSeries
        title="T"
        data={[{ day: 'a', total: 0, chat: 0 }, { day: 'b', total: 0, chat: 1 }]}
        series={SERIES_DEF}
      />,
    )
    expect(container.querySelector('.recharts-line')).not.toBeNull()
  })

  it('labels every series in the legend', () => {
    render(<TimeSeries title="T" data={[{ day: 'a', total: 1, chat: 1 }]} series={SERIES_DEF} />)

    expect(screen.getByText('total')).toBeDefined()
    expect(screen.getByText('chat')).toBeDefined()
  })
})

describe('ScoreHistogram', () => {
  const BINS = [
    { bucket: 13, lo: 0.97, hi: 0.98, count: 2 },
    { bucket: 14, lo: 0.98, hi: 0.99, count: 5 },
    { bucket: 15, lo: 0.99, hi: 1.0, count: 9 },
  ]

  it('draws a bar per bin and labels the axis without the leading zero', () => {
    const { container } = render(<ScoreHistogram bins={BINS} />)

    expect(container.querySelectorAll('.recharts-bar-rectangle').length).toBe(3)
    expect(screen.getByText('.97')).toBeDefined()
    expect(screen.getByText('.99')).toBeDefined()
  })

  it('shows the empty state for no bins and for all-zero bins', () => {
    const { unmount } = render(<ScoreHistogram bins={[]} />)
    expect(screen.getByText('No data in this period')).toBeDefined()
    unmount()

    const second = render(<ScoreHistogram bins={BINS.map((b) => ({ ...b, count: 0 }))} />)
    expect(screen.getByText('No data in this period')).toBeDefined()
    second.unmount()

    render(<ScoreHistogram bins={/** @type {any} */ (undefined)} />)
    expect(screen.getByText('No data in this period')).toBeDefined()
  })
})

describe('TopDocuments', () => {
  const DOCS = [
    { name: 'Wi-Fi', type: 'md', count: 40, avgScore: 0.9412 },
    { name: 'libft.en.subject', type: 'pdf', count: 10, avgScore: null },
  ]

  it('lists each document with its type, count and mean score', () => {
    render(<TopDocuments docs={DOCS} />)

    expect(screen.getByText('Wi-Fi')).toBeDefined()
    expect(screen.getByText('md')).toBeDefined()
    expect(screen.getByText('40')).toBeDefined()
    expect(screen.getByText('0.941')).toBeDefined()
  })

  it('shows an em dash for a missing mean score', () => {
    render(<TopDocuments docs={DOCS} />)
    expect(screen.getByText('—')).toBeDefined()
  })

  it('defaults a null type to md', () => {
    render(<TopDocuments docs={[{ name: 'Old', type: null, count: 1, avgScore: 0.9 }]} />)
    expect(screen.getByText('md')).toBeDefined()
  })

  it('scales the bars against the top row, and survives an all-zero list', () => {
    // `|| 1` on the max: without it a list where every count is 0 divides by
    // zero and every bar width becomes NaN%.
    const { container } = render(<TopDocuments docs={[{ name: 'a', type: 'md', count: 0, avgScore: null }]} />)

    const bar = /** @type {HTMLElement} */ (container.querySelector('li span[style*="width"]'))
    expect(bar.style.width).toBe('0%')
  })

  it('shows the empty state for an empty or missing list', () => {
    const { unmount } = render(<TopDocuments docs={[]} />)
    expect(screen.getByText('No data in this period')).toBeDefined()
    unmount()

    render(<TopDocuments docs={/** @type {any} */ (undefined)} />)
    expect(screen.getByText('No data in this period')).toBeDefined()
  })
})

describe('Breakdowns', () => {
  it('shows a total and a labelled legend per split', () => {
    render(
      <Breakdowns
        languages={[{ language: 'fr', count: 90 }, { language: 'en', count: 10 }]}
        errors={[{ code: 'ok', count: 95 }, { code: 'ollama_error', count: 5 }]}
      />,
    )

    expect(screen.getByText('Languages')).toBeDefined()
    expect(screen.getByText('Errors')).toBeDefined()
    expect(screen.getAllByText('100 total')).toHaveLength(2)
    expect(screen.getByText('fr')).toBeDefined()
    expect(screen.getByText('ollama_error')).toBeDefined()
  })

  it('gives the ok slice the success colour wherever it sits in the list', () => {
    // Otherwise "ok" would take whatever slot colour its index happened to give
    // it — red, on a list where an error came first.
    const { container } = render(
      <Breakdowns languages={[]} errors={[{ code: 'ollama_error', count: 5 }, { code: 'ok', count: 95 }]} />,
    )

    const okSlice = /** @type {HTMLElement} */ (container.querySelector('[title^="ok ·"]'))
    expect(okSlice.style.backgroundColor).toBe('rgb(25, 158, 112)') // SERIES.aqua
    expect(SERIES.aqua).toBe('#199e70')
  })

  it('says nothing was recorded rather than drawing an empty bar', () => {
    render(<Breakdowns languages={[]} errors={[]} />)
    expect(screen.getAllByText('Nothing recorded in this period.')).toHaveLength(2)
  })

  it('tolerates missing arrays', () => {
    render(<Breakdowns languages={/** @type {any} */ (undefined)} errors={/** @type {any} */ (null)} />)
    expect(screen.getAllByText('Nothing recorded in this period.')).toHaveLength(2)
  })

  it('sizes each slice by its share of the total', () => {
    const { container } = render(
      <Breakdowns languages={[{ language: 'fr', count: 75 }, { language: 'en', count: 25 }]} errors={[]} />,
    )

    const slices = container.querySelectorAll('[title^="fr ·"], [title^="en ·"]')
    expect(/** @type {HTMLElement} */ (slices[0]).style.width).toBe('75%')
    expect(/** @type {HTMLElement} */ (slices[1]).style.width).toBe('25%')
  })
})

describe('LabTabs', () => {
  it('renders the four tabs with accessible labels', () => {
    render(<LabTabs active="viz" onChange={() => {}} />)

    const list = screen.getByRole('tablist', { name: 'Lab sections' })
    expect(within(list).getAllByRole('tab').map((tab) => tab.getAttribute('aria-label'))).toEqual([
      'Connexion', 'Visualizations', 'Database viewer', 'Ollama console',
    ])
  })

  it('marks the active tab and keeps only it in the tab order', () => {
    // Roving tabindex: a tablist must be one stop, not four.
    render(<LabTabs active="dbviz" onChange={() => {}} />)

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true', 'false'])
    expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toEqual(['-1', '-1', '0', '-1'])
  })

  it('falls back to the first tab for an unknown id', () => {
    render(<LabTabs active={/** @type {any} */ ('nope')} onChange={() => {}} />)
    expect(screen.getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true')
  })

  it('reports a click', async () => {
    const onChange = vi.fn()
    render(<LabTabs active="connexion" onChange={onChange} />)

    await userEvent.click(screen.getByRole('tab', { name: 'Ollama console' }))
    expect(onChange).toHaveBeenCalledWith('ollama')
  })

  // The handler sits on the tablist <div>, which is not focusable, so
  // `userEvent.type` has nowhere to type — the key event is dispatched directly.
  const press = (/** @type {string} */ key) => fireEvent.keyDown(screen.getByRole('tablist'), { key })

  it('moves with the arrow keys and wraps around', () => {
    const onChange = vi.fn()
    const { rerender } = render(<LabTabs active="connexion" onChange={onChange} />)

    press('ArrowRight')
    expect(onChange).toHaveBeenLastCalledWith('viz')

    press('ArrowLeft')
    expect(onChange).toHaveBeenLastCalledWith('ollama')

    rerender(<LabTabs active="ollama" onChange={onChange} />)
    press('ArrowDown')
    expect(onChange).toHaveBeenLastCalledWith('connexion')
  })

  it('treats Up like Left', () => {
    const onChange = vi.fn()
    render(<LabTabs active="viz" onChange={onChange} />)

    press('ArrowUp')
    expect(onChange).toHaveBeenLastCalledWith('connexion')
  })

  it('moves focus with the selection', () => {
    const onChange = vi.fn()
    render(<LabTabs active="connexion" onChange={onChange} />)

    press('ArrowRight')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Visualizations' }))
  })

  it('ignores other keys', () => {
    const onChange = vi.fn()
    render(<LabTabs active="viz" onChange={onChange} />)

    press('Enter')
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('UnmatchedQuestions', () => {
  const ITEMS = [
    { id: '1', question: 'tricher avec l\'IA', language: 'fr', page: 'chat', createdAt: new Date().toISOString() },
    { id: '2', question: '', language: null, page: null, createdAt: new Date().toISOString() },
  ]

  /** @param {any} payload */
  function stubUnmatched(payload) {
    return vi.spyOn(labApi, 'analyticsUnmatched').mockResolvedValue(payload)
  }

  it('shows a loading line, then the questions', async () => {
    stubUnmatched({ items: ITEMS, total: 2 })
    render(<UnmatchedQuestions range={RANGE} />)

    expect(screen.getByText('Loading…')).toBeDefined()
    expect(await screen.findByText('tricher avec l\'IA')).toBeDefined()
  })

  it('labels an empty question rather than rendering a blank row', async () => {
    stubUnmatched({ items: ITEMS, total: 2 })
    render(<UnmatchedQuestions range={RANGE} />)

    expect(await screen.findByText('(empty question)')).toBeDefined()
  })

  it('says nothing is missing when the list is empty', async () => {
    stubUnmatched({ items: [], total: 0 })
    render(<UnmatchedQuestions range={RANGE} />)

    expect(await screen.findByText(/nothing missing/)).toBeDefined()
  })

  it('surfaces a failed load', async () => {
    vi.spyOn(labApi, 'analyticsUnmatched').mockResolvedValue(null)
    render(<UnmatchedQuestions range={RANGE} />)

    expect(await screen.findByText(/Couldn’t load the unmatched list/)).toBeDefined()
  })

  it('asks for the parent window and the first page', async () => {
    const list = stubUnmatched({ items: [], total: 0 })
    render(<UnmatchedQuestions range={RANGE} />)

    await waitFor(() => expect(list).toHaveBeenCalled())
    expect(list.mock.calls[0][0]).toEqual({
      from: RANGE.from, to: RANGE.to, limit: 25, offset: 0, page: undefined,
    })
  })

  it('re-queries with a page filter and resets to the first page', async () => {
    const list = stubUnmatched({ items: ITEMS, total: 60 })
    render(<UnmatchedQuestions range={RANGE} />)
    await screen.findByText('tricher avec l\'IA')

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(lastCall(list).offset).toBe(25))

    await userEvent.selectOptions(screen.getByRole('combobox'), 'archiviste')
    await waitFor(() => expect(lastCall(list)).toMatchObject({ page: 'archiviste', offset: 0 }))
  })

  it('hides the pager when everything fits on one page', async () => {
    stubUnmatched({ items: ITEMS, total: 2 })
    render(<UnmatchedQuestions range={RANGE} />)
    await screen.findByText('tricher avec l\'IA')

    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
  })

  it('pages backwards without going below zero', async () => {
    const list = stubUnmatched({ items: ITEMS, total: 60 })
    render(<UnmatchedQuestions range={RANGE} />)
    await screen.findByText('tricher avec l\'IA')

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(lastCall(list).offset).toBe(25))

    await userEvent.click(screen.getByRole('button', { name: 'Prev' }))
    await waitFor(() => expect(lastCall(list).offset).toBe(0))
  })

  it('copies one question and confirms it, then reverts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    stubUnmatched({ items: ITEMS, total: 2 })

    render(<UnmatchedQuestions range={RANGE} />)
    await screen.findByText('tricher avec l\'IA')

    await userEvent.click(screen.getAllByRole('button', { name: 'Copy' })[0])
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('tricher avec l\'IA'))
    expect(await screen.findByText('Copied ✓')).toBeDefined()
  })

  it('copies the whole filtered list, unpaginated', async () => {
    // The point of "Copy all" is to feed the curation task — it must not stop
    // at the 25 rows on screen.
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const list = stubUnmatched({ items: ITEMS, total: 2 })

    render(<UnmatchedQuestions range={RANGE} />)
    await screen.findByText('tricher avec l\'IA')

    await userEvent.click(screen.getByRole('button', { name: /Copy all/ }))

    await waitFor(() => expect(lastCall(list).limit).toBe(1000))
    // The blank question is dropped — an empty line is not a gap to curate.
    expect(writeText).toHaveBeenCalledWith('tricher avec l\'IA')
  })

  it('does not copy when every question is blank', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    stubUnmatched({ items: [{ id: '2', question: '', page: null, createdAt: new Date().toISOString() }], total: 1 })

    render(<UnmatchedQuestions range={RANGE} />)
    await screen.findByText('(empty question)')

    await userEvent.click(screen.getByRole('button', { name: /Copy all/ }))
    await waitFor(() => expect(labApi.analyticsUnmatched).toHaveBeenCalledTimes(2))
    expect(writeText).not.toHaveBeenCalled()
  })

  it('survives Copy all when the request comes back null', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    vi.spyOn(labApi, 'analyticsUnmatched')
      .mockResolvedValueOnce({ items: ITEMS, total: 2 })
      .mockResolvedValueOnce(null)

    render(<UnmatchedQuestions range={RANGE} />)
    await screen.findByText('tricher avec l\'IA')

    await userEvent.click(screen.getByRole('button', { name: /Copy all/ }))
    await waitFor(() => expect(labApi.analyticsUnmatched).toHaveBeenCalledTimes(2))
    expect(writeText).not.toHaveBeenCalled()
  })

  it('swallows a clipboard that refuses — the panel must not break', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => { throw new Error('denied') }) },
      configurable: true,
    })
    stubUnmatched({ items: ITEMS, total: 2 })

    render(<UnmatchedQuestions range={RANGE} />)
    await screen.findByText('tricher avec l\'IA')

    await userEvent.click(screen.getAllByRole('button', { name: 'Copy' })[0])
    expect(screen.queryByText('Copied ✓')).toBeNull()
    expect(screen.getByText('tricher avec l\'IA')).toBeDefined()
  })

  it('disables Copy all when there is nothing to copy', async () => {
    stubUnmatched({ items: [], total: 0 })
    render(<UnmatchedQuestions range={RANGE} />)

    await screen.findByText(/nothing missing/)
    expect(screen.getByRole('button', { name: /Copy all/ }).hasAttribute('disabled')).toBe(true)
  })
})

describe('VizDashboard', () => {
  const OVERVIEW = {
    window: RANGE,
    totals: {
      range: { requests: 10, requestsChat: 6, requestsArchiviste: 4, thumbsUp: 2, thumbsDown: 1, noMatch: 1, noMatchRate: 0.1, activeVisitors: 5, conversations: 6, avgMessagesPerConversation: 2, chatLatencyP50: 900, chatLatencyP95: 1800, chatLatencyMax: 3000 },
      allTime: { requests: 100, requestsChat: 60, requestsArchiviste: 40, thumbsUp: 20, thumbsDown: 5, noMatch: 8, noMatchRate: 0.08, activeVisitors: 50, conversations: 60, avgMessagesPerConversation: 2.4, chatLatencyP50: 950, chatLatencyP95: 2000, chatLatencyMax: 8000 },
    },
    daily: {
      volume: [{ day: '2026-03-01', total: 5, chat: 3, archiviste: 2, noMatch: 1 }],
      visitors: [{ day: '2026-03-01', active: 3, new: 1 }],
      feedback: [{ day: '2026-03-01', up: 1, down: 0 }],
    },
    scoreHistogram: [{ bucket: 15, lo: 0.99, hi: 1.0, count: 4 }],
    topDocuments: [{ name: 'Wi-Fi', type: 'md', count: 4, avgScore: 0.94 }],
    languages: [{ language: 'fr', count: 10 }],
    errors: [{ code: 'ok', count: 10 }],
  }

  /**
   * VizDashboard mounts three self-fetching panels below the charts
   * (UnmatchedQuestions, ConversationBrowser, VisitorExplorer). EVERY read they
   * make has to be stubbed, not just the ones a given test asserts on: an
   * unstubbed call reaches the real `fetch`, which throws ERR_INVALID_URL on a
   * relative path in jsdom — the test still passes, but vitest reports an
   * unhandled error and exits non-zero, so `make test` fails with a green suite.
   */
  function stubEverything(overview = OVERVIEW) {
    vi.spyOn(labApi, 'analyticsOverview').mockResolvedValue(overview)
    vi.spyOn(labApi, 'analyticsUnmatched').mockResolvedValue({ items: [], total: 0 })
    vi.spyOn(labApi, 'analyticsConversations').mockResolvedValue({ items: [], total: 0 })
    vi.spyOn(labApi, 'analyticsConversation').mockResolvedValue(null)
    vi.spyOn(labApi, 'tables').mockResolvedValue([])
    vi.spyOn(labApi, 'table').mockResolvedValue({ name: 'visitors', columns: [], rows: [], rowCount: 0, truncated: false })
    vi.spyOn(labApi, 'tree').mockResolvedValue(null)
  }

  it('shows a loading line, then the whole dashboard', async () => {
    stubEverything()
    render(<VizDashboard />)

    expect(screen.getByText('Loading dashboard…')).toBeDefined()

    expect(await screen.findByText('Total requests')).toBeDefined()
    expect(screen.getByText('Daily volume')).toBeDefined()
    expect(screen.getByText('Daily visitors')).toBeDefined()
    expect(screen.getByText('Daily no-match')).toBeDefined()
    expect(screen.getByText('Retrieval scores')).toBeDefined()
    expect(screen.getByText('Top documents')).toBeDefined()
    expect(screen.getByText('Languages')).toBeDefined()
  })

  it('defaults to the last 7 days, Paris', async () => {
    stubEverything()
    const overview = vi.spyOn(labApi, 'analyticsOverview').mockResolvedValue(OVERVIEW)
    render(<VizDashboard />)

    expect(screen.getByText('Last 7 days · Paris days')).toBeDefined()
    await waitFor(() => expect(overview).toHaveBeenCalled())

    const args = lastCall(overview)
    expect(new Date(args.to).getTime() - new Date(args.from).getTime()).toBe(7 * 86400e3)
  })

  it('re-queries on a period change and relabels the header', async () => {
    stubEverything()
    render(<VizDashboard />)
    await screen.findByText('Total requests')

    await userEvent.click(screen.getByRole('radio', { name: 'All' }))

    expect(screen.getByText('All time · Paris days')).toBeDefined()
    await waitFor(() => expect(labApi.analyticsOverview).toHaveBeenCalledTimes(2))
  })

  it('tells the operator to check their session when the read is gated', async () => {
    // labApi returns null on a 401/404 rather than throwing, so the panel has to
    // name the likely cause itself — an expired /lab session.
    stubEverything()
    vi.spyOn(labApi, 'analyticsOverview').mockResolvedValue(null)

    render(<VizDashboard />)
    expect(await screen.findByText(/Check you’re still signed in/)).toBeDefined()
  })

  it('still renders the three browse sections when the overview failed', async () => {
    stubEverything()
    vi.spyOn(labApi, 'analyticsOverview').mockResolvedValue(null)

    render(<VizDashboard />)
    await screen.findByText(/Check you’re still signed in/)

    expect(screen.getByText('Gaps in the base')).toBeDefined()
    expect(screen.getByText('Browse')).toBeDefined()
    expect(screen.getByText('By visitor')).toBeDefined()
  })
})
