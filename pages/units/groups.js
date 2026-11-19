import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import Link from 'next/link'
import { Plus, Waves } from 'lucide-react'
import { Button, Card, EmptyState, Field, GradientButton, Input, LoadingState, Select, Textarea } from '../../components/ui'
import UnitViewSwitch from '../../components/units/UnitViewSwitch'
import { useT } from '../../lib/i18n/context'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../contexts/AuthContext'
import { useLocation } from '../../contexts/LocationContext'
import { api } from '../../convex/_generated/api'
import { errorMessage } from '../../lib/errorMessage'
import { usePermission } from '../../hooks/usePermission'

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
  const t = useT()
  const { user } = useAuth()
  const isAdmin = usePermission('org.sites.manage')
  const { locations } = useLocation()
  const groups = useQuery(api.units.listGroups, user ? {} : 'skip')
  const waterBodies = useQuery(api.units.listWaterBodies, user ? {} : 'skip')
  const units = useQuery(api.cages.list, user ? {} : 'skip')
  const [adding, setAdding] = useState(null)

  const sectionHead = 'flex items-center justify-between gap-3 border-b border-line px-6 py-5'
  const sectionTitle = 'text-[17px] font-semibold leading-[22px] text-text'

  return (
    <Layout
      title={t('groupsUi.title')}
      eyebrow={t('groupsUi.eyebrow')}
      actions={
        isAdmin && (
          <>
            <GradientButton icon={Plus} onClick={() => setAdding('group')}>
              {t('groupsUi.addGroup')}
            </GradientButton>
            <GradientButton reverse icon={Waves} onClick={() => setAdding('water')}>
              {t('groupsUi.addWaterBody')}
            </GradientButton>
          </>
        )
      }
    >
      <div className="flex max-w-5xl flex-col gap-7">
        <UnitViewSwitch className="self-start" />

        {adding && (
          <Card>
            <h2 className={`${sectionTitle} mb-5`}>
              {adding === 'group' ? t('groupsUi.newGroup') : t('groupsUi.newWaterBody')}
            </h2>
            {adding === 'group' ? (
              <GroupForm waterBodies={waterBodies} locations={locations} onDone={() => setAdding(null)} />
            ) : (
              <WaterBodyForm locations={locations} onDone={() => setAdding(null)} />
            )}
          </Card>
        )}

        <section aria-labelledby="groups-title" className="rounded-card border border-line bg-surface shadow-[var(--shadow-card)]">
          <div className={sectionHead}>
            <h2 id="groups-title" className={sectionTitle}>
              {t('groupsUi.groups')}
            </h2>
            {groups?.length > 0 && <span className="text-[13px] text-muted tabular-nums">{groups.length}</span>}
          </div>
          {groups === undefined ? (
            <LoadingState />
          ) : groups.length === 0 ? (
            <EmptyState title={t('groupsUi.noGroups')} description={t('groupsUi.noGroupsBody')} />
          ) : (
            <ul>
              {groups.map((g) => (
                <li key={g._id} className="border-t border-line px-6 py-[14px] first:border-t-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-[2px]">
                      <Link
                        href={`/units?group=${g._id}`}
                        className="rounded-sm text-[14px] font-medium leading-[18px] text-text hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                      >
                        {g.name}
                      </Link>
                      <span className="text-xs leading-4 text-muted">
                        {kindLabel(GROUP_KINDS, g.kind)}
                        {g.waterBodyName ? ` · ${g.waterBodyName}` : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-6 text-[14px] tabular-nums">
                      <span className="text-muted">{t('groupsUi.units', { count: g.unitCount })}</span>
                      <span className="text-muted">{t('groupsUi.stocked', { count: g.stockedCount })}</span>
                      <span className="w-28 text-right text-text">{t('groupsUi.fish', { count: g.fishCount })}</span>
                    </div>
                  </div>
                  {isAdmin && <AssignUnits group={g} units={units} />}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="water-title" className="rounded-card border border-line bg-surface shadow-[var(--shadow-card)]">
          <div className={sectionHead}>
            <h2 id="water-title" className={sectionTitle}>
              {t('groupsUi.waterBodies')}
            </h2>
          </div>
          {waterBodies === undefined ? (
            <LoadingState />
          ) : waterBodies.length === 0 ? (
            <EmptyState title={t('groupsUi.noWater')} description={t('groupsUi.noWaterBody')} />
          ) : (
            <ul>
              {waterBodies.map((w) => (
                <li key={w._id} className="flex flex-wrap justify-between gap-2 border-t border-line px-6 py-[14px] text-[14px] first:border-t-0">
                  <span className="font-medium text-text">{w.name}</span>
                  <span className="text-muted tabular-nums">
                    {kindLabel(WATER_BODY_KINDS, w.kind)}
                    {w.latitude != null ? ` · ${w.latitude.toFixed(4)}, ${w.longitude.toFixed(4)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Layout>
  )
}

export default function GroupsPage() {
  return (
    <ProtectedRoute>
      <Groups />
    </ProtectedRoute>
  )
}
