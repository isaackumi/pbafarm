import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { cageService } from '../lib/databaseService'
import {
  Button,
  FormCard,
  FormActions,
  FormSection,
  Field,
  Input,
  Select,
  Textarea,
} from './ui'

const CreateCageForm = () => {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [nameError, setNameError] = useState('')
  const [existingCages, setExistingCages] = useState([])
  const [cageCode, setCageCode] = useState('')
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    location: '',
    size: '',
    capacity: '',
    dimensions: '',
    material: '',
    installation_date: '',
    notes: '',
    status: 'empty',
  })

  useEffect(() => {
    async function fetchExistingCages() {
      try {
        const { data, error: fetchError } = await cageService.getAllCages()
        if (fetchError) throw fetchError
        setExistingCages(data || [])
        generateCageCode(data || [])
      } catch (err) {
        console.error('Error fetching existing cages:', err)
      }
    }

    fetchExistingCages()
  }, [])

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

      const nameExists = existingCages.some(
        (cage) => cage.name.toLowerCase() === formData.name.toLowerCase(),
      )
      if (nameExists) {
        throw new Error(
          'This cage name already exists. Please choose a unique name.',
        )
      }

      const cageData = {
        name: formData.name.trim(),
        code: formData.code,
        location: formData.location ? formData.location.trim() : null,
        size: formData.size ? parseFloat(formData.size) : null,
        capacity: formData.capacity ? parseInt(formData.capacity, 10) : null,
        dimensions: formData.dimensions ? formData.dimensions.trim() : null,
        material: formData.material ? formData.material.trim() : null,
        installation_date: formData.installation_date || null,
        notes: formData.notes ? formData.notes.trim() : null,
        status: formData.status || 'empty',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      const { data, error: createError } = await cageService.createCage(cageData)
      if (createError) throw createError

      setMessage('Cage created successfully!')
      setFormData({
        name: '',
        code: '',
        location: '',
        size: '',
        capacity: '',
        dimensions: '',
        material: '',
        installation_date: '',
        notes: '',
        status: 'empty',
      })
      generateCageCode([...existingCages, data])

      setTimeout(() => {
        router.push('/cages')
      }, 2000)
    } catch (err) {
      console.error('Error creating cage:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <FormCard
      title="Cage details"
      subtitle="Register a physical cage. Stock it separately after creation."
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
        <FormSection title="Identity">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
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
            <Field label="Location" htmlFor="location">
              <Input
                id="location"
                type="text"
                name="location"
                value={formData.location}
                onChange={handleChange}
                placeholder="e.g., North Pond, Section A"
              />
            </Field>
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
          </div>
        </FormSection>

        <FormSection title="Capacity & build">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="Size (m³)" htmlFor="size">
              <Input
                id="size"
                type="number"
                name="size"
                value={formData.size}
                onChange={handleChange}
                step="0.1"
                className="font-data"
                placeholder="Volume in cubic meters"
              />
            </Field>
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
            <Field label="Installation date" htmlFor="installation_date">
              <Input
                id="installation_date"
                type="date"
                name="installation_date"
                value={formData.installation_date}
                onChange={handleChange}
              />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Notes">
          <Field label="Optional notes" htmlFor="notes">
            <Textarea
              id="notes"
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              placeholder="Optional notes about the cage"
            />
          </Field>
        </FormSection>

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
