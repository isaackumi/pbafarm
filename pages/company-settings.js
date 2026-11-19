import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Link from 'next/link'
import Layout from '../components/Layout'
import { GhostButton, GradientButton, Toggle } from '../components/ui'
import {
  FIELD,
  LineTabs,
  Notice,
  SettingsCard,
  SettingsField as Field,
  SettingsFrame,
  SettingsRow,
  useSettingsEyebrow,
} from '../components/settings'
import { useT } from '../lib/i18n/context'
import { api } from '../convex/_generated/api'
import { sha256HexOfFile } from '../lib/fileHash'
import { useToast } from '../components/Toast'
import { useAuth } from '../contexts/AuthContext'
import { applyBrandToDocument } from '../contexts/CompanySettingsContext'
import OrgProfileCard from '../components/OrgProfileCard'
import DataPrivacyCard from '../components/DataPrivacyCard'
import BrandContrast from '../components/BrandContrast'
import { checkBrandAccent } from '../convex/lib/contrast'

const TABS = ['profile', 'branding', 'farm', 'stocking', 'feed', 'data']

function emptyDraft() {
  return {
    name: '',
    abbreviation: '',
    address: '',
    contactEmail: '',
    contactPhone: '',
    logoStorageId: undefined,
    aiAssistantEnabled: false,
    branding: {
      displayName: '',
      accentHex: '#18181B',
      themeMode: 'light',
    },
    farmRules: {
      targetHarvestAbwG: 600,
      harvestDocMinDays: 150,
      harvestDocMaxDays: 210,
      maxDensityFishPerM3: 80,
      maxDensityFishPerM2: 5,
      maxDensityTankFishPerM3: 0,
      densityWarnPct: 90,
      dailyMortalityAlertPct: 0.5,
      cumulativeMortalityAlertPct: 10,
      targetFcr: 1.4,
      maxFcrAlert: 1.8,
    },
    stockingRules: {
      requireApprovalForStocking: true,
      requireApprovalForTopup: true,
      requireApprovalForFishTransfer: true,
      enforceCageCapacity: true,
      minInitialAbwG: 1,
      maxInitialAbwG: 500,
      minTopupAbwG: 1,
      maxTopupAbwG: 800,
      allowStockOnlyEmptyStatuses: ['empty', 'fallow', 'harvested'],
    },
    feedRules: {
      defaultBagSizeKg: 20,
      defaultLocation: 'Main store',
      allowNegativeStock: false,
      trackLots: true,
      lowStockMultiplier: 1,
      requireBatchOnPurchase: false,
    },
    locale: {
      currency: 'GHS',
    },
  }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

export default function CompanySettingsPage() {
  return (
    <ProtectedRoute permission="org.settings.manage">
      <CompanySettings />
    </ProtectedRoute>
  )
}

function CompanySettings() {
  const t = useT()
  const eyebrow = useSettingsEyebrow(t('settingsUi.nav.company'))
  const { showToast } = useToast()
  const { user } = useAuth()
  const draftQuery = useQuery(
    api.companies.getSettingsDraft,
    user?.companyId ? {} : 'skip',
  )
  const saveDraft = useMutation(api.companies.saveSettingsDraft)
  const publish = useMutation(api.companies.publishSettings)
  const generateUploadUrl = useMutation(api.companies.generateLogoUploadUrl)
  const setLogo = useMutation(api.companies.setLogo)
  const clearLogo = useMutation(api.companies.clearLogo)

  const [tab, setTab] = useState('profile')
  const [draft, setDraft] = useState(emptyDraft())
  const [published, setPublished] = useState(null)
  const [logoUrl, setLogoUrl] = useState(null)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)
  const previewRef = useRef(null)

  useEffect(() => {
    if (!draftQuery || draftQuery.missingCompany || !draftQuery.draft) return
    setDraft({ ...emptyDraft(), ...draftQuery.draft })
    setPublished(draftQuery.published)
    setLogoUrl(draftQuery.logoUrl)
  }, [draftQuery])

  const dirty = useMemo(
    () => (published ? !deepEqual(draft, published) : true),
    [draft, published],
  )

  // Live preview (scoped) — does not touch :root until publish
  useEffect(() => {
    const el = previewRef.current
    if (!el) return
    // What members will see: pale accents are applied as their accessible variant.
    const accent = checkBrandAccent(draft.branding?.accentHex || '')?.accessibleHex || '#18181B'
    el.style.setProperty('--lagoon-950', accent)
    el.style.setProperty('--preview-accent', accent)
    const dark = draft.branding?.themeMode === 'dark'
    el.dataset.previewTheme = dark ? 'dark' : 'light'
  }, [draft.branding])

  const patch = useCallback((path, value) => {
    setDraft((prev) => {
      const next = { ...prev }
      const parts = path.split('.')
      if (parts.length === 1) {
        next[parts[0]] = value
        return next
      }
      const [root, key] = parts
      next[root] = { ...(next[root] || {}), [key]: value }
      return next
    })
  }, [])

  const onSaveDraft = async () => {
    setSaving(true)
    try {
      await saveDraft({ draft })
      showToast('success', t('settingsUi.company.toast.saved'))
    } catch (e) {
      showToast('error', e.message || t('settingsUi.company.toast.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const onPublish = async () => {
    setPublishing(true)
    try {
      const result = await publish({ draft })
      setPublished(draft)
      const branding = draft.branding || {}
      const mode =
        branding.themeMode === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : branding.themeMode || 'light'
      applyBrandToDocument(branding, mode)
      showToast('success', t('settingsUi.company.toast.published'))
      if (result?.company?.logo_url) setLogoUrl(result.company.logo_url)
    } catch (e) {
      showToast('error', e.message || t('settingsUi.company.toast.publishFailed'))
    } finally {
      setPublishing(false)
    }
  }

  const onDiscard = () => {
    if (published) setDraft({ ...emptyDraft(), ...published })
  }

  const onLogo = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const { uploadUrl, uploadId } = await generateUploadUrl({ sha256: await sha256HexOfFile(file) })
      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      const { storageId } = await res.json()
      if (!storageId) throw new Error('Upload failed')
      const { logoUrl: url } = await setLogo({ storageId, uploadId })
      setDraft((d) => ({ ...d, logoStorageId: storageId }))
      setLogoUrl(url)
      showToast('success', t('settingsUi.company.toast.logoUploaded'))
    } catch (err) {
      showToast('error', err.message || t('settingsUi.company.toast.logoFailed'))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const patchBranding = (key, value) => patch(`branding.${key}`, value)

  const onClearLogo = async () => {
    try {
      await clearLogo()
      setDraft((d) => ({ ...d, logoStorageId: undefined }))
      setLogoUrl(null)
      showToast('success', t('settingsUi.company.toast.logoRemoved'))
    } catch (e) {
      showToast('error', e.message || t('settingsUi.company.toast.logoRemoveFailed'))
    }
  }

  const shell = (content, actions = null) => (
    <Layout title={t('settingsUi.company.title')} eyebrow={eyebrow} actions={actions}>
      <SettingsFrame active="company">{content}</SettingsFrame>
    </Layout>
  )

  if (!user?.companyId || draftQuery?.missingCompany) {
    return shell(
      <SettingsCard title={t('settingsUi.company.noCompany')} className="max-w-xl">
        <p className="text-[13px] leading-4 text-muted">{t('settingsUi.company.noCompanyHelp')}</p>
        <div className="flex flex-wrap gap-2 pt-3">
          <GradientButton href="/register-company" variant="solid">{t('settingsUi.company.register')}</GradientButton>
          {!user?.companyId && <GhostButton href="/admin/company-registrations">{t('settingsUi.company.registrations')}</GhostButton>}
          {!user?.companyId && <GhostButton href="/dashboard">{t('nav.item.dashboard')}</GhostButton>}
        </div>
      </SettingsCard>,
    )
  }

  if (draftQuery === undefined) {
    return shell(<p className="text-[13px] text-muted">{t('common.loading')}</p>)
  }

  const ruleSummary = [
    draft.stockingRules?.requireApprovalForStocking
      ? t('settingsUi.company.rs.stockApproval')
      : t('settingsUi.company.rs.stockAuto'),
    draft.stockingRules?.requireApprovalForTopup
      ? t('settingsUi.company.rs.topupApproval')
      : t('settingsUi.company.rs.topupAuto'),
    draft.stockingRules?.requireApprovalForFishTransfer
      ? t('settingsUi.company.rs.transferApproval')
      : t('settingsUi.company.rs.transferAuto'),
    draft.stockingRules?.enforceCageCapacity
      ? t('settingsUi.company.rs.capacityOn')
      : t('settingsUi.company.rs.capacityOff'),
    t('settingsUi.company.rs.density', { value: draft.farmRules?.maxDensityFishPerM3 }),
    t('settingsUi.company.rs.harvest', { abw: draft.farmRules?.targetHarvestAbwG, min: draft.farmRules?.harvestDocMinDays, max: draft.farmRules?.harvestDocMaxDays }),
    t('settingsUi.company.rs.mortality', { daily: draft.farmRules?.dailyMortalityAlertPct, cum: draft.farmRules?.cumulativeMortalityAlertPct }),
  ]

  return (
    shell(
    <div className="flex flex-col gap-5">
      <p className="text-[14px] leading-[18px] text-muted">
        {t('settingsUi.company.description')}{' '}
        <Link href="/messaging-settings" className="text-pearl-cyan underline-offset-2 hover:underline">{t('settingsUi.company.related.messaging')}</Link>
        {' · '}
        <Link href="/automations" className="text-pearl-cyan underline-offset-2 hover:underline">{t('settingsUi.nav.automations')}</Link>
      </p>

      {dirty && <Notice tone="warn" role="status">{t('settingsUi.company.unpublished')}</Notice>}

      <LineTabs
        label={t('settingsUi.company.title')}
        tabs={TABS.map((id) => ({ value: id, label: t(`settingsUi.company.tab.${id}`) }))}
        value={tab}
        onChange={setTab}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_20rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {tab === 'profile' && (
            <SettingsCard title={t('settingsUi.company.profile.title')}>
              <div className="flex flex-col gap-4">
                <Field label={t('settingsUi.company.f.name')} required>
                  <input className={FIELD}
                    value={draft.name || ''}
                    onChange={(e) => patch('name', e.target.value)}
                  />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label={t('settingsUi.company.f.abbr')}>
                    <input className={FIELD}
                      value={draft.abbreviation || ''}
                      onChange={(e) => patch('abbreviation', e.target.value)}
                    />
                  </Field>
                  <Field label={t('settingsUi.company.f.phone')}>
                    <input className={FIELD}
                      value={draft.contactPhone || ''}
                      onChange={(e) => patch('contactPhone', e.target.value)}
                    />
                  </Field>
                </div>
                <Field label={t('settingsUi.company.f.email')}>
                  <input className={FIELD}
                    type="email"
                    value={draft.contactEmail || ''}
                    onChange={(e) => patch('contactEmail', e.target.value)}
                  />
                </Field>
                <Field label={t('settingsUi.company.f.address')}>
                  <textarea className={FIELD}
                    value={draft.address || ''}
                    onChange={(e) => patch('address', e.target.value)}
                  />
                </Field>
                <Field label={t('settingsUi.company.f.logo')}>
                  <div className="flex flex-wrap items-center gap-3">
                    {logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={logoUrl}
                        alt={t('settingsUi.company.a.logo')}
                        className="h-14 w-14 rounded-input border border-line object-cover"
                      />
                    ) : (
                      <div className="h-14 w-14 rounded-input border border-line bg-surface-2" />
                    )}
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={onLogo}
                    />
                    <GhostButton disabled={uploading} onClick={() => fileRef.current?.click()}>
                      {uploading ? t('settingsUi.company.uploading') : t('settingsUi.company.upload')}
                    </GhostButton>
                    {logoUrl && (
                      <GhostButton tone="danger" onClick={onClearLogo}>{t('settingsUi.company.remove')}</GhostButton>
                    )}
                  </div>
                </Field>
              </div>
            </SettingsCard>
          )}
          {tab === 'profile' && <OrgProfileCard />}
          {tab === 'data' && <DataPrivacyCard />}

          {tab === 'branding' && (
            <SettingsCard title={t('settingsUi.company.tab.branding')}>
              <div className="flex flex-col gap-4">
                <Field label={t('settingsUi.company.f.displayName')} hint={t('settingsUi.company.h.displayName')}>
                  <input className={FIELD}
                    value={draft.branding?.displayName || ''}
                    onChange={(e) => patchBranding('displayName', e.target.value)}
                  />
                </Field>
                <Field label={t('settingsUi.company.f.accent')}>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={draft.branding?.accentHex || '#18181B'}
                      onChange={(e) => patchBranding('accentHex', e.target.value)}
                      aria-label={t('settingsUi.company.a.pick')}
                      className="h-10 w-14 cursor-pointer rounded-input border border-line bg-surface-2"
                    />
                    <input
                      value={draft.branding?.accentHex || '#18181B'}
                      onChange={(e) => patchBranding('accentHex', e.target.value)}
                      aria-label={t('settingsUi.company.a.hex')}
                      className={`${FIELD} max-w-[10rem] font-data`}
                    />
                  </div>
                  <BrandContrast
                    hex={draft.branding?.accentHex || '#18181B'}
                    onUse={(hex) => patchBranding('accentHex', hex)}
                  />
                </Field>
                <Field label={t('settingsUi.company.f.theme')}>
                  <select className={FIELD}
                    value={draft.branding?.themeMode || 'light'}
                    onChange={(e) => patchBranding('themeMode', e.target.value)}
                  >
                    <option value="light">{t('settingsUi.company.theme.light')}</option>
                    <option value="dark">{t('settingsUi.company.theme.dark')}</option>
                    <option value="system">{t('settingsUi.company.theme.system')}</option>
                  </select>
                </Field>
                <SettingsRow label={t('settingsUi.company.cb.ai')}>
                  <Toggle checked={!!draft.aiAssistantEnabled} onChange={(v) => patch('aiAssistantEnabled', v)} label={t('settingsUi.company.cb.ai')} />
                </SettingsRow>
              </div>
            </SettingsCard>
          )}

          {tab === 'farm' && (
            <SettingsCard title={t('settingsUi.company.tab.farm')}>
              <p className="-mt-2 mb-2 text-[12px] leading-4 text-muted">{t('settingsUi.company.farm.sub')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  ['farmRules.targetHarvestAbwG'],
                  ['farmRules.harvestDocMinDays'],
                  ['farmRules.harvestDocMaxDays'],
                  ['farmRules.maxDensityFishPerM3'],
                  ['farmRules.maxDensityFishPerM2'],
                  ['farmRules.maxDensityTankFishPerM3'],
                  ['farmRules.densityWarnPct'],
                  ['farmRules.dailyMortalityAlertPct'],
                  ['farmRules.cumulativeMortalityAlertPct'],
                  ['farmRules.targetFcr'],
                  ['farmRules.maxFcrAlert'],
                ].map(([path]) => {
                  const [root, key] = path.split('.')
                  const label = t(`settingsUi.company.rule.${key}`)
                  return (
                    <Field key={path} label={label}>
                      <input
                        type="number"
                        step="any"
                        className={`${FIELD} font-data tabular-nums`}
                        value={draft[root]?.[key] ?? ''}
                        onChange={(e) =>
                          patch(path, e.target.value === '' ? '' : Number(e.target.value))
                        }
                      />
                    </Field>
                  )
                })}
              </div>
            </SettingsCard>
          )}

          {tab === 'stocking' && (
            <SettingsCard title={t('settingsUi.company.tab.stocking')}>
              <p className="-mt-2 mb-2 text-[12px] leading-4 text-muted">{t('settingsUi.company.stocking.sub')}</p>
              <div className="flex flex-col gap-4">
                <SettingsRow label={t('settingsUi.company.cb.stock')}>
                  <Toggle checked={!!draft.stockingRules?.requireApprovalForStocking} onChange={(v) => patch('stockingRules.requireApprovalForStocking', v)} label={t('settingsUi.company.cb.stock')} />
                </SettingsRow>
                <SettingsRow label={t('settingsUi.company.cb.topup')}>
                  <Toggle checked={!!draft.stockingRules?.requireApprovalForTopup} onChange={(v) => patch('stockingRules.requireApprovalForTopup', v)} label={t('settingsUi.company.cb.topup')} />
                </SettingsRow>
                <SettingsRow label={t('settingsUi.company.cb.transfer')}>
                  <Toggle checked={draft.stockingRules?.requireApprovalForFishTransfer !== false} onChange={(v) => patch('stockingRules.requireApprovalForFishTransfer', v)} label={t('settingsUi.company.cb.transfer')} />
                </SettingsRow>
                <SettingsRow label={t('settingsUi.company.cb.differentApprover')}>
                  <Toggle checked={draft.stockingRules?.requireDifferentApprover === true} onChange={(v) => patch('stockingRules.requireDifferentApprover', v)} label={t('settingsUi.company.cb.differentApprover')} />
                </SettingsRow>
                <SettingsRow label={t('settingsUi.company.cb.capacity')}>
                  <Toggle checked={!!draft.stockingRules?.enforceCageCapacity} onChange={(v) => patch('stockingRules.enforceCageCapacity', v)} label={t('settingsUi.company.cb.capacity')} />
                </SettingsRow>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label={t('settingsUi.company.f.minInitial')}>
                    <input
                      type="number"
                      className={`${FIELD} font-data tabular-nums`}
                      value={draft.stockingRules?.minInitialAbwG ?? ''}
                      onChange={(e) =>
                        patch('stockingRules.minInitialAbwG', Number(e.target.value))
                      }
                    />
                  </Field>
                  <Field label={t('settingsUi.company.f.maxInitial')}>
                    <input
                      type="number"
                      className={`${FIELD} font-data tabular-nums`}
                      value={draft.stockingRules?.maxInitialAbwG ?? ''}
                      onChange={(e) =>
                        patch('stockingRules.maxInitialAbwG', Number(e.target.value))
                      }
                    />
                  </Field>
                  <Field label={t('settingsUi.company.f.minTopup')}>
                    <input
                      type="number"
                      className={`${FIELD} font-data tabular-nums`}
                      value={draft.stockingRules?.minTopupAbwG ?? ''}
                      onChange={(e) =>
                        patch('stockingRules.minTopupAbwG', Number(e.target.value))
                      }
                    />
                  </Field>
                  <Field label={t('settingsUi.company.f.maxTopup')}>
                    <input
                      type="number"
                      className={`${FIELD} font-data tabular-nums`}
                      value={draft.stockingRules?.maxTopupAbwG ?? ''}
                      onChange={(e) =>
                        patch('stockingRules.maxTopupAbwG', Number(e.target.value))
                      }
                    />
                  </Field>
                </div>
                <Field
                  label={t('settingsUi.company.f.statuses')}
                  hint={t('settingsUi.company.h.statuses')}
                >
                  <input className={FIELD}
                    value={(draft.stockingRules?.allowStockOnlyEmptyStatuses || []).join(
                      ', ',
                    )}
                    onChange={(e) =>
                      patch(
                        'stockingRules.allowStockOnlyEmptyStatuses',
                        e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      )
                    }
                  />
                </Field>
              </div>
            </SettingsCard>
          )}

          {tab === 'feed' && (
            <SettingsCard title={t('settingsUi.company.tab.feed')}>
              <p className="-mt-2 mb-2 text-[12px] leading-4 text-muted">{t('settingsUi.company.feed.sub')}</p>
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label={t('settingsUi.company.f.bag')}>
                    <input
                      type="number"
                      step="any"
                      className={`${FIELD} font-data tabular-nums`}
                      value={draft.feedRules?.defaultBagSizeKg ?? ''}
                      onChange={(e) =>
                        patch(
                          'feedRules.defaultBagSizeKg',
                          e.target.value === '' ? '' : Number(e.target.value),
                        )
                      }
                    />
                  </Field>
                  <Field label={t('settingsUi.company.f.lowStock')}>
                    <input
                      type="number"
                      step="any"
                      className={`${FIELD} font-data tabular-nums`}
                      value={draft.feedRules?.lowStockMultiplier ?? ''}
                      onChange={(e) =>
                        patch(
                          'feedRules.lowStockMultiplier',
                          e.target.value === '' ? '' : Number(e.target.value),
                        )
                      }
                    />
                  </Field>
                  <Field
                    label={t('settingsUi.company.f.store')}
                    hint={t('settingsUi.company.h.store')}
                  >
                    <input className={FIELD}
                      value={draft.feedRules?.defaultLocation ?? ''}
                      onChange={(e) =>
                        patch('feedRules.defaultLocation', e.target.value)
                      }
                    />
                  </Field>
                </div>
                <SettingsRow label={t('settingsUi.company.cb.trackLots')}>
                  <Toggle checked={draft.feedRules?.trackLots !== false} onChange={(v) => patch('feedRules.trackLots', v)} label={t('settingsUi.company.cb.trackLots')} />
                </SettingsRow>
                <SettingsRow label={t('settingsUi.company.cb.batch')}>
                  <Toggle checked={!!draft.feedRules?.requireBatchOnPurchase} onChange={(v) => patch('feedRules.requireBatchOnPurchase', v)} label={t('settingsUi.company.cb.batch')} />
                </SettingsRow>
                <SettingsRow label={t('settingsUi.company.cb.negative')}>
                  <Toggle checked={!!draft.feedRules?.allowNegativeStock} onChange={(v) => patch('feedRules.allowNegativeStock', v)} label={t('settingsUi.company.cb.negative')} />
                </SettingsRow>
              </div>
            </SettingsCard>
          )}
        </div>

        <SettingsCard title={t('settingsUi.company.preview')} className="h-fit xl:sticky xl:top-24">
          <div
            ref={previewRef}
            className="overflow-hidden rounded-input border border-line"
            data-preview-theme="light"
          >
            <div
              className="px-3 py-3 text-white text-sm font-semibold flex items-center gap-2"
              style={{ background: 'var(--preview-accent, #18181B)' }}
            >
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="" className="h-7 w-7 rounded-lg object-cover" />
              ) : (
                <span className="h-7 w-7 rounded-lg bg-white/20 inline-block" />
              )}
              <span className="truncate">
                {draft.branding?.displayName || draft.name || t('settingsUi.company.farmName')}
              </span>
            </div>
            <div
              className={`p-3 space-y-2 ${
                draft.branding?.themeMode === 'dark'
                  ? 'bg-zinc-900 text-zinc-100'
                  : 'bg-white text-zinc-900'
              }`}
            >
              <button
                type="button"
                className="w-full rounded-lg py-2.5 text-sm font-semibold text-white"
                style={{ background: 'var(--preview-accent, #18181B)' }}
              >
                {t('settingsUi.company.primaryAction')}
              </button>
              <p className="text-xs opacity-70">
                {t('settingsUi.company.mode', { mode: t(`settingsUi.company.theme.${draft.branding?.themeMode || 'light'}`) })}
              </p>
            </div>
          </div>
          <ul className="mt-4 space-y-1.5 text-[13px] leading-4 text-muted">
            {ruleSummary.map((line) => (
              <li key={line} className="flex gap-2">
                <span className="text-muted" aria-hidden>•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </SettingsCard>
      </div>
    </div>,
    <>
      <GhostButton onClick={onDiscard} disabled={!dirty || !published}>
        {t('settingsUi.company.discard')}
      </GhostButton>
      <GhostButton onClick={onSaveDraft} disabled={saving}>
        {saving ? t('settingsUi.saving') : t('settingsUi.company.saveDraft')}
      </GhostButton>
      <GradientButton variant="solid" onClick={onPublish} disabled={publishing}>
        {publishing ? t('settingsUi.company.publishing') : t('settingsUi.company.publish')}
      </GradientButton>
    </>,
    )
  )
}
