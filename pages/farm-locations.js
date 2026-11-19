import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { useRouter } from 'next/router'
import { MapPin, Plus } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { GhostButton, GradientButton, Pill, Toggle } from '../components/ui'
import {
  CardNote,
  FIELD,
  SettingsCard,
  SettingsField as Field,
  SettingsFrame,
  SettingsRow,
  useSettingsEyebrow,
} from '../components/settings'
import { useT } from '../lib/i18n/context'
import { api } from '../convex/_generated/api'
import { SITE_TYPES } from '../lib/format'

/** Site metadata fields (FARM-001); blank = not set. */
const EMPTY_SITE = { siteType: '', timezone: '', latitude: '', longitude: '', waterBody: '' }

const COMMON_ZONES = ['Africa/Accra', 'Africa/Lagos', 'Africa/Abidjan', 'Africa/Nairobi', 'Africa/Kampala', 'Africa/Johannesburg', 'UTC']

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Patch for the site metadata from the form. */
function siteMeta(form) {
  return {
    siteType: form.siteType || undefined,
    timezone: form.timezone,
    latitude: numberOrNull(form.latitude),
    longitude: numberOrNull(form.longitude),
    waterBody: form.waterBody,
  }
}
import { useToast } from '../components/Toast'
import { useLocation } from '../contexts/LocationContext'
import { usePermission } from '../hooks/usePermission'
import { CustomFieldValues, customPayload } from '../components/CustomFields'
import FormLayout, { hiddenCoreKeys, useFormLayout } from '../components/FormLayout'

export default function FarmLocationsPage() {
  return (
    <ProtectedRoute>
      <FarmLocations />
    </ProtectedRoute>
  )
}

