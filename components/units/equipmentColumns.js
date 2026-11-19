import Link from 'next/link'
import { Pill } from '../ui'
import { EQUIPMENT_KINDS } from '../EquipmentForm'
import { formatDate } from '../../lib/format'
import { useT } from '../../lib/i18n/context'

export const STATUS_PILL = {
  in_service: 'green',
  standby: 'neutral',
  faulty: 'red',
  under_maintenance: 'amber',
  retired: 'neutral',
}

/** Equipment table rows for /maintenance and the unit maintenance tab. */
export function useEquipmentColumns({ asOf, showUnit = true, locationName = () => null }) {
  const t = useT()
  return [
    ...(showUnit
      ? [
          {
            key: 'unit',
            header: t('equipmentUi.col.unit'),
            width: 120,
            render: (e) =>
              e.unitId ? (
                <Link
                  href={`/units/${e.unitId}/maintenance`}
                  onClick={(ev) => ev.stopPropagation()}
                  className="rounded-sm font-medium text-text hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                >
                  {e.unitName}
                </Link>
              ) : (
                <span className="text-muted">{e.groupName || locationName(e.locationId) || '—'}</span>
              ),
          },
        ]
      : []),
    {
      key: 'name',
      header: t('equipmentUi.col.equipment'),
      render: (e) => <span className="text-text">{e.name}</span>,
      sub: (e) =>
        [t.or(`equipmentUi.kind.${e.kind}`, EQUIPMENT_KINDS.find((k) => k.value === e.kind)?.label), e.serialNumber || e.assetTag]
          .filter(Boolean)
          .join(' · '),
    },
    {
      key: 'checked',
      header: t('equipmentUi.col.checked'),
      width: 110,
      align: 'right',
      render: (e) => <span className="text-muted tabular-nums">{e.lastMaintainedOn ? formatDate(e.lastMaintainedOn) : '—'}</span>,
    },
    {
      key: 'due',
      header: t('equipmentUi.col.nextDue'),
      width: 120,
      align: 'right',
      render: (e) => (
        <span className={`tabular-nums ${e.nextMaintenanceDue && e.nextMaintenanceDue < asOf ? 'text-alert' : 'text-text'}`}>
          {e.nextMaintenanceDue ? formatDate(e.nextMaintenanceDue) : '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('equipmentUi.col.status'),
      width: 150,
      render: (e) => {
        const overdue = e.nextMaintenanceDue && e.nextMaintenanceDue < asOf && e.status !== 'retired'
        return overdue && e.status === 'in_service' ? (
          <Pill tone="red">{t('equipmentUi.overdue')}</Pill>
        ) : (
          <Pill tone={STATUS_PILL[e.status] || 'neutral'}>{t.or(`equipmentUi.status.${e.status}`, e.status)}</Pill>
        )
      },
    },
  ]
}

