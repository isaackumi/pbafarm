import { useMemo, useState } from 'react'
import { useAction, useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { GhostButton, GradientButton, Pill, Skeleton, Toggle } from '../components/ui'
import { FIELD, Notice, SettingsCard, SettingsField, SettingsFrame, useSettingsEyebrow } from '../components/settings'
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
    <form onSubmit={submit} className="flex flex-col gap-4 border-t border-line pt-5">
      <div>
        <h3 className="text-[15px] font-medium leading-5 text-text">{t('integ.ai.addTitle')}</h3>
        <p className="mt-1 text-[13px] leading-4 text-muted">{t('integ.ai.addHint')}</p>
      </div>
      <div role="radiogroup" aria-label={t('integ.ai.provider')} className="grid gap-3 sm:grid-cols-2">
        {providers.map((p) => {
          const on = p.id === providerId
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setProviderId(p.id)}
              className={`flex items-center gap-3 rounded-[14px] border px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
                on ? 'border-cyan bg-surface-2' : 'border-line hover:bg-surface-2'
              }`}
            >
              <span
                aria-hidden
                className={`size-4 shrink-0 rounded-full border-2 ${on ? 'border-cyan bg-[radial-gradient(circle,var(--cyan)_35%,transparent_40%)]' : 'border-faint'}`}
              />
              <span className="min-w-0">
                <span className="block text-[15px] leading-5 text-text">{p.label}</span>
                {p.defaultModel && <span className="block truncate text-[13px] leading-4 text-muted">{p.defaultModel}</span>}
              </span>
            </button>
          )
        })}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SettingsField label={t('integ.ai.model')} htmlFor="ai-model">
          <input id="ai-model" list="ai-models" className={FIELD} value={model} placeholder={provider?.defaultModel || ''} onChange={(e) => setModel(e.target.value)} />
          <datalist id="ai-models">
            {(provider?.models || []).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </SettingsField>
        <SettingsField label={t('integ.ai.baseUrl')} htmlFor="ai-base">
          <input id="ai-base" type="url" className={FIELD} value={baseUrl} placeholder="https://" onChange={(e) => setBaseUrl(e.target.value)} />
        </SettingsField>
        <SettingsField label={t('integ.ai.apiKey')} htmlFor="ai-key" required className="sm:col-span-2">
          <input
            id="ai-key"
            type="password"
            autoComplete="off"
            className={`${FIELD} font-mono`}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            required
          />
        </SettingsField>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-3 text-[14px] leading-[18px] text-text">
          <Toggle checked={makeDefault} onChange={setMakeDefault} label={t('integ.ai.makeDefault')} />
          <span aria-hidden>{t('integ.ai.makeDefault')}</span>
        </span>
        <GradientButton type="submit" size="sm" disabled={busy || disabled || !apiKey.trim() || !providerId}>
          {busy ? t('common.saving') : t('common.save')}
        </GradientButton>
      </div>
    </form>
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
    <li
      className={`flex flex-col gap-3 rounded-[14px] border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
        cred.isDefault ? 'border-cyan' : 'border-line'
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-medium leading-5 text-text">{cred.providerLabel}</span>
          {cred.isDefault && <Pill tone="cyan">{t('integ.ai.default')}</Pill>}
          <Pill tone={cred.enabled ? 'green' : 'neutral'}>{cred.enabled ? t('integ.common.on') : t('integ.common.off')}</Pill>
        </div>
        <p className="mt-1 font-mono text-[13px] leading-4 text-muted">
          {cred.model} · {t('integ.ai.keyEnding', { hint: cred.keyHint || '—' })}
          {cred.baseUrl ? ` · ${cred.baseUrl}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {!cred.isDefault && (
          <GhostButton size="sm" onClick={() => act(() => update({ credentialId: cred.id, makeDefault: true }), t('integ.ai.defaultSet'))}>
            {t('integ.ai.setDefault')}
          </GhostButton>
        )}
        <GhostButton size="sm" onClick={() => act(() => update({ credentialId: cred.id, enabled: !cred.enabled }))}>
          {cred.enabled ? t('integ.common.turnOff') : t('integ.common.turnOn')}
        </GhostButton>
        <GhostButton
          size="sm"
          tone="danger"
          onClick={() => {
            if (!window.confirm(t('integ.ai.removeConfirm', { provider: cred.providerLabel }))) return
            act(() => remove({ credentialId: cred.id }), t('integ.ai.removed'))
          }}
        >
          {t('integ.common.remove')}
        </GhostButton>
      </div>
    </li>
  )
}

const TH = 'py-2.5 pr-3 text-[11px] font-medium uppercase leading-[14px] tracking-[0.06em] text-faint'

