import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import {
  PageHeader,
  FormPage,
  FormCard,
  FormSection,
  FormActions,
  Field,
  Select,
  Button,
} from '../components/ui'
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
      <Layout title="Global Settings">
        <GlobalSettings />
      </Layout>
    </ProtectedRoute>
  )
}

function GlobalSettings() {
  const { showToast } = useToast()
  const { user } = useAuth()
  const t = useT()
  const isAdmin = usePermission('org.settings.manage')
  const { settings: localSettings, updateSettings } = useSettings()
  const { formatCurrency: fmt, symbol, shortLabel } = useCurrency()

  const draftQuery = useQuery(
    api.companies.getSettingsDraft,
    user?.companyId && isAdmin ? {} : 'skip',
  )
  const saveDraft = useMutation(api.companies.saveSettingsDraft)
  const publish = useMutation(api.companies.publishSettings)

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
    <FormPage width="md">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: t.or(navKey('/dashboard'), 'Dashboard'), href: '/dashboard' },
          { label: t.or(navKey('/global-settings'), 'Global settings') },
        ]}
        description={t('settings.description')}
        related={
          isAdmin
            ? [{ label: t.or(navKey('/company-settings'), 'Company settings'), href: '/company-settings' }]
            : undefined
        }
      />

      <div className="space-y-6">
        <FormCard
          title={t('settings.currency.title')}
          subtitle={t('settings.currency.active', { currency: shortLabel, symbol, example: fmt(1250.5) })}
        >
          <FormSection>
            <Field
              label={t('settings.currency.farm')}
              hint={t('settings.currency.hint')}
            >
              <Select
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
              </Select>
            </Field>
            <p className="text-sm text-muted">{t('settings.currency.preview', { value: preview })}</p>
          </FormSection>
          {isAdmin ? (
            <FormActions>
              <Button type="button" disabled={saving} onClick={handleSaveFarmCurrency}>
                {saving ? t('settings.saving') : t('settings.currency.save')}
              </Button>
            </FormActions>
          ) : (
            <p className="text-sm text-muted pt-2">
              {t('settings.currency.adminOnly')}
            </p>
          )}
        </FormCard>

        <FormCard
          title={t('settings.display.title')}
          subtitle={t('settings.display.subtitle')}
        >
          <FormSection>
            <Field label={t('settings.display.dateFormat')}>
              <Select
                value={dateFormat}
                onChange={(e) => setDateFormat(e.target.value)}
              >
                {DATE_FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {format}
                  </option>
                ))}
              </Select>
            </Field>
          </FormSection>
          <FormActions>
            <Button type="button" variant="secondary" disabled={savingPersonal} onClick={handleSavePersonal}>
              {savingPersonal ? t('settings.saving') : t('settings.display.save')}
            </Button>
          </FormActions>
        </FormCard>

        <MobileShortcutsCard />
      </div>
    </FormPage>
  )
}
