import { useState } from 'react'
import { useAction, useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { Button, Card, CardHeader, EmptyState, Field, FormPage, Input, PageHeader, Skeleton } from '../components/ui'
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

function formatTime(ms) {
  if (!ms) return '—'
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return '—'
  }
}

function Pill({ className, children }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>{children}</span>
}

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
    <Card className="border-lake">
      <CardHeader title={t('integ.inbound.secretTitle')} subtitle={t('integ.inbound.secretHint')} />
      <code className="block break-all rounded-lg bg-foam px-3 py-3 font-mono text-sm select-all">{secret}</code>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => copy(secret, t, toasts)}>{t('integ.common.copySecret')}</Button>
        <Button variant="secondary" onClick={onDone}>
          {t('integ.common.stored')}
        </Button>
      </div>
    </Card>
  )
}

function EventLog({ webhookId }) {
  const t = useT()
  const { results, status, loadMore } = usePaginatedQuery(api.inboundWebhooks.events, { webhookId }, { initialNumItems: 10 })
  if (status === 'LoadingFirstPage') return <Skeleton className="h-24" />
  if (!results.length) return <p className="text-sm text-muted">{t('integ.inbound.noEvents')}</p>
  return (
    <div>
      <ul className="divide-y divide-foam-deep">
        {results.map((e) => (
          <li key={e.id} className="py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Pill className={e.status === 'accepted' ? 'bg-kelp/15 text-kelp' : 'bg-signal/10 text-signal'}>
                {e.status === 'accepted' ? t('integ.inbound.accepted') : t('integ.inbound.rejected')}
              </Pill>
              {e.eventType && <span className="font-mono text-xs text-chart-ink">{e.eventType}</span>}
              {e.externalId && <span className="font-mono text-xs text-muted break-all">{e.externalId}</span>}
            </div>
            <p className="mt-1 text-muted">
              {formatTime(e.receivedAt)} · {t('integ.inbound.bytes', { count: e.payloadBytes })}
              {e.duplicates > 0 ? ` · ${t('integ.inbound.duplicates', { count: e.duplicates })}` : ''}
            </p>
            {e.reason && <p className="mt-0.5 text-signal">{e.reason}</p>}
            {e.payloadPreview && (
              <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-foam px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all">
                {e.payloadPreview}
              </pre>
            )}
          </li>
        ))}
      </ul>
      {status === 'CanLoadMore' && (
        <Button variant="ghost" size="sm" onClick={() => loadMore(20)}>
          {t('integ.common.showOlder')}
        </Button>
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
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-chart-ink">{hook.name}</span>
            <Pill className={active ? 'bg-kelp/15 text-kelp' : 'bg-signal/10 text-signal'}>
              {active ? t('integ.common.on') : t('integ.common.off')}
            </Pill>
          </div>
          <p className="mt-1 font-mono text-xs text-muted break-all">{url}</p>
          <p className="mt-1 text-sm text-muted">
            {t('integ.inbound.secretLine', { hint: hook.secretHint || '—', time: formatTime(hook.lastReceivedAt) })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Button variant="secondary" size="sm" onClick={() => copy(url, t, toasts)}>
            {t('integ.inbound.copyUrl')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => act(() => update({ webhookId: hook.id, enabled: !active }), active ? t('integ.inbound.turnedOff') : t('integ.inbound.turnedOn'))}
          >
            {active ? t('integ.common.turnOff') : t('integ.common.turnOn')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (!window.confirm(t('integ.inbound.rotateConfirm'))) return
              act(async () => onSecret((await rotate({ webhookId: hook.id })).secret))
            }}
          >
            {t('integ.common.rotate')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowLog((s) => !s)}>
            {showLog ? t('integ.inbound.hideLog') : t('integ.inbound.showLog')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (!window.confirm(t('integ.inbound.removeConfirm', { name: hook.name }))) return
              act(() => remove({ webhookId: hook.id }), t('integ.inbound.removed'))
            }}
          >
            {t('integ.common.remove')}
          </Button>
        </div>
      </div>
      {showLog && (
        <div className="mt-4 border-t border-foam-deep pt-4">
          <EventLog webhookId={hook.id} />
        </div>
      )}
    </Card>
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
    <FormPage>
      <PageHeader title={t('integ.inbound.title')} description={t('integ.inbound.description')} />
      <div className="space-y-6">
        {secret && <SecretOnce secret={secret} onDone={() => setSecret(null)} />}
        {data === undefined ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            {!data.encryptionReady && (
              <Card className="border-signal">
                <p className="text-sm text-signal">{t('integ.common.encryptionMissing')}</p>
              </Card>
            )}
            <Card>
              <CardHeader title={t('integ.inbound.addTitle')} subtitle={t('integ.inbound.addHint')} />
              <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <Field label={t('integ.inbound.name')} htmlFor="inw-name" className="flex-1">
                  <Input id="inw-name" value={name} maxLength={100} placeholder={t('integ.inbound.namePlaceholder')} onChange={(e) => setName(e.target.value)} required />
                </Field>
                <Button type="submit" disabled={busy || !name.trim() || !data.encryptionReady}>
                  {busy ? t('integ.common.adding') : t('integ.inbound.add')}
                </Button>
              </form>
            </Card>
            {data.webhooks.length === 0 ? (
              <EmptyState title={t('integ.inbound.emptyTitle')} description={t('integ.inbound.emptyHint')} />
            ) : (
              data.webhooks.map((hook) => <WebhookCard key={hook.id} hook={hook} base={base} onSecret={setSecret} />)
            )}
            <Card>
              <CardHeader title={t('integ.inbound.signingTitle')} />
              <ul className="space-y-1 text-sm text-chart-ink">
                <li>
                  <span className="font-mono">{data.signing.signatureHeader}</span>: t=&lt;unix&gt;,v1=HMAC-SHA256(secret, &quot;t.body&quot;)
                </li>
                <li>
                  <span className="font-mono">{data.signing.eventIdHeader}</span>: {t('integ.inbound.eventIdHelp')}
                </li>
                <li>
                  <span className="font-mono">{data.signing.eventTypeHeader}</span>: {t('integ.inbound.eventTypeHelp')}
                </li>
                <li>{t('integ.inbound.toleranceHelp', { seconds: data.signing.toleranceSec })}</li>
              </ul>
            </Card>
          </>
        )}
      </div>
    </FormPage>
  )
}

export default function InboundWebhooks() {
  return (
    <ProtectedRoute permission="integrations.manage">
      <Layout>
        <InboundWebhooksPage />
      </Layout>
    </ProtectedRoute>
  )
}