function FarmLocations() {
  const t = useT()
  const router = useRouter()
  const eyebrow = useSettingsEyebrow(t('settingsUi.nav.sites'))
  const { showToast } = useToast()
  const isAdmin = usePermission('org.sites.manage')
  const { setActiveLocation } = useLocation()

  const locations = useQuery(
    api.farmLocations.list,
    isAdmin ? { includeInactive: true } : {},
  )
  const createLocation = useMutation(api.farmLocations.create)
  const updateLocation = useMutation(api.farmLocations.update)

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', code: '', address: '', notes: '', active: true, ...EMPTY_SITE })
  const [saving, setSaving] = useState(false)
  const layout = useFormLayout('setup.farmLocation')
  const setCustom = useCallback((custom) => setForm((p) => ({ ...p, custom })), [])

  useEffect(() => {
    if (!editing) return
    setForm({
      name: editing.name || '',
      code: editing.code || '',
      address: editing.address || '',
      notes: editing.notes || '',
      active: editing.active !== false,
      siteType: editing.siteType || '',
      timezone: editing.timezone || '',
      latitude: editing.latitude ?? '',
      longitude: editing.longitude ?? '',
      waterBody: editing.waterBody || '',
      custom: editing.custom || {},
    })
    setShowForm(true)
  }, [editing])

  const openNew = useCallback(() => {
    setEditing(null)
    setForm({ name: '', code: '', address: '', notes: '', active: true, ...EMPTY_SITE })
    setShowForm(true)
  }, [])

  useEffect(() => {
    if (router.query.new && isAdmin) openNew()
  }, [router.query.new, isAdmin, openNew])

  const reset = () => {
    setEditing(null)
    setForm({ name: '', code: '', address: '', notes: '', active: true, ...EMPTY_SITE })
    setShowForm(false)
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!isAdmin) return
    // Optional fields a layout condition hides are not saved.
    const hidden = hiddenCoreKeys(layout.sections, form, form.custom)
    hidden.delete('active')
    const values = { ...form }
    for (const key of hidden) values[key] = ''
    setSaving(true)
    try {
      if (editing) {
        await updateLocation({
          id: editing.id || editing._id,
          patch: {
            name: values.name,
            code: values.code,
            address: values.address,
            notes: values.notes,
            active: form.active,
            ...siteMeta(values),
            custom: form.custom || {},
          },
        })
        showToast('success', t('settingsUi.sites.updated'))
      } else {
        const id = await createLocation({
          name: values.name,
          code: values.code || undefined,
          address: values.address || undefined,
          notes: values.notes || undefined,
          active: form.active,
          ...siteMeta(values),
          timezone: values.timezone || undefined,
          latitude: numberOrNull(values.latitude) ?? undefined,
          longitude: numberOrNull(values.longitude) ?? undefined,
          waterBody: values.waterBody || undefined,
          custom: customPayload(form.custom),
        })
        showToast('success', t('settingsUi.sites.created'))
        if (id) await setActiveLocation(id)
      }
      reset()
    } catch (err) {
      showToast('error', err.message || t('settingsUi.sites.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Layout
      title={t('settingsUi.nav.sites')}
      eyebrow={eyebrow}
      actions={
        isAdmin ? (
          <GradientButton icon={Plus} onClick={openNew}>
            {t('settingsUi.sites.add')}
          </GradientButton>
        ) : null
      }
    >
    <SettingsFrame active="sites">
    <div data-tour="page-farm-locations" className="flex flex-col gap-5">
      <p className="text-[14px] leading-[18px] text-muted">{t('settingsUi.sites.description')}</p>
      {showForm && isAdmin && (
        <SettingsCard title={editing ? t('settingsUi.sites.editTitle') : t('settingsUi.sites.newTitle')}>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <p className="-mt-2 text-[12px] leading-4 text-muted">{t('settingsUi.sites.formHint')}</p>
            <FormLayout
              key={editing ? editing.id || editing._id : 'new'}
              formKey="setup.farmLocation"
              layout={layout}
              fields={{
                name: (
                  <Field label={t('settingsUi.sites.name')} htmlFor="loc-name" required>
                  <input
                    className={FIELD}
                    id="loc-name"
                    value={form.name}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, name: e.target.value }))
                    }
                    required
                  />
                </Field>
                ),
                code: (
                  <Field label={t('common.code')} htmlFor="loc-code">
                  <input
                    className={FIELD}
                    id="loc-code"
                    value={form.code}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, code: e.target.value }))
                    }
                    placeholder="MAIN"
                  />
                </Field>
                ),
                address: (
                  <Field label={t('settingsUi.sites.address')} htmlFor="loc-address">
                <input
                  className={FIELD}
                  id="loc-address"
                  value={form.address}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, address: e.target.value }))
                  }
                />
              </Field>
                ),
                siteType: (
                  <Field label={t('settingsUi.org.type')} htmlFor="loc-type">
                  <select
                    className={FIELD}
                    id="loc-type"
                    value={form.siteType}
                    onChange={(e) => setForm((p) => ({ ...p, siteType: e.target.value }))}
                  >
                    <option value="">{t('settingsUi.sites.notSet')}</option>
                    {SITE_TYPES.map((st) => (
                      <option key={st.value} value={st.value}>
                        {t.or(`settingsUi.org.siteType.${st.value}`, st.label)}
                      </option>
                    ))}
                  </select>
                </Field>
                ),
                timezone: (
                  <Field
                  label={t('settingsUi.org.timezone')}
                  htmlFor="loc-tz"
                  hint={t('settingsUi.sites.tzHint')}
                >
                  <input
                    className={FIELD}
                    id="loc-tz"
                    list="loc-tz-options"
                    value={form.timezone}
                    placeholder="Africa/Accra"
                    onChange={(e) => setForm((p) => ({ ...p, timezone: e.target.value }))}
                  />
                  <datalist id="loc-tz-options">
                    {COMMON_ZONES.map((z) => (
                      <option key={z} value={z} />
                    ))}
                  </datalist>
                </Field>
                ),
                latitude: (
                  <Field label={t('settingsUi.sites.lat')} htmlFor="loc-lat" hint={t('settingsUi.sites.latHint')}>
                  <input
                    className={FIELD}
                    id="loc-lat"
                    inputMode="decimal"
                    value={form.latitude}
                    onChange={(e) => setForm((p) => ({ ...p, latitude: e.target.value }))}
                  />
                </Field>
                ),
                longitude: (
                  <Field label={t('settingsUi.sites.lng')} htmlFor="loc-lng" hint={t('settingsUi.sites.lngHint')}>
                  <input
                    className={FIELD}
                    id="loc-lng"
                    inputMode="decimal"
                    value={form.longitude}
                    onChange={(e) => setForm((p) => ({ ...p, longitude: e.target.value }))}
                  />
                </Field>
                ),
                waterBody: (
                  <Field label={t('settingsUi.sites.water')} htmlFor="loc-water" hint={t('settingsUi.sites.waterHint')}>
                <input
                  className={FIELD}
                  id="loc-water"
                  value={form.waterBody}
                  onChange={(e) => setForm((p) => ({ ...p, waterBody: e.target.value }))}
                />
              </Field>
                ),
                notes: (
                  <Field label={t('common.notes')} htmlFor="loc-notes">
                <textarea
                  className={FIELD}
                  id="loc-notes"
                  rows={2}
                  value={form.notes}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, notes: e.target.value }))
                  }
                />
              </Field>
                ),
                active: editing ? (
                  
                <SettingsRow label={t('settingsUi.team.status.active')} helper={t('settingsUi.sites.activeHelper')}>
                  <Toggle
                    checked={form.active}
                    onChange={(v) => setForm((p) => ({ ...p, active: v }))}
                    label={t('settingsUi.team.status.active')}
                  />
                </SettingsRow>
                ) : null,
              }}
              coreValues={form}
              custom={form.custom}
              onCustomChange={setCustom}
              locationId={editing ? editing.id || editing._id : null}
              core={{ siteType: form.siteType }}
              idPrefix="loc-cf"
            />
            <div className="flex justify-end gap-2 border-t border-line pt-4">
              <GhostButton size="lg" onClick={reset}>
                {t('common.cancel')}
              </GhostButton>
              <GradientButton type="submit" variant="solid" disabled={saving}>
                {saving ? t('settingsUi.saving') : editing ? t('settingsUi.sites.update') : t('settingsUi.sites.create')}
              </GradientButton>
            </div>
          </form>
        </SettingsCard>
      )}

      <SettingsCard
        title={
          <span className="flex items-center gap-2">
            <MapPin size={18} aria-hidden className="text-pearl-cyan" />
            {t('settingsUi.sites.list')}
          </span>
        }
        meta={locations ? t('ent.structure.siteCount', { count: locations.length }) : null}
      >
        {locations === undefined ? (
          <CardNote>{t('common.loading')}</CardNote>
        ) : locations.length === 0 ? (
          <CardNote>{t('settingsUi.sites.empty')}</CardNote>
        ) : (
          locations.map((loc) => (
            <div key={loc.id || loc._id} className="flex flex-col gap-3 border-t border-line py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col gap-[2px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-medium leading-[18px] text-text">{loc.name}</span>
                  {loc.code ? <span className="font-data text-[12px] text-muted">{loc.code}</span> : null}
                  {loc.active === false && <Pill tone="red">{t('ent.common.inactive')}</Pill>}
                </div>
                {loc.address && <span className="text-[13px] leading-4 text-muted">{loc.address}</span>}
                {(loc.siteType || loc.timezone || loc.waterBody || loc.latitude != null) && (
                  <span className="text-[12px] leading-4 text-muted">
                    {[
                      loc.siteType ? t.or(`settingsUi.org.siteType.${loc.siteType}`, loc.siteType) : null,
                      loc.waterBody,
                      loc.timezone,
                      loc.latitude != null && loc.longitude != null ? `${loc.latitude}, ${loc.longitude}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                )}
                {loc.notes && <span className="text-[12px] leading-4 text-faint">{loc.notes}</span>}
                <CustomFieldValues entity="farmLocations" values={loc.custom} className="mt-2" />
              </div>
              <div className="flex shrink-0 gap-2">
                <GhostButton onClick={() => setActiveLocation(loc.id || loc._id)}>
                  {t('settingsUi.sites.useInHeader')}
                </GhostButton>
                {isAdmin && (
                  <GhostButton onClick={() => setEditing(loc)}>{t('settingsUi.org.edit')}</GhostButton>
                )}
              </div>
            </div>
          ))
        )}
      </SettingsCard>
    </div>
    </SettingsFrame>
    </Layout>
  )
}
