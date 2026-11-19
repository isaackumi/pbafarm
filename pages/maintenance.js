import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from 'convex/react'
import { ClipboardCheck, Plus } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import EquipmentForm from '../components/EquipmentForm'
import InspectionHistory from '../components/InspectionHistory'
import { Card, GradientButton, KpiStrip, StatusDot, Table } from '../components/ui'
import { useEquipmentColumns } from '../components/units/equipmentColumns'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { api } from '../convex/_generated/api'
import { formatDate, localToday } from '../lib/format'
import { usePermission, usePermissions } from '../hooks/usePermission'
import { routePermission } from '../lib/routePermissions'
import { useT } from '../lib/i18n/context'

/** Table tabs (Paper 48): equipment kinds grouped the way crews talk about them. */
const KIND_GROUP = {
  aerator: 'aeration',
  blower: 'aeration',
  oxygen_cone: 'aeration',
  generator: 'power',
  net: 'nets',
  mooring: 'nets',
}
const TABS = ['all', 'aeration', 'power', 'nets', 'other']

const card = 'rounded-card border border-line bg-surface shadow-[var(--shadow-card)]'

function DueCard({ due }) {
  const t = useT()
  const items = [...due.overdue.map((i) => ({ ...i, overdue: true })), ...due.dueSoon]
  return (
    <section aria-labelledby="due-title" className={`flex flex-col gap-1 px-[26px] py-6 ${card}`}>
      <div className="flex items-center justify-between pb-[10px]">
        <h2 id="due-title" className="text-[15px] font-semibold leading-[18px] text-text">
          {t('equipmentUi.dueTitle')}
        </h2>
        <span className="text-xs leading-4 text-muted">{t('equipmentUi.next7')}</span>
      </div>
      {items.length === 0 ? (
        <p className="border-t border-line py-[11px] text-[14px] leading-[18px] text-muted">{t('equipmentUi.nothingDue')}</p>
      ) : (
        <ul>
          {items.map((i) => (
            <li key={`${i.kind}-${i.id}`} className="flex items-center gap-[14px] border-t border-line py-[11px]">
              <StatusDot tone={i.overdue ? 'alert' : 'warn'} size={7} label={i.overdue ? t('equipmentUi.overdue') : t('equipmentUi.dueSoon')} />
              <span className="flex min-w-0 grow basis-0 flex-col">
                {i.unitId ? (
                  <Link href={`/units/${i.unitId}/maintenance`} className="truncate text-[14px] text-text hover:underline">
                    {i.name}
                  </Link>
                ) : (
                  <span className="truncate text-[14px] text-text">{i.name}</span>
                )}
                {i.detail && <span className="truncate text-xs text-muted">{i.detail}</span>}
              </span>
              <span className={`shrink-0 text-right text-[13px] tabular-nums ${i.overdue ? 'text-alert' : 'text-muted'}`}>
                {formatDate(i.due)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Maintenance() {
  const t = useT()
  const { user } = useAuth()
  const { can } = usePermissions()
  const isAdmin = usePermission('org.sites.manage')
  const { locationArgs, locations } = useLocation()
  const locationName = (id) => (id ? (locations || []).find((l) => l.id === id)?.name : null)
  const asOf = localToday()
  const due = useQuery(api.equipment.due, user ? { asOf, days: 7, ...locationArgs } : 'skip')
  const gear = useQuery(api.equipment.list, user ? locationArgs : 'skip')
  const recent = useQuery(api.equipment.listInspections, user ? { limit: 30 } : 'skip')
  const [adding, setAdding] = useState(false)
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const columns = useEquipmentColumns({ asOf, locationName })

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (gear || []).filter((e) => {
      const group = KIND_GROUP[e.kind] || 'other'
      if (tab !== 'all' && group !== tab) return false
      if (!q) return true
      return [e.name, e.unitName, e.groupName, e.assetTag, e.serialNumber].some((v) => v && v.toLowerCase().includes(q))
    })
  }, [gear, tab, search])

  const faulty = (gear || []).filter((e) => e.status === 'faulty' || e.status === 'under_maintenance').length
  const inService = (gear || []).filter((e) => e.status === 'in_service').length
  const active = (gear || []).filter((e) => e.status !== 'retired').length

  return (
    <Layout
      title={t('equipmentUi.title')}
      eyebrow={t('equipmentUi.eyebrow')}
      actions={
        <>
          {can(routePermission('/inspection-entry')) && (
            <GradientButton href="/inspection-entry" icon={ClipboardCheck}>
              {t('equipmentUi.logInspection')}
            </GradientButton>
          )}
          {isAdmin && (
            <GradientButton reverse icon={Plus} onClick={() => setAdding(true)}>
              {t('equipmentUi.add')}
            </GradientButton>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-7">
        <KpiStrip
          items={[
            { key: 'due', label: t('equipmentUi.kpi.dueWeek'), value: due ? due.dueSoon.length : '—' },
            {
              key: 'overdue',
              label: t('equipmentUi.kpi.overdue'),
              value: due ? due.overdue.length : '—',
              valueTone: due?.overdue.length ? 'alert' : undefined,
            },
            { key: 'faulty', label: t('equipmentUi.kpi.faulty'), value: gear ? faulty : '—', valueTone: faulty ? 'warn' : undefined },
            {
              key: 'inService',
              label: t('equipmentUi.kpi.inService'),
              value: gear ? inService : '—',
              suffix: gear ? t('equipmentUi.ofActive', { count: active }) : undefined,
            },
          ]}
        />

        {adding && (
          <Card>
            <h2 className="mb-5 text-[17px] font-semibold leading-[22px] text-text">{t('equipmentUi.add')}</h2>
            <EquipmentForm onDone={() => setAdding(false)} />
          </Card>
        )}

        <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
          <Table
            className="min-w-0 xl:w-[700px] xl:shrink-0"
            title={t('equipmentUi.registry')}
            tabsLabel={t('equipmentUi.registry')}
            tabs={TABS.map((v) => ({ value: v, label: t(`equipmentUi.tab.${v}`) }))}
            tab={tab}
            onTabChange={setTab}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder={t('equipmentUi.search')}
            columns={columns}
            rows={rows}
            empty={gear === undefined ? t('equipmentUi.loading') : gear.length === 0 ? t('equipmentUi.empty') : t('equipmentUi.noMatch')}
          />
          <div className="flex min-w-0 flex-col gap-5 xl:grow xl:basis-0">
            {due && <DueCard due={due} />}
            <section aria-labelledby="jobs-title" className={`flex flex-col gap-1 px-[26px] pt-6 ${card}`}>
              <div className="border-b border-line pb-[10px]">
                <h2 id="jobs-title" className="text-[15px] font-semibold leading-[18px] text-text">
                  {t('equipmentUi.recent')}
                </h2>
              </div>
              <div className="-mx-5 -mt-1">
                <InspectionHistory rows={recent} showUnit />
              </div>
            </section>
          </div>
        </div>
      </div>
    </Layout>
  )
}

export default function MaintenancePage() {
  return (
    <ProtectedRoute>
      <Maintenance />
    </ProtectedRoute>
  )
}
