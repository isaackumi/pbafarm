import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import {
  PageHeader,
  Button,
  TabBar,
  FormCard,
  Field,
  Input,
  Select,
  Textarea,
  Card,
} from '../components/ui'
import { api } from '../convex/_generated/api'
import { useToast } from '../components/Toast'
import { useAuth } from '../contexts/AuthContext'
import { applyBrandToDocument } from '../contexts/CompanySettingsContext'

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'branding', label: 'Branding & theme' },
  { id: 'farm', label: 'Farm rules' },
  { id: 'stocking', label: 'Stocking rules' },
  { id: 'feed', label: 'Feed & inventory' },
]

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
    <ProtectedRoute requiredRole="admin">
      <Layout title="Company Settings">
        <CompanySettings />
      </Layout>
    </ProtectedRoute>
  )
}

function CompanySettings() {
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
    const accent = draft.branding?.accentHex || '#18181B'
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
      showToast('success', 'Draft saved')
    } catch (e) {
      showToast('error', e.message || 'Failed to save draft')
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
      showToast('success', 'Settings published — now live across the farm')
      if (result?.company?.logo_url) setLogoUrl(result.company.logo_url)
    } catch (e) {
      showToast('error', e.message || 'Publish failed')
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
      const uploadUrl = await generateUploadUrl()
      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      const { storageId } = await res.json()
      if (!storageId) throw new Error('Upload failed')
      const { logoUrl: url } = await setLogo({ storageId })
      setDraft((d) => ({ ...d, logoStorageId: storageId }))
      setLogoUrl(url)
      showToast('success', 'Logo uploaded (publish to keep with draft sync)')
    } catch (err) {
      showToast('error', err.message || 'Logo upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const onClearLogo = async () => {
    try {
      await clearLogo()
      setDraft((d) => ({ ...d, logoStorageId: undefined }))
      setLogoUrl(null)
      showToast('success', 'Logo removed')
    } catch (e) {
      showToast('error', e.message || 'Failed to remove logo')
    }
  }

  if (!user?.companyId) {
    return (
      <div className="max-w-xl space-y-4">
        <PageHeader
          showTitle={false}
          breadcrumbs={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Company settings' },
          ]}
          description="Link a company to your account before editing farm settings."
        />
        <Card className="space-y-3">
          <p className="text-sm text-chart-ink font-medium">
            No company is linked to your account.
          </p>
          <p className="text-sm text-muted">
            Register a company, or ask a super admin to approve your registration
            and attach you as admin. Platform super admins without a tenant company
            manage registrations from Admin instead.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button href="/register-company" size="sm">
              Register company
            </Button>
            <Button href="/admin/company-registrations" variant="secondary" size="sm">
              Company registrations
            </Button>
            <Button href="/dashboard" variant="ghost" size="sm">
              Dashboard
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  if (draftQuery === undefined) {
    return <p className="text-muted text-sm">Loading settings…</p>
  }

  if (draftQuery.missingCompany) {
    return (
      <div className="max-w-xl space-y-4">
        <PageHeader
          showTitle={false}
          breadcrumbs={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Company settings' },
          ]}
          description="Link a company to your account before editing farm settings."
        />
        <Card className="space-y-3">
          <p className="text-sm text-chart-ink font-medium">
            No company is linked to your account.
          </p>
          <p className="text-sm text-muted">
            Register a company, or ask a super admin to approve your registration
            and attach you as admin.
          </p>
          <Button href="/register-company" size="sm">
            Register company
          </Button>
        </Card>
      </div>
    )
  }

  const ruleSummary = [
    draft.stockingRules?.requireApprovalForStocking
      ? 'Stocking requires approval'
      : 'Stocking auto-approves',
    draft.stockingRules?.requireApprovalForTopup
      ? 'Top-ups require approval'
      : 'Top-ups auto-approve',
    draft.stockingRules?.requireApprovalForFishTransfer
      ? 'Fish transfers require approval'
      : 'Fish transfers auto-approve',
    draft.stockingRules?.enforceCageCapacity
      ? 'Cage capacity enforced'
      : 'Cage capacity not enforced',
    `Max density ${draft.farmRules?.maxDensityFishPerM3} fish/m³`,
    `Harvest target ${draft.farmRules?.targetHarvestAbwG}g · DOC ${draft.farmRules?.harvestDocMinDays}–${draft.farmRules?.harvestDocMaxDays}d`,
    `Mortality alerts ${draft.farmRules?.dailyMortalityAlertPct}%/day · ${draft.farmRules?.cumulativeMortalityAlertPct}% cumulative`,
  ]

  return (
    <div className="max-w-6xl">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Company settings' },
        ]}
        description="Edit farm branding and operating rules. Preview changes, save a draft, then publish to make them live."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onDiscard}
              disabled={!dirty || !published}
            >
              Discard
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onSaveDraft}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save draft'}
            </Button>
            <Button size="sm" onClick={onPublish} disabled={publishing}>
              {publishing ? 'Publishing…' : 'Publish'}
            </Button>
          </div>
        }
      />

      {dirty && (
        <p className="mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          Unpublished changes — save a draft or publish to apply.
        </p>
      )}

      <div className="mb-5">
        <TabBar tabs={TABS} active={tab} onChange={setTab} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_20rem] gap-6">
        <div className="space-y-5">
          {tab === 'profile' && (
            <FormCard title="Company profile">
              <div className="space-y-4">
                <Field label="Company name" required>
                  <Input
                    value={draft.name || ''}
                    onChange={(e) => patch('name', e.target.value)}
                  />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Abbreviation">
                    <Input
                      value={draft.abbreviation || ''}
                      onChange={(e) => patch('abbreviation', e.target.value)}
                    />
                  </Field>
                  <Field label="Phone">
                    <Input
                      value={draft.contactPhone || ''}
                      onChange={(e) => patch('contactPhone', e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Contact email">
                  <Input
                    type="email"
                    value={draft.contactEmail || ''}
                    onChange={(e) => patch('contactEmail', e.target.value)}
                  />
                </Field>
                <Field label="Address">
                  <Textarea
                    value={draft.address || ''}
                    onChange={(e) => patch('address', e.target.value)}
                  />
                </Field>
                <Field label="Logo">
                  <div className="flex flex-wrap items-center gap-3">
                    {logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={logoUrl}
                        alt="Company logo"
                        className="h-14 w-14 rounded-xl object-cover border border-zinc-200"
                      />
                    ) : (
                      <div className="h-14 w-14 rounded-xl bg-foam border border-foam-deep" />
                    )}
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={onLogo}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={uploading}
                      onClick={() => fileRef.current?.click()}
                    >
                      {uploading ? 'Uploading…' : 'Upload'}
                    </Button>
                    {logoUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={onClearLogo}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </Field>
              </div>
            </FormCard>
          )}

          {tab === 'branding' && (
            <FormCard title="Branding & theme">
              <div className="space-y-4">
                <Field label="Display name" hint="Shown in sidebar if set">
                  <Input
                    value={draft.branding?.displayName || ''}
                    onChange={(e) => patch('branding.displayName', e.target.value)}
                  />
                </Field>
                <Field label="Accent color">
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={draft.branding?.accentHex || '#18181B'}
                      onChange={(e) => patch('branding.accentHex', e.target.value)}
                      className="h-11 w-14 cursor-pointer rounded-lg border border-zinc-200 bg-white"
                    />
                    <Input
                      value={draft.branding?.accentHex || '#18181B'}
                      onChange={(e) => patch('branding.accentHex', e.target.value)}
                      className="font-data max-w-[10rem]"
                    />
                  </div>
                </Field>
                <Field label="Theme mode">
                  <Select
                    value={draft.branding?.themeMode || 'light'}
                    onChange={(e) => patch('branding.themeMode', e.target.value)}
                  >
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                    <option value="system">System (user can toggle)</option>
                  </Select>
                </Field>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={!!draft.aiAssistantEnabled}
                    onChange={(e) => patch('aiAssistantEnabled', e.target.checked)}
                    className="rounded border-zinc-300"
                  />
                  Enable AI assistant for this company
                </label>
              </div>
            </FormCard>
          )}

          {tab === 'farm' && (
            <FormCard
              title="Farm rules"
              subtitle="Used for harvest guidance, density checks, and mortality alerts."
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  ['farmRules.targetHarvestAbwG', 'Target harvest ABW (g)'],
                  ['farmRules.harvestDocMinDays', 'Harvest DOC min (days)'],
                  ['farmRules.harvestDocMaxDays', 'Harvest DOC max (days)'],
                  ['farmRules.maxDensityFishPerM3', 'Max density (fish/m³)'],
                  ['farmRules.dailyMortalityAlertPct', 'Daily mortality alert %'],
                  [
                    'farmRules.cumulativeMortalityAlertPct',
                    'Cumulative mortality alert %',
                  ],
                  ['farmRules.targetFcr', 'Target FCR'],
                  ['farmRules.maxFcrAlert', 'Max FCR alert'],
                ].map(([path, label]) => {
                  const [root, key] = path.split('.')
                  return (
                    <Field key={path} label={label}>
                      <Input
                        type="number"
                        step="any"
                        className="font-data"
                        value={draft[root]?.[key] ?? ''}
                        onChange={(e) =>
                          patch(path, e.target.value === '' ? '' : Number(e.target.value))
                        }
                      />
                    </Field>
                  )
                })}
              </div>
            </FormCard>
          )}

          {tab === 'stocking' && (
            <FormCard
              title="Stocking rules"
              subtitle="Enforced when creating stockings and top-ups."
            >
              <div className="space-y-4">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={!!draft.stockingRules?.requireApprovalForStocking}
                    onChange={(e) =>
                      patch('stockingRules.requireApprovalForStocking', e.target.checked)
                    }
                  />
                  Require approval for new stockings
                </label>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={!!draft.stockingRules?.requireApprovalForTopup}
                    onChange={(e) =>
                      patch('stockingRules.requireApprovalForTopup', e.target.checked)
                    }
                  />
                  Require approval for top-ups
                </label>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={
                      draft.stockingRules?.requireApprovalForFishTransfer !== false
                    }
                    onChange={(e) =>
                      patch(
                        'stockingRules.requireApprovalForFishTransfer',
                        e.target.checked,
                      )
                    }
                  />
                  Require approval for fish transfers
                </label>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={!!draft.stockingRules?.enforceCageCapacity}
                    onChange={(e) =>
                      patch('stockingRules.enforceCageCapacity', e.target.checked)
                    }
                  />
                  Enforce cage capacity
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Min initial ABW (g)">
                    <Input
                      type="number"
                      className="font-data"
                      value={draft.stockingRules?.minInitialAbwG ?? ''}
                      onChange={(e) =>
                        patch('stockingRules.minInitialAbwG', Number(e.target.value))
                      }
                    />
                  </Field>
                  <Field label="Max initial ABW (g)">
                    <Input
                      type="number"
                      className="font-data"
                      value={draft.stockingRules?.maxInitialAbwG ?? ''}
                      onChange={(e) =>
                        patch('stockingRules.maxInitialAbwG', Number(e.target.value))
                      }
                    />
                  </Field>
                  <Field label="Min top-up ABW (g)">
                    <Input
                      type="number"
                      className="font-data"
                      value={draft.stockingRules?.minTopupAbwG ?? ''}
                      onChange={(e) =>
                        patch('stockingRules.minTopupAbwG', Number(e.target.value))
                      }
                    />
                  </Field>
                  <Field label="Max top-up ABW (g)">
                    <Input
                      type="number"
                      className="font-data"
                      value={draft.stockingRules?.maxTopupAbwG ?? ''}
                      onChange={(e) =>
                        patch('stockingRules.maxTopupAbwG', Number(e.target.value))
                      }
                    />
                  </Field>
                </div>
                <Field
                  label="Allowed cage statuses for stocking"
                  hint="Comma-separated: empty, fallow, harvested"
                >
                  <Input
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
            </FormCard>
          )}

          {tab === 'feed' && (
            <FormCard
              title="Feed & inventory"
              subtitle="Defaults and rules for stock lots, purchases, and low-stock alerts."
            >
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Default bag size (kg)">
                    <Input
                      type="number"
                      step="any"
                      className="font-data"
                      value={draft.feedRules?.defaultBagSizeKg ?? ''}
                      onChange={(e) =>
                        patch(
                          'feedRules.defaultBagSizeKg',
                          e.target.value === '' ? '' : Number(e.target.value),
                        )
                      }
                    />
                  </Field>
                  <Field label="Low-stock multiplier">
                    <Input
                      type="number"
                      step="any"
                      className="font-data"
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
                    label="Default store location"
                    hint="Used for new purchase lots"
                  >
                    <Input
                      value={draft.feedRules?.defaultLocation ?? ''}
                      onChange={(e) =>
                        patch('feedRules.defaultLocation', e.target.value)
                      }
                    />
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={draft.feedRules?.trackLots !== false}
                    onChange={(e) =>
                      patch('feedRules.trackLots', e.target.checked)
                    }
                  />
                  Track batch / location lots
                </label>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={!!draft.feedRules?.requireBatchOnPurchase}
                    onChange={(e) =>
                      patch('feedRules.requireBatchOnPurchase', e.target.checked)
                    }
                  />
                  Require batch number on purchases
                </label>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={!!draft.feedRules?.allowNegativeStock}
                    onChange={(e) =>
                      patch('feedRules.allowNegativeStock', e.target.checked)
                    }
                  />
                  Allow negative stock (admin override still logged)
                </label>
              </div>
            </FormCard>
          )}
        </div>

        <Card className="h-fit xl:sticky xl:top-24">
          <p className="text-sm font-semibold text-muted mb-3">Preview</p>
          <div
            ref={previewRef}
            className="rounded-xl border border-zinc-200 overflow-hidden"
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
                {draft.branding?.displayName || draft.name || 'Farm name'}
              </span>
            </div>
            <div
              className={`p-3 space-y-2 ${
                draft.branding?.themeMode === 'dark'
                  ? 'bg-zinc-900 text-zinc-100'
                  : 'bg-white text-chart-ink'
              }`}
            >
              <button
                type="button"
                className="w-full rounded-lg py-2.5 text-sm font-semibold text-white"
                style={{ background: 'var(--preview-accent, #18181B)' }}
              >
                Primary action
              </button>
              <p className="text-xs opacity-70">
                Mode: {draft.branding?.themeMode || 'light'}
              </p>
            </div>
          </div>
          <ul className="mt-4 space-y-1.5 text-sm text-muted">
            {ruleSummary.map((line) => (
              <li key={line} className="flex gap-2">
                <span className="text-lagoon-950">•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}
