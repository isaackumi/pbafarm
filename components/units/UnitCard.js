import Link from 'next/link'
import { StatusDot } from '../ui'
import { useT } from '../../lib/i18n/context'
import { unitLabel } from '../../lib/format'

const IDLE = new Set(['fallow', 'empty', 'harvested'])

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
  return (
    <Link
      href={`/cages/${u._id}`}
      className={`flex w-full flex-col gap-[14px] rounded-[16px] border bg-surface p-[18px] transition-colors hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan sm:w-[266px] ${
        signal.tone === 'alert' ? 'border-[var(--pill-red-border)]' : 'border-line'
      } ${idle ? 'opacity-55' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-[3px]">
          <span className="truncate text-[17px] font-semibold leading-[22px] tracking-[-0.01em] text-text">{u.name}</span>
          <span className="truncate text-xs leading-4 text-muted">{u.species || unitLabel(u.unitType)}</span>
        </div>
        <span className="flex shrink-0 items-center gap-[6px]">
          <StatusDot tone={signal.tone} size={7} />
          <span className="text-xs leading-4 text-muted">{signal.text}</span>
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[24px] font-semibold leading-[30px] tracking-[-0.02em] text-text tabular-nums">
          {biomass != null ? `${biomass < 10 ? biomass.toFixed(2) : biomass.toFixed(1)} t` : '—'}
        </span>
        <span className={`text-xs leading-4 tabular-nums ${over ? 'text-warn' : 'text-muted'}`}>
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
        <div
          className={`h-1 rounded-pill ${over ? 'bg-warn' : ''}`}
          style={{ width: `${over ? 100 : pct}%`, backgroundImage: over ? undefined : 'var(--gradient-bar)' }}
        />
      </div>
    </Link>
  )
}
