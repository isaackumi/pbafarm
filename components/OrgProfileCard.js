import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { Button, Field, FormCard, Input, Select } from './ui'

const COMMON_ZONES = [
  'Africa/Accra',
  'Africa/Lagos',
  'Africa/Abidjan',
  'Africa/Nairobi',
  'Africa/Kampala',
  'Africa/Johannesburg',
  'Africa/Cairo',
  'Europe/London',
  'UTC',
]

function allZones() {
  try {
    if (typeof Intl.supportedValuesOf === 'function') return Intl.supportedValuesOf('timeZone')
  } catch {
    // older browsers
  }
  return COMMON_ZONES
}

/**
 * Organization profile (ORG-005, D-012): country, time zone, units, locale.
 * Saved straight away (not part of the settings draft): it changes how dates
 * and units are shown, not farm rules.
 */
export default function OrgProfileCard() {
  const company = useQuery(api.companies.getCurrentCompany, {})
  const update = useMutation(api.companies.updateProfile)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const zones = useMemo(() => {
    const list = allZones()
    return [...COMMON_ZONES, ...list.filter((z) => !COMMON_ZONES.includes(z))]
  }, [])

  useEffect(() => {
    if (company?.profile && !form) setForm(company.profile)
  }, [company, form])

  if (!form) {
    return (
      <FormCard title="Organization profile">
        <p className="text-sm text-muted">Loading…</p>
      </FormCard>
    )
  }

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const saved = await update(form)
      setForm(saved)
      setMessage('Saved.')
    } catch (err) {
      setError(errorMessage(err, 'Could not save the profile'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormCard
      title="Organization profile"
      subtitle="Time zone sets what 'today' means for entries and reminders. Sites can override it."
    >
      <form className="space-y-4" onSubmit={save}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Country" hint="Two-letter code, e.g. GH">
            <Input
              value={form.country}
              maxLength={2}
              onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="Time zone">
            <Select
              value={form.timezone}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Units">
            <Select
              value={form.unitSystem}
              onChange={(e) => setForm({ ...form, unitSystem: e.target.value })}
            >
              <option value="metric">Metric (kg, m³)</option>
              <option value="imperial">Imperial (lb, ft³)</option>
            </Select>
          </Field>
          <Field label="Number and date format" hint="Locale, e.g. en-GH">
            <Input
              value={form.defaultLocale}
              onChange={(e) => setForm({ ...form, defaultLocale: e.target.value })}
            />
          </Field>
        </div>
        {error && <p className="text-sm text-signal">{error}</p>}
        {message && <p className="text-sm text-kelp">{message}</p>}
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? 'Saving…' : 'Save profile'}
        </Button>
      </form>
    </FormCard>
  )
}
