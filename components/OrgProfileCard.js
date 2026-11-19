import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { useLocale, useT } from '../lib/i18n/context'
import { COUNTRY_PRESETS, countryPreset } from '../convex/lib/countries'
import { COUNTRY_CALLING_CODES } from '../convex/lib/phone'
import { GhostButton, GradientButton } from './ui'
import { FIELD, InlineError, InlineSuccess, SettingsCard, SettingsField as Field } from './settings'

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

function regionName(locale, code) {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) || code
  } catch {
    return code
  }
}

const OTHER = '__other'
// Currency is opt-in: amounts already entered are not converted (I18N-003).
const DEFAULT_PICK = { timezone: true, locale: true, units: true, phone: true, currency: false }

/**
 * Organization profile (ORG-005, D-012): country, time zone, units, locale.
 * Saved straight away (not part of the settings draft): it changes how dates
 * and units are shown, not farm rules. Picking a country with a preset
 * (I18N-004, convex/lib/countries) offers its defaults to apply.
 */
export default function OrgProfileCard() {
  const t = useT()
  const { locale } = useLocale()
  const company = useQuery(api.companies.getCurrentCompany, {})
  const update = useMutation(api.companies.updateProfile)
  const applyDefaults = useMutation(api.companies.applyCountryDefaults)
  const [form, setForm] = useState(null)
  const [otherCountry, setOtherCountry] = useState(false)
  const [pick, setPick] = useState(DEFAULT_PICK)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const zones = useMemo(() => {
    const list = allZones()
    return [...COMMON_ZONES, ...list.filter((z) => !COMMON_ZONES.includes(z))]
  }, [])
  const countries = useMemo(
    () =>
      COUNTRY_PRESETS.map((c) => ({ code: c.code, label: regionName(locale, c.code) })).sort((a, b) =>
        a.label.localeCompare(b.label, locale),
      ),
    [locale],
  )

  useEffect(() => {
    if (company?.profile && !form) {
      setForm(company.profile)
      setOtherCountry(!countryPreset(company.profile.country))
    }
  }, [company, form])

  if (!form) {
    return (
      <SettingsCard title={t('country.profileTitle')}>
        <p className="text-[13px] text-muted">{t('common.loading')}</p>
      </SettingsCard>
    )
  }

  const preset = countryPreset(form.country)
  const suggestions = preset
    ? [
        { key: 'timezone', label: t('country.timezone'), value: preset.timezone },
        { key: 'locale', label: t('country.locale'), value: preset.locale },
        {
          key: 'units',
          label: t('country.units'),
          value: preset.unitSystem === 'imperial' ? t('country.imperial') : t('country.metric'),
        },
        { key: 'phone', label: t('country.phone'), value: `+${COUNTRY_CALLING_CODES[preset.code]}` },
        { key: 'currency', label: t('country.currency'), value: preset.currency },
      ]
    : []

  const run = async (fn, fallback) => {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await fn()
    } catch (err) {
      setError(errorMessage(err, fallback))
    } finally {
      setSaving(false)
    }
  }

  const save = (e) => {
    e.preventDefault()
    return run(async () => {
      setForm(await update(form))
      setMessage(t('country.saved'))
    }, t('country.saveFailed'))
  }

  const apply = () =>
    run(async () => {
      const fields = suggestions.filter((s) => pick[s.key]).map((s) => s.key)
      const res = await applyDefaults({ country: form.country, fields })
      setForm(res.profile)
      setMessage(t('country.applied', { count: res.applied.length }))
    }, t('country.applyFailed'))

  return (
    <SettingsCard title={t('country.profileTitle')}>
      <p className="-mt-2 mb-2 text-[12px] leading-4 text-muted">{t('country.profileSubtitle')}</p>
      <form className="flex flex-col gap-4" onSubmit={save}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t('country.country')} htmlFor="org-country" hint={otherCountry ? t('country.countryHint') : undefined}>
            <select
              className={FIELD}
              id="org-country"
              value={otherCountry ? OTHER : form.country}
              onChange={(e) => {
                const other = e.target.value === OTHER
                setOtherCountry(other)
                if (!other) setForm({ ...form, country: e.target.value })
              }}
            >
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label} ({c.code})
                </option>
              ))}
              <option value={OTHER}>{t('country.other')}</option>
            </select>
            {otherCountry && (
              <input
                className={`${FIELD} mt-2`}
                aria-label={t('country.countryCode')}
                value={form.country}
                maxLength={2}
                onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })}
              />
            )}
          </Field>
          <Field label={t('country.timezone')} htmlFor="org-timezone">
            <select
              className={FIELD}
              id="org-timezone"
              value={form.timezone}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('country.units')} htmlFor="org-units">
            <select
              className={FIELD}
              id="org-units"
              value={form.unitSystem}
              onChange={(e) => setForm({ ...form, unitSystem: e.target.value })}
            >
              <option value="metric">{t('country.metric')}</option>
              <option value="imperial">{t('country.imperial')}</option>
            </select>
          </Field>
          <Field label={t('country.locale')} htmlFor="org-locale" hint={t('country.localeHint')}>
            <input
              className={FIELD}
              id="org-locale"
              value={form.defaultLocale}
              onChange={(e) => setForm({ ...form, defaultLocale: e.target.value })}
            />
          </Field>
        </div>

        {preset && (
          <fieldset className="flex flex-col gap-3 rounded-input border border-line bg-surface-2 p-4">
            <legend className="px-1 text-[13px] font-semibold text-text">
              {t('country.suggestedTitle', { country: regionName(locale, preset.code) })}
            </legend>
            <p className="text-[12px] leading-4 text-muted">{t('country.suggestedHint')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {suggestions.map((s) => (
                <label key={s.key} className="inline-flex min-h-11 items-center gap-2 text-[13px] text-text sm:min-h-0">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--cyan)]"
                    checked={!!pick[s.key]}
                    onChange={(e) => setPick({ ...pick, [s.key]: e.target.checked })}
                  />
                  {s.label}: <span className="font-medium">{s.value}</span>
                </label>
              ))}
            </div>
            {pick.currency && <p className="text-[12px] text-warn">{t('country.currencyWarning')}</p>}
            <div>
              <GhostButton disabled={saving} onClick={apply}>
                {t('country.apply')}
              </GhostButton>
            </div>
          </fieldset>
        )}

        {error && <InlineError>{error}</InlineError>}
        {message && <InlineSuccess>{message}</InlineSuccess>}
        <div className="flex justify-end border-t border-line pt-4">
          <GradientButton type="submit" variant="solid" disabled={saving}>
            {saving ? t('country.saving') : t('country.save')}
          </GradientButton>
        </div>
      </form>
    </SettingsCard>
  )
}
