import { useState } from 'react'
import Link from 'next/link'
import { MessageCircle } from 'lucide-react'
import { useOptionalQuery } from '../../hooks/useOptionalQuery'
import { api } from '../../convex/_generated/api'
import { Avatar } from '../ui'
import { localToday } from '../../lib/format'
import { useLocale, useT } from '../../lib/i18n/context'
import { shortDate } from '../../lib/keepers'

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'

/** wa.me wants the number in digits only. */
function waLink(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  return digits ? `https://wa.me/${digits}` : null
}

/**
 * Who keeps this unit (cage detail): keeper, backup, since when, who covers
 * today, a WhatsApp link for managers, and the history of keepers.
 */
export default function KeeperChip({ unitId }) {
  const t = useT()
  const { formatLocale, locale } = useLocale()
  const lang = formatLocale || locale
  const data = useOptionalQuery(api.keepers.views.forUnit, unitId ? { unitId, asOf: localToday() } : 'skip', null)
  const [showHistory, setShowHistory] = useState(false)
  if (!data) return null
  const k = data.keeper
  const wa = waLink(data.cover?.person?.phone || k?.phone)

  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-line bg-surface px-4 py-3" aria-label={t('keepers.chip.label')}>
      <div className="flex flex-wrap items-center gap-3">
        {k ? (
          <>
            <Avatar name={k.name} size={28} />
            <div className="flex min-w-0 flex-col">
              <span className="text-sm font-semibold text-text">
                {t('keepers.chip.keeper', { name: k.name })}
                {data.backup && <span className="font-normal text-muted"> · {t('keepers.chip.backup', { name: data.backup.name })}</span>}
              </span>
              <span className="text-xs text-muted">
                {data.cover
                  ? t('keepers.chip.covered', { name: data.cover.person?.name || '', date: shortDate(data.cover.toDate, lang) })
                  : t('keepers.chip.since', { date: shortDate(data.sinceDate, lang) })}
              </span>
            </div>
          </>
        ) : (
          <span className="flex items-center gap-2 text-sm font-semibold text-alert">
            <span className="size-[10px] rounded-[2px] ring-[1.5px] ring-inset ring-alert" aria-hidden />
            {t('keepers.chip.none')}
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-1.5 text-xs font-semibold text-cover hover:underline ${FOCUS}`}>
              <MessageCircle size={14} aria-hidden />
              {t('keepers.chip.whatsapp')}
            </a>
          )}
          {data.history.length > 0 && (
            <button type="button" onClick={() => setShowHistory((s) => !s)} aria-expanded={showHistory} className={`text-xs text-muted hover:text-text ${FOCUS}`}>
              {t('keepers.chip.history', { count: data.history.length })}
            </button>
          )}
          {data.canManage && (
            <Link href="/cage-keepers" className={`text-xs font-semibold text-cover hover:underline ${FOCUS}`}>
              {k ? t('keepers.chip.change') : t('keepers.chip.assign')}
            </Link>
          )}
        </div>
      </div>
      {showHistory && (
        <ol className="flex flex-col gap-1 border-t border-line pt-2 text-xs text-muted">
          {data.history.map((h) => (
            <li key={h.id} className="flex flex-wrap gap-x-2">
              <span className="font-semibold text-text">{h.keeper}</span>
              <span>
                {h.untilDate
                  ? t('keepers.chip.range', { from: shortDate(h.sinceDate, lang), to: shortDate(h.untilDate, lang) })
                  : t('keepers.chip.since', { date: shortDate(h.sinceDate, lang) })}
              </span>
              {h.backup && <span>· {t('keepers.chip.backup', { name: h.backup })}</span>}
              <span className="text-faint">· {t('keepers.chip.by', { name: h.assignedBy })}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
