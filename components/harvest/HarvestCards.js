import Link from 'next/link'
import { ProgressBar, StatusDot } from '../ui'
import { formatDate, formatNumber } from '../../lib/format'
import { gradeShares } from '../../lib/harvestView'
import { useLocale, useT } from '../../lib/i18n/context'

const CARD = 'flex min-w-0 flex-col rounded-card border border-line bg-surface px-[26px] py-6 shadow-[var(--shadow-card)]'

/** Kilograms as "4.73 t" from one tonne up, else "820 kg". */
export function formatKg(kg, locale) {
  const n = Number(kg)
  if (!Number.isFinite(n)) return '—'
  return n >= 1000
    ? `${formatNumber(n / 1000, { locale, decimals: 2 })} t`
    : `${formatNumber(n, { locale, decimals: n % 1 ? 1 : 0 })} kg`
}

/** Paper 08: the newest graded harvest's size grades as gradient bars. */
export function SizeGradesCard({ record, className = '' }) {
  const t = useT()
  const { locale } = useLocale()
  const grades = gradeShares(record)
  return (
    <section className={`${CARD} gap-[18px] ${className}`} aria-labelledby="harvest-grades-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="harvest-grades-title" className="text-[15px] font-semibold leading-[18px] text-text">
          {record
            ? t('harvestPage.grades.titleFor', { cage: record.cage?.name || '—' })
            : t('harvestPage.grades.title')}
        </h2>
        {record && (
          <span className="text-xs leading-4 text-muted tabular-nums">
            {formatKg(record.total_weight, locale)}
            {record.estimated_count
              ? ` · ${t('harvestPage.grades.fish', { count: record.estimated_count, n: formatNumber(record.estimated_count, { locale }) })}`
              : ''}
            {` · ${formatDate(record.harvest_date, { locale })}`}
          </span>
        )}
      </div>
      {grades.length === 0 ? (
        <p className="text-[14px] leading-[18px] text-muted">{t('harvestPage.grades.empty')}</p>
      ) : (
        grades.map((g) => (
          <div key={g.key} className="flex items-center gap-4">
            <div className="w-[110px] shrink-0 text-[13px] leading-4 text-muted">
              {g.key}
              {g.range ? <span className="text-faint"> {g.range}</span> : null}
            </div>
            <ProgressBar
              value={g.pct}
              label={t('harvestPage.grades.barLabel', { grade: g.key, pct: g.pct })}
              className="h-[10px] grow basis-0"
            />
            <div className="w-[70px] shrink-0 text-right text-[14px] leading-[18px] text-text tabular-nums">{g.pct}%</div>
          </div>
        ))
      )}
    </section>
  )
}

/** Paper 08: cages at the harvest target weight, with withdrawal holds. */
export function ReadyToHarvestCard({ rows, loading, className = '' }) {
  const t = useT()
  const { locale } = useLocale()
  return (
    <section className={`${CARD} gap-1 ${className}`} aria-labelledby="harvest-ready-title">
      <div className="flex items-center justify-between pb-[10px]">
        <h2 id="harvest-ready-title" className="text-[15px] font-semibold leading-[18px] text-text">
          {t('harvestPage.ready.title')}
        </h2>
        <Link
          href="/cages/analytics/harvest"
          className="rounded text-xs leading-4 text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
        >
          {t('harvestPage.ready.viewAll')}
        </Link>
      </div>
      {loading ? (
        <p className="border-t border-line py-[11px] text-[14px] leading-[18px] text-muted">{t('ui.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="border-t border-line py-[11px] text-[14px] leading-[18px] text-muted">{t('harvestPage.ready.empty')}</p>
      ) : (
        <ul>
          {rows.slice(0, 5).map((r) => {
            const held = Boolean(r.holdUntil)
            return (
              <li key={r.id} className="flex items-center gap-[14px] border-t border-line py-[11px]">
                <StatusDot
                  tone={held ? 'warn' : 'good'}
                  size={7}
                  label={held ? t('harvestPage.ready.held') : t('harvestPage.ready.ready')}
                />
                <div className="flex min-w-0 grow basis-0 flex-col gap-[2px]">
                  <div className="truncate text-[14px] leading-[18px] text-text">
                    {r.species ? `${r.name} · ${r.species}` : r.name}
                  </div>
                  <div className="text-xs leading-4 text-muted">
                    {held
                      ? t('harvestPage.ready.inWithdrawal', { date: formatDate(r.holdUntil, { locale }) })
                      : [
                          r.abw ? `${formatNumber(r.abw, { locale })} g` : null,
                          r.doc != null ? t('harvestPage.ready.day', { n: r.doc }) : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                  </div>
                </div>
                <div className="shrink-0 text-[14px] font-medium leading-[18px] text-text tabular-nums">
                  {r.biomassKg ? formatKg(r.biomassKg, locale) : '—'}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
