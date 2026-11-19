/**
 * Pie for the Cages page, loaded through next/dynamic so recharts stays off
 * the page's first load (MOBILE-008).
 */
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import { TOOLTIP } from './chartTheme'

export default function CagePieChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={80}
          innerRadius={52}
          stroke="var(--surface)"
          strokeWidth={2}
          label={({ name, percent, value }) =>
            value > 0 ? `${name} ${(percent * 100).toFixed(0)}%` : null
          }
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip {...TOOLTIP} />
        <Legend wrapperStyle={{ fontSize: 12, color: 'var(--muted)' }} />
      </PieChart>
    </ResponsiveContainer>
  )
}
