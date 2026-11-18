import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import EquipmentForm, { EQUIPMENT_KINDS, EQUIPMENT_STATUS } from '../components/EquipmentForm'
import InspectionHistory from '../components/InspectionHistory'
import { Button, Card, EmptyState, PageHeader, StatCard } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { api } from '../convex/_generated/api'
import { localToday } from '../lib/format'
import { usePermission } from '../hooks/usePermission'

function DueList({ title, items, tone }) {
  if (!items.length) return null
  return (
    <Card padding={false}>
      <div className="px-5 py-4 border-b border-foam-deep">
        <h2 className={`font-display text-lg font-medium ${tone}`}>{title}</h2>
      </div>
      <ul className="divide-y divide-foam-deep text-sm">
        {items.map((i) => (
          <li key={`${i.kind}-${i.id}`} className="px-5 py-3 flex flex-wrap items-baseline justify-between gap-2">
            <span>
              {i.unitId ? (
                <Link href={`/units/${i.unitId}/maintenance`} className="text-lake hover:underline font-medium">{i.name}</Link>
              ) : (
                <span className="font-medium">{i.name}</span>
              )}{' '}
              <span className="text-muted">{i.detail}</span>
            </span>
            <span className="tabular-nums">{i.due}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Maintenance() {
  const { user, hasRole } = useAuth()
  const isAdmin = usePermission('org.sites.manage')
  const { locationArgs, locations } = useLocation()
  const locationName = (id) => (id ? (locations || []).find((l) => l.id === id)?.name : null)
  const asOf = localToday()
  const due = useQuery(api.equipment.due, user ? { asOf, days: 14, ...locationArgs } : 'skip')
  const gear = useQuery(api.equipment.list, user ? locationArgs : 'skip')
  const recent = useQuery(api.equipment.listInspections, user ? { limit: 30 } : 'skip')
  const [adding, setAdding] = useState(false)

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Maintenance"
        breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Maintenance' }]}
        description="Net inspections and equipment servicing due, the equipment registry and recent jobs."
        actions={
          <>
            <Button size="sm" variant="secondary" href="/inspection-entry">Log inspection</Button>
            {isAdmin && <Button size="sm" onClick={() => setAdding(true)}>Add equipment</Button>}
          </>
        }
        related={[{ label: 'Unit board', href: '/units' }, { label: 'Inventory items', href: '/inventory/items' }]}
      />
      {due && (
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Overdue" value={due.overdue.length} tone={due.overdue.length ? 'warn' : 'default'} />
          <StatCard label="Due in 14 days" value={due.dueSoon.length} />
        </div>
      )}
      {adding && (
        <Card>
          <EquipmentForm onDone={() => setAdding(false)} />
        </Card>
      )}
      {due && <DueList title="Overdue" items={due.overdue} tone="text-signal" />}
      {due && <DueList title="Due soon" items={due.dueSoon} tone="" />}

      <Card padding={false}>
        <div className="px-5 py-4 border-b border-foam-deep">
          <h2 className="font-display text-lg font-medium">Equipment</h2>
        </div>
        {!gear ? (
          <p className="p-5 text-sm text-muted">Loading…</p>
        ) : gear.length === 0 ? (
          <EmptyState title="No equipment yet" description="Register pumps, aerators, nets, boats, generators and vehicles to schedule their servicing." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-b border-foam-deep">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Asset tag</th>
                  <th className="px-4 py-2 font-medium">Kind</th>
                  <th className="px-4 py-2 font-medium">Attached to</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Next service</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foam-deep">
                {gear.map((e) => (
                  <tr key={e._id}>
                    <td className="px-4 py-2 font-medium">{e.name}</td>
                    <td className="px-4 py-2 text-muted">{e.assetTag || '—'}</td>
                    <td className="px-4 py-2 text-muted">{EQUIPMENT_KINDS.find((k) => k.value === e.kind)?.label}</td>
                    <td className="px-4 py-2">
                      {e.unitId ? (
                        <Link href={`/units/${e.unitId}/maintenance`} className="text-lake hover:underline">{e.unitName}</Link>
                      ) : (
                        e.groupName || locationName(e.locationId) || '—'
                      )}
                    </td>
                    <td className={`px-4 py-2 ${e.status === 'faulty' ? 'text-signal' : ''}`}>{EQUIPMENT_STATUS[e.status]}</td>
                    <td className={`px-4 py-2 tabular-nums ${e.nextMaintenanceDue && e.nextMaintenanceDue < asOf ? 'text-signal' : ''}`}>
                      {e.nextMaintenanceDue || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card padding={false}>
        <div className="px-5 py-4 border-b border-foam-deep">
          <h2 className="font-display text-lg font-medium">Recent jobs</h2>
        </div>
        <InspectionHistory rows={recent} showUnit />
      </Card>
    </div>
  )
}

export default function MaintenancePage() {
  return (
    <ProtectedRoute>
      <Layout title="Maintenance">
        <Maintenance />
      </Layout>
    </ProtectedRoute>
  )
}
