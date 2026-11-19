import React, { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { cageCreateArgs } from '../lib/recordArgs'
import { errorMessage } from '../lib/errorMessage'
import { useLocation } from '../contexts/LocationContext'
import FarmLocationSelect from './FarmLocationSelect'
import {
  Button,
  FormCard,
  FormActions,
  Field,
  Input,
  Select,
  Textarea,
} from './ui'
import UnitGeometryFields, { EMPTY_GEOMETRY, geometryArgs } from './UnitGeometryFields'
import { unitLabel } from '../lib/format'
import { customPayload } from './CustomFields'
import FormLayout, { hiddenCoreKeys, useFormLayout } from './FormLayout'

const CreateCageForm = () => {
  const router = useRouter()
  const { activeLocationId, activeLocation, locationArgs, locations } =
    useLocation()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [nameError, setNameError] = useState('')
  const [cageCode, setCageCode] = useState('')
  const [geometry, setGeometry] = useState({ ...EMPTY_GEOMETRY })
  const [custom, setCustom] = useState({})
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    locationId: '',
    size: '',
    capacity: '',
    dimensions: '',
    material: '',
    installation_date: '',
    notes: '',
    status: 'empty',
  })

  const layout = useFormLayout('setup.cage')
  const existingResult = useQuery(api.cages.list, locationArgs)
  const existingCages = useMemo(() => existingResult || [], [existingResult])
  const createCage = useMutation(api.cages.create)
  const cagesLoaded = existingResult !== undefined

  // Suggest the next code once the site's cages have loaded.
  useEffect(() => {
    if (cagesLoaded) generateCageCode(existingResult)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cagesLoaded, locationArgs?.locationId])

  const generateCageCode = (cages) => {
    let maxCodeNumber = 0
    cages.forEach((cage) => {
      if (cage.code && cage.code.startsWith('C')) {
        const codeNumber = parseInt(cage.code.substring(1), 10)
        if (!isNaN(codeNumber) && codeNumber > maxCodeNumber) {
          maxCodeNumber = codeNumber
        }
      }
    })
    const newCode = `C${(maxCodeNumber + 1).toString().padStart(3, '0')}`
    setCageCode(newCode)
    setFormData((prev) => ({ ...prev, code: newCode }))
  }

  useEffect(() => {
    setNameError('')
    if (!formData.name) return
    const timer = setTimeout(() => {
      const nameExists = existingCages.some(
        (cage) => cage.name.toLowerCase() === formData.name.toLowerCase(),
      )
      if (nameExists) {
        setNameError(
          'This cage name already exists. Please choose a unique name.',
        )
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [formData.name, existingCages])

  const selectedLocationName = useMemo(() => {
    const id = formData.locationId || activeLocationId
    const match = (locations || []).find((l) => (l.id || l._id) === id)
    return match?.name || activeLocation?.name || ''
  }, [formData.locationId, activeLocationId, locations, activeLocation])

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')

    try {
      if (!formData.name) {
        throw new Error('Cage name is required')
      }

      const locationId = formData.locationId || activeLocationId
      if (!locationId) {
        throw new Error(
          'Select a farm location in the header (or create one under Farm Locations)',
        )
      }

      const nameExists = existingCages.some(
        (cage) => cage.name.toLowerCase() === formData.name.toLowerCase(),
      )
      if (nameExists) {
        throw new Error(
          'This cage name already exists. Please choose a unique name.',
        )
      }

      // Optional fields a layout condition hides are not saved.
      const hidden = hiddenCoreKeys(layout.sections, coreValues, custom)
      const shown = (key, value) => (hidden.has(key) ? '' : value)
      const cageData = {
        name: formData.name.trim(),
        code: formData.code,
        locationId,
        location: selectedLocationName || undefined,
        ...geometryArgs(geometry),
        capacity: shown('capacity', formData.capacity) ? parseInt(formData.capacity, 10) : undefined,
        dimensions: shown('dimensions', formData.dimensions) ? formData.dimensions.trim() : undefined,
        material: shown('material', formData.material) ? formData.material.trim() : undefined,
        installation_date: shown('installationDate', formData.installation_date) || undefined,
        notes: shown('notes', formData.notes) ? formData.notes.trim() : undefined,
        status: shown('status', formData.status) || 'empty',
        custom: customPayload(custom),
      }

      await createCage(cageCreateArgs(cageData, activeLocationId))

      setMessage(`${unitLabel(geometry.unitType)} created`)
      setGeometry({ ...EMPTY_GEOMETRY })
      setCustom({})
      setFormData({
        name: '',
        code: '',
        locationId: activeLocationId || '',
        size: '',
        capacity: '',
        dimensions: '',
        material: '',
        installation_date: '',
        notes: '',
        status: 'empty',
      })
      generateCageCode([...existingCages, { code: cageData.code }])

      setTimeout(() => {
        router.push('/cages')
      }, 2000)
    } catch (err) {
      console.error('Error creating cage:', err)
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const coreValues = {
    code: cageCode,
    name: formData.name,
    locationId: formData.locationId || activeLocationId || '',
    status: formData.status,
    unitType: geometry.unitType,
    capacity: formData.capacity,
    dimensions: formData.dimensions,
    material: formData.material,
    installationDate: formData.installation_date,
    notes: formData.notes,
  }

  const layoutFields = {
    code: (
      <Field
        label="Cage code"
        htmlFor="code"
        required
        hint="Auto-generated unique code"
      >
        <Input
          id="code"
          type="text"
          name="code"
          value={cageCode}
          readOnly
          className="bg-foam font-data"
        />
      </Field>
    ),
    name: (
      <Field
        label="Cage name"
        htmlFor="name"
        required
        error={nameError || undefined}
      >
        <Input
          id="name"
          type="text"
          name="name"
          value={formData.name}
          onChange={handleChange}
          placeholder="e.g., Cage 1, North A"
          required
          className={nameError ? 'border-signal' : ''}
        />
      </Field>
    ),
    locationId: (
      <Field
        label="Farm location"
        htmlFor="locationId"
        required
        hint="Defaults to the location selected in the header"
      >
        <FarmLocationSelect
          id="locationId"
          name="locationId"
          value={formData.locationId}
          onChange={handleChange}
          required
          allowEmpty={false}
          locked
        />
      </Field>
    ),
    status: (
      <Field label="Status" htmlFor="status">
        <Select
          id="status"
          name="status"
          value={formData.status}
          onChange={handleChange}
          required
        >
          <option value="empty">Empty</option>
          <option value="maintenance">Maintenance</option>
          <option value="fallow">Fallow</option>
        </Select>
      </Field>
    ),
    unitType: (
      <UnitGeometryFields
        value={geometry}
        idPrefix="create-unit"
        onChange={(key, value) => setGeometry((g) => ({ ...g, [key]: value }))}
      />
    ),
    capacity: (
      <Field label="Capacity (fish count)" htmlFor="capacity">
        <Input
          id="capacity"
          type="number"
          name="capacity"
          value={formData.capacity}
          onChange={handleChange}
          className="font-data"
          placeholder="Maximum fish capacity"
        />
      </Field>
    ),
    dimensions: (
      <Field label="Dimensions" htmlFor="dimensions">
        <Input
          id="dimensions"
          type="text"
          name="dimensions"
          value={formData.dimensions}
          onChange={handleChange}
          placeholder="e.g., 5m × 5m × 3m"
        />
      </Field>
    ),
    material: (
      <Field label="Material" htmlFor="material">
        <Input
          id="material"
          type="text"
          name="material"
          value={formData.material}
          onChange={handleChange}
          placeholder="e.g., HDPE, Metal frame"
        />
      </Field>
    ),
    installationDate: (
      <Field label="Installation date" htmlFor="installation_date">
        <Input
          id="installation_date"
          type="date"
          name="installation_date"
          value={formData.installation_date}
          onChange={handleChange}
        />
      </Field>
    ),
    notes: (
      <Field label="Optional notes" htmlFor="notes">
        <Textarea
          id="notes"
          name="notes"
          value={formData.notes}
          onChange={handleChange}
          placeholder="Optional notes about the cage"
        />
      </Field>
    ),
  }

  return (
    <FormCard
      title="Cage details"
      subtitle="Register a cage, pond, tank or other unit. Stock it separately after creation."
    >
      {error && (
        <div className="mb-5 text-sm text-signal border border-signal/20 bg-signal/10 rounded-xl p-3">
          {error}
        </div>
      )}
      {message && (
        <div className="mb-5 text-sm text-kelp border border-kelp/20 bg-kelp/10 rounded-xl p-3">
          {message}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        <FormLayout
          formKey="setup.cage"
          layout={layout}
          fields={layoutFields}
          coreValues={coreValues}
          custom={custom}
          onCustomChange={setCustom}
          locationId={formData.locationId || activeLocationId}
          core={{ unitType: geometry.unitType, status: formData.status }}
        />

        <FormActions>
          <Button type="submit" disabled={loading || !!nameError} size="lg">
            {loading ? 'Creating…' : 'Create cage'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push('/cages')}
          >
            Cancel
          </Button>
        </FormActions>
      </form>
    </FormCard>
  )
}

export default CreateCageForm
