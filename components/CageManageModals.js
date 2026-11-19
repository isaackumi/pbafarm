import { useCallback, useEffect, useState } from 'react'
import { useMutation } from 'convex/react'
import { AlertTriangle } from 'lucide-react'
import { api } from '../convex/_generated/api'
import { useLocation } from '../contexts/LocationContext'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { useT } from '../lib/i18n/context'
import { Button, Field, Input, Modal, Select, Textarea } from './ui'
import FarmLocationSelect from './FarmLocationSelect'
import UnitGeometryFields, { EMPTY_GEOMETRY, geometryArgs, geometryFromUnit } from './UnitGeometryFields'
import { usePermission } from '../hooks/usePermission'
import FormLayout, { hiddenCoreKeys, useFormLayout } from './FormLayout'
import { MANUAL_TRANSITIONS, STATUS_LABELS } from '../convex/lib/unitStatus'

const EMPTY_FORM = {
  name: '',
  locationId: '',
  size: '',
  capacity: '',
  material: '',
  status: 'empty',
  notes: '',
  custom: {},
  ...EMPTY_GEOMETRY,
}

/** The current status plus where it may go by hand (PROD-013). */
function statusOptions(current) {
  const from = current || 'empty'
  return [from, ...(MANUAL_TRANSITIONS[from] || [])]
}

function cageIdOf(cage) {
  return cage?.id || cage?._id || null
}

function formFromCage(cage) {
  if (!cage) return { ...EMPTY_FORM }
  return {
    name: cage.name || '',
    locationId: cage.location_id || cage.locationId || '',
    size: cage.size ?? '',
    capacity: cage.capacity ?? '',
    material: cage.material || '',
    status: cage.status || 'empty',
    notes: cage.notes || '',
    custom: cage.custom || {},
    ...geometryFromUnit(cage),
  }
}

/**
 * Edit + delete cage modals. Controlled by `editCage` / `deleteCage` props.
 */
