import React, { useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../convex/_generated/api'
import { useToast } from './Toast'
import { Button, Field, FormActions, FormSection, Input, Select } from './ui'

const SIZE_CATEGORIES = [
  { category: 'S3', range: '800g above' },
  { category: 'S2', range: '700g-800g' },
  { category: 'S1', range: '600g-700g' },
  { category: 'Reg', range: '500g-600g' },
  { category: 'Eco', range: '400g-500g' },
  { category: 'SS', range: '300g-400g' },
  { category: 'SB', range: '200g-300g' },
  { category: 'Rej', range: 'less than 200g' }
]

const SamplingForm = ({ harvestId, onComplete }) => {
  const [formData, setFormData] = useState({
    crateSize: '50', // Default to 50kg crate
    samples: SIZE_CATEGORIES.map(category => ({
      category: category.category,
      range: category.range,
      quantity: '',
      abw: ''
    }))
  })
  const [loading, setLoading] = useState(false)
  const { showToast } = useToast()
  const createSampling = useMutation(api.harvest.createSampling)

  const handleSamplingDataChange = (index, field, value) => {
    const newSamples = [...formData.samples]
    newSamples[index][field] = value
    setFormData(prev => ({ ...prev, samples: newSamples }))
  }

  const handleCrateSizeChange = (value) => {
    setFormData(prev => ({
      ...prev,
      crateSize: value
    }))
  }

  const validateForm = () => {
    // Check if at least one sampling data point is entered
    const hasSamplingData = formData.samples.some(
      sample => sample.quantity && sample.abw
    )
    if (!hasSamplingData) {
      showToast('Please enter at least one sampling data point', 'error')
      return false
    }

    return true
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validateForm()) return

    setLoading(true)
    try {
      const crateSize = parseInt(formData.crateSize)
      await createSampling({
        harvestId,
        crateSize: Number.isFinite(crateSize) ? crateSize : undefined,
        samples: formData.samples
          .filter(sample => sample.quantity && sample.abw)
          .map(sample => ({
            size: sample.category,
            range: sample.range,
            quantity: parseInt(sample.quantity),
            abw: parseFloat(sample.abw)
          }))
      })

      showToast('Sampling data saved successfully', 'success')
      if (onComplete) {
        onComplete()
      }
    } catch (error) {
      console.error('Error saving sampling data:', error)
      showToast(error.message || 'Error saving sampling data', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <FormSection title="Harvest sampling">
        <Field label="Crate size" htmlFor="sampling-crate" className="max-w-xs">
          <Select
            id="sampling-crate"
            value={formData.crateSize}
            onChange={(e) => handleCrateSizeChange(e.target.value)}
          >
            <option value="50">50 kg</option>
            <option value="25">25 kg</option>
          </Select>
        </Field>

        <div>
          <p className="text-sm font-semibold text-chart-ink mb-2">Samples</p>
          <div className="overflow-x-auto rounded-xl border border-foam-deep">
            <table className="min-w-full divide-y divide-foam-deep">
              <thead className="bg-foam">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted">Size</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted">Range</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted">
                    Quantity per crate
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted">ABW (g)</th>
                </tr>
              </thead>
              <tbody className="bg-surface divide-y divide-foam-deep">
                {formData.samples.map((sample, index) => (
                  <tr key={sample.category}>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-chart-ink">
                      {sample.category}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-muted">
                      {sample.range}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap min-w-[8rem]">
                      <Input
                        type="number"
                        aria-label={`${sample.category} quantity per crate`}
                        value={sample.quantity}
                        onChange={(e) => handleSamplingDataChange(index, 'quantity', e.target.value)}
                        className="tabular-nums"
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap min-w-[8rem]">
                      <Input
                        type="number"
                        aria-label={`${sample.category} ABW in grams`}
                        value={sample.abw}
                        onChange={(e) => handleSamplingDataChange(index, 'abw', e.target.value)}
                        step="0.1"
                        className="tabular-nums"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </FormSection>

      <FormActions className="justify-end">
        <Button type="button" variant="secondary" onClick={() => onComplete()}>
          Cancel
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? 'Saving…' : 'Save sampling'}
        </Button>
      </FormActions>
    </form>
  )
}

export default SamplingForm
