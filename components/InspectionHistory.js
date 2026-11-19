import { INSPECTION_KINDS } from './InspectionForm'
import TraceTimeline from './trace/TraceTimeline'
import { formatDate } from '../lib/format'
import { useLocale, useT } from '../lib/i18n/context'

const RESULT_TONE = { ok: 'good', needs_attention: 'warn', failed: 'alert' }
const RESULT_TEXT = { good: 'text-good', warn: 'text-warn', alert: 'text-alert' }

/** List of inspections and maintenance jobs, newest first, as the Paper 26 timeline. */
export default function InspectionHistory({ rows, showUnit = false }) {
  const t = useT()
  const { locale } = useLocale()
  if (!rows) return <p className="p-5 text-[13px] leading-[18px] text-muted">{t('ui.loading')}</p>
  if (!rows.length) return <p className="p-5 text-[13px] leading-[18px] text-muted">{t('tracePage.inspection.empty')}</p>
  return (
    <div className="p-5">
      <TraceTimeline
        label={t('tracePage.inspection.label')}
        items={rows.map((r) => {
          const faults = (r.checklist || []).filter((c) => !c.ok)
          const tone = RESULT_TONE[r.result] || 'neutral'
          const kind = INSPECTION_KINDS.find((k) => k.value === r.kind)
          return {
            key: r._id,
            tone,
            label: t.or(`tracePage.inspection.kind.${r.kind}`, kind?.label || r.kind),
            title: (
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  {[formatDate(r.date, { locale }), r.equipmentName, showUnit ? r.unitName : null].filter(Boolean).join(' · ')}
                </span>
                <span className={`text-[13px] font-normal ${RESULT_TEXT[tone] || 'text-muted'}`}>
                  {t.or(`tracePage.inspection.result.${r.result}`, r.result)}
                </span>
              </span>
            ),
            sub: [
              faults.length ? t('tracePage.inspection.faults', { list: faults.map((c) => `${c.item}${c.note ? ` (${c.note})` : ''}`).join('; ') }) : null,
              r.findings,
              r.nextDueOn ? t('tracePage.inspection.nextDue', { date: formatDate(r.nextDueOn, { locale }) }) : null,
            ]
              .filter(Boolean)
              .join(' · ') || null,
          }
        })}
      />
    </div>
  )
}
