import { useCallback, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { Button, Field, Input, Select, Textarea } from './ui'
import { useToast } from './Toast'
import { errorMessage } from '../lib/errorMessage'
import { customPayload } from './CustomFields'
import FormLayout, { hiddenCoreKeys, useFormLayout } from './FormLayout'
import { useLocation } from '../contexts/LocationContext'

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
  { value: 'boat', label: 'Boat' },
  { value: 'vehicle', label: 'Vehicle' },
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
  const { locations, activeLocationId } = useLocation()
  const [form, setForm] = useState({
    name: '', kind: 'pump', unitId: unitId || '', unitGroupId: '', make: '', model: '', serialNumber: '', rating: '',
    installedOn: '', maintenanceIntervalDays: '', nextMaintenanceDue: '', spareId: '', notes: '', custom: {},
    locationId: '', assetTag: '', purchasedOn: '', purchaseCost: '', supplier: '', warrantyUntil: '',
  })
  const [saving, setSaving] = useState(false)
  const layout = useFormLayout('operations.equipment')
  const setCustom = useCallback((custom) => setForm((f) => ({ ...f, custom })), [])
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const t = (s) => s.trim() || undefined
  const coreValues = {
    name: form.name,
    kind: form.kind,
    unitId: form.unitId,
    unitGroupId: form.unitGroupId,
    locationId: form.locationId,
    assetTag: form.assetTag,
    make: form.make,
    model: form.model,
    serialNumber: form.serialNumber,
    rating: form.rating,
    installationDate: form.installedOn,
    purchasedOn: form.purchasedOn,
    purchaseCost: form.purchaseCost,
    supplier: form.supplier,
    warrantyUntil: form.warrantyUntil,
    maintenanceIntervalDays: form.maintenanceIntervalDays,
    nextMaintenanceDue: form.nextMaintenanceDue,
    sparePartId: form.spareId,
    notes: form.notes,
  }
  const FORM_KEY = {
    installationDate: 'installedOn',
    sparePartId: 'spareId',
  }

  const submit = async (e) => {
    e.preventDefault()
    // Optional fields a layout condition hides are not saved (a fixed unit always is).
    const hidden = hiddenCoreKeys(layout.sections, coreValues, form.custom)
    if (unitId) hidden.delete('unitId')
    const values = { ...form }
    for (const key of hidden) values[FORM_KEY[key] || key] = ''
    setSaving(true)
    try {
      await create({
        name: form.name,
        kind: form.kind,
        unitId: values.unitId || undefined,
        unitGroupId: values.unitGroupId || undefined,
        make: t(values.make),
        model: t(values.model),
        serialNumber: t(values.serialNumber),
        rating: t(values.rating),
        installedOn: values.installedOn || undefined,
        maintenanceIntervalDays: values.maintenanceIntervalDays === '' ? undefined : Number(values.maintenanceIntervalDays),
        nextMaintenanceDue: values.nextMaintenanceDue || undefined,
        sparePartItemIds: values.spareId ? [values.spareId] : undefined,
        notes: t(values.notes),
        locationId: values.unitId || values.unitGroupId ? undefined : values.locationId || activeLocationId || undefined,
        assetTag: t(values.assetTag),
        purchasedOn: values.purchasedOn || undefined,
        purchaseCost: values.purchaseCost === '' ? undefined : Number(values.purchaseCost),
        supplier: t(values.supplier),
        warrantyUntil: values.warrantyUntil || undefined,
        custom: customPayload(form.custom),
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
  const fields = {
    name: (
      <Field label="Name" htmlFor="eq-name" required>
        <Input id="eq-name" value={form.name} onChange={set('name')} required placeholder="Pump 1" />
      </Field>
    ),
    kind: (
      <Field label="Kind" htmlFor="eq-kind">
        <Select id="eq-kind" value={form.kind} onChange={set('kind')}>
          {EQUIPMENT_KINDS.map((k) => (
            <option key={k.value} value={k.value}>{k.label}</option>
          ))}
        </Select>
      </Field>
    ),
    unitId: !unitId ? (
      <Field label="Unit" htmlFor="eq-unit">
        <Select id="eq-unit" value={form.unitId} onChange={set('unitId')}>
          <option value="">None</option>
          {(units || []).map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </Select>
      </Field>
    ) : null,
    unitGroupId: groups && groups.length > 0 ? (
      <Field label="Group or system" htmlFor="eq-group">
        <Select id="eq-group" value={form.unitGroupId} onChange={set('unitGroupId')}>
          <option value="">None</option>
          {groups.map((g) => (
            <option key={g._id} value={g._id}>{g.name}</option>
          ))}
        </Select>
      </Field>
    ) : null,
    locationId: !unitId && !form.unitId && !form.unitGroupId && (locations || []).length > 1 ? (
      <Field label="Site" htmlFor="eq-site" hint="For boats, vehicles and generators not tied to a unit">
        <Select id="eq-site" value={form.locationId || activeLocationId || ''} onChange={set('locationId')}>
          <option value="">None</option>
          {(locations || []).map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </Select>
      </Field>
    ) : null,
    assetTag: (
      <Field label="Asset tag" htmlFor="eq-tag">
        <Input id="eq-tag" value={form.assetTag} onChange={set('assetTag')} />
      </Field>
    ),
    make: (
      <Field label="Make" htmlFor="eq-make">
        <Input id="eq-make" value={form.make} onChange={set('make')} />
      </Field>
    ),
    model: (
      <Field label="Model" htmlFor="eq-model">
        <Input id="eq-model" value={form.model} onChange={set('model')} />
      </Field>
    ),
    serialNumber: (
      <Field label="Serial number" htmlFor="eq-serial">
        <Input id="eq-serial" value={form.serialNumber} onChange={set('serialNumber')} />
      </Field>
    ),
    rating: (
      <Field label="Rating" htmlFor="eq-rating" hint="e.g. 2.2 kW, 40 m³/h">
        <Input id="eq-rating" value={form.rating} onChange={set('rating')} />
      </Field>
    ),
    installationDate: (
      <Field label="Installed on" htmlFor="eq-installed">
        <Input id="eq-installed" type="date" value={form.installedOn} onChange={set('installedOn')} />
      </Field>
    ),
    purchasedOn: (
      <Field label="Purchased on" htmlFor="eq-purchased">
        <Input id="eq-purchased" type="date" value={form.purchasedOn} onChange={set('purchasedOn')} />
      </Field>
    ),
    purchaseCost: (
      <Field label="Purchase cost" htmlFor="eq-cost">
        <Input id="eq-cost" type="number" min="0" step="0.01" inputMode="decimal" value={form.purchaseCost} onChange={set('purchaseCost')} />
      </Field>
    ),
    supplier: (
      <Field label="Supplier" htmlFor="eq-supplier">
        <Input id="eq-supplier" value={form.supplier} onChange={set('supplier')} />
      </Field>
    ),
    warrantyUntil: (
      <Field label="Warranty until" htmlFor="eq-warranty">
        <Input id="eq-warranty" type="date" value={form.warrantyUntil} onChange={set('warrantyUntil')} />
      </Field>
    ),
    maintenanceIntervalDays: (
      <Field label="Service every (days)" htmlFor="eq-interval">
        <Input id="eq-interval" type="number" min="1" inputMode="numeric" value={form.maintenanceIntervalDays} onChange={set('maintenanceIntervalDays')} />
      </Field>
    ),
    nextMaintenanceDue: (
      <Field label="Next service" htmlFor="eq-next">
        <Input id="eq-next" type="date" value={form.nextMaintenanceDue} onChange={set('nextMaintenanceDue')} />
      </Field>
    ),
    sparePartId: itemList.length > 0 ? (
      <Field label="Spare part kept" htmlFor="eq-spare" hint="From non-feed inventory">
        <Select id="eq-spare" value={form.spareId} onChange={set('spareId')}>
          <option value="">None</option>
          {itemList.map((i) => (
            <option key={i._id || i.id} value={i._id || i.id}>{i.name}</option>
          ))}
        </Select>
      </Field>
    ) : null,
    notes: (
      <Field label="Notes" htmlFor="eq-notes">
        <Textarea id="eq-notes" rows={2} value={form.notes} onChange={set('notes')} />
      </Field>
    ),
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <FormLayout
        formKey="operations.equipment"
        layout={layout}
        fields={fields}
        coreValues={coreValues}
        custom={form.custom}
        onCustomChange={setCustom}
        locationId={form.locationId || activeLocationId}
        core={{ kind: form.kind }}
        idPrefix="eq-cf"
      />
      <div className="flex justify-end gap-2">
        {onDone && <Button variant="secondary" onClick={onDone}>Cancel</Button>}
        <Button type="submit" disabled={saving || !form.name.trim()}>{saving ? 'Saving…' : 'Add equipment'}</Button>
      </div>
    </form>
  )
}
