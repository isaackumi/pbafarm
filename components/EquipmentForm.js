import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { Button, Field, Input, Select, Textarea } from './ui'
import { useToast } from './Toast'
import { errorMessage } from '../lib/errorMessage'

export const EQUIPMENT_KINDS = [
  { value: 'pump', label: 'Pump' },
  { value: 'blower', label: 'Blower' },
  { value: 'aerator', label: 'Aerator' },
  { value: 'biofilter', label: 'Biofilter' },
  { value: 'mechanical_filter', label: 'Mechanical filter' },
  { value: 'uv', label: 'UV steriliser' },
  { value: 'oxygen_cone', label: 'Oxygen cone' },
  { value: 'net', label: 'Net' },
  { value: 'mooring', label: 'Mooring' },
  { value: 'feeder', label: 'Feeder' },
  { value: 'generator', label: 'Generator' },
  { value: 'sensor', label: 'Sensor' },
  { value: 'other', label: 'Other' },
]

export const EQUIPMENT_STATUS = {
  in_service: 'In service',
  standby: 'Standby',
  faulty: 'Faulty',
  under_maintenance: 'Under maintenance',
  retired: 'Retired',
}

/** Register a piece of equipment (admin). `unitId` fixes the unit. */
export default function EquipmentForm({ unitId, onDone }) {
  const { showToast } = useToast()
  const create = useMutation(api.equipment.create)
  const units = useQuery(api.cages.list, unitId ? 'skip' : {})
  const groups = useQuery(api.units.listGroups, {})
  const items = useQuery(api.inventoryItems.listItems, {})
  const [form, setForm] = useState({
    name: '', kind: 'pump', unitId: unitId || '', unitGroupId: '', make: '', model: '', serialNumber: '', rating: '',
    installedOn: '', maintenanceIntervalDays: '', nextMaintenanceDue: '', spareId: '', notes: '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const t = (s) => s.trim() || undefined

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await create({
        name: form.name,
        kind: form.kind,
        unitId: form.unitId || undefined,
        unitGroupId: form.unitGroupId || undefined,
        make: t(form.make),
        model: t(form.model),
        serialNumber: t(form.serialNumber),
        rating: t(form.rating),
        installedOn: form.installedOn || undefined,
        maintenanceIntervalDays: form.maintenanceIntervalDays === '' ? undefined : Number(form.maintenanceIntervalDays),
        nextMaintenanceDue: form.nextMaintenanceDue || undefined,
        sparePartItemIds: form.spareId ? [form.spareId] : undefined,
        notes: t(form.notes),
      })
      showToast(`Added ${form.name.trim()}`, 'success')
      onDone?.()
    } catch (err) {
      showToast(errorMessage(err, 'Could not add the equipment'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const itemList = Array.isArray(items) ? items : []
  return (
    <form onSubmit={submit} className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <Field label="Name" htmlFor="eq-name" required>
        <Input id="eq-name" value={form.name} onChange={set('name')} required placeholder="Pump 1" />
      </Field>
      <Field label="Kind" htmlFor="eq-kind">
        <Select id="eq-kind" value={form.kind} onChange={set('kind')}>
          {EQUIPMENT_KINDS.map((k) => (
            <option key={k.value} value={k.value}>{k.label}</option>
          ))}
        </Select>
      </Field>
      {!unitId && (
        <Field label="Unit" htmlFor="eq-unit">
          <Select id="eq-unit" value={form.unitId} onChange={set('unitId')}>
            <option value="">None</option>
            {(units || []).map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </Select>
        </Field>
      )}
      {groups && groups.length > 0 && (
        <Field label="Group or system" htmlFor="eq-group">
          <Select id="eq-group" value={form.unitGroupId} onChange={set('unitGroupId')}>
            <option value="">None</option>
            {groups.map((g) => (
              <option key={g._id} value={g._id}>{g.name}</option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Make" htmlFor="eq-make">
        <Input id="eq-make" value={form.make} onChange={set('make')} />
      </Field>
      <Field label="Model" htmlFor="eq-model">
        <Input id="eq-model" value={form.model} onChange={set('model')} />
      </Field>
      <Field label="Serial number" htmlFor="eq-serial">
        <Input id="eq-serial" value={form.serialNumber} onChange={set('serialNumber')} />
      </Field>
      <Field label="Rating" htmlFor="eq-rating" hint="e.g. 2.2 kW, 40 m³/h">
        <Input id="eq-rating" value={form.rating} onChange={set('rating')} />
      </Field>
      <Field label="Installed on" htmlFor="eq-installed">
        <Input id="eq-installed" type="date" value={form.installedOn} onChange={set('installedOn')} />
      </Field>
      <Field label="Service every (days)" htmlFor="eq-interval">
        <Input id="eq-interval" type="number" min="1" inputMode="numeric" value={form.maintenanceIntervalDays} onChange={set('maintenanceIntervalDays')} />
      </Field>
      <Field label="Next service" htmlFor="eq-next">
        <Input id="eq-next" type="date" value={form.nextMaintenanceDue} onChange={set('nextMaintenanceDue')} />
      </Field>
      {itemList.length > 0 && (
        <Field label="Spare part kept" htmlFor="eq-spare" hint="From non-feed inventory">
          <Select id="eq-spare" value={form.spareId} onChange={set('spareId')}>
            <option value="">None</option>
            {itemList.map((i) => (
              <option key={i._id || i.id} value={i._id || i.id}>{i.name}</option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Notes" htmlFor="eq-notes" className="col-span-2 sm:col-span-3">
        <Textarea id="eq-notes" rows={2} value={form.notes} onChange={set('notes')} />
      </Field>
      <div className="col-span-2 sm:col-span-3 flex justify-end gap-2">
        {onDone && <Button variant="secondary" onClick={onDone}>Cancel</Button>}
        <Button type="submit" disabled={saving || !form.name.trim()}>{saving ? 'Saving…' : 'Add equipment'}</Button>
      </div>
    </form>
  )
}
