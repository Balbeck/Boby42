// @ts-nocheck — the /lab payloads (labApi.table/tree/analytics*) arrive untyped
// from the backend; writing typedefs for them is a task of its own, and /lab is a
// single-user, password-gated admin page. Drop this line when they get typed.
import { useEffect, useState } from 'react'
import * as labApi from '../../services/labApi'
import { C, windowFor } from './vizKit'
import { SectionLabel } from './VizChrome'
import PeriodSelect from './PeriodSelect'
import StatTiles from './StatTiles'
import TimeSeries from './TimeSeries'
import ScoreHistogram from './ScoreHistogram'
import TopDocuments from './TopDocuments'
import Breakdowns from './Breakdowns'
import UnmatchedQuestions from './UnmatchedQuestions'
import ConversationBrowser from './ConversationBrowser'
import VisitorExplorer from './VisitorExplorer'

const ERR = 'text-[#cf9186]'

/**
 * The 🔬 tab: a usage dashboard (period selector → counter tiles + charts) plus
 * the unmatched-questions list and the admin-wide conversation browser.
 *
 * `analyticsOverview` is one call per window; the unmatched list follows the
 * same period; the conversation browser is fully independent. English-only.
 *
 * The overview payload still carries `daily.feedback` — the 👍/👎 tiles cover it
 * for now, so it isn't charted (re-adding a feedback line is one <TimeSeries>).
 */
export default function VizDashboard() {
  const [range, setRange] = useState(() => windowFor('7'))
  // { key, value } — value is 'error' or the payload; a key mismatch = loading.
  const [res, setRes] = useState(null)

  const key = `${range.from}|${range.to}`

  useEffect(() => {
    let cancelled = false
    labApi
      .analyticsOverview({ from: range.from, to: range.to })
      .then((v) => !cancelled && setRes({ key: `${range.from}|${range.to}`, value: v ?? 'error' }))
    return () => {
      cancelled = true
    }
  }, [range.from, range.to])

  const overview = res && res.key === key ? res.value : null

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="sticky top-14 z-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-chat-border bg-chat-bg/85 px-4 py-2.5 backdrop-blur">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-medium text-chat-text">Usage</h2>
          <p className="text-xs text-chat-text-muted">
            {range.key === 'all' ? 'All time' : `Last ${range.key} days`} · Paris days
          </p>
        </div>
        <PeriodSelect value={range.key} onChange={setRange} />
      </header>

      {overview === null && <p className="text-sm text-chat-text-muted">Loading dashboard…</p>}
      {overview === 'error' && (
        <p className={`text-sm ${ERR}`}>Couldn’t load analytics. Check you’re still signed in.</p>
      )}

      {overview && overview !== 'error' && (
        <>
          <StatTiles totals={overview.totals} />

          <section className="flex flex-col gap-3">
            <SectionLabel>Trends</SectionLabel>
            <div className="grid gap-4 lg:grid-cols-2">
              <TimeSeries
                title="Daily volume"
                hint="Exchanges per day"
                data={overview.daily.volume}
                series={[
                  { key: 'total', label: 'total', color: C.total },
                  { key: 'chat', label: 'chat', color: C.chat },
                  { key: 'archiviste', label: 'archiviste', color: C.archiviste },
                ]}
              />
              <TimeSeries
                title="Daily visitors"
                hint="Active that day vs first seen that day"
                data={overview.daily.visitors}
                series={[
                  { key: 'active', label: 'active', color: C.active },
                  { key: 'new', label: 'new', color: C.new },
                ]}
              />
              <TimeSeries
                title="Daily no-match"
                hint="Exchanges that returned zero documents"
                data={overview.daily.volume}
                series={[{ key: 'noMatch', label: 'no-match', color: C.noMatch }]}
              />
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <SectionLabel>Retrieval</SectionLabel>
            <div className="grid gap-4 lg:grid-cols-2">
              <ScoreHistogram bins={overview.scoreHistogram} />
              <TopDocuments docs={overview.topDocuments} />
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <SectionLabel>Mix</SectionLabel>
            <Breakdowns languages={overview.languages} errors={overview.errors} />
          </section>
        </>
      )}

      <section className="flex flex-col gap-3">
        <SectionLabel>Gaps in the base</SectionLabel>
        {/* remount on a period change so pagination resets to the first page */}
        <UnmatchedQuestions key={key} range={range} />
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>Browse</SectionLabel>
        <ConversationBrowser />
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>By visitor</SectionLabel>
        <VisitorExplorer />
      </section>
    </div>
  )
}
