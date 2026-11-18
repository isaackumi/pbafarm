import { useEffect, useState } from 'react'
import { useMutation } from 'convex/react'
import { AlertTriangle } from 'lucide-react'
import { api } from '../convex/_generated/api'
import { useLocation } from '../contexts/LocationContext'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { Button, Field, Input, Select, Textarea } from './ui'
import FarmLocationSelect from './FarmLocationSelect'
import UnitGeometryFields, { EMPTY_GEOMETRY, geometryArgs, geometryFromUnit } from './UnitGeometryFields'
import { usePermission } from '../hooks/usePermission'
import { MANUAL_TRANSITIONS, STATUS_LABELS } from '../convex/lib/unitStatus'

const EMPTY_FORM = {
  name: '',
  locationId: '',
  size: '',
  capacity: '',
  material: '',
  status: 'empty',
  notes: '',
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

  useEffect(() => {
    setForm(formFromCage(editCage))
  }, [editCage])

  useEffect(() => {
    setConfirmName('')
  }, [deleteCage])

  const patchField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }))
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
      const patch = {
        name: form.name.trim(),
        status: form.status,
        material: form.material.trim(),
        notes: form.notes.trim(),
      }
      if (locationId) {
        patch.locationId = locationId
        if (locName) patch.location = locName
      }
      Object.assign(patch, geometryArgs(form))
      if (form.capacity !== '' && form.capacity != null) {
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

  return (
    <>
      {editCage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 modal-backdrop"
            onClick={() => !saving && onCloseEdit?.()}
          />
          <div className="relative bg-surface rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-auto p-6">
            <h3 className="text-lg font-semibold text-chart-ink mb-1">Edit cage</h3>
            <p className="text-sm text-muted mb-4">
              Update details for <span className="font-medium">{editCage.name}</span>.
            </p>
            <form onSubmit={handleSave} className="space-y-4">
              <Field label="Name">
                <Input
                  value={form.name}
                  onChange={(e) => patchField('name', e.target.value)}
                  required
                />
              </Field>
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
              <UnitGeometryFields value={form} idPrefix="edit-unit" onChange={patchField} />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Capacity (fish)">
                  <Input
                    type="number"
                    min="0"
                    className="font-data tabular-nums"
                    value={form.capacity}
                    onChange={(e) => patchField('capacity', e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Material">
                <Input
                  value={form.material}
                  onChange={(e) => patchField('material', e.target.value)}
                />
              </Field>
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
              <Field label="Notes">
                <Textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => patchField('notes', e.target.value)}
                />
              </Field>
              <div className="flex justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={saving}
                  onClick={onCloseEdit}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteCage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 modal-backdrop"
            onClick={() => !deleting && onCloseDelete?.()}
          />
          <div className="relative bg-surface rounded-xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-6 h-6 text-signal" />
              <h3 className="text-lg font-semibold text-chart-ink">Archive unit</h3>
            </div>
            <p className="text-sm text-muted mb-3">
              Archiving hides{' '}
              <span className="font-semibold text-chart-ink">{deleteCage.name}</span> from
              lists and pickers. Its records, batches and history stay. A unit that still
              holds fish cannot be archived; an admin can restore it later.
            </p>
            <Field label={`Type “${deleteCage.name}” to confirm`}>
              <Input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={deleteCage.name}
                autoFocus
              />
            </Field>
            <div className="flex justify-end gap-3 mt-5">
              <Button
                type="button"
                variant="secondary"
                disabled={deleting}
                onClick={onCloseDelete}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={
                  deleting ||
                  confirmName.trim() !== (deleteCage.name || '').trim()
                }
                onClick={handleDelete}
              >
                {deleting ? 'Archiving…' : 'Archive unit'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