function UsageLog() {
  const t = useT()
  const { results, status, loadMore } = usePaginatedQuery(api.llmGateway.usage, {}, { initialNumItems: 20 })
  if (status === 'LoadingFirstPage') return <Skeleton className="h-24" />
  if (!results.length) return <p className="text-[14px] leading-[18px] text-muted">{t('integ.ai.noUsage')}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[14px] leading-[18px]">
        <thead>
          <tr className="border-b border-line">
            <th className={TH}>{t('integ.ai.when')}</th>
            <th className={TH}>{t('integ.ai.user')}</th>
            <th className={TH}>{t('integ.ai.model')}</th>
            <th className={TH}>{t('integ.ai.key')}</th>
            <th className={`${TH} text-right`}>{t('integ.ai.tokens')}</th>
            <th className={`${TH} text-right`}>{t('integ.ai.cost')}</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.id} className={`border-b border-line last:border-0 ${r.ok ? 'text-text' : 'text-alert'}`}>
              <td className="whitespace-nowrap py-2.5 pr-3 text-muted">{formatTime(r.createdAt)}</td>
              <td className="py-2.5 pr-3">{r.user}</td>
              <td className="py-2.5 pr-3 font-mono text-[12px]">
                {r.model}
                {r.error ? ` · ${r.error}` : ''}
              </td>
              <td className="py-2.5 pr-3 text-muted">{r.source === 'org_key' ? t('integ.ai.sourceOrg') : t('integ.ai.sourceServer')}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums">
                {r.inputTokens == null && r.outputTokens == null ? '—' : `${r.inputTokens ?? 0} / ${r.outputTokens ?? 0}`}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{usd(r.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {status === 'CanLoadMore' && (
        <GhostButton size="sm" className="mt-3" onClick={() => loadMore(30)}>
          {t('integ.common.showOlder')}
        </GhostButton>
      )}
    </div>
  )
}

function UsageCard({ usage }) {
  const t = useT()
  return (
    <SettingsCard title={t('settingsUi.ai.usageTitle')} meta={t('settingsUi.ai.last30')}>
      <div className="flex items-baseline gap-2">
        <span className="font-sans text-[56px] font-semibold leading-[60px] tracking-[-0.02em] text-text tabular-nums">{usage.calls}</span>
        <span className="text-[15px] leading-5 text-muted">{t('settingsUi.ai.calls')}</span>
      </div>
      {usage.truncated && <p className="mt-1 text-[13px] leading-4 text-faint">{t('integ.ai.partial')}</p>}
      <dl className="mt-5 flex flex-col">
        <div className="flex justify-between border-t border-line py-3 text-[14px] leading-[18px]">
          <dt className="text-muted">{t('integ.ai.cost30')}</dt>
          <dd className="tabular-nums text-text">{usd(usage.costUsd)}</dd>
        </div>
        <div className="flex justify-between border-t border-line py-3 text-[14px] leading-[18px]">
          <dt className="text-muted">{t('integ.ai.models30')}</dt>
          <dd className="tabular-nums text-text">{usage.byModel.length}</dd>
        </div>
      </dl>
    </SettingsCard>
  )
}

function AiSettingsPage() {
  const t = useT()
  // Rounded to the hour so the subscription is stable between renders.
  const since = useMemo(() => Math.floor((Date.now() - 30 * DAY) / 3_600_000) * 3_600_000, [])
  const data = useQuery(api.llmGateway.overview, { since })

  if (data === undefined) return <Skeleton className="h-40" />
  return (
    <div className="flex flex-col gap-5">
      {!data.encryptionReady && (
        <Notice tone="alert" role="alert">
          {t('integ.common.encryptionMissing')}
        </Notice>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <SettingsCard title={t('settingsUi.ai.providerTitle')} meta={t('integ.ai.keysHint')}>
          <div className="flex flex-col gap-5">
            {data.credentials.length === 0 ? (
              <div className="rounded-[14px] border border-dashed border-line px-4 py-5">
                <p className="text-[15px] leading-5 text-text">{t('integ.ai.noKeys')}</p>
                <p className="mt-1 text-[13px] leading-4 text-muted">{t('integ.ai.noKeysHint')}</p>
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {data.credentials.map((c) => (
                  <CredentialRow key={c.id} cred={c} />
                ))}
              </ul>
            )}
            <AddKey providers={data.providers} disabled={!data.encryptionReady} />
          </div>
        </SettingsCard>
        <UsageCard usage={data.usage} />
      </div>
      {data.usage.byUser.length > 0 && (
        <SettingsCard title={t('integ.ai.topUsers')} meta={t('settingsUi.ai.last30')}>
          <ul className="flex flex-col">
            {data.usage.byUser.map((u) => (
              <li key={u.userId} className="flex items-center justify-between gap-3 border-t border-line py-3 first:border-0 first:pt-0">
                <span className="text-[15px] leading-5 text-text">{u.name}</span>
                <span className="text-[13px] leading-4 tabular-nums text-muted">
                  {t('integ.ai.callsCount', { count: u.calls })} · {usd(u.costUsd)}
                </span>
              </li>
            ))}
          </ul>
        </SettingsCard>
      )}
      <SettingsCard title={t('integ.ai.logTitle')} meta={t('integ.ai.logHint')}>
        <UsageLog />
      </SettingsCard>
    </div>
  )
}

function AiSettingsScreen() {
  const t = useT()
  const eyebrow = useSettingsEyebrow(t('settingsUi.ai.crumb'))
  return (
    <Layout title={t('integ.ai.title')} eyebrow={eyebrow}>
      <SettingsFrame active="ai">
        <p className="mb-5 max-w-3xl text-[14px] leading-[18px] text-muted">{t('integ.ai.description')}</p>
        <AiSettingsPage />
      </SettingsFrame>
    </Layout>
  )
}

export default function AiSettings() {
  return (
    <ProtectedRoute permission="integrations.manage">
      <AiSettingsScreen />
    </ProtectedRoute>
  )
}