export default function CageManageModals({
  editCage,
  deleteCage,
  onCloseEdit,
  onCloseDelete,
  onSaved,
  onDeleted,
}) {
  const t = useT()
  const { showToast } = useToast()
  const { locations, activeLocationId } = useLocation()
  const { hasRole } = useAuth()
  const isAdmin = usePermission('production.stock.adjust')
  const updateCage = useMutation(api.cages.update)
  const removeCage = useMutation(api.cages.remove)

  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [customTouched, setCustomTouched] = useState(false)
  const layout = useFormLayout('setup.cage')

  useEffect(() => {
    setForm(formFromCage(editCage))
    setCustomTouched(false)
  }, [editCage])

  useEffect(() => {
    setConfirmName('')
  }, [deleteCage])

  const patchField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }
  const setCustom = useCallback((custom) => {
    setForm((prev) => ({ ...prev, custom }))
    setCustomTouched(true)
  }, [])
  const coreValues = {
    name: form.name,
    locationId: form.locationId,
    status: form.status,
    unitType: form.unitType,
    capacity: form.capacity,
    material: form.material,
    notes: form.notes,
  }

  const handleSave = async (e) => {
    e?.preventDefault?.()
    const id = cageIdOf(editCage)
    if (!id) return
    if (!form.name.trim()) {
      showToast('Cage name is required', 'error')
      return
    }

    setSaving(true)
    try {
      const locationId = form.locationId || activeLocationId || undefined
      const locName = locationId
        ? (locations || []).find((l) => (l.id || l._id) === locationId)?.name
        : undefined
      // Optional fields a layout condition hides are left as they are.
      const hidden = hiddenCoreKeys(layout.sections, coreValues, form.custom)
      const patch = { name: form.name.trim() }
      if (!hidden.has('status')) patch.status = form.status
      if (!hidden.has('material')) patch.material = form.material.trim()
      if (!hidden.has('notes')) patch.notes = form.notes.trim()
      if (customTouched) patch.custom = form.custom || {}
      if (locationId) {
        patch.locationId = locationId
        if (locName) patch.location = locName
      }
      Object.assign(patch, geometryArgs(form))
      if (!hidden.has('capacity') && form.capacity !== '' && form.capacity != null) {
        const n = Number(form.capacity)
        if (!Number.isFinite(n) || n < 0) {
          throw new Error('Capacity must be a valid number')
        }
        patch.capacity = n
      }

      await updateCage({ id, patch })
      showToast('Cage updated successfully', 'success')
      onSaved?.(id)
      onCloseEdit?.()
    } catch (err) {
      showToast(err?.message || 'Failed to update cage', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    const id = cageIdOf(deleteCage)
    if (!id) return
    if (confirmName.trim() !== (deleteCage.name || '').trim()) {
      showToast('Type the unit name exactly to confirm', 'error')
      return
    }

    setDeleting(true)
    try {
      await removeCage({ id })
      showToast(`Archived “${deleteCage.name}”`, 'success')
      onDeleted?.(id)
      onCloseDelete?.()
    } catch (err) {
      showToast(err?.message || 'Could not archive this unit', 'error')
    } finally {
      setDeleting(false)
    }
  }

  const layoutFields = {
    code: null,
    name: (
      <Field label="Name">
        <Input
          value={form.name}
          onChange={(e) => patchField('name', e.target.value)}
          required
        />
      </Field>
    ),
    locationId: (
      <Field
        label="Farm location"
        hint="Defaults to header location"
      >
        <FarmLocationSelect
          value={form.locationId}
          onChange={(e) => patchField('locationId', e.target.value)}
          syncWithHeader={false}
        />
      </Field>
    ),
    status: (
      <Field
        label="Status"
        hint={isAdmin ? undefined : 'Only an admin can change the status by hand'}
      >
        <Select
          value={form.status}
          disabled={!isAdmin}
          onChange={(e) => patchField('status', e.target.value)}
        >
          {statusOptions(editCage?.status).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s] || s}
            </option>
          ))}
        </Select>
      </Field>
    ),
    unitType: <UnitGeometryFields value={form} idPrefix="edit-unit" onChange={patchField} />,
    capacity: (
      <Field label="Capacity (fish)">
        <Input
          type="number"
          min="0"
          className="font-data tabular-nums"
          value={form.capacity}
          onChange={(e) => patchField('capacity', e.target.value)}
        />
      </Field>
    ),
    dimensions: null,
    material: (
      <Field label="Material">
        <Input
          value={form.material}
          onChange={(e) => patchField('material', e.target.value)}
        />
      </Field>
    ),
    installationDate: null,
    notes: (
      <Field label="Notes">
        <Textarea
          rows={3}
          value={form.notes}
          onChange={(e) => patchField('notes', e.target.value)}
        />
      </Field>
    ),
  }

  return (
    <>
      <Modal
        open={!!editCage}
        onClose={onCloseEdit}
        dismissible={!saving}
        size="lg"
        as="form"
        onSubmit={handleSave}
        title={t('overlay.cage.editTitle')}
        description={t('overlay.cage.editBody', { name: editCage?.name || '' })}
        bodyClassName="space-y-6"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={onCloseEdit}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t('common.saving') : t('overlay.cage.save')}
            </Button>
          </>
        }
      >
        <FormLayout
          formKey="setup.cage"
          layout={layout}
          fields={layoutFields}
          coreValues={coreValues}
          custom={form.custom}
          onCustomChange={setCustom}
          locationId={form.locationId || activeLocationId}
          core={{ unitType: form.unitType, status: form.status }}
          idPrefix="edit-cage-cf"
        />
      </Modal>

      <Modal
        open={!!deleteCage}
        onClose={onCloseDelete}
        dismissible={!deleting}
        role="alertdialog"
        tone="danger"
        title={t('overlay.cage.archiveTitle', { name: deleteCage?.name || '' })}
        description={t('overlay.cage.archiveBody')}
        icon={<AlertTriangle aria-hidden />}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={deleting}
              onClick={onCloseDelete}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={
                deleting ||
                confirmName.trim() !== (deleteCage?.name || '').trim()
              }
              onClick={handleDelete}
            >
              {deleting ? t('overlay.cage.archiving') : t('overlay.cage.archive')}
            </Button>
          </>
        }
      >
        {deleteCage && (
          <div className="flex flex-col gap-2">
            <label htmlFor="archive-unit-confirm" className="text-sm leading-[18px] text-muted">
              {t('overlay.cage.typePrefix')}{' '}
              <span className="font-mono text-text">{deleteCage.name}</span>{' '}
              {t('overlay.cage.typeSuffix')}
            </label>
            <input
              id="archive-unit-confirm"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={deleteCage.name}
              autoComplete="off"
              autoFocus
              className="w-full rounded-input border border-line-strong bg-surface px-4 py-3 text-sm text-text placeholder:text-faint focus:border-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan/40"
            />
          </div>
        )}
      </Modal>
    </>
  )
}
