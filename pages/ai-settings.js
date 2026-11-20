import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useAction, useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { Sparkle } from 'lucide-react'
import { GhostButton, GradientButton, Pill, Skeleton } from '../components/ui'
import { LIME_BUTTON, SKY_TEXT, SkyToggle, TonePill } from '../components/paperTones'
import { FIELD, Notice, RouteGate, SettingsCard, SettingsField, SettingsFrame, SettingsRow, useSettingsEyebrow } from '../components/settings'
import { useToast } from '../components/Toast'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { useT } from '../lib/i18n/context'

/**
 * AI provider keys and usage (INT-009). A company can bring its own key per
 * provider (encrypted at rest); the assistant uses the default enabled key
 * and falls back to the server key. Every call lands in the usage log.
 * Models come from each provider's live list (D-022): nothing is hardcoded,
 * '' means "automatic" (the provider's default).
 */

const DAY = 24 * 60 * 60 * 1000

function modelText(m, t) {
  const name = m.label && m.label !== m.id ? `${m.label} (${m.id})` : m.id
  return m.vision ? `${name} · ${t('integ.ai.vision')}` : name
}

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
  const preview = useAction(api.llmModels.preview)
  const [providerId, setProviderId] = useState(providers[0]?.id || '')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [makeDefault, setMakeDefault] = useState(true)
  const [busy, setBusy] = useState(false)
  // Live models for the pasted key: { loading, models, defaultModel, error }.
  const [list, setList] = useState(null)

  useEffect(() => setList(null), [providerId, apiKey, baseUrl])

  const loadModels = async () => {
    setList({ loading: true, models: [], defaultModel: null, error: '' })
    try {
      const r = await preview({ providerId, apiKey, ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}) })
      setList({ loading: false, models: r.models, defaultModel: r.defaultModel, error: r.error || '' })
    } catch (err) {
      setList({ loading: false, models: [], defaultModel: null, error: errorMessage(err) })
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await save({
        providerId,
        // '' = automatic: the provider's default from its live list.
        model: model.trim(),
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
        <h3 className="text-[15px] font-semibold leading-[18px] text-text">{t('integ.ai.addTitle')}</h3>
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
              className={`flex min-w-0 rounded-[14px] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
                on
                  ? 'bg-[image:var(--gradient-sky)] p-[1.5px] [html[data-theme=light]_&]:bg-[image:linear-gradient(in_oklab_120deg,#1562D6_0%,#7DB6F2_100%)]'
                  : 'border border-line-strong hover:bg-surface-2'
              }`}
            >
              <span className={`flex min-w-0 grow flex-col gap-1 rounded-[13px] ${on ? 'bg-surface-2 px-[15px] py-[13px]' : 'px-4 py-[14px]'}`}>
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={`size-[14px] shrink-0 rounded-full ${on ? 'border-4 border-sky-ink [html[data-theme=light]_&]:border-[#3D86E6]' : 'border-[1.5px] border-faint'}`}
                  />
                  <span className="text-[14px] leading-[18px] text-text">{p.label}</span>
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SettingsField label={t('integ.ai.model')} htmlFor="ai-model">
          {list?.models?.length ? (
            <select id="ai-model" className={FIELD} value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">
                {list.defaultModel ? t('integ.ai.modelAutoWith', { model: list.defaultModel }) : t('integ.ai.modelAuto')}
              </option>
              {list.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {modelText(m, t)}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="ai-model"
              className={FIELD}
              value={model}
              placeholder={t('integ.ai.modelAuto')}
              onChange={(e) => setModel(e.target.value)}
            />
          )}
          <span className="mt-1 flex flex-wrap items-center gap-2 text-[12px] leading-4 text-muted" aria-live="polite">
            <GhostButton
              size="sm"
              type="button"
              onClick={loadModels}
              disabled={disabled || list?.loading || apiKey.trim().length < 8 || (providerId === 'custom' && !baseUrl.trim())}
            >
              {list?.loading ? t('integ.ai.loadingModels') : t('integ.ai.loadModels')}
            </GhostButton>
            {list && !list.loading && !list.error && t('integ.ai.modelsFound', { count: list.models.length })}
            {list?.error && <span className="text-alert">{t('integ.ai.modelsFailed', { message: list.error })}</span>}
            {!list && t('integ.ai.modelHint')}
          </span>
          {list?.models?.some((m) => m.vision) && <span className="mt-1 block text-[12px] leading-4 text-muted">{t('integ.ai.visionHint')}</span>}
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
          <SkyToggle checked={makeDefault} onChange={setMakeDefault} label={t('integ.ai.makeDefault')} />
          <span aria-hidden>{t('integ.ai.makeDefault')}</span>
        </span>
        <GradientButton type="submit" size="sm" ring="sky" disabled={busy || disabled || !apiKey.trim() || !providerId}>
          {busy ? t('common.saving') : t('common.save')}
        </GradientButton>
      </div>
    </form>
  )
}

function CredentialRow({ cred, live }) {
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
      className={`flex flex-col gap-3 rounded-[14px] border px-4 py-[14px] sm:flex-row sm:items-center sm:justify-between ${
        cred.isDefault ? 'border-sky-ink [html[data-theme=light]_&]:border-[#3D86E6]' : 'border-line-strong'
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-medium leading-[18px] text-text">{cred.providerLabel}</span>
          {cred.isDefault && <TonePill tone="sky">{t('integ.ai.default')}</TonePill>}
          <Pill tone={cred.enabled ? 'green' : 'neutral'}>{cred.enabled ? t('integ.common.on') : t('integ.common.off')}</Pill>
        </div>
        <p className="mt-1 font-geist text-[12px] leading-4 text-muted">
          {cred.model || t('integ.ai.modelAutoWith', { model: live?.model || '…' })} ·{' '}
          {t('integ.ai.keyEnding', { hint: cred.keyHint || '—' })}
          {cred.baseUrl ? ` · ${cred.baseUrl}` : ''}
        </p>
        {cred.model && live?.model && live.models.length > 0 && live.model !== cred.model && (
          <p className="mt-1 text-[12px] leading-4 text-[var(--pill-amber-text)]">
            {t('integ.ai.modelGone', { model: cred.model, fallback: live.model })}
          </p>
        )}
        {live?.error && <p className="mt-1 text-[12px] leading-4 text-alert">{t('integ.ai.modelsFailed', { message: live.error })}</p>}
        {live?.models?.length > 0 && (
          <select
            aria-label={t('integ.ai.model')}
            className={`${FIELD} mt-2 max-w-md`}
            value={live.models.some((m) => m.id === cred.model) ? cred.model : ''}
            onChange={(e) => act(() => update({ credentialId: cred.id, model: e.target.value }), t('integ.ai.saved'))}
          >
            <option value="">{t('integ.ai.modelAutoWith', { model: live.defaultModel || '…' })}</option>
            {live.models.map((m) => (
              <option key={m.id} value={m.id}>
                {modelText(m, t)}
              </option>
            ))}
          </select>
        )}
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
        <span className="font-sans text-[40px] font-semibold leading-[44px] tracking-[-0.03em] text-text tabular-nums">{usage.calls}</span>
        <span className="text-[13px] leading-4 text-muted">{t('settingsUi.ai.calls')}</span>
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

/**
 * Anowa policy (AI-POLICY): what Anowa may do beyond answering questions.
 * Owners and admins with org.settings.manage only; who may use Anowa at all
 * is the ai.use permission on roles.
 */
function AnowaPolicyCard() {
  const t = useT()
  const toasts = useToasts()
  const status = useQuery(api.companies.aiAssistantStatus, {})
  const update = useMutation(api.companies.updateAiPolicy)
  const [busy, setBusy] = useState(false)
  const [cap, setCap] = useState('')
  const policy = status?.policy
  useEffect(() => {
    if (policy) setCap(policy.dailyQuestionsPerMember == null ? '' : String(policy.dailyQuestionsPerMember))
  }, [policy])

  if (!status?.canManage || !policy) return null

  const save = async (patch, message) => {
    setBusy(true)
    try {
      await update(patch)
      toasts.ok(message)
    } catch (err) {
      toasts.fail(err)
    } finally {
      setBusy(false)
    }
  }
  const saveCap = (e) => {
    e.preventDefault()
    const trimmed = cap.trim()
    save({ dailyQuestionsPerMember: trimmed === '' ? null : Number(trimmed) }, t('settingsUi.ai.policy.saved'))
  }
  const capDirty = cap.trim() !== (policy.dailyQuestionsPerMember == null ? '' : String(policy.dailyQuestionsPerMember))

  return (
    <SettingsCard title={t('settingsUi.ai.policy.title')} meta={t('settingsUi.ai.policy.meta')}>
      <SettingsRow label={t('settingsUi.ai.policy.drafts')} helper={t('settingsUi.ai.policy.draftsHelper')}>
        <SkyToggle
          checked={policy.allowAutomationDrafts}
          disabled={busy}
          label={t('settingsUi.ai.policy.drafts')}
          onChange={(next) => save({ allowAutomationDrafts: next }, t('settingsUi.ai.policy.saved'))}
        />
      </SettingsRow>
      <SettingsRow label={t('settingsUi.ai.policy.paused')} helper={t('settingsUi.ai.policy.pausedHelper')}>
        <SkyToggle
          checked={policy.draftsStartPaused}
          disabled={busy || !policy.allowAutomationDrafts}
          label={t('settingsUi.ai.policy.paused')}
          onChange={(next) => save({ draftsStartPaused: next }, t('settingsUi.ai.policy.saved'))}
        />
      </SettingsRow>
      <SettingsRow
        label={t('settingsUi.ai.policy.cap')}
        helper={t('settingsUi.ai.policy.capHelper')}
        htmlFor="anowa-daily-cap"
      >
        <form onSubmit={saveCap} className="flex items-center gap-2">
          <div className="w-28">
          <input
            id="anowa-daily-cap"
            type="number"
            inputMode="numeric"
            min={1}
            max={500}
            step={1}
            placeholder={t('settingsUi.ai.policy.noCap')}
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            className={FIELD}
          />
          </div>
          <GhostButton size="md" type="submit" disabled={busy || !capDirty}>
            {t('common.save')}
          </GhostButton>
        </form>
      </SettingsRow>
      <p className="border-t border-line pt-3 text-[12px] leading-4 text-muted">
        {t('settingsUi.ai.policy.whoUses')}{' '}
        <Link href="/users?view=roles" className={`${SKY_TEXT} hover:underline`}>
          {t('settingsUi.ai.policy.rolesLink')}
        </Link>
      </p>
    </SettingsCard>
  )
}

/** Rounded to the hour so the subscription stays stable between renders (queries do not read the clock). */
function useHourNow() {
  return useMemo(() => Math.floor(Date.now() / 3_600_000) * 3_600_000, [])
}

/** Amount input → number, null for empty, undefined when invalid. */
function parseAmount(text) {
  const trimmed = String(text ?? '').trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/**
 * Monthly AI budget (AI protections, D-023): this month's spend against the
 * budget, the org's own limit (it can only lower the platform's), and an
 * optional limit per provider key. At 80% and 100% admins are notified; at
 * 100% Anowa stops answering until next month or until the budget is raised.
 */
function AiBudgetCard() {
  const t = useT()
  const toasts = useToasts()
  const now = useHourNow()
  const status = useQuery(api.aiGuard.budgetStatus, { now })
  const setBudget = useMutation(api.aiGuard.setBudget)
  const setKeyBudget = useMutation(api.aiGuard.setKeyBudget)
  const [amount, setAmount] = useState('')
  const [tokens, setTokens] = useState('')
  const [keyAmounts, setKeyAmounts] = useState({})
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!status) return
    setAmount(status.monthlyBudgetUsd == null ? '' : String(status.monthlyBudgetUsd))
    setTokens(status.monthlyTokenBudget == null ? '' : String(status.monthlyTokenBudget))
    setKeyAmounts(Object.fromEntries(status.keys.map((k) => [k.credentialId, k.monthlyBudgetUsd == null ? '' : String(k.monthlyBudgetUsd)])))
  }, [status])
  if (!status) return null

  const run = async (fn) => {
    setBusy(true)
    try {
      await fn()
      toasts.ok(t('settingsUi.ai.budget.saved'))
    } catch (err) {
      toasts.fail(err)
    } finally {
      setBusy(false)
    }
  }
  const saveBudget = (e) => {
    e.preventDefault()
    const usdValue = parseAmount(amount)
    const tokenValue = parseAmount(tokens)
    if (usdValue === undefined || tokenValue === undefined) return toasts.fail(new Error(t('settingsUi.ai.budget.invalid')))
    run(() => setBudget({ monthlyBudgetUsd: usdValue, monthlyTokenBudget: tokenValue }))
  }
  const saveKey = (credentialId) => {
    const value = parseAmount(keyAmounts[credentialId])
    if (value === undefined) return toasts.fail(new Error(t('settingsUi.ai.budget.invalid')))
    run(() => setKeyBudget({ credentialId, monthlyBudgetUsd: value }))
  }
  const pct = status.usedPct == null ? null : Math.min(100, status.usedPct)
  // Paper 58 quota bar: sky gradient (#1562D6 → #8EC2F7; light → #5FA0EE); warn and alert stay solid.
  const tone = status.refusing
    ? 'bg-alert'
    : (status.usedPct ?? 0) >= 80
      ? 'bg-warn'
      : 'rounded-pill bg-[image:linear-gradient(in_oklab_90deg,#1562D6_0%,#8EC2F7_100%)] [html[data-theme=light]_&]:bg-[image:linear-gradient(in_oklab_90deg,#1562D6_0%,#5FA0EE_100%)]'

  return (
    <SettingsCard title={t('settingsUi.ai.budget.title')} meta={t('settingsUi.ai.budget.meta', { month: status.month })}>
      <div className="flex flex-col gap-4">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[20px] leading-6 tabular-nums text-text">{usd(status.spentUsd)}</span>
            <span className="text-[13px] leading-4 tabular-nums text-muted">
              {status.effectiveUsd == null
                ? t('settingsUi.ai.budget.noBudget')
                : t('settingsUi.ai.budget.ofBudget', { budget: usd(status.effectiveUsd), pct: status.usedPct ?? 0 })}
            </span>
          </div>
          {pct != null && (
            <div className="mt-2 h-[6px] overflow-hidden rounded-pill bg-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t('settingsUi.ai.budget.title')}>
              <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
            </div>
          )}
          {status.unpricedTokens > 0 && (
            <p className="mt-2 text-[12px] leading-4 text-muted">
              {t('settingsUi.ai.budget.unpriced', { tokens: status.unpricedTokens.toLocaleString() })}
            </p>
          )}
          {status.refusing && (
            <Notice tone="alert" role="alert">
              {t('settingsUi.ai.budget.refusing')}
            </Notice>
          )}
          {status.allowedOver && <p className="mt-2 text-[12px] leading-4 text-muted">{t('settingsUi.ai.budget.allowedOver')}</p>}
        </div>
        <form onSubmit={saveBudget} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="flex flex-col gap-1 text-[12px] leading-4 text-muted" htmlFor="ai-budget-usd">
            {t('settingsUi.ai.budget.usd')}
            <input id="ai-budget-usd" type="number" inputMode="decimal" min={0} step="0.01" placeholder={t('settingsUi.ai.budget.none')} value={amount} onChange={(e) => setAmount(e.target.value)} className={FIELD} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] leading-4 text-muted" htmlFor="ai-budget-tokens">
            {t('settingsUi.ai.budget.tokens')}
            <input id="ai-budget-tokens" type="number" inputMode="numeric" min={0} step="1000" placeholder={t('settingsUi.ai.budget.none')} value={tokens} onChange={(e) => setTokens(e.target.value)} className={FIELD} />
          </label>
          <GhostButton size="md" type="submit" disabled={busy}>
            {t('common.save')}
          </GhostButton>
        </form>
        <p className="text-[12px] leading-4 text-muted">{t('settingsUi.ai.budget.helper')}</p>
        {status.keys.length > 0 && (
          <ul className="flex flex-col border-t border-line">
            {status.keys.map((k) => (
              <li key={k.credentialId} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2">
                <span className="text-[13px] leading-4 text-text">
                  {t('settingsUi.ai.budget.keyLabel', { provider: k.providerId })}{' '}
                  <span className="tabular-nums text-muted">{usd(k.spentUsd)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <input
                    aria-label={t('settingsUi.ai.budget.keyLabel', { provider: k.providerId })}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    placeholder={t('settingsUi.ai.budget.none')}
                    value={keyAmounts[k.credentialId] ?? ''}
                    onChange={(e) => setKeyAmounts((m) => ({ ...m, [k.credentialId]: e.target.value }))}
                    className={`${FIELD} w-28`}
                  />
                  <GhostButton size="sm" type="button" disabled={busy} onClick={() => saveKey(k.credentialId)}>
                    {t('common.save')}
                  </GhostButton>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SettingsCard>
  )
}

/** Only admins who manage organization settings see and set the budget. */
function AiBudgetCardGate() {
  const status = useQuery(api.companies.aiAssistantStatus, {})
  return status?.canManage ? <AiBudgetCard /> : null
}

function AiSettingsPage() {
  const t = useT()
  // Rounded to the hour so the subscription is stable between renders.
  const since = useMemo(() => Math.floor((Date.now() - 30 * DAY) / 3_600_000) * 3_600_000, [])
  const data = useQuery(api.llmGateway.overview, { since })
  // Live models per saved key (keys stay in Convex). Reloaded when keys change.
  const listModels = useAction(api.llmModels.list)
  const [live, setLive] = useState({})
  const credKey = (data?.credentials || []).map((c) => `${c.id}:${c.enabled}:${c.updatedAt}`).join(',')
  useEffect(() => {
    if (!credKey) return
    let on = true
    listModels({})
      .then((r) => on && setLive(Object.fromEntries(r.providers.map((p) => [p.id, p]))))
      .catch((err) => on && setLive({ _error: errorMessage(err) }))
    return () => {
      on = false
    }
  }, [credKey, listModels])

  if (data === undefined) return <Skeleton className="h-40" />
  return (
    <div className="flex flex-col gap-5">
      {!data.encryptionReady && (
        <Notice tone="alert" role="alert">
          {t('integ.common.encryptionMissing')}
        </Notice>
      )}
      <AnowaPolicyCard />
      <AiBudgetCardGate />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <SettingsCard title={t('settingsUi.ai.providerTitle')} meta={t('integ.ai.keysHint')}>
          <div className="flex flex-col gap-5">
            {data.credentials.length === 0 ? (
              <div className="rounded-[14px] border border-dashed border-line px-4 py-5">
                <p className="text-[14px] leading-[18px] text-text">{t('integ.ai.noKeys')}</p>
                <p className="mt-1 text-[12px] leading-4 text-muted">{t('integ.ai.noKeysHint')}</p>
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {data.credentials.map((c) => (
                  <CredentialRow key={c.id} cred={c} live={live[c.providerId]} />
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
              <li key={u.userId} className="flex items-center justify-between gap-3 border-t border-line py-3">
                <span className="text-[14px] leading-[18px] text-text">{u.name}</span>
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
    <Layout
      title={t('integ.ai.title')}
      eyebrow={eyebrow}
      actions={
        <RouteGate href="/assistant">
          <GradientButton variant="lime" className={LIME_BUTTON} icon={Sparkle} href="/assistant">
            {t('settingsUi.ai.open')}
          </GradientButton>
        </RouteGate>
      }
    >
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
