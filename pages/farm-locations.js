import { useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import {
  MapPin,
  Plus,
} from 'lucide-react'
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
  Select,
  Button,
} from '../components/ui'
import { api } from '../convex/_generated/api'
import { SITE_TYPES } from '../lib/format'

/** Site metadata fields (FARM-001); blank = not set. */
const EMPTY_SITE = { siteType: '', timezone: '', latitude: '', longitude: '', waterBody: '' }

const COMMON_ZONES = ['Africa/Accra', 'Africa/Lagos', 'Africa/Abidjan', 'Africa/Nairobi', 'Africa/Kampala', 'Africa/Johannesburg', 'UTC']

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Patch for the site metadata from the form. */
function siteMeta(form) {
  return {
    siteType: form.siteType || undefined,
    timezone: form.timezone,
    latitude: numberOrNull(form.latitude),
    longitude: numberOrNull(form.longitude),
    waterBody: form.waterBody,
  }
}
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
  const { setActiveLocation } = useLocation()

  const locations = useQuery(
    api.farmLocations.list,
    isAdmin ? { includeInactive: true } : {},
  )
  const createLocation = useMutation(api.farmLocations.create)
  const updateLocation = useMutation(api.farmLocations.update)

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', code: '', address: '', notes: '', active: true, ...EMPTY_SITE })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editing) return
    setForm({
      name: editing.name || '',
      code: editing.code || '',
      address: editing.address || '',
      notes: editing.notes || '',
      active: editing.active !== false,
      siteType: editing.siteType || '',
      timezone: editing.timezone || '',
      latitude: editing.latitude ?? '',
      longitude: editing.longitude ?? '',
      waterBody: editing.waterBody || '',
    })
    setShowForm(true)
  }, [editing])

  const reset = () => {
    setEditing(null)
    setForm({ name: '', code: '', address: '', notes: '', active: true, ...EMPTY_SITE })
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
            ...siteMeta(form),
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
          ...siteMeta(form),
          timezone: form.timezone || undefined,
          latitude: numberOrNull(form.latitude) ?? undefined,
          longitude: numberOrNull(form.longitude) ?? undefined,
          waterBody: form.waterBody || undefined,
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
                onClick={() => {
                  setEditing(null)
                  setForm({ name: '', code: '', address: '', notes: '', active: true, ...EMPTY_SITE })
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Site type" htmlFor="loc-type">
                  <Select
                    id="loc-type"
                    value={form.siteType}
                    onChange={(e) => setForm((p) => ({ ...p, siteType: e.target.value }))}
                  >
                    <option value="">Not set</option>
                    {SITE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Time zone"
                  htmlFor="loc-tz"
                  hint="Sets the date for entries and reminders at this site. Blank uses the organization's."
                >
                  <Input
                    id="loc-tz"
                    list="loc-tz-options"
                    value={form.timezone}
                    placeholder="Africa/Accra"
                    onChange={(e) => setForm((p) => ({ ...p, timezone: e.target.value }))}
                  />
                  <datalist id="loc-tz-options">
                    {COMMON_ZONES.map((z) => (
                      <option key={z} value={z} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Latitude" htmlFor="loc-lat" hint="Decimal degrees, e.g. 6.2">
                  <Input
                    id="loc-lat"
                    inputMode="decimal"
                    value={form.latitude}
                    onChange={(e) => setForm((p) => ({ ...p, latitude: e.target.value }))}
                  />
                </Field>
                <Field label="Longitude" htmlFor="loc-lng" hint="Decimal degrees, e.g. 0.05">
                  <Input
                    id="loc-lng"
                    inputMode="decimal"
                    value={form.longitude}
                    onChange={(e) => setForm((p) => ({ ...p, longitude: e.target.value }))}
                  />
                </Field>
              </div>
              <Field label="Water body" htmlFor="loc-water" hint="Lake, reservoir or river">
                <Input
                  id="loc-water"
                  value={form.waterBody}
                  onChange={(e) => setForm((p) => ({ ...p, waterBody: e.target.value }))}
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
          <MapPin size={20} className="text-lagoon-800" />
          <h3 className="text-lg font-medium text-chart-ink">Locations</h3>
        </div>
        {locations === undefined ? (
          <p className="px-6 py-8 text-sm text-muted">Loading…</p>
        ) : locations.length === 0 ? (
          <p className="px-6 py-8 text-sm text-muted">
            No locations yet. Create one to get started.
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
                  {(loc.siteType || loc.timezone || loc.waterBody || loc.latitude != null) && (
                    <p className="text-xs text-muted mt-0.5">
                      {[
                        SITE_TYPES.find((t) => t.value === loc.siteType)?.label,
                        loc.waterBody,
                        loc.timezone,
                        loc.latitude != null && loc.longitude != null
                          ? `${loc.latitude}, ${loc.longitude}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
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
