import { useEffect, useState } from 'react'
import { useMutation } from 'convex/react'
import { AlertTriangle } from 'lucide-react'
import { api } from '../convex/_generated/api'
import { useLocation } from '../contexts/LocationContext'
import { useToast } from './Toast'
import { Button, Field, Input, Select, Textarea } from './ui'
import FarmLocationSelect from './FarmLocationSelect'

const EMPTY_FORM = {
  name: '',
  locationId: '',
  size: '',
  capacity: '',
  material: '',
  status: 'empty',
  notes: '',
}

const STATUS_OPTIONS = [
  'empty',
  'active',
  'maintenance',
  'fallow',
  'harvesting',
  'harvested',
]

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
      if (form.size !== '' && form.size != null) {
        const n = Number(form.size)
        if (!Number.isFinite(n) || n < 0) {
          throw new Error('Size must be a valid number')
        }
        patch.size = n
      }
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
      showToast('Type the cage name exactly to confirm delete', 'error')
      return
    }

    setDeleting(true)
    try {
      await removeCage({ id })
      showToast(`Deleted cage “${deleteCage.name}”`, 'success')
      onDeleted?.(id)
      onCloseDelete?.()
    } catch (err) {
      showToast(err?.message || 'Failed to delete cage', 'error')
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
          <div className="relative bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-auto p-6">
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
              <div className="grid grid-cols-2 gap-4">
                <Field label="Size (m³)">
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    className="font-data"
                    value={form.size}
                    onChange={(e) => patchField('size', e.target.value)}
                  />
                </Field>
                <Field label="Capacity (fish)">
                  <Input
                    type="number"
                    min="0"
                    className="font-data"
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
              <Field label="Status">
                <Select
                  value={form.status}
                  onChange={(e) => patchField('status', e.target.value)}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
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
          <div className="relative bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-6 h-6 text-signal" />
              <h3 className="text-lg font-semibold text-chart-ink">Delete cage</h3>
            </div>
            <p className="text-sm text-muted mb-3">
              This permanently removes{' '}
              <span className="font-semibold text-chart-ink">{deleteCage.name}</span>
              {deleteCage.status === 'active'
                ? ' (currently active — related records may remain orphaned).'
                : '.'}{' '}
              This cannot be undone.
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
              <button
                type="button"
                disabled={
                  deleting ||
                  confirmName.trim() !== (deleteCage.name || '').trim()
                }
                onClick={handleDelete}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-signal hover:opacity-90 disabled:opacity-40 min-h-10"
              >
                {deleting ? 'Deleting…' : 'Delete cage'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
