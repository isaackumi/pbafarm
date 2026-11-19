import { Pill, StatusDot } from './ui'
import { useT } from '../lib/i18n/context'

const DOT = { approved: 'good', pending_approval: 'warn', rejected: 'alert', reversed: 'alert' }
const TYPE_TONE = { stocking: 'cyan', fish_transfer: 'pink', transfer: 'pink', topup: 'neutral' }
const TYPE_KEY = { stocking: 'stocking', fish_transfer: 'transfer', transfer: 'transfer', topup: 'topup' }

/** Status of a stocking, top-up or transfer: dot + label (Paper 06 history table). */
export default function MovementStatus({ status, reversed = false }) {
  const t = useT()
  const key = reversed ? 'reversed' : status
  const label = DOT[key] ? t(`stocking.status.${key}`) : String(status || '—').replace(/_/g, ' ')
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-muted">
      <StatusDot tone={DOT[key] || 'neutral'} />
      {label}
    </span>
  )
}

/** Movement kind pill: stocking cyan, transfer pink, top-up neutral. */
export function MovementTypePill({ type }) {
  const t = useT()
  return <Pill tone={TYPE_TONE[type] || 'neutral'}>{t(`stocking.type.${TYPE_KEY[type] || 'stocking'}`)}</Pill>
}
