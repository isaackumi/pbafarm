import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import InspectionForm, { INSPECTION_KINDS } from '../components/InspectionForm'
import OutboxPanel from '../components/OutboxPanel'
import { Card, Field, FormPage, PageHeader, Select } from '../components/ui'
import { useToast } from '../components/Toast'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { api } from '../convex/_generated/api'
import { saveOrQueue } from '../lib/outboxSenders'
import { useOnline } from '../hooks/useOutbox'
import { errorMessage } from '../lib/errorMessage'
import { unitLabel } from '../lib/format'

/** Net inspections and maintenance from the field; saves offline (outbox). */
function InspectionEntry() {
  const router = useRouter()
  const { user } = useAuth()
  const { showToast } = useToast()
  const online = useOnline()
  const { locationArgs } = useLocation()
  const units = useQuery(api.cages.list, user ? locationArgs : 'skip')
  const [unitId, setUnitId] = useState('')
  const gear = useQuery(api.equipment.list, user && unitId ? { unitId } : 'skip')

  useEffect(() => {
    const q = router.query.unit || router.query.cage
    if (typeof q === 'string' && q) setUnitId(q)
  }, [router.query.unit, router.query.cage])

  const unit = (units || []).find((u) => u.id === unitId)

  const save = async (args) => {
    if (!unitId) {
      showToast('Choose a unit first', 'error')
      return false
    }
    const kind = INSPECTION_KINDS.find((k) => k.value === args.kind)?.label || args.kind
    const res = await saveOrQueue({
      kind: 'inspection',
      payload: JSON.parse(JSON.stringify({ ...args, unitId })),
      summary: `${args.date} · ${kind} · ${unit?.name || 'unit'}`,
      userId: user?.id,
    })
    if (res.error) {
      showToast(errorMessage(res.error, 'Could not save'), 'error')
      return false
    }
    showToast(
      res.queued
        ? 'No connection. Saved on this device and will send when you are back online'
        : res.data?.nextDueOn
          ? `Saved. Next due ${res.data.nextDueOn}`
          : 'Saved',
      res.queued ? 'info' : 'success',
    )
    return true
  }

  return (
    <FormPage width="md">
      <PageHeader
        title="Inspection entry"
        breadcrumbs={[{ label: 'Maintenance', href: '/maintenance' }, { label: 'Entry' }]}
        description={online ? 'Net inspections, cleaning and maintenance jobs.' : 'Offline: entries wait on this device and send when you reconnect.'}
      />
      <Card className="space-y-4">
        <Field label="Unit" htmlFor="insp-unit" required>
          <Select id="insp-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">{units === undefined ? 'Loading…' : 'Choose a unit'}</option>
            {(units || []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {unitLabel(u)}
              </option>
            ))}
          </Select>
        </Field>
        {unitId && (
          <InspectionForm key={unitId} unitType={unit?.unitType || 'cage'} equipment={gear || []} onSave={save} />
        )}
      </Card>
      <div className="mt-6">
        <OutboxPanel compact kinds={['inspection']} online={online} />
      </div>
    </FormPage>
  )
}

export default function InspectionEntryPage() {
  return (
    <ProtectedRoute>
      <Layout title="Inspection entry">
        <InspectionEntry />
      </Layout>
    </ProtectedRoute>
  )
}
