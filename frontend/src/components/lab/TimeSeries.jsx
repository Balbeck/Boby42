import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { ChartCard, MiniLegend, VizTooltip } from './VizChrome'
import { axisProps, GRID, shortDay } from './vizKit'

/**
 * One reusable day-indexed line chart, used for daily visitors, daily volume,
 * daily no-match and the feedback ratio. The x-axis is continuous — the series
 * are gap-filled server-side, so a quiet day is a real `0` point.
 *
 * @param {{
 *   title: string,
 *   hint?: string,
 *   data: Array<Record<string, any>>,
 *   series: Array<{ key: string, label: string, color: string }>,
 *   valueFormat?: (v: number) => string,
 *   yDomain?: [number | string, number | string]
 * }} props
 */
export default function TimeSeries({ title, hint, data, series, valueFormat, yDomain }) {
  const empty =
    !data ||
    data.length === 0 ||
    data.every((d) => series.every((s) => d[s.key] == null || d[s.key] === 0))

  return (
    <ChartCard
      title={title}
      hint={hint}
      empty={empty}
      legend={<MiniLegend items={series.map((s) => ({ label: s.label, color: s.color }))} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid stroke={GRID} strokeOpacity={0.5} vertical={false} />
          <XAxis dataKey="day" tickFormatter={shortDay} minTickGap={24} {...axisProps} />
          <YAxis
            allowDecimals={false}
            width={44}
            domain={yDomain}
            tickFormatter={valueFormat}
            {...axisProps}
          />
          <Tooltip
            content={<VizTooltip valueFormat={valueFormat} />}
            cursor={{ stroke: GRID }}
          />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
