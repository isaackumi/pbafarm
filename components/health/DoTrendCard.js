import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useLocale, useT } from '../../lib/i18n/context'

const dayLabel = (iso, locale) =>
  new Intl.DateTimeFormat(locale || undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${iso}T12:00:00Z`),
  )

/**
 * "Dissolved oxygen · 7 days" card (Paper 07): daily average (cyan) and the
 * lowest unit (alert red) from daily records, with the DO alert limit as a
 * dashed line.
 */
export default function DoTrendCard({ points, threshold, loading, className = '' }) {
  const t = useT()
  const { locale } = useLocale()
  const hasData = (points || []).some((p) => p.avg != null)
  const data = (points || []).map((p) => ({ ...p, label: dayLabel(p.date, locale) }))
  return (
    <section
      aria-labelledby="do-trend-title"
      className={`flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface px-[26px] py-6 shadow-[var(--shadow-card)] ${className}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="do-trend-title" className="text-[15px] font-semibold leading-[18px] text-text">
          {t('healthWater.doChart.title')}
        </h2>
        <span className="text-xs leading-4 text-muted">{t('healthWater.doChart.unit')}</span>
      </div>
      {loading ? (
        <div className="h-[170px] animate-pulse rounded-input bg-surface-2" aria-hidden />
      ) : !hasData ? (
        <p className="flex h-[170px] items-center justify-center text-sm text-muted">{t('healthWater.doChart.empty')}</p>
      ) : (
        <div className="h-[170px]" role="img" aria-label={t('healthWater.doChart.aria')}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                interval={0}
                tick={{ fill: 'var(--faint)', fontSize: 12 }}
                padding={{ left: 8, right: 8 }}
              />
              <YAxis hide domain={['dataMin - 1', 'dataMax + 1']} />
              <Tooltip
                cursor={{ stroke: 'var(--line-strong)' }}
                contentStyle={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--line)',
                  borderRadius: 12,
                  color: 'var(--text)',
                  fontSize: 12,
                }}
                labelStyle={{ color: 'var(--muted)' }}
                formatter={(v, name) => [`${v} mg/L`, name]}
              />
              {threshold != null && (
                <ReferenceLine y={threshold} stroke="var(--pill-red-border)" strokeDasharray="4 4" ifOverflow="extendDomain" />
              )}
              <Line
                type="monotone"
                dataKey="min"
                name={t('healthWater.doChart.lowest')}
                stroke="var(--alert)"
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="avg"
                name={t('healthWater.doChart.avg')}
                stroke="var(--cyan)"
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="flex flex-wrap gap-4 text-xs leading-4 text-muted">
        <span className="inline-flex items-center gap-2">
          <span className="h-[2px] w-3 rounded-pill bg-cyan" aria-hidden />
          {t('healthWater.doChart.avg')}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-[2px] w-3 rounded-pill bg-alert" aria-hidden />
          {t('healthWater.doChart.lowest')}
        </span>
        {threshold != null && (
          <span className="inline-flex items-center gap-2">
            <span className="w-3 border-t border-dashed border-[var(--pill-red-border)]" aria-hidden />
            {t('healthWater.doChart.threshold', { value: threshold })}
          </span>
        )}
      </div>
    </section>
  )
}
