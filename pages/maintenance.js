import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from 'convex/react'
import { PenLine, Plus } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import EquipmentForm from '../components/EquipmentForm'
import InspectionHistory from '../components/InspectionHistory'
import { Card, GradientButton, KpiStrip, StatusDot, Table } from '../components/ui'
import { EquipmentStatusPill, shortDate, useEquipmentColumns } from '../components/units/equipmentColumns'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { api } from '../convex/_generated/api'
import { daysBetween, formatDate, localToday } from '../lib/format'
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

/** Latest inspection per equipment (rows newest first): open checklist faults and whether it failed. */
function openFindings(inspections) {
  const seen = new Set()
  const byEquipment = {}
  let total = 0
  let critical = 0
  for (const r of inspections || []) {
    const target = r.equipmentId || (r.unitId ? `unit:${r.unitId}` : null)
    if (!target || seen.has(target)) continue
    seen.add(target)
    const faults = (r.checklist || []).filter((c) => !c.ok).length || (r.result && r.result !== 'ok' ? 1 : 0)
    if (!faults) continue
    if (r.equipmentId) byEquipment[r.equipmentId] = faults
    total += faults
    if (r.result === 'failed') critical += 1
  }
  return { byEquipment, total, critical }
}

/** Paper 48 checklist box: 20px, 6px radius; sky fill + check on pass, alert ring + cross on fail. */
function CheckBox({ ok }) {
  if (ok) {
    return (
      <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-[6px] bg-[#3D86E6]">
        <svg width="12" height="12" viewBox="0 0 24 24">
          <path d="M5 12l5 5 9-10" fill="none" stroke="#0A0B0C" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    )
  }
  return (
    <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-[6px] border-[1.5px] border-alert">
      <svg width="12" height="12" viewBox="0 0 24 24">
        <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="#F87171" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </span>
  )
}

/**
 * Paper 48 "Inspection" card (GH5-0): the selected equipment's latest
 * checklist, its finding and the next step.
 */
function InspectionCard({ equipment, asOf, findings, canLog }) {
  const t = useT()
  const latest = useQuery(api.equipment.listInspections, { equipmentId: equipment._id, limit: 1 })
  const last = latest?.[0]
  const checklist = last?.checklist || []
  const faults = checklist.filter((c) => !c.ok)
  const finding = last?.findings || faults.map((c) => `${c.item}${c.note ? ` (${c.note})` : ''}`).join('; ')
  const href = equipment.unitId ? `/inspection-entry?unit=${equipment.unitId}` : '/inspection-entry'
  return (
    <section aria-labelledby="inspection-title" className={`flex flex-col gap-1 px-[26px] py-6 ${card}`}>
      <div className="flex items-start justify-between gap-3 pb-[14px]">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs leading-4 text-muted">
            {[equipment.assetTag || equipment.serialNumber, equipment.unitName || equipment.groupName].filter(Boolean).join(' · ') ||
              t.or(`equipmentUi.kind.${equipment.kind}`, equipment.kind)}
          </span>
          <h2 id="inspection-title" className="text-[20px] font-semibold leading-6 text-text">
            {equipment.name}
          </h2>
        </div>
        <span className="shrink-0">
          <EquipmentStatusPill equipment={equipment} asOf={asOf} findings={findings} />
        </span>
      </div>
      {latest === undefined ? (
        <p className="border-t border-line py-[11px] text-[14px] leading-[18px] text-muted">{t('equipmentUi.loading')}</p>
      ) : checklist.length === 0 ? (
        <p className="border-t border-line py-[11px] text-[14px] leading-[18px] text-muted">
          {last ? t('equipmentUi.inspection.noChecklist', { date: shortDate(last.date, asOf) }) : t('equipmentUi.inspection.none')}
        </p>
      ) : (
        <ul>
          {checklist.map((c) => (
            <li key={c.item} className="flex items-center gap-3 border-t border-line py-[11px]">
              <CheckBox ok={c.ok} />
              <span className="min-w-0 grow basis-0 text-[14px] leading-[18px] text-text">{c.item}</span>
              <span className={`w-12 shrink-0 text-right text-xs leading-4 ${c.ok ? 'text-good' : 'text-alert'}`}>
                {c.ok ? t('equipmentUi.inspection.pass') : t('equipmentUi.inspection.fail')}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-[14px] pt-3">
        {last && finding && (
          <div className="flex flex-col gap-1 rounded-[14px] border border-[#5A2A2A] bg-[#1A1112] px-4 py-[14px] [[data-theme=light]_&]:border-[#F5C2C2] [[data-theme=light]_&]:bg-[#FEF2F2]">
            <span className="text-[13px] font-medium leading-4 text-alert">{t('equipmentUi.inspection.finding', { text: finding })}</span>
            <span className="text-xs leading-4 text-muted">
              {[
                shortDate(last.date, asOf),
                last.performedBy,
                last.nextDueOn ? t('equipmentUi.inspection.fixBy', { date: shortDate(last.nextDueOn, asOf) }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
        )}
        {canLog && (
          <div className="flex flex-wrap gap-[10px]">
            <Link
              href={href}
              className="whitespace-nowrap rounded-pill bg-[#E4E6E8] px-[18px] py-[10px] text-[13px] font-medium leading-4 text-bg hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan [[data-theme=light]_&]:bg-[#0E1012] [[data-theme=light]_&]:text-white"
            >
              {t('equipmentUi.inspection.submit')}
            </Link>
            <Link
              href={equipment.unitId ? `/units/${equipment.unitId}/maintenance` : href}
              className="whitespace-nowrap rounded-pill border border-line-strong px-[18px] py-[10px] text-[13px] leading-4 text-text hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
            >
              {t('equipmentUi.inspection.addFinding')}
            </Link>
          </div>
        )}
      </div>
    </section>
  )
}

/** Paper 48 light KPI suffixes are in the text colour; dark keeps the muted suffix. */
function Suffix({ children }) {
  return <span className="[[data-theme=light]_&]:text-text">{children}</span>
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
  const recent = useQuery(api.equipment.listInspections, user ? { limit: 100 } : 'skip')
  const [adding, setAdding] = useState(false)
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const findings = useMemo(() => openFindings(recent), [recent])
  const columns = useEquipmentColumns({ asOf, locationName, findings: findings.byEquipment })
  const canLog = can(routePermission('/inspection-entry'))

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (gear || []).filter((e) => {
      const group = KIND_GROUP[e.kind] || 'other'
      if (tab !== 'all' && group !== tab) return false
      if (!q) return true
      return [e.name, e.unitName, e.groupName, e.assetTag, e.serialNumber].some((v) => v && v.toLowerCase().includes(q))
    })
  }, [gear, tab, search])

  // The inspection card follows the clicked row; by default the most overdue equipment.
  const selected = useMemo(() => {
    const list = (gear || []).filter((e) => e.status !== 'retired')
    const picked = selectedId && list.find((e) => e._id === selectedId)
    if (picked) return picked
    const dated = list.filter((e) => e.nextMaintenanceDue).sort((a, b) => a.nextMaintenanceDue.localeCompare(b.nextMaintenanceDue))
    return dated[0] || list[0] || null
  }, [gear, selectedId])

  const kindOf = useMemo(() => new Map((gear || []).map((e) => [e._id, e.kind])), [gear])
  const dueBreakdown = useMemo(() => {
    if (!due) return null
    const counts = {}
    for (const d of due.dueSoon) {
      const group = d.equipmentId ? KIND_GROUP[kindOf.get(d.equipmentId)] || 'other' : 'nets'
      counts[group] = (counts[group] || 0) + 1
    }
    return TABS.filter((g) => counts[g]).map((g) => t(`equipmentUi.dueGroup.${g === 'other' ? 'misc' : g}`, { count: counts[g] })).join(' · ')
  }, [due, kindOf, t])
  const oldestOverdue = due?.overdue.length ? Math.max(...due.overdue.map((d) => daysBetween(d.due, asOf))) : 0

  const faulty = (gear || []).filter((e) => e.status === 'faulty' || e.status === 'under_maintenance').length
  const inService = (gear || []).filter((e) => e.status === 'in_service').length
  const active = (gear || []).filter((e) => e.status !== 'retired').length

  return (
    <Layout
      title={t('equipmentUi.title')}
      eyebrow={t('equipmentUi.eyebrow')}
      actions={
        <>
          {canLog && (
            <GradientButton href="/inspection-entry" variant="lime" icon={Plus}>
              {t('equipmentUi.logInspection')}
            </GradientButton>
          )}
          {isAdmin && (
            <GradientButton
              ring="sky"
              icon={PenLine}
              onClick={() => setAdding(true)}
              // Paper 48 light (LAK-0) ends the sky ring at #7DB6F2; dark keeps --gradient-sky.
              style={{}}
              className="bg-[image:var(--gradient-sky)] [[data-theme=light]_&]:bg-[image:linear-gradient(in_oklab_120deg,#1562D6_0%,#7DB6F2_100%)]"
            >
              {t('equipmentUi.add')}
            </GradientButton>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-7">
        <KpiStrip
          items={[
            {
              key: 'due',
              label: t('equipmentUi.kpi.dueWeek'),
              value: due ? due.dueSoon.length : '—',
              suffix: dueBreakdown ? <Suffix>{dueBreakdown}</Suffix> : undefined,
            },
            {
              key: 'overdue',
              label: t('equipmentUi.kpi.overdue'),
              value: due ? due.overdue.length : '—',
              suffix: oldestOverdue ? <Suffix>{t('equipmentUi.oldest', { count: oldestOverdue })}</Suffix> : undefined,
            },
            {
              key: 'findings',
              label: t('equipmentUi.kpi.findings'),
              value: recent ? findings.total : '—',
              suffix: findings.critical ? <Suffix>{t('equipmentUi.critical', { count: findings.critical })}</Suffix> : undefined,
            },
            {
              key: 'inService',
              label: t('equipmentUi.kpi.inService'),
              value: gear ? inService : '—',
              suffix: gear ? (
                <Suffix>
                  {[t('equipmentUi.ofActive', { count: active }), faulty ? t('equipmentUi.faultyCount', { count: faulty }) : null]
                    .filter(Boolean)
                    .join(' · ')}
                </Suffix>
              ) : undefined,
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
            onRowClick={(e) => setSelectedId(e._id)}
            empty={gear === undefined ? t('equipmentUi.loading') : gear.length === 0 ? t('equipmentUi.empty') : t('equipmentUi.noMatch')}
          />
          <div className="flex min-w-0 flex-col gap-5 xl:grow xl:basis-0">
            {selected && (
              <InspectionCard
                key={selected._id}
                equipment={selected}
                asOf={asOf}
                findings={findings.byEquipment[selected._id] || 0}
                canLog={canLog}
              />
            )}
            {due && <DueCard due={due} />}
            <section aria-labelledby="jobs-title" className={`flex flex-col gap-1 px-[26px] pt-6 ${card}`}>
              <div className="border-b border-line pb-[10px]">
                <h2 id="jobs-title" className="text-[15px] font-semibold leading-[18px] text-text">
                  {t('equipmentUi.recent')}
                </h2>
              </div>
              <div className="-mx-5 -mt-1">
                <InspectionHistory rows={recent?.slice(0, 30)} showUnit />
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
