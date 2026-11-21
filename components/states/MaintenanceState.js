import { useT } from '../../lib/i18n/context'
import { backByTime } from '../../lib/maintenanceMode'
import { STATE_GHOST, SystemCard, SystemPage } from './StateCard'

function WrenchGlyph() {
  return (
    <span className="inline-flex size-16 shrink-0 items-center justify-center rounded-full border border-[var(--warn-tint-border)] text-warn" aria-hidden>
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" />
      </svg>
    </span>
  )
}

/**
 * Paper 62 maintenance card (HMM-0 / KRK-0): wrench ring, "Back by HH:MM
 * GMT", the admin's message or the default copy, and "Status page" when
 * STATUS_PAGE_URL is set.
 */
export function MaintenanceCard({ endsAt, message, statusPageUrl, className = '' }) {
  const t = useT()
  return (
    <SystemCard className={`min-h-[340px] ${className}`}>
      <WrenchGlyph />
      <div role="status" className="flex flex-col items-center gap-2">
        <h1 className="text-[20px] font-semibold leading-[26px] tracking-[-0.02em] text-text">
          {t('systemStates.maintenance.backBy', { time: backByTime(endsAt) })}
        </h1>
        <p className="max-w-sm text-[14px] leading-5 text-muted">{message || t('systemStates.maintenance.body')}</p>
      </div>
      {statusPageUrl && (
        <a href={statusPageUrl} target="_blank" rel="noopener noreferrer" className={STATE_GHOST}>
          {t('systemStates.maintenance.statusPage')}
        </a>
      )}
    </SystemCard>
  )
}

/** Full-page maintenance screen shown to members while the window is open. */
export default function MaintenanceState(props) {
  return (
    <SystemPage>
      <MaintenanceCard {...props} />
    </SystemPage>
  )
}
