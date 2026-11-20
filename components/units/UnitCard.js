import Link from 'next/link'
import { StatusDot } from '../ui'
import { useT } from '../../lib/i18n/context'
import { daysBetween, unitLabel } from '../../lib/format'

const IDLE = new Set(['fallow', 'empty', 'harvested'])

/**
 * Paper 02 bar fill: #1562D6 → #8EC2F7 (dark), → #5FA0EE (L · 02). Also the
 * fill of the 04 round progress and the 08 size-grade bars.
 */
export const BAR_FILL =
  'bg-[linear-gradient(in_oklab_90deg,#1562D6_0%,#8EC2F7_100%)] [html[data-theme=light]_&]:bg-[linear-gradient(in_oklab_90deg,#1562D6_0%,#5FA0EE_100%)]'

/** Paper 02 biomass: one decimal ("12.4 t", "9.4 t"), two under a tonne ("0.36 t"). */
export function formatBiomassT(t) {
  return `${t < 1 ? t.toFixed(2) : t.toFixed(1)} t`
}

/** Biomass in tonnes from the board's fish count and ABW (grams). */
export function unitBiomassT(u) {
  return u.fish > 0 && u.abwG ? (u.fish * u.abwG) / 1e6 : null
}

/**
 * One status line for a unit: the most urgent signal wins (water breach,
 * over density, overdue maintenance), then the latest DO, then the status.
 * `alert` marks units counted by "Alerts only".
 */
export function unitSignal(u, wq, today, t) {
  const overdue = Boolean(u.nextMaintenanceDate && u.nextMaintenanceDate < today)
  const doValue = wq?.values?.dissolvedOxygen
  if (wq?.breachCount) {
    return {
      tone: 'alert',
      alert: true,
      text: doValue != null ? t('unitsUi.signal.doLow', { value: doValue }) : t('unitsUi.signal.outOfRange'),
    }
  }
  if (u.densityLevel === 'over') return { tone: 'warn', alert: true, text: t('unitsUi.signal.overDensity') }
  if (overdue) return { tone: 'warn', alert: true, text: t('unitsUi.signal.maintenanceOverdue') }
  if (IDLE.has(u.status)) return { tone: 'neutral', alert: false, text: t.or(`unitsUi.status.${u.status}`, u.statusLabel) }
  if (u.status === 'maintenance') return { tone: 'warn', alert: false, text: t.or('unitsUi.status.maintenance', u.statusLabel) }
  if (doValue != null) return { tone: 'good', alert: false, text: t('unitsUi.signal.do', { value: doValue }) }
  return { tone: 'neutral', alert: false, text: t.or(`unitsUi.status.${u.status}`, u.statusLabel) }
}

/** Unit card (Paper 02 Cages): name, species, status dot, biomass, density bar. */
export default function UnitCard({ u, wq, today }) {
  const t = useT()
  const signal = unitSignal(u, wq, today, t)
  const biomass = unitBiomassT(u)
  const idle = IDLE.has(u.status)
  const pct = Math.max(0, Math.min(100, u.densityPct ?? 0))
  const over = u.densityLevel === 'over'
  // Paper 02: "Tilapia · Day 84" while stocked, the status ("Fallow") when idle.
  const kind = u.species || unitLabel(u.unitType)
  const subtitle = idle
    ? t.or(`unitsUi.status.${u.status}`, u.statusLabel)
    : u.stockingDate
      ? t('unitsUi.speciesDay', { species: kind, day: daysBetween(u.stockingDate, today) })
      : kind
  // Idle: the subtitle already names the status, so the chip names the unit type (no cleaning note in the data).
  const chipText = idle && signal.tone === 'neutral' ? unitLabel(u.unitType) : signal.text
  return (
    <Link
      href={`/cages/${u._id}`}
      className={`flex w-full flex-col gap-[14px] rounded-[16px] border bg-surface p-[18px] transition-colors hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan sm:w-[266px] ${
        signal.tone === 'alert' ? 'border-[var(--unit-alert-border)]' : 'border-line'
      } ${idle ? 'opacity-55' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-[3px]">
          <span className="truncate text-[17px] font-semibold leading-[22px] tracking-[-0.01em] text-text">{u.name}</span>
          <span className="truncate text-xs leading-4 text-muted">{subtitle}</span>
        </div>
        <span className="flex shrink-0 items-center gap-[6px]">
          <StatusDot tone={signal.tone} size={7} />
          <span className="text-xs leading-4 text-muted">{chipText}</span>
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[24px] font-semibold leading-[30px] tracking-[-0.02em] text-text tabular-nums">
          {biomass != null ? formatBiomassT(biomass) : '—'}
        </span>
        <span className="text-xs leading-4 tabular-nums text-muted">
          {u.density != null ? `${u.density} ${u.densityUnit}` : '—'}
        </span>
      </div>
      <div
        className="flex h-1 shrink-0 rounded-pill bg-line-strong"
        role="meter"
        aria-label={t('unitsUi.densityOfLimit')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div className={`h-1 rounded-pill ${over ? 'bg-dot-warn' : BAR_FILL}`} style={{ width: `${over ? 100 : pct}%` }} />
      </div>
    </Link>
  )
}
