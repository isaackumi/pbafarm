import { useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { MapPin, Plus } from '@phosphor-icons/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import {
  PageHeader,
  FormCard,
  FormSection,
  FormActions,
  Field,
  Input,
  Textarea,
  Button,
} from '../components/ui'
import { api } from '../convex/_generated/api'
import { useToast } from '../components/Toast'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'

export default function FarmLocationsPage() {
  return (
    <ProtectedRoute>
      <Layout title="Farm Locations">
        <FarmLocations />
      </Layout>
    </ProtectedRoute>
  )
}

function FarmLocations() {
  const { showToast } = useToast()
  const { hasRole } = useAuth()
  const isAdmin = hasRole?.('admin')
  const { setActiveLocation, runBackfill } = useLocation()

  const locations = useQuery(
    api.farmLocations.list,
    isAdmin ? { includeInactive: true } : {},
  )
  const createLocation = useMutation(api.farmLocations.create)
  const updateLocation = useMutation(api.farmLocations.update)

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({
    name: '',
    code: '',
    address: '',
    notes: '',
    active: true,
  })
  const [saving, setSaving] = useState(false)
  const [backfilling, setBackfilling] = useState(false)

  useEffect(() => {
    if (!editing) return
    setForm({
      name: editing.name || '',
      code: editing.code || '',
      address: editing.address || '',
      notes: editing.notes || '',
      active: editing.active !== false,
    })
    setShowForm(true)
  }, [editing])

  const reset = () => {
    setEditing(null)
    setForm({ name: '', code: '', address: '', notes: '', active: true })
    setShowForm(false)
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!isAdmin) return
    setSaving(true)
    try {
      if (editing) {
        await updateLocation({
          id: editing.id || editing._id,
          patch: {
            name: form.name,
            code: form.code,
            address: form.address,
            notes: form.notes,
            active: form.active,
          },
        })
        showToast('success', 'Location updated')
      } else {
        const id = await createLocation({
          name: form.name,
          code: form.code || undefined,
          address: form.address || undefined,
          notes: form.notes || undefined,
          active: form.active,
        })
        showToast('success', 'Location created')
        if (id) await setActiveLocation(id)
      }
      reset()
    } catch (err) {
      showToast('error', err.message || 'Failed to save location')
    } finally {
      setSaving(false)
    }
  }

  const handleBackfill = async () => {
    if (!isAdmin) return
    setBackfilling(true)
    try {
      const result = await runBackfill({ promoteCageLocationStrings: true })
      showToast(
        'success',
        `Backfill done: ${result.createdLocations} locations, ${result.patched} rows, ${result.usersUpdated} users`,
      )
    } catch (err) {
      showToast('error', err.message || 'Backfill failed')
    } finally {
      setBackfilling(false)
    }
  }

  return (
    <div data-tour="page-farm-locations">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Farm Locations' },
        ]}
        description="Sites under your company. Ops data (cages, feed stock, daily records) is scoped to the active location in the header."
        actions={
          isAdmin ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={handleBackfill}
                disabled={backfilling}
              >
                {backfilling ? 'Backfilling…' : 'Backfill existing data'}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setEditing(null)
                  setForm({
                    name: '',
                    code: '',
                    address: '',
                    notes: '',
                    active: true,
                  })
                  setShowForm(true)
                }}
              >
                <Plus className="w-4 h-4 mr-1" />
                Add location
              </Button>
            </div>
          ) : null
        }
      />

      {showForm && isAdmin && (
        <FormCard className="mb-6">
          <form onSubmit={submit}>
            <FormSection
              title={editing ? 'Edit location' : 'New location'}
              description="Name is required. Code is optional (e.g. VOLTA)."
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Name" htmlFor="loc-name" required>
                  <Input
                    id="loc-name"
                    value={form.name}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, name: e.target.value }))
                    }
                    required
                  />
                </Field>
                <Field label="Code" htmlFor="loc-code">
                  <Input
                    id="loc-code"
                    value={form.code}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, code: e.target.value }))
                    }
                    placeholder="MAIN"
                  />
                </Field>
              </div>
              <Field label="Address" htmlFor="loc-address">
                <Input
                  id="loc-address"
                  value={form.address}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, address: e.target.value }))
                  }
                />
              </Field>
              <Field label="Notes" htmlFor="loc-notes">
                <Textarea
                  id="loc-notes"
                  rows={2}
                  value={form.notes}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, notes: e.target.value }))
                  }
                />
              </Field>
              {editing && (
                <label className="flex items-center gap-2 text-sm text-chart-ink">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, active: e.target.checked }))
                    }
                  />
                  Active
                </label>
              )}
            </FormSection>
            <FormActions>
              <Button type="button" variant="secondary" onClick={reset}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : editing ? 'Update' : 'Create'}
              </Button>
            </FormActions>
          </form>
        </FormCard>
      )}

      <div className="page-card overflow-hidden">
        <div className="px-6 py-4 border-b border-foam-deep flex items-center gap-2">
          <MapPin size={20} weight="duotone" className="text-lagoon-800" />
          <h3 className="text-lg font-medium text-chart-ink">Locations</h3>
        </div>
        {locations === undefined ? (
          <p className="px-6 py-8 text-sm text-muted">Loading…</p>
        ) : locations.length === 0 ? (
          <p className="px-6 py-8 text-sm text-muted">
            No locations yet. Create one or run backfill.
          </p>
        ) : (
          <ul className="divide-y divide-foam-deep">
            {locations.map((loc) => (
              <li
                key={loc.id || loc._id}
                className="px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
              >
                <div>
                  <p className="font-medium text-chart-ink">
                    {loc.name}
                    {loc.code ? (
                      <span className="ml-2 text-xs font-data text-muted">
                        {loc.code}
                      </span>
                    ) : null}
                    {loc.active === false && (
                      <span className="ml-2 text-xs text-signal">Inactive</span>
                    )}
                  </p>
                  {loc.address && (
                    <p className="text-sm text-muted">{loc.address}</p>
                  )}
                  {loc.notes && (
                    <p className="text-xs text-muted mt-1">{loc.notes}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setActiveLocation(loc.id || loc._id)}
                  >
                    Use in header
                  </Button>
                  {isAdmin && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setEditing(loc)}
                    >
                      Edit
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
