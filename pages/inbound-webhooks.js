import { useState } from 'react'
import { useAction, useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import { GhostButton, GradientButton, Pill, Skeleton } from '../components/ui'
import { FIELD, Notice, SettingsCard, SettingsField } from '../components/settings'
import { IntegrationsShell, SecretOnce as SecretCard, formatTime } from '../components/integrations/kit'
import { LIME_BUTTON } from '../components/paperTones'
import { useToast } from '../components/Toast'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { convexSiteUrl } from '../lib/apiBase'
import { useT } from '../lib/i18n/context'

/**
 * Inbound signed webhooks (INT-003): partners POST to our endpoint, signed
 * with a per-webhook secret (shown once). Admins create, rotate, switch off
 * and inspect what arrived.
 */

function useToasts() {
  const { showToast } = useToast()
  return {
    ok: (m) => showToast('success', m),
    fail: (err) => showToast('error', errorMessage(err)),
  }
}

function copy(text, t, toasts) {
  navigator.clipboard
    .writeText(text)
    .then(() => toasts.ok(t('integ.common.copied')))
    .catch(() => toasts.fail(new Error(t('integ.common.copyFailed'))))
}

function SecretOnce({ secret, onDone }) {
  const t = useT()
  const toasts = useToasts()
  return (
    <SecretCard
      title={t('integ.inbound.secretTitle')}
      hint={t('integ.inbound.secretHint')}
      secret={secret}
      copyLabel={t('integ.common.copySecret')}
      onCopy={() => copy(secret, t, toasts)}
      onDone={onDone}
    />
  )
}

function EventLog({ webhookId }) {
  const t = useT()
  const { results, status, loadMore } = usePaginatedQuery(api.inboundWebhooks.events, { webhookId }, { initialNumItems: 10 })
  if (status === 'LoadingFirstPage') return <Skeleton className="h-24" />
  if (!results.length) return <p className="text-[13px] leading-4 text-muted">{t('integ.inbound.noEvents')}</p>
  return (
    <div>
      <ul>
        {results.map((e) => (
          <li key={e.id} className="border-t border-line py-3 text-[13px] leading-4 first:border-0">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={e.status === 'accepted' ? 'green' : 'red'}>
                {e.status === 'accepted' ? t('integ.inbound.accepted') : t('integ.inbound.rejected')}
              </Pill>
              {e.eventType && <span className="font-mono text-[12px] text-text">{e.eventType}</span>}
              {e.externalId && <span className="break-all font-mono text-[12px] text-muted">{e.externalId}</span>}
            </div>
            <p className="mt-1.5 text-muted">
              {formatTime(e.receivedAt)} · {t('integ.inbound.bytes', { count: e.payloadBytes })}
              {e.duplicates > 0 ? ` · ${t('integ.inbound.duplicates', { count: e.duplicates })}` : ''}
            </p>
            {e.reason && <p className="mt-1 text-alert">{e.reason}</p>}
            {e.payloadPreview && (
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-input border border-line-strong bg-bg px-3 py-2 font-mono text-[12px] text-text">
                {e.payloadPreview}
              </pre>
            )}
          </li>
        ))}
      </ul>
      {status === 'CanLoadMore' && (
        <GhostButton size="sm" className="mt-2" onClick={() => loadMore(20)}>
          {t('integ.common.showOlder')}
        </GhostButton>
      )}
    </div>
  )
}

function WebhookCard({ hook, base, onSecret }) {
  const t = useT()
  const toasts = useToasts()
  const update = useMutation(api.inboundWebhooks.update)
  const remove = useMutation(api.inboundWebhooks.remove)
  const rotate = useAction(api.inboundWebhooks.rotateSecret)
  const [showLog, setShowLog] = useState(false)
  const url = `${base}${hook.path}`
  const act = async (fn, okText) => {
    try {
      await fn()
      if (okText) toasts.ok(okText)
    } catch (err) {
      toasts.fail(err)
    }
  }
  const active = hook.status === 'active'
  return (
    <SettingsCard>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-medium leading-5 text-text">{hook.name}</span>
            <Pill tone={active ? 'green' : 'neutral'}>
              {active ? t('integ.common.on') : t('integ.common.off')}
            </Pill>
          </div>
          <p className="mt-1 break-all font-geist text-[13px] leading-4 text-muted">{url}</p>
          <p className="mt-1 text-[13px] leading-4 text-muted">
            {t('integ.inbound.secretLine', { hint: hook.secretHint || '—', time: formatTime(hook.lastReceivedAt) })}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <GhostButton size="sm" onClick={() => copy(url, t, toasts)}>
            {t('integ.inbound.copyUrl')}
          </GhostButton>
          <GhostButton
            size="sm"
            onClick={() => act(() => update({ webhookId: hook.id, enabled: !active }), active ? t('integ.inbound.turnedOff') : t('integ.inbound.turnedOn'))}
          >
            {active ? t('integ.common.turnOff') : t('integ.common.turnOn')}
          </GhostButton>
          <GhostButton
            size="sm"
            onClick={() => {
              if (!window.confirm(t('integ.inbound.rotateConfirm'))) return
              act(async () => onSecret((await rotate({ webhookId: hook.id })).secret))
            }}
          >
            {t('integ.common.rotate')}
          </GhostButton>
          <GhostButton size="sm" aria-expanded={showLog} onClick={() => setShowLog((s) => !s)}>
            {showLog ? t('integ.inbound.hideLog') : t('integ.inbound.showLog')}
          </GhostButton>
          <GhostButton
            size="sm"
            tone="danger"
            onClick={() => {
              if (!window.confirm(t('integ.inbound.removeConfirm', { name: hook.name }))) return
              act(() => remove({ webhookId: hook.id }), t('integ.inbound.removed'))
            }}
          >
            {t('integ.common.remove')}
          </GhostButton>
        </div>
      </div>
      {showLog && (
        <div className="mt-4 border-t border-line pt-4">
          <EventLog webhookId={hook.id} />
        </div>
      )}
    </SettingsCard>
  )
}

function InboundWebhooksPage() {
  const t = useT()
  const toasts = useToasts()
  const data = useQuery(api.inboundWebhooks.overview, {})
  const create = useAction(api.inboundWebhooks.create)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [secret, setSecret] = useState(null)
  const base = convexSiteUrl()

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await create({ name })
      setSecret(res.secret)
      setName('')
    } catch (err) {
      toasts.fail(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <IntegrationsShell
      title={t('integ.inbound.title')}
      actions={
        <GradientButton variant="lime" className={LIME_BUTTON} href="#new-inbound">
          {t('integ.inbound.add')}
        </GradientButton>
      }
    >
      <p className="max-w-3xl text-[14px] leading-[18px] text-muted">{t('integ.inbound.description')}</p>
      {secret && <SecretOnce secret={secret} onDone={() => setSecret(null)} />}
      {data === undefined ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          {!data.encryptionReady && <Notice tone="alert">{t('integ.common.encryptionMissing')}</Notice>}
          {data.webhooks.length === 0 ? (
            <Notice tone="cyan">
              <span className="text-text">{t('integ.inbound.emptyTitle')}.</span> <span className="text-muted">{t('integ.inbound.emptyHint')}</span>
            </Notice>
          ) : (
            data.webhooks.map((hook) => <WebhookCard key={hook.id} hook={hook} base={base} onSecret={setSecret} />)
          )}
          <SettingsCard id="new-inbound" title={t('integ.inbound.addTitle')} meta={t('integ.inbound.addHint')}>
            <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <SettingsField label={t('integ.inbound.name')} htmlFor="inw-name" className="flex-1">
                <input
                  id="inw-name"
                  className={FIELD}
                  value={name}
                  maxLength={100}
                  placeholder={t('integ.inbound.namePlaceholder')}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </SettingsField>
              <GradientButton ring="sky" type="submit" size="sm" className="sm:mb-1" disabled={busy || !name.trim() || !data.encryptionReady}>
                {busy ? t('integ.common.adding') : t('integ.inbound.add')}
              </GradientButton>
            </form>
          </SettingsCard>
          <SettingsCard title={t('integ.inbound.signingTitle')}>
            <ul className="flex flex-col gap-2 text-[13px] leading-[18px] text-muted">
              <li>
                <span className="font-mono text-text">{data.signing.signatureHeader}</span>: t=&lt;unix&gt;,v1=HMAC-SHA256(secret, &quot;t.body&quot;)
              </li>
              <li>
                <span className="font-mono text-text">{data.signing.eventIdHeader}</span>: {t('integ.inbound.eventIdHelp')}
              </li>
              <li>
                <span className="font-mono text-text">{data.signing.eventTypeHeader}</span>: {t('integ.inbound.eventTypeHelp')}
              </li>
              <li>{t('integ.inbound.toleranceHelp', { seconds: data.signing.toleranceSec })}</li>
            </ul>
          </SettingsCard>
        </>
      )}
    </IntegrationsShell>
  )
}

export default function InboundWebhooks() {
  return (
    <ProtectedRoute permission="integrations.manage">
      <InboundWebhooksPage />
    </ProtectedRoute>
  )
}
