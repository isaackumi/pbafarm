import { useState } from 'react'
import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Layout from '../../../components/Layout'
import UnitTabs from '../../../components/UnitTabs'
import InspectionForm from '../../../components/InspectionForm'
import InspectionHistory from '../../../components/InspectionHistory'
import EquipmentForm, { EQUIPMENT_KINDS, EQUIPMENT_STATUS } from '../../../components/EquipmentForm'
import { Button, Card, CardHeader, EmptyState, PageHeader } from '../../../components/ui'
import { useToast } from '../../../components/Toast'
import { useAuth } from '../../../contexts/AuthContext'
import { api } from '../../../convex/_generated/api'
import { errorMessage } from '../../../lib/errorMessage'
import { localToday, unitLabel } from '../../../lib/format'

function MaintenancePage() {
  const router = useRouter()
  const { user, hasRole } = useAuth()
  const isAdmin = Boolean(hasRole?.('admin'))
  const { showToast } = useToast()
  const id = typeof router.query.id === 'string' ? router.query.id : null
  const ws = useQuery(api.units.workspace, user && id ? { id } : 'skip')
  const gear = useQuery(api.equipment.list, user && id ? { unitId: id } : 'skip')
  const history = useQuery(api.equipment.listInspections, user && id ? { unitId: id } : 'skip')
  const items = useQuery(api.inventoryItems.listItems, user ? {} : 'skip')
  const log = useMutation(api.equipment.logInspection)
  const [adding, setAdding] = useState(false)

  if (ws === undefined || !id) {
    return <Layout title="Maintenance"><p className="text-muted p-6">Loading…</p></Layout>
  }
  if (ws === null) {
    return <Layout title="Maintenance"><EmptyState title="Unit not found" action={<Button href="/units">All units</Button>} /></Layout>
  }
  const unit = ws.unit
  const today = localToday()
  const spares = (Array.isArray(items) ? items : []).filter((i) => ['spare', 'net', 'equipment'].includes(i.category))

  const save = async (args) => {
    try {
      const res = await log({ ...args, unitId: id })
      showToast(res.nextDueOn ? `Saved. Next due ${res.nextDueOn}` : 'Saved', 'success')
      return true
    } catch (err) {
      showToast(errorMessage(err, 'Could not save'), 'error')
      return false
    }
  }

  return (
    <Layout title={`${unit.name} maintenance`}>
      <div className="max-w-5xl space-y-6">
        <PageHeader
          title={unit.name}
          breadcrumbs={[
            { label: 'Units', href: '/units' },
            { label: unit.name, href: `/cages/${id}` },
            { label: ws.unitType === 'cage' ? 'Nets and equipment' : 'Equipment' },
          ]}
          description={`${unitLabel(ws.unitType)} · last maintained ${unit.lastMaintenanceDate || 'never'}${
            unit.nextMaintenanceDate ? ` · next due ${unit.nextMaintenanceDate}` : ''
          }`}
        />
        <UnitTabs unitId={id} active="maintenance" unitType={ws.unitType} />

        {unit.nextMaintenanceDate && unit.nextMaintenanceDate < today && (
          <p className="rounded-lg border border-signal/30 bg-signal/10 px-4 py-3 text-sm text-signal">
            {ws.unitType === 'cage' ? 'Net inspection' : 'Maintenance'} overdue since {unit.nextMaintenanceDate}.
          </p>
        )}

        <Card>
          <CardHeader title={ws.unitType === 'cage' ? 'Log a net inspection or job' : 'Log maintenance'} />
          <InspectionForm unitType={ws.unitType} equipment={gear || []} spares={spares} onSave={save} />
        </Card>

        <Card padding={false}>
          <div className="px-5 py-4 border-b border-foam-deep flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-medium">Equipment</h2>
            {isAdmin && !adding && <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>Add equipment</Button>}
          </div>
          {adding && (
            <div className="p-5 border-b border-foam-deep">
              <EquipmentForm unitId={id} onDone={() => setAdding(false)} />
            </div>
          )}
          {!gear ? (
            <p className="p-5 text-sm text-muted">Loading…</p>
          ) : gear.length === 0 ? (
            <p className="p-5 text-sm text-muted">No equipment attached to this unit.</p>
          ) : (
            <ul className="divide-y divide-foam-deep text-sm">
              {gear.map((e) => (
                <li key={e._id} className="px-5 py-3 flex flex-wrap items-baseline justify-between gap-2">
                  <span>
                    <span className="font-medium">{e.name}</span>{' '}
                    <span className="text-muted">
                      {EQUIPMENT_KINDS.find((k) => k.value === e.kind)?.label}
                      {e.rating ? ` · ${e.rating}` : ''}
                    </span>
                  </span>
                  <span className={`tabular-nums ${e.status === 'faulty' ? 'text-signal' : 'text-muted'}`}>
                    {EQUIPMENT_STATUS[e.status]}
                    {e.nextMaintenanceDue
                      ? ` · ${e.nextMaintenanceDue < today ? 'overdue' : 'due'} ${e.nextMaintenanceDue}`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card padding={false}>
          <div className="px-5 py-4 border-b border-foam-deep">
            <h2 className="font-display text-lg font-medium">History</h2>
          </div>
          <InspectionHistory rows={history} />
        </Card>
      </div>
    </Layout>
  )
}

export default function UnitMaintenancePage() {
  return (
    <ProtectedRoute>
      <MaintenancePage />
    </ProtectedRoute>
  )
}
