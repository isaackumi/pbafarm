import { usePaginatedQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { Button, EmptyState, LoadingState, Pill } from '../ui'
import { useT } from '../../lib/i18n/context'
import { formatDateTime } from '../../lib/format'

/** Paper 11 "Recent exports" format chips: outlined pills in the status tone. */
const TONE = {
  succeeded: 'green',
  partial: 'amber',
  failed: 'red',
  retrying: 'amber',
  skipped: 'neutral',
  queued: 'neutral',
  running: 'neutral',
}

/** Paper 11 column heads: 11/14 uppercase, 0.08em, faint. */
const TH = 'py-3 text-left text-[11px] font-normal uppercase leading-[14px] tracking-[0.08em] text-faint'
const TD = 'py-[14px] align-top text-[14px] leading-[18px] text-text'
const SUB = 'mt-[2px] block text-xs leading-4 text-muted'

/** Delivery log of scheduled and "send now" reports (ANLY-007), newest first. */
export default function DeliveryLog() {
  const t = useT()
  const { results, status, loadMore } = usePaginatedQuery(api.reportSchedules.deliveries, {}, { initialNumItems: 20 })
  if (status === 'LoadingFirstPage') return <LoadingState />
  if (!results.length) {
    return <EmptyState title={t('reportBuilder.log.emptyTitle')} description={t('reportBuilder.log.emptyBody')} />
  }
  return (
    <div className="flex flex-col gap-3">
      <section
        aria-labelledby="delivery-log-title"
        className="flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-[var(--shadow-card)]"
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-5">
          <h2 id="delivery-log-title" className="text-[17px] font-semibold leading-[22px] text-text">
            {t('reportBuilder.log.title')}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr>
                <th scope="col" className={`${TH} pl-6 pr-3`}>{t('reportBuilder.log.report')}</th>
                <th scope="col" className={`${TH} w-[180px] px-3`}>{t('reportBuilder.log.range')}</th>
                <th scope="col" className={`${TH} w-[120px] px-3`}>{t('reportBuilder.log.status')}</th>
                <th scope="col" className={`${TH} px-3`}>{t('reportBuilder.log.recipients')}</th>
                <th scope="col" className={`${TH} w-[160px] pl-3 pr-6 text-right`}>{t('reportBuilder.log.when')}</th>
              </tr>
            </thead>
            <tbody>
              {results.map((d) => (
                <tr key={d._id} className="border-t border-line">
                  <td className={`${TD} pl-6 pr-3`}>
                    {d.reportName}
                    {d.rowCount !== undefined && (
                      <span className={SUB}>
                        {t('reportBuilder.result.rows', { count: d.rowCount })}
                        {d.truncated ? ` · ${t('reportBuilder.log.truncated')}` : ''}
                      </span>
                    )}
                  </td>
                  <td className={`${TD} whitespace-nowrap px-3`}>
                    {d.rangeFrom && d.rangeTo ? t('reportBuilder.result.period', { from: d.rangeFrom, to: d.rangeTo }) : '—'}
                  </td>
                  <td className={`${TD} px-3`}>
                    <Pill tone={TONE[d.status] ?? 'neutral'}>{t(`reportBuilder.status.${d.status}`)}</Pill>
                    {d.attempts > 1 && <span className={SUB}>{t('reportBuilder.log.attempts', { count: d.attempts })}</span>}
                    {d.status === 'retrying' && d.nextAttemptAt && (
                      <span className={SUB}>{t('reportBuilder.log.nextAttempt', { when: formatDateTime(d.nextAttemptAt) })}</span>
                    )}
                    {d.error && <span className="mt-[2px] block max-w-xs text-xs leading-4 text-alert">{d.error}</span>}
                  </td>
                  <td className={`${TD} px-3`}>
                    <ul className="flex flex-col gap-[2px]">
                      {d.recipients.map((r, i) => (
                        <li key={i} className="text-xs leading-4 text-muted">
                          <span className="text-text">{r.to || '—'}</span>: {t(`reportBuilder.recipientStatus.${r.status}`)}
                          {r.error && <span> ({r.error})</span>}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className={`${TD} whitespace-nowrap pl-3 pr-6 text-right`}>
                    {formatDateTime(d.createdAt)}
                    <span className={SUB}>
                      {d.trigger === 'manual' ? t('reportBuilder.log.manual') : t('reportBuilder.log.scheduled')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {status === 'CanLoadMore' && (
        <Button variant="secondary" onClick={() => loadMore(20)}>
          {t('reportBuilder.log.more')}
        </Button>
      )}
    </div>
  )
}
