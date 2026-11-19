import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import Link from 'next/link'
import { GhostButton, GradientButton, Skeleton } from '../components/ui'
import { FIELD, SettingsCard, SettingsField, useSettingsEyebrow } from '../components/settings'
import { api } from '../convex/_generated/api'
import { useToast } from '../components/Toast'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useCurrency } from '../hooks/useCurrency'
import { CURRENCIES, formatCurrency } from '../lib/currencyUtils'
import { usePermission } from '../hooks/usePermission'
import { useT } from '../lib/i18n/context'
import { navKey } from '../lib/i18n'
import { errorMessage } from '../lib/errorMessage'
import { DATE_FORMATS } from '../convex/lib/userPreferences'
import MobileShortcutsCard from '../components/MobileShortcutsCard'

export default function GlobalSettingsPage() {
  return (
    <ProtectedRoute>
      <GlobalSettings />
    </ProtectedRoute>
  )
}

function GlobalSettings() {
  const { showToast } = useToast()
  const { user } = useAuth()
  const t = useT()
  const eyebrow = useSettingsEyebrow(t('settingsUi.global.crumb'))
  const isAdmin = usePermission('org.settings.manage')
  const { settings: localSettings, updateSettings } = useSettings()
  const { formatCurrency: fmt, symbol, shortLabel } = useCurrency()

  const draftQuery = useQuery(
    api.companies.getSettingsDraft,
    user?.companyId && isAdmin ? {} : 'skip',
  )
  const saveDraft = useMutation(api.companies.saveSettingsDraft)
  const publish = useMutation(api.companies.publishSettings)

  // Admins edit the published currency; until it loads, saving would overwrite it with the default.
  const draftLoading = isAdmin && !!user?.companyId && draftQuery === undefined
  const liveCurrency =
    draftQuery?.draft?.locale?.currency ||
    draftQuery?.published?.locale?.currency ||
    'GHS'

  const [currency, setCurrency] = useState('GHS')
  const [dateFormat, setDateFormat] = useState(
    localSettings?.dateFormat || 'DD/MM/YYYY',
  )
  const [saving, setSaving] = useState(false)
  const [savingPersonal, setSavingPersonal] = useState(false)

  useEffect(() => {
    if (draftQuery?.draft?.locale?.currency) {
      setCurrency(draftQuery.draft.locale.currency)
    } else if (liveCurrency) {
      setCurrency(liveCurrency)
    }
  }, [draftQuery, liveCurrency])

  useEffect(() => {
    setDateFormat(localSettings?.dateFormat || 'DD/MM/YYYY')
  }, [localSettings?.dateFormat])

  const preview = useMemo(() => formatCurrency(1250.5, { currency }), [currency])

  const handleSavePersonal = async () => {
    setSavingPersonal(true)
    try {
      await updateSettings({ dateFormat, currency })
      showToast('success', t('settings.display.saved'))
    } catch (err) {
      showToast('error', errorMessage(err, t('settings.saveFailed')))
    } finally {
      setSavingPersonal(false)
    }
  }

  const handleSaveFarmCurrency = async () => {
    if (!isAdmin) return
    setSaving(true)
    try {
      const base = draftQuery?.draft || draftQuery?.published || {}
      const next = {
        ...base,
        locale: { ...(base.locale || {}), currency },
      }
      await saveDraft({ draft: next })
      await publish({})
      await updateSettings({ currency })
      showToast('success', t('settings.currency.saved', { currency: CURRENCIES[currency]?.shortLabel || currency }))
    } catch (err) {
      showToast('error', errorMessage(err, t('settings.currency.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Layout title={t.or(navKey('/global-settings'), 'Global settings')} eyebrow={eyebrow}>
      <div className="flex max-w-3xl flex-col gap-5">
        <p className="text-[14px] leading-[18px] text-muted">
          {t('settings.description')}
          {isAdmin && (
            <>
              {' '}
              <Link
                href="/company-settings"
                className="rounded text-cyan hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
              >
                {t.or(navKey('/company-settings'), 'Company settings')}
              </Link>
            </>
          )}
        </p>

        <SettingsCard
          id="gs-currency"
          title={t('settings.currency.title')}
          meta={t('settings.currency.active', { currency: shortLabel, symbol, example: fmt(1250.5) })}
        >
          {draftLoading ? (
            <Skeleton className="h-20" />
          ) : (
            <div className="flex flex-col gap-3">
              <SettingsField label={t('settings.currency.farm')} htmlFor="gs-currency-select" hint={t('settings.currency.hint')}>
                <select
                  id="gs-currency-select"
                  className={FIELD}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  disabled={!isAdmin}
                >
                  {Object.values(CURRENCIES).map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label} ({c.symbol})
                      {c.code === 'GHS' ? ` — ${t('settings.currency.default')}` : ''}
                    </option>
                  ))}
                </select>
              </SettingsField>
              <p className="text-[13px] leading-4 text-muted">
                {t('settings.currency.preview', { value: preview })}
              </p>
            </div>
          )}
          {isAdmin ? (
            <div className="mt-4 flex justify-end border-t border-line pt-4">
              <GradientButton size="sm" disabled={saving || draftLoading} onClick={handleSaveFarmCurrency}>
                {saving ? t('settings.saving') : t('settings.currency.save')}
              </GradientButton>
            </div>
          ) : (
            <p className="mt-4 border-t border-line pt-4 text-[13px] leading-4 text-muted">{t('settings.currency.adminOnly')}</p>
          )}
        </SettingsCard>

        <SettingsCard id="gs-display" title={t('settings.display.title')} meta={t('settings.display.subtitle')}>
          <SettingsField label={t('settings.display.dateFormat')} htmlFor="gs-date-format" className="sm:max-w-xs">
            <select id="gs-date-format" className={FIELD} value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}>
              {DATE_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {format}
                </option>
              ))}
            </select>
          </SettingsField>
          <div className="mt-4 flex justify-end border-t border-line pt-4">
            <GhostButton size="sm" disabled={savingPersonal} onClick={handleSavePersonal}>
              {savingPersonal ? t('settings.saving') : t('settings.display.save')}
            </GhostButton>
          </div>
        </SettingsCard>

        <MobileShortcutsCard />
      </div>
    </Layout>
  )
}
