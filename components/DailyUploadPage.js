import React, { useState, useEffect } from 'react'
import { cageService } from '../lib/cageService'
import { feedTypeService } from '../lib/feedTypeService'
import { dailyRecordService } from '../lib/databaseService'
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

const DailyUploadPage = () => {
  const [cages, setCages] = useState([])
  const [feedTypes, setFeedTypes] = useState([])
  const [selectedCage, setSelectedCage] = useState('')
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    mortalityCount: 0,
    feedAmount: 0,
    feedTypeId: '',
    feedPrice: 0,
    notes: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadLookups()
  }, [])

  const loadLookups = async () => {
    try {
      const [cageRes, feedRes] = await Promise.all([
        cageService.getActiveCages(),
        feedTypeService.getAllFeedTypes(),
      ])
      if (cageRes.data) setCages(cageRes.data)
      if (feedRes.data) setFeedTypes(feedRes.data)
    } catch (err) {
      console.error('Error loading lookups:', err)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!selectedCage) {
      setError('Please select a cage')
      return
    }
    const feedAmount = Number(formData.feedAmount) || 0
    if (feedAmount > 0 && !formData.feedTypeId) {
      setError('Feed type is required when feed amount > 0')
      return
    }

    setLoading(true)
    try {
      const selectedFeed = feedTypes.find(
        (f) => (f.id || f._id) === formData.feedTypeId,
      )
      const feedPrice =
        Number(formData.feedPrice) ||
        Number(selectedFeed?.price_per_kg || selectedFeed?.pricePerKg || 0)

      const response = await dailyRecordService.createDailyRecord({
        cage_id: selectedCage,
        cageId: selectedCage,
        date: formData.date,
        feed_amount: feedAmount,
        feedAmount,
        feed_type_id: formData.feedTypeId || undefined,
        feedTypeId: formData.feedTypeId || undefined,
        feed_price: feedPrice,
        feedPrice,
        feed_cost: feedAmount * feedPrice,
        feedCost: feedAmount * feedPrice,
        mortality: Number(formData.mortalityCount) || 0,
        notes: formData.notes || undefined,
      })

      if (response.error) throw response.error

      setSelectedCage('')
      setFormData({
        date: new Date().toISOString().split('T')[0],
        mortalityCount: 0,
        feedAmount: 0,
        feedTypeId: '',
        feedPrice: 0,
        notes: '',
      })
      alert('Daily record created — stock updated on ledger')
    } catch (err) {
      console.error('Error creating daily record:', err)
      setError(err.message || 'Error creating daily record')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e) => {
    const { name, value, type } = e.target
    setFormData({
      ...formData,
      [name]: type === 'number' ? parseFloat(value) || 0 : value,
    })
  }

  return (
    <FormCard
      title="Record details"
      subtitle="Choose a cage, then log mortality and feed for the day."
    >
      {error && (
        <div className="mb-5 text-sm text-signal border border-signal/20 bg-signal/10 rounded-xl p-3">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        <FormSection title="Cage & date">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="Cage" htmlFor="cage" required className="md:col-span-2">
              <Select
                id="cage"
                value={selectedCage}
                onChange={(e) => setSelectedCage(e.target.value)}
                required
              >
                <option value="">Choose a cage…</option>
                {cages.map((cage) => (
                  <option key={cage._id || cage.id} value={cage._id || cage.id}>
                    {cage.name} — {cage.status}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date" htmlFor="date" required>
              <Input
                id="date"
                type="date"
                name="date"
                value={formData.date}
                onChange={handleChange}
                required
              />
            </Field>
            <Field
              label="Mortality"
              htmlFor="mortalityCount"
              hint="Number of fish lost today"
            >
              <Input
                id="mortalityCount"
                type="number"
                name="mortalityCount"
                value={formData.mortalityCount}
                onChange={handleChange}
                min="0"
                className="font-data"
              />
            </Field>
          </div>
        </FormSection>

        <FormSection
          title="Feed"
          description="Feed amounts deduct stock through the inventory ledger."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="Feed type" htmlFor="feedTypeId">
              <Select
                id="feedTypeId"
                name="feedTypeId"
                value={formData.feedTypeId}
                onChange={handleChange}
              >
                <option value="">Select…</option>
                {feedTypes.map((f) => (
                  <option key={f.id || f._id} value={f.id || f._id}>
                    {f.name} ({Number(f.current_stock).toFixed(1)} kg)
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Feed amount (kg)" htmlFor="feedAmount">
              <Input
                id="feedAmount"
                type="number"
                name="feedAmount"
                step="0.1"
                value={formData.feedAmount}
                onChange={handleChange}
                min="0"
                className="font-data"
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
              placeholder="Observations, weather, unusual events…"
            />
          </Field>
        </FormSection>

        <FormActions>
          <Button type="submit" disabled={loading} size="lg">
            {loading ? 'Saving…' : 'Save daily record'}
          </Button>
        </FormActions>
      </form>
    </FormCard>
  )
}

export default DailyUploadPage
