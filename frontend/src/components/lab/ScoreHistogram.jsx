import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { ChartCard, VizTooltip } from './VizChrome'
import { axisProps, C, GRID } from './vizKit'

/**
 * Distribution of retrieval scores (`message_documents.score`) over 15 fixed
 * 0.01-wide bins. One series → no legend; the title names it.
 *
 * @param {{ bins: Array<{ bucket: number, lo: number, hi: number, count: number }> }} props
 */
export default function ScoreHistogram({ bins }) {
  const data = (bins || []).map((b) => ({
    ...b,
    label: b.lo.toFixed(2).replace(/^0/, ''), // .89
  }))
  const empty = data.length === 0 || data.every((b) => b.count === 0)

  return (
    <ChartCard title="Retrieval scores" hint="Cosine score of every returned document" empty={empty}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -8 }} barCategoryGap={2}>
          <CartesianGrid stroke={GRID} strokeOpacity={0.5} vertical={false} />
          <XAxis dataKey="label" interval={0} minTickGap={0} {...axisProps} />
          <YAxis allowDecimals={false} width={44} {...axisProps} />
          <Tooltip
            content={<VizTooltip />}
            cursor={{ fill: GRID, fillOpacity: 0.25 }}
          />
          <Bar dataKey="count" name="documents" fill={C.bar} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
