/**
 * Chart of a report result, loaded through next/dynamic so recharts stays off
 * the page's first load (MOBILE-008).
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const COLORS = ['#0f766e', '#2563eb', '#d97706', '#7c3aed', '#dc2626', '#059669', '#db2777', '#4b5563']

export default function ReportChart({ type, data, label, format }) {
  const tooltip = <Tooltip formatter={(v) => [format(v), label]} />
  if (type === 'pie') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" outerRadius="80%" label={({ name }) => name}>
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          {tooltip}
        </PieChart>
      </ResponsiveContainer>
    )
  }
  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
      <XAxis dataKey="name" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
      <YAxis tick={{ fontSize: 12 }} width={70} tickFormatter={(v) => format(v)} />
      {tooltip}
    </>
  )
  return (
    <ResponsiveContainer width="100%" height="100%">
      {type === 'line' ? (
        <LineChart data={data}>
          {axes}
          <Line type="monotone" dataKey="value" stroke={COLORS[0]} strokeWidth={2} dot={false} name={label} />
        </LineChart>
      ) : (
        <BarChart data={data}>
          {axes}
          <Bar dataKey="value" fill={COLORS[0]} name={label} />
        </BarChart>
      )}
    </ResponsiveContainer>
  )
}
