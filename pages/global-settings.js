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
  const { user, hasRole } = useAuth()
  const isAdmin = hasRole?.('admin')
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

  const handleSavePersonal = () => {
    updateSettings({ dateFormat, currency })
    showToast('success', 'Personal display preferences saved on this device')
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
      updateSettings({ currency })
      showToast('success', `Farm currency set to ${CURRENCIES[currency]?.shortLabel || currency}`)
    } catch (err) {
      showToast('error', err.message || 'Failed to save currency')
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormPage width="md">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Global settings' },
        ]}
        description="Money amounts use Cedis (₵) unless you choose another currency here."
        related={
          isAdmin
            ? [{ label: 'Company settings', href: '/company-settings' }]
            : undefined
        }
      />

      <div className="space-y-6">
        <FormCard
          title="Currency"
          subtitle={`Active: ${shortLabel} (${symbol}). Example: ${fmt(1250.5)}`}
        >
          <FormSection>
            <Field
              label="Farm currency"
              hint="Applies to prices, purchases, inventory value, and other money fields."
            >
              <Select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                disabled={!isAdmin}
              >
                {Object.values(CURRENCIES).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label} ({c.symbol})
                    {c.code === 'GHS' ? ' — default' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-sm text-muted">Preview: {preview}</p>
          </FormSection>
          {isAdmin ? (
            <FormActions>
              <Button type="button" disabled={saving} onClick={handleSaveFarmCurrency}>
                {saving ? 'Saving…' : 'Save & publish currency'}
              </Button>
            </FormActions>
          ) : (
            <p className="text-sm text-muted pt-2">
              Only admins can change the farm currency.
            </p>
          )}
        </FormCard>

        <FormCard
          title="Display preferences"
          subtitle="Stored on this browser for your account."
        >
          <FormSection>
            <Field label="Date format">
              <Select
                value={dateFormat}
                onChange={(e) => setDateFormat(e.target.value)}
              >
                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
              </Select>
            </Field>
          </FormSection>
          <FormActions>
            <Button type="button" variant="secondary" onClick={handleSavePersonal}>
              Save display preferences
            </Button>
          </FormActions>
        </FormCard>
      </div>
    </FormPage>
  )
}
