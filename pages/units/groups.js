import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Textarea } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../contexts/AuthContext'
import { useLocation } from '../../contexts/LocationContext'
import { api } from '../../convex/_generated/api'
import { errorMessage } from '../../lib/errorMessage'

const GROUP_KINDS = [
  { value: 'cage_group', label: 'Cage group' },
  { value: 'pond_block', label: 'Pond block' },
  { value: 'ras_system', label: 'RAS system' },
  { value: 'raceway_line', label: 'Raceway line' },
  { value: 'other', label: 'Other' },
]

const WATER_BODY_KINDS = [
  { value: 'lake', label: 'Lake' },
  { value: 'reservoir', label: 'Reservoir' },
  { value: 'river', label: 'River' },
  { value: 'sea', label: 'Sea' },
  { value: 'lagoon', label: 'Lagoon' },
  { value: 'borehole', label: 'Borehole' },
  { value: 'canal', label: 'Canal' },
  { value: 'other', label: 'Other' },
]

const kindLabel = (list, v) => list.find((k) => k.value === v)?.label || v

function coords(form) {
  const lat = form.latitude === '' ? undefined : Number(form.latitude)
  const lng = form.longitude === '' ? undefined : Number(form.longitude)
  return { latitude: lat, longitude: lng }
}

function GroupForm({ waterBodies, locations, onDone }) {
  const { showToast } = useToast()
  const createGroup = useMutation(api.units.createGroup)
  const [form, setForm] = useState({
    name: '', kind: 'cage_group', locationId: '', waterBodyId: '', latitude: '', longitude: '', systemVolumeM3: '', notes: '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await createGroup({
        name: form.name,
        kind: form.kind,
        locationId: form.locationId || undefined,
        waterBodyId: form.waterBodyId || undefined,
        systemVolumeM3: form.systemVolumeM3 === '' ? undefined : Number(form.systemVolumeM3),
        notes: form.notes.trim() || undefined,
        ...coords(form),
      })
      showToast(`Added ${form.name.trim()}`, 'success')
      onDone()
    } catch (err) {
      showToast(errorMessage(err, 'Could not add the group'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Name" htmlFor="g-name" required>
        <Input id="g-name" value={form.name} onChange={set('name')} required placeholder="Line A" />
      </Field>
      <Field label="Kind" htmlFor="g-kind">
        <Select id="g-kind" value={form.kind} onChange={set('kind')}>
          {GROUP_KINDS.map((k) => (
            <option key={k.value} value={k.value}>{k.label}</option>
          ))}
        </Select>
      </Field>
      <Field label="Site" htmlFor="g-site">
        <Select id="g-site" value={form.locationId} onChange={set('locationId')}>
          <option value="">Any site</option>
          {(locations || []).map((l) => (
            <option key={l.id || l._id} value={l.id || l._id}>{l.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Water body" htmlFor="g-wb">
        <Select id="g-wb" value={form.waterBodyId} onChange={set('waterBodyId')}>
          <option value="">None</option>
          {(waterBodies || []).map((w) => (
            <option key={w._id} value={w._id}>{w.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Latitude" htmlFor="g-lat" hint="Decimal degrees">
        <Input id="g-lat" type="number" step="any" inputMode="decimal" value={form.latitude} onChange={set('latitude')} />
      </Field>
      <Field label="Longitude" htmlFor="g-lng" hint="Decimal degrees">
        <Input id="g-lng" type="number" step="any" inputMode="decimal" value={form.longitude} onChange={set('longitude')} />
      </Field>
      {form.kind === 'ras_system' && (
        <Field label="System volume (m³)" htmlFor="g-vol" hint="Tanks, sumps and filters together">
          <Input id="g-vol" type="number" step="any" min="0" inputMode="decimal" value={form.systemVolumeM3} onChange={set('systemVolumeM3')} />
        </Field>
      )}
      <Field label="Notes" htmlFor="g-notes" className="sm:col-span-2">
        <Textarea id="g-notes" rows={2} value={form.notes} onChange={set('notes')} />
      </Field>
      <div className="sm:col-span-2 flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={saving || !form.name.trim()}>{saving ? 'Saving…' : 'Add group'}</Button>
      </div>
    </form>
  )
}

function WaterBodyForm({ locations, onDone }) {
  const { showToast } = useToast()
  const create = useMutation(api.units.createWaterBody)
  const [form, setForm] = useState({ name: '', kind: 'lake', locationId: '', latitude: '', longitude: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await create({
        name: form.name,
        kind: form.kind,
        locationId: form.locationId || undefined,
        notes: form.notes.trim() || undefined,
        ...coords(form),
      })
      showToast(`Added ${form.name.trim()}`, 'success')
      onDone()
    } catch (err) {
      showToast(errorMessage(err, 'Could not add the water body'), 'error')
    } finally {
      setSaving(false)
    }
  }
  return (
    <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Name" htmlFor="w-name" required>
        <Input id="w-name" value={form.name} onChange={set('name')} required placeholder="Lake Volta" />
      </Field>
      <Field label="Kind" htmlFor="w-kind">
        <Select id="w-kind" value={form.kind} onChange={set('kind')}>
          {WATER_BODY_KINDS.map((k) => (
            <option key={k.value} value={k.value}>{k.label}</option>
          ))}
        </Select>
      </Field>
      <Field label="Site" htmlFor="w-site">
        <Select id="w-site" value={form.locationId} onChange={set('locationId')}>
          <option value="">Any site</option>
          {(locations || []).map((l) => (
            <option key={l.id || l._id} value={l.id || l._id}>{l.name}</option>
          ))}
        </Select>
      </Field>
      <div />
      <Field label="Latitude" htmlFor="w-lat">
        <Input id="w-lat" type="number" step="any" inputMode="decimal" value={form.latitude} onChange={set('latitude')} />
      </Field>
      <Field label="Longitude" htmlFor="w-lng">
        <Input id="w-lng" type="number" step="any" inputMode="decimal" value={form.longitude} onChange={set('longitude')} />
      </Field>
      <div className="sm:col-span-2 flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={saving || !form.name.trim()}>{saving ? 'Saving…' : 'Add water body'}</Button>
      </div>
    </form>
  )
}

function AssignUnits({ group, units }) {
  const { showToast } = useToast()
  const assign = useMutation(api.units.assignToGroup)
  const [selected, setSelected] = useState([])
  const candidates = useMemo(
    () => (units || []).filter((u) => u.unitGroupId !== group._id),
    [units, group._id],
  )
  if (!candidates.length) return null
  const submit = async () => {
    try {
      await assign({ unitIds: selected, groupId: group._id })
      showToast(`Added ${selected.length} to ${group.name}`, 'success')
      setSelected([])
    } catch (err) {
      showToast(errorMessage(err, 'Could not add the units'), 'error')
    }
  }
  return (
    <div className="mt-3 flex flex-col sm:flex-row sm:items-end gap-2">
      <Field label="Add units" htmlFor={`assign-${group._id}`} className="flex-1">
        <Select
          id={`assign-${group._id}`}
          multiple
          className="min-h-24"
          value={selected}
          onChange={(e) => setSelected(Array.from(e.target.selectedOptions).map((o) => o.value))}
        >
          {candidates.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
              {u.unitGroup ? ` (now ${u.unitGroup})` : ''}
            </option>
          ))}
        </Select>
      </Field>
      <Button size="sm" variant="secondary" disabled={!selected.length} onClick={submit}>
        Add to group
      </Button>
    </div>
  )
}

function Groups() {
  const { user, hasRole } = useAuth()
  const isAdmin = Boolean(hasRole?.('admin'))
  const { locations } = useLocation()
  const groups = useQuery(api.units.listGroups, user ? {} : 'skip')
  const waterBodies = useQuery(api.units.listWaterBodies, user ? {} : 'skip')
  const units = useQuery(api.cages.list, user ? {} : 'skip')
  const [adding, setAdding] = useState(null)

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Groups and water bodies"
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Units', href: '/units' },
          { label: 'Groups' },
        ]}
        description="Cage groups, pond blocks and RAS systems are managed together; water bodies hold cages or feed ponds."
        actions={
          isAdmin && (
            <>
              <Button size="sm" onClick={() => setAdding('group')}>Add group</Button>
              <Button size="sm" variant="secondary" onClick={() => setAdding('water')}>Add water body</Button>
            </>
          )
        }
        related={[{ label: 'Unit board', href: '/units' }]}
      />

      {adding && (
        <Card>
          <CardHeader title={adding === 'group' ? 'New group' : 'New water body'} />
          {adding === 'group' ? (
            <GroupForm waterBodies={waterBodies} locations={locations} onDone={() => setAdding(null)} />
          ) : (
            <WaterBodyForm locations={locations} onDone={() => setAdding(null)} />
          )}
        </Card>
      )}

      <Card padding={false}>
        <div className="px-5 py-4 border-b border-foam-deep">
          <h2 className="font-display text-lg font-medium">Groups</h2>
        </div>
        {groups === undefined ? (
          <p className="p-5 text-sm text-muted">Loading…</p>
        ) : groups.length === 0 ? (
          <EmptyState
            title="No groups yet"
            description="Group cages on a mooring line, ponds in a block or tanks on one filter loop to see and manage them together."
          />
        ) : (
          <ul className="divide-y divide-foam-deep">
            {groups.map((g) => (
              <li key={g._id} className="px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-chart-ink">
                    {g.name}{' '}
                    <span className="text-sm font-normal text-muted">{kindLabel(GROUP_KINDS, g.kind)}</span>
                  </p>
                  <p className="text-sm text-muted tabular-nums">
                    {g.unitCount} units · {g.stockedCount} stocked · {g.fishCount.toLocaleString()} fish
                    {g.waterBodyName ? ` · ${g.waterBodyName}` : ''}
                  </p>
                </div>
                {isAdmin && <AssignUnits group={g} units={units} />}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card padding={false}>
        <div className="px-5 py-4 border-b border-foam-deep">
          <h2 className="font-display text-lg font-medium">Water bodies</h2>
        </div>
        {waterBodies === undefined ? (
          <p className="p-5 text-sm text-muted">Loading…</p>
        ) : waterBodies.length === 0 ? (
          <EmptyState title="No water bodies yet" description="Add the lake or reservoir your cages sit in, or the source that feeds your ponds." />
        ) : (
          <ul className="divide-y divide-foam-deep">
            {waterBodies.map((w) => (
              <li key={w._id} className="px-5 py-3 flex flex-wrap justify-between gap-2 text-sm">
                <span className="font-medium text-chart-ink">{w.name}</span>
                <span className="text-muted tabular-nums">
                  {kindLabel(WATER_BODY_KINDS, w.kind)}
                  {w.latitude != null ? ` · ${w.latitude.toFixed(4)}, ${w.longitude.toFixed(4)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

export default function GroupsPage() {
  return (
    <ProtectedRoute>
      <Layout title="Groups and water bodies">
        <Groups />
      </Layout>
    </ProtectedRoute>
  )
}
