import React, { useState, useEffect } from 'react'
import { getConvexHttpClient, api } from '../lib/convexBridge'
import { feedTypeService } from '../lib/feedTypeService'
import FeedTypeField from './FeedTypeField'
import { usePersistedForm } from '../hooks/usePersistedForm'
import { MORTALITY_CAUSES } from '../lib/farmHealth'
import { Button, Field, Input, Select, Textarea } from './ui'
import { localToday } from '../lib/format'

const DAILY_ENTRY_DEFAULTS = {
  date: localToday(),
  mortality: '',
  mortalityCause: 'unknown',
  feedAmount: '',
  feedTypeId: '',
  feedPrice: '',
  dissolvedOxygen: '',
  temperatureC: '',
  secchiCm: '',
  notes: '',
}

export default function DailyEntryForm({ cageId, onSubmit, onCancel }) {
  const persistKey = `daily-entry-form-${cageId || 'none'}`
  const { formData, setFormData, clear } = usePersistedForm(
    persistKey,
    DAILY_ENTRY_DEFAULTS,
  )
  const [feedTypes, setFeedTypes] = useState([])
  const [lookupsReady, setLookupsReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadFeedTypes = () =>
    feedTypeService
      .getActiveFeedTypes()
      .then(({ data }) => setFeedTypes(data || []))
      .finally(() => setLookupsReady(true))

  useEffect(() => {
    loadFeedTypes()
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!cageId) {
      setError('Cage is required')
      return
    }
    const feedAmount = Number(formData.feedAmount) || 0
    if (feedAmount > 0 && !formData.feedTypeId) {
      setError('Feed type is required when feed amount is greater than zero')
      return
    }
    setSaving(true)
    setError('')
    try {
      const client = getConvexHttpClient()
      const feedPrice = Number(formData.feedPrice) || 0
      await client.mutation(api.dailyRecords.create, {
        cageId,
        date: formData.date,
        feedAmount,
        feedTypeId: formData.feedTypeId || undefined,
        feedPrice,
        feedCost: feedAmount * feedPrice,
        mortality: Number(formData.mortality) || 0,
        mortalityCause:
          Number(formData.mortality) > 0
            ? formData.mortalityCause || 'unknown'
            : undefined,
        notes: formData.notes || undefined,
        dissolvedOxygen:
          formData.dissolvedOxygen !== ''
            ? Number(formData.dissolvedOxygen)
            : undefined,
        temperatureC:
          formData.temperatureC !== ''
            ? Number(formData.temperatureC)
            : undefined,
        secchiCm:
          formData.secchiCm !== '' ? Number(formData.secchiCm) : undefined,
      })
      clear()
      setFormData({
        ...DAILY_ENTRY_DEFAULTS,
        date: localToday(),
      })
      onSubmit?.(formData)
    } catch (err) {
      setError(err.message || 'Failed to save daily record')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-md mx-auto bg-surface border border-foam-deep p-6 rounded-xl shadow-sm">
      <h2 className="text-xl font-semibold text-chart-ink mb-1">Daily entry</h2>
      <p className="text-xs text-muted mb-4">Drafts survive a browser refresh.</p>
      {error && (
        <div
          role="alert"
          className="mb-4 text-sm text-signal border border-signal/20 bg-signal/10 rounded-lg p-3"
        >
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Date" htmlFor="daily-entry-date" required>
          <Input
            id="daily-entry-date"
            type="date"
            value={formData.date}
            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
            required
          />
        </Field>
        <FeedTypeField
          id="feedTypeId"
          name="feedTypeId"
          value={formData.feedTypeId}
          onChange={(e) => {
            const ft = feedTypes.find(
              (t) => (t.id || t._id) === e.target.value,
            )
            setFormData({
              ...formData,
              feedTypeId: e.target.value,
              feedPrice: ft?.price_per_kg ?? ft?.pricePerKg ?? '',
            })
          }}
          feedTypes={feedTypes}
          ready={lookupsReady}
          showStock
          onFeedTypesChanged={loadFeedTypes}
          onCreated={(result) => {
            loadFeedTypes()
            if (result?.id) {
              setFormData((prev) => ({ ...prev, feedTypeId: result.id }))
            }
          }}
        />
        <Field label="Feed amount (kg)" htmlFor="daily-entry-feed">
          <Input
            id="daily-entry-feed"
            type="number"
            step="0.1"
            value={formData.feedAmount}
            onChange={(e) => setFormData({ ...formData, feedAmount: e.target.value })}
            className="font-data tabular-nums"
          />
        </Field>
        <Field label="Mortality" htmlFor="daily-entry-mortality">
          <Input
            id="daily-entry-mortality"
            type="number"
            value={formData.mortality}
            onChange={(e) => setFormData({ ...formData, mortality: e.target.value })}
            className="font-data tabular-nums"
          />
        </Field>
        {Number(formData.mortality) > 0 && (
          <Field label="Mortality cause" htmlFor="daily-entry-cause">
            <Select
              id="daily-entry-cause"
              value={formData.mortalityCause}
              onChange={(e) =>
                setFormData({ ...formData, mortalityCause: e.target.value })
              }
            >
              {MORTALITY_CAUSES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="DO (mg/L)" htmlFor="daily-entry-do">
            <Input
              id="daily-entry-do"
              type="number"
              step="0.1"
              value={formData.dissolvedOxygen}
              onChange={(e) =>
                setFormData({ ...formData, dissolvedOxygen: e.target.value })
              }
              className="font-data tabular-nums"
              placeholder="Optional"
            />
          </Field>
          <Field label="Temp (°C)" htmlFor="daily-entry-temp">
            <Input
              id="daily-entry-temp"
              type="number"
              step="0.1"
              value={formData.temperatureC}
              onChange={(e) =>
                setFormData({ ...formData, temperatureC: e.target.value })
              }
              className="font-data tabular-nums"
              placeholder="Optional"
            />
          </Field>
          <Field label="Secchi (cm)" htmlFor="daily-entry-secchi">
            <Input
              id="daily-entry-secchi"
              type="number"
              step="1"
              value={formData.secchiCm}
              onChange={(e) =>
                setFormData({ ...formData, secchiCm: e.target.value })
              }
              className="font-data tabular-nums"
              placeholder="Optional"
            />
          </Field>
        </div>
        <Field label="Notes" htmlFor="daily-entry-notes">
          <Textarea
            id="daily-entry-notes"
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            rows={3}
          />
        </Field>
        <div className="flex flex-wrap gap-3 pt-2">
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save entry'}
          </Button>
          {onCancel && (
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}
