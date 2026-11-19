import { useMemo, useState } from 'react'
import { useAction, useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { Button, Card, CardHeader, EmptyState, Field, FormPage, Input, PageHeader, Select, Skeleton, StatCard } from '../components/ui'
import { useToast } from '../components/Toast'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { useT } from '../lib/i18n/context'

/**
 * AI provider keys and usage (INT-009). A company can bring its own key per
 * provider (encrypted at rest); the assistant uses the default enabled key
 * and falls back to the server key. Every call lands in the usage log.
 */

const DAY = 24 * 60 * 60 * 1000

function formatTime(ms) {
  if (!ms) return '—'
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return '—'
  }
}

function usd(n) {
  if (n == null) return '—'
  return `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`
}

function useToasts() {
  const { showToast } = useToast()
  return {
    ok: (m) => showToast('success', m),
    fail: (err) => showToast('error', errorMessage(err)),
  }
}

function AddKey({ providers, disabled }) {
  const t = useT()
  const toasts = useToasts()
  const save = useAction(api.llmGateway.saveCredential)
  const [providerId, setProviderId] = useState(providers[0]?.id || '')
  const provider = providers.find((p) => p.id === providerId)
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [makeDefault, setMakeDefault] = useState(true)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await save({
        providerId,
        model: model.trim() || provider?.defaultModel || '',
        apiKey,
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        makeDefault,
      })
      toasts.ok(t('integ.ai.saved'))
      setApiKey('')
      setBaseUrl('')
      setModel('')
    } catch (err) {
      toasts.fail(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader title={t('integ.ai.addTitle')} subtitle={t('integ.ai.addHint')} />
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label={t('integ.ai.provider')} htmlFor="ai-provider">
          <Select id="ai-provider" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('integ.ai.model')} htmlFor="ai-model">
          <Input id="ai-model" list="ai-models" value={model} placeholder={provider?.defaultModel || ''} onChange={(e) => setModel(e.target.value)} />
          <datalist id="ai-models">
            {(provider?.models || []).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        <Field label={t('integ.ai.apiKey')} htmlFor="ai-key">
          <Input id="ai-key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required />
        </Field>
        <Field label={t('integ.ai.baseUrl')} htmlFor="ai-base">
          <Input id="ai-base" type="url" value={baseUrl} placeholder="https://" onChange={(e) => setBaseUrl(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-chart-ink sm:col-span-2">
          <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
          {t('integ.ai.makeDefault')}
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy || disabled || !apiKey.trim() || !providerId}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Card>
  )
}

function CredentialRow({ cred }) {
  const t = useT()
  const toasts = useToasts()
  const update = useMutation(api.llmGateway.updateCredential)
  const remove = useMutation(api.llmGateway.removeCredential)
  const act = async (fn, okText) => {
    try {
      await fn()
      if (okText) toasts.ok(okText)
    } catch (err) {
      toasts.fail(err)
    }
  }
  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-chart-ink">{cred.providerLabel}</span>
          {cred.isDefault && <span className="rounded-full bg-lake/15 px-2.5 py-0.5 text-xs font-medium text-lake">{t('integ.ai.default')}</span>}
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${cred.enabled ? 'bg-kelp/15 text-kelp' : 'bg-signal/10 text-signal'}`}
          >
            {cred.enabled ? t('integ.common.on') : t('integ.common.off')}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted">
          {cred.model} · {t('integ.ai.keyEnding', { hint: cred.keyHint || '—' })}
          {cred.baseUrl ? ` · ${cred.baseUrl}` : ''}
        </p>
      </div>
      <div className="flex flex-wrap gap-2 shrink-0">
        {!cred.isDefault && (
          <Button variant="secondary" size="sm" onClick={() => act(() => update({ credentialId: cred.id, makeDefault: true }), t('integ.ai.defaultSet'))}>
            {t('integ.ai.setDefault')}
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={() => act(() => update({ credentialId: cred.id, enabled: !cred.enabled }))}>
          {cred.enabled ? t('integ.common.turnOff') : t('integ.common.turnOn')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (!window.confirm(t('integ.ai.removeConfirm', { provider: cred.providerLabel }))) return
            act(() => remove({ credentialId: cred.id }), t('integ.ai.removed'))
          }}
        >
          {t('integ.common.remove')}
        </Button>
      </div>
    </li>
  )
}

function UsageLog() {
  const t = useT()
  const { results, status, loadMore } = usePaginatedQuery(api.llmGateway.usage, {}, { initialNumItems: 20 })
  if (status === 'LoadingFirstPage') return <Skeleton className="h-24" />
  if (!results.length) return <p className="text-sm text-muted">{t('integ.ai.noUsage')}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-muted">
          <tr>
            <th className="py-2 pr-3">{t('integ.ai.when')}</th>
            <th className="py-2 pr-3">{t('integ.ai.user')}</th>
            <th className="py-2 pr-3">{t('integ.ai.model')}</th>
            <th className="py-2 pr-3">{t('integ.ai.key')}</th>
            <th className="py-2 pr-3 text-right">{t('integ.ai.tokens')}</th>
            <th className="py-2 pr-3 text-right">{t('integ.ai.cost')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-foam-deep">
          {results.map((r) => (
            <tr key={r.id} className={r.ok ? '' : 'text-signal'}>
              <td className="py-2 pr-3 whitespace-nowrap">{formatTime(r.createdAt)}</td>
              <td className="py-2 pr-3">{r.user}</td>
              <td className="py-2 pr-3 font-mono text-xs">
                {r.model}
                {r.error ? ` · ${r.error}` : ''}
              </td>
              <td className="py-2 pr-3">{r.source === 'org_key' ? t('integ.ai.sourceOrg') : t('integ.ai.sourceServer')}</td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {r.inputTokens == null && r.outputTokens == null ? '—' : `${r.inputTokens ?? 0} / ${r.outputTokens ?? 0}`}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{usd(r.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {status === 'CanLoadMore' && (
        <Button variant="ghost" size="sm" onClick={() => loadMore(30)}>
          {t('integ.common.showOlder')}
        </Button>
      )}
    </div>
  )
}

function AiSettingsPage() {
  const t = useT()
  // Rounded to the hour so the subscription is stable between renders.
  const since = useMemo(() => Math.floor((Date.now() - 30 * DAY) / 3_600_000) * 3_600_000, [])
  const data = useQuery(api.llmGateway.overview, { since })

  return (
    <FormPage>
      <PageHeader title={t('integ.ai.title')} description={t('integ.ai.description')} />
      {data === undefined ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="space-y-6">
          {!data.encryptionReady && (
            <Card className="border-signal">
              <p className="text-sm text-signal">{t('integ.common.encryptionMissing')}</p>
            </Card>
          )}
          <Card>
            <CardHeader title={t('integ.ai.keysTitle')} subtitle={t('integ.ai.keysHint')} />
            {data.credentials.length === 0 ? (
              <EmptyState title={t('integ.ai.noKeys')} description={t('integ.ai.noKeysHint')} />
            ) : (
              <ul className="divide-y divide-foam-deep">
                {data.credentials.map((c) => (
                  <CredentialRow key={c.id} cred={c} />
                ))}
              </ul>
            )}
          </Card>
          <AddKey providers={data.providers} disabled={!data.encryptionReady} />
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label={t('integ.ai.calls30')} value={data.usage.calls} hint={data.usage.truncated ? t('integ.ai.partial') : undefined} />
            <StatCard label={t('integ.ai.cost30')} value={usd(data.usage.costUsd)} />
            <StatCard label={t('integ.ai.models30')} value={data.usage.byModel.length} />
          </div>
          {data.usage.byUser.length > 0 && (
            <Card>
              <CardHeader title={t('integ.ai.topUsers')} />
              <ul className="divide-y divide-foam-deep text-sm">
                {data.usage.byUser.map((u) => (
                  <li key={u.userId} className="flex justify-between py-2">
                    <span>{u.name}</span>
                    <span className="tabular-nums text-muted">
                      {t('integ.ai.callsCount', { count: u.calls })} · {usd(u.costUsd)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader title={t('integ.ai.logTitle')} subtitle={t('integ.ai.logHint')} />
            <UsageLog />
          </Card>
        </div>
      )}
    </FormPage>
  )
}

export default function AiSettings() {
  return (
    <ProtectedRoute permission="integrations.manage">
      <Layout>
        <AiSettingsPage />
      </Layout>
    </ProtectedRoute>
  )
}
