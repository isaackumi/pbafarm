import { usePaginatedQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { Button, EmptyState, LoadingState } from '../ui'
import { useT } from '../../lib/i18n/context'
import { formatDateTime } from '../../lib/format'

const TONE = {
  succeeded: 'bg-emerald-50 text-emerald-800',
  partial: 'bg-amber-50 text-amber-900',
  failed: 'bg-red-50 text-red-800',
  retrying: 'bg-amber-50 text-amber-900',
  skipped: 'bg-foam text-muted',
  queued: 'bg-foam text-muted',
  running: 'bg-foam text-muted',
}

/** Delivery log of scheduled and "send now" reports (ANLY-007), newest first. */
export default function DeliveryLog() {
  const t = useT()
  const { results, status, loadMore } = usePaginatedQuery(api.reportSchedules.deliveries, {}, { initialNumItems: 20 })
  if (status === 'LoadingFirstPage') return <LoadingState />
  if (!results.length) {
    return <EmptyState title={t('reportBuilder.log.emptyTitle')} description={t('reportBuilder.log.emptyBody')} />
  }
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-foam-deep">
        <table className="min-w-full text-sm">
          <thead className="bg-foam text-left">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">{t('reportBuilder.log.when')}</th>
              <th scope="col" className="px-3 py-2 font-medium">{t('reportBuilder.log.report')}</th>
              <th scope="col" className="px-3 py-2 font-medium">{t('reportBuilder.log.status')}</th>
              <th scope="col" className="px-3 py-2 font-medium">{t('reportBuilder.log.recipients')}</th>
            </tr>
          </thead>
          <tbody>
            {results.map((d) => (
              <tr key={d._id} className="border-t border-foam-deep align-top">
                <td className="px-3 py-2 whitespace-nowrap">
                  {formatDateTime(d.createdAt)}
                  <span className="block text-xs text-muted">
                    {d.trigger === 'manual' ? t('reportBuilder.log.manual') : t('reportBuilder.log.scheduled')}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {d.reportName}
                  {d.rangeFrom && d.rangeTo && (
                    <span className="block text-xs text-muted">
                      {t('reportBuilder.result.period', { from: d.rangeFrom, to: d.rangeTo })}
                    </span>
                  )}
                  {d.rowCount !== undefined && (
                    <span className="block text-xs text-muted">
                      {t('reportBuilder.result.rows', { count: d.rowCount })}
                      {d.truncated ? ` · ${t('reportBuilder.log.truncated')}` : ''}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${TONE[d.status] ?? ''}`}>
                    {t(`reportBuilder.status.${d.status}`)}
                  </span>
                  {d.attempts > 1 && <span className="block text-xs text-muted">{t('reportBuilder.log.attempts', { count: d.attempts })}</span>}
                  {d.status === 'retrying' && d.nextAttemptAt && (
                    <span className="block text-xs text-muted">
                      {t('reportBuilder.log.nextAttempt', { when: formatDateTime(d.nextAttemptAt) })}
                    </span>
                  )}
                  {d.error && <span className="block max-w-xs text-xs text-red-800">{d.error}</span>}
                </td>
                <td className="px-3 py-2">
                  <ul className="space-y-0.5">
                    {d.recipients.map((r, i) => (
                      <li key={i} className="text-xs">
                        {r.to || '—'}: {t(`reportBuilder.recipientStatus.${r.status}`)}
                        {r.error && <span className="text-muted"> ({r.error})</span>}
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {status === 'CanLoadMore' && (
        <Button variant="secondary" onClick={() => loadMore(20)}>
          {t('reportBuilder.log.more')}
        </Button>
      )}
    </div>
  )
}
