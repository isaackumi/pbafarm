import { Pill, StatusDot } from './ui'
import { useT } from '../lib/i18n/context'

const DOT = { approved: 'good', pending_approval: 'warn', rejected: 'alert', reversed: 'alert' }
/** Paper 06 type pills: stocking sky (#1F3E6E edge), transfer lime (#4A5A1C edge), top-up neutral. */
const TYPE_CLASS = {
  stocking: '!border-[#1F3E6E] !text-sky-ink',
  fish_transfer: '!border-[#4A5A1C] !text-lime-ink',
  transfer: '!border-[#4A5A1C] !text-lime-ink',
}
const TYPE_KEY = { stocking: 'stocking', fish_transfer: 'transfer', transfer: 'transfer', topup: 'topup' }

/** Status of a stocking, top-up or transfer: dot + label (Paper 06 history table). */
export default function MovementStatus({ status, reversed = false }) {
  const t = useT()
  const key = reversed ? 'reversed' : status
  const label = DOT[key] ? t(`stocking.status.${key}`) : String(status || '—').replace(/_/g, ' ')
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-[13px] leading-4 text-muted">
      <StatusDot tone={DOT[key] || 'neutral'} />
      {label}
    </span>
  )
}

/** Movement kind pill: stocking sky, transfer lime, top-up neutral. */
export function MovementTypePill({ type }) {
  const t = useT()
  return (
    <Pill tone="neutral" className={TYPE_CLASS[type] || ''}>
      {t(`stocking.type.${TYPE_KEY[type] || 'stocking'}`)}
    </Pill>
  )
}
