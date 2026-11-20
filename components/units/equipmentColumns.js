import Link from 'next/link'
import { Pill } from '../ui'
import { EQUIPMENT_KINDS } from '../EquipmentForm'
import { daysBetween, getActiveLocale } from '../../lib/format'
import { useT } from '../../lib/i18n/context'

export const STATUS_PILL = {
  in_service: 'green',
  standby: 'neutral',
  faulty: 'red',
  under_maintenance: 'amber',
  retired: 'neutral',
}

/**
 * Paper 48 light pill borders (LAK-0): a shade darker than the shared light
 * pill tokens. Dark keeps the tokens, which match EWX-0.
 */
const LIGHT_BORDER = {
  red: '[[data-theme=light]_&]:border-[#F3B8B8]',
  amber: '[[data-theme=light]_&]:border-[#F1D39A]',
  green: '[[data-theme=light]_&]:border-[#A7DDB8]',
}

/** Paper 48 "1 finding": lime, #4A5A1C ring on dark; #4F6B00 on #C9DC7A on light. */
const LIME_PILL =
  'inline-flex items-center whitespace-nowrap rounded-pill border border-[#4A5A1C] px-3 py-1 text-[12px] leading-4 text-lime-ink [[data-theme=light]_&]:border-[#C9DC7A] [[data-theme=light]_&]:text-[#4F6B00]'

/** "Nov 12": Paper 48's month-and-day dates (the year only when it is not this year). */
export function shortDate(iso, today) {
  if (!iso) return '—'
  const d = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return String(iso)
  const sameYear = today && iso.slice(0, 4) === today.slice(0, 4)
  return new Intl.DateTimeFormat(getActiveLocale(), {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(d)
}

/**
 * Maintenance status of one piece of equipment (Paper 48 Status column):
 * overdue (days), due today, an open finding, calibrate soon (sensors due
 * within 7 days), due soon, OK; otherwise its registry status.
 */
export function equipmentStatus(e, asOf, findings = 0) {
  const due = e.nextMaintenanceDue
  if (e.status === 'retired') return { tone: 'neutral', key: 'status.retired' }
  if (e.status === 'faulty' || e.status === 'under_maintenance' || e.status === 'standby') {
    return { tone: STATUS_PILL[e.status], key: `status.${e.status}` }
  }
  if (due && due < asOf) return { tone: 'red', key: 'statusPill.overdue', vars: { days: daysBetween(due, asOf) } }
  if (due && due === asOf) return { tone: 'amber', key: 'statusPill.dueToday' }
  if (findings > 0) return { tone: 'lime', key: 'statusPill.findings', vars: { count: findings } }
  if (due && daysBetween(asOf, due) <= 7) {
    return { tone: 'amber', key: e.kind === 'sensor' ? 'statusPill.calibrateSoon' : 'statusPill.dueSoon' }
  }
  return { tone: 'green', key: 'statusPill.ok' }
}

export function EquipmentStatusPill({ equipment, asOf, findings = 0 }) {
  const t = useT()
  const s = equipmentStatus(equipment, asOf, findings)
  const label = t.or(`equipmentUi.${s.key}`, equipment.status, s.vars)
  if (s.tone === 'lime') return <span className={LIME_PILL}>{label}</span>
  return (
    <Pill tone={s.tone} className={LIGHT_BORDER[s.tone] || ''}>
      {label}
    </Pill>
  )
}

/**
 * Equipment table rows for /maintenance and the unit maintenance tab
 * (Paper 48 EYC-0): 52 / grow / 80 right / 110 right / 130 lanes, 24px apart.
 * Widths below include the table's cell padding. `findings` maps an
 * equipment id to its open checklist faults.
 */
export function useEquipmentColumns({ asOf, showUnit = true, locationName = () => null, findings = {} }) {
  const t = useT()
  return [
    ...(showUnit
      ? [
          {
            key: 'unit',
            header: t('equipmentUi.col.unit'),
            width: 88,
            render: (e) =>
              e.unitId ? (
                <Link
                  href={`/units/${e.unitId}/maintenance`}
                  onClick={(ev) => ev.stopPropagation()}
                  className="rounded-sm text-text hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                >
                  {e.unitName}
                </Link>
              ) : (
                <span className="text-text">{e.groupName || locationName(e.locationId) || '—'}</span>
              ),
          },
        ]
      : []),
    {
      key: 'name',
      header: t('equipmentUi.col.equipment'),
      render: (e) => <span className="text-text">{e.name}</span>,
      // Paper 48: the tag first ("AER-07 · …"), then what it is.
      sub: (e) =>
        [e.assetTag || e.serialNumber, t.or(`equipmentUi.kind.${e.kind}`, EQUIPMENT_KINDS.find((k) => k.value === e.kind)?.label)]
          .filter(Boolean)
          .join(' · '),
    },
    {
      key: 'checked',
      header: t('equipmentUi.col.checked'),
      width: 104,
      align: 'right',
      render: (e) => <span className="text-text tabular-nums">{e.lastMaintainedOn ? shortDate(e.lastMaintainedOn, asOf) : '—'}</span>,
    },
    {
      key: 'due',
      header: t('equipmentUi.col.nextDue'),
      width: 134,
      align: 'right',
      render: (e) => <span className="text-text tabular-nums">{e.nextMaintenanceDue ? shortDate(e.nextMaintenanceDue, asOf) : '—'}</span>,
    },
    {
      key: 'status',
      header: t('equipmentUi.col.status'),
      width: 166,
      render: (e) => <EquipmentStatusPill equipment={e} asOf={asOf} findings={findings[e._id] || 0} />,
    },
  ]
}
