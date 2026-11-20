import { useState } from 'react'
import { useAction, useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import { GhostButton, GradientButton, Pill, Skeleton } from '../components/ui'
import { FIELD, Notice, SettingsCard, SettingsField } from '../components/settings'
import { CheckTile, IntegrationsShell, SecretOnce, formatTime } from '../components/integrations/kit'
import { LIME_BUTTON } from '../components/paperTones'
import { useToast } from '../components/Toast'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { useT } from '../lib/i18n/context'

const DELIVERY_TONE = { pending: 'amber', succeeded: 'green', failed: 'red' }

function useToasts() {
  const { showToast } = useToast()
  return {
    ok: (m) => showToast('success', m),
    fail: (err) => showToast('error', errorMessage(err)),
  }
}

function EventPicker({ events, value, onChange, idPrefix }) {
  const t = useT()
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  return (
    <fieldset>
      <legend className="mb-2 text-[12px] leading-4 text-muted">{t('settingsUi.integ.hooks.events')}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {events.map((e) => (
          <CheckTile key={e.id} id={`${idPrefix}-${e.id}`} checked={value.includes(e.id)} onChange={() => toggle(e.id)} label={e.label} sub={e.id} />
        ))}
      </div>
    </fieldset>
  )
}

function NewEndpoint({ events, onCreated, disabled }) {
  const t = useT()
  const toasts = useToasts()
  const create = useAction(api.webhooks.create)
  const [url, setUrl] = useState('')
  const [description, setDescription] = useState('')
  const [types, setTypes] = useState([])
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await create({ url, description: description || undefined, eventTypes: types })
      onCreated(res.secret)
      setUrl('')
      setDescription('')
      setTypes([])
    } catch (err) {
      toasts.fail(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <SettingsCard id="new-endpoint" title={t('settingsUi.integ.hooks.addTitle')} meta={t('settingsUi.integ.hooks.addHint')}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <SettingsField label={t('settingsUi.integ.hooks.url')} htmlFor="wh-url" hint={t('settingsUi.integ.hooks.urlHint')} required>
            <input
              id="wh-url"
              type="url"
              inputMode="url"
              className={`${FIELD} font-mono`}
              placeholder="https://example.com/anowa-webhook"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
          </SettingsField>
          <SettingsField label={t('settingsUi.integ.hooks.descLabel')} htmlFor="wh-desc" hint={t('settingsUi.integ.hooks.descHint')}>
            <input id="wh-desc" className={FIELD} value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />
          </SettingsField>
        </div>
        <EventPicker events={events} value={types} onChange={setTypes} idPrefix="new" />
        <div>
          <GradientButton ring="sky" type="submit" size="sm" disabled={busy || disabled || !url.trim() || !types.length}>
            {busy ? t('integ.common.adding') : t('settingsUi.integ.addEndpoint')}
          </GradientButton>
        </div>
      </form>
    </SettingsCard>
  )
}

function DeliveryLog({ endpointId }) {
  const t = useT()
  const toasts = useToasts()
  const redeliver = useMutation(api.webhooks.redeliver)
  const { results, status, loadMore } = usePaginatedQuery(api.webhooks.deliveries, { endpointId }, { initialNumItems: 10 })
  if (status === 'LoadingFirstPage') return <Skeleton className="h-24" />
  if (!results.length) return <p className="text-[13px] leading-4 text-muted">{t('settingsUi.integ.hooks.noDeliveries')}</p>
  return (
    <div>
      <ul>
        {results.map((d) => (
          <li key={d.id} className="flex flex-col gap-2 border-t border-line py-3 first:border-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-[13px] leading-4">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={DELIVERY_TONE[d.status] || 'amber'}>{t(`settingsUi.integ.hooks.status.${d.status in DELIVERY_TONE ? d.status : 'pending'}`)}</Pill>
                <span className="font-mono text-[12px] text-text">{d.eventType}</span>
                {d.redelivery && <span className="text-faint">{t('settingsUi.integ.hooks.redelivery')}</span>}
              </div>
              <p className="mt-1.5 text-muted">
                {formatTime(d.createdAt)} · {t('settingsUi.integ.hooks.attempts', { count: d.attempts })}
                {d.responseStatus ? ` · HTTP ${d.responseStatus}` : ''}
                {d.durationMs != null ? ` · ${d.durationMs} ms` : ''}
              </p>
              {d.lastError && d.status !== 'succeeded' && <p className="mt-1 text-alert">{d.lastError}</p>}
              {d.status === 'pending' && d.nextAttemptAt && (
                <p className="mt-1 text-muted">{t('settingsUi.integ.hooks.nextTry', { time: formatTime(d.nextAttemptAt) })}</p>
              )}
            </div>
            <GhostButton
              size="sm"
              onClick={async () => {
                try {
                  await redeliver({ deliveryId: d.id })
                  toasts.ok(t('settingsUi.integ.hooks.sentAgain'))
                } catch (err) {
                  toasts.fail(err)
                }
              }}
            >
              {t('settingsUi.integ.hooks.redeliver')}
            </GhostButton>
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

function EndpointCard({ ep, events, onSecret }) {
  const t = useT()
  const toasts = useToasts()
  const update = useMutation(api.webhooks.update)
  const remove = useMutation(api.webhooks.remove)
  const sendTest = useMutation(api.webhooks.sendTest)
  const rotate = useAction(api.webhooks.rotateSecret)
  const [editing, setEditing] = useState(false)
  const [types, setTypes] = useState(ep.eventTypes)
  const [showLog, setShowLog] = useState(false)
  const label = (id) => events.find((e) => e.id === id)?.label || id
  const active = ep.status === 'active'
  const failing = active && ep.consecutiveFailures > 0

  const act = async (fn, okText) => {
    try {
      await fn()
      if (okText) toasts.ok(okText)
    } catch (err) {
      toasts.fail(err)
    }
  }

  return (
    <SettingsCard>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-all font-geist text-[13px] leading-4 text-text">{ep.url}</span>
            <Pill tone={!active ? 'neutral' : failing ? 'red' : 'green'}>
              {!active
                ? t('integ.common.off')
                : failing
                  ? t('settingsUi.integ.hooks.failing', { count: ep.consecutiveFailures })
                  : t('integ.common.on')}
            </Pill>
          </div>
          {ep.description && <p className="mt-1 text-[14px] leading-[18px] text-text">{ep.description}</p>}
          {ep.disabledReason && !active && <p className="mt-1 text-[13px] leading-4 text-alert">{ep.disabledReason}</p>}
          <p className="mt-1 text-[13px] leading-4 text-muted">
            {t('settingsUi.integ.hooks.secretLine', {
              hint: ep.secretHint || t('settingsUi.integ.hooks.notSet'),
              time: formatTime(ep.lastSuccessAt),
            })}
          </p>
          {!editing && <p className="mt-2 text-[12px] leading-4 text-muted">{ep.eventTypes.map(label).join(' · ')}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {active ? (
            <>
              <GhostButton size="sm" onClick={() => act(() => sendTest({ endpointId: ep.id }), t('settingsUi.integ.hooks.testSent'))}>
                {t('settingsUi.integ.hooks.sendTest')}
              </GhostButton>
              <GhostButton size="sm" onClick={() => act(() => update({ endpointId: ep.id, enabled: false }), t('settingsUi.integ.hooks.turnedOff'))}>
                {t('integ.common.turnOff')}
              </GhostButton>
            </>
          ) : (
            <GradientButton ring="sky" size="sm" onClick={() => act(() => update({ endpointId: ep.id, enabled: true }), t('settingsUi.integ.hooks.turnedOn'))}>
              {t('integ.common.turnOn')}
            </GradientButton>
          )}
          <GhostButton size="sm" aria-expanded={editing} onClick={() => setEditing((x) => !x)}>
            {editing ? t('common.cancel') : t('settingsUi.integ.hooks.editEvents')}
          </GhostButton>
        </div>
      </div>

      {editing && (
        <div className="mt-4 flex flex-col gap-4">
          <EventPicker events={events} value={types} onChange={setTypes} idPrefix={`ep-${ep.id}`} />
          <div>
            <GradientButton ring="sky"
              size="sm"
              disabled={!types.length}
              onClick={() =>
                act(async () => {
                  await update({ endpointId: ep.id, eventTypes: types })
                  setEditing(false)
                }, t('settingsUi.integ.hooks.eventsSaved'))
              }
            >
              {t('settingsUi.integ.hooks.saveEvents')}
            </GradientButton>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
        <GhostButton size="sm" aria-expanded={showLog} onClick={() => setShowLog((x) => !x)}>
          {showLog ? t('settingsUi.integ.hooks.hideDeliveries') : t('settingsUi.integ.hooks.showDeliveries')}
        </GhostButton>
        <GhostButton
          size="sm"
          onClick={() =>
            act(async () => {
              if (!window.confirm(t('settingsUi.integ.hooks.rotateConfirm'))) return
              const res = await rotate({ endpointId: ep.id })
              onSecret(res.secret)
            })
          }
        >
          {t('integ.common.rotate')}
        </GhostButton>
        <GhostButton
          size="sm"
          tone="danger"
          onClick={() =>
            act(async () => {
              if (!window.confirm(t('settingsUi.integ.hooks.deleteConfirm', { url: ep.url }))) return
              await remove({ endpointId: ep.id })
            }, t('settingsUi.integ.hooks.deleted'))
          }
        >
          {t('settingsUi.integ.hooks.delete')}
        </GhostButton>
      </div>
      {showLog && (
        <div className="mt-3">
          <DeliveryLog endpointId={ep.id} />
        </div>
      )}
    </SettingsCard>
  )
}

const VERIFY_SNIPPET = `// Node: check X-PBA-Signature before trusting a delivery
import crypto from 'node:crypto'

function verify(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')))
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false
  const expected = crypto.createHmac('sha256', secret).update(\`\${parts.t}.\${rawBody}\`).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1 || ''))
}`

function WebhooksScreen() {
  const t = useT()
  const toasts = useToasts()
  const data = useQuery(api.webhooks.overview)
  const [secret, setSecret] = useState(null)
  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(secret)
      toasts.ok(t('integ.common.copied'))
    } catch {
      toasts.fail(new Error(t('integ.common.copyFailed')))
    }
  }

  return (
    <IntegrationsShell
      title={t('settingsUi.integ.nav.outbound')}
      actions={
        <GradientButton variant="lime" className={LIME_BUTTON} href="#new-endpoint">
          {t('settingsUi.integ.addEndpoint')}
        </GradientButton>
      }
    >
      <p className="max-w-3xl text-[14px] leading-[18px] text-muted">{t('settingsUi.integ.hooks.description')}</p>
      {!data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          {!data.encryptionReady && <Notice tone="alert">{t('integ.common.encryptionMissing')}</Notice>}
          {secret && (
            <SecretOnce
              title={t('settingsUi.integ.hooks.secretTitle')}
              hint={t('settingsUi.integ.hooks.secretHint')}
              secret={secret}
              copyLabel={t('integ.common.copySecret')}
              onCopy={copySecret}
              onDone={() => setSecret(null)}
            />
          )}
          {data.endpoints.length === 0 ? (
            <Notice tone="cyan">{t('settingsUi.integ.hooks.emptyHint')}</Notice>
          ) : (
            data.endpoints.map((ep) => <EndpointCard key={ep.id} ep={ep} events={data.events} onSecret={setSecret} />)
          )}
          <NewEndpoint events={data.events} onCreated={setSecret} disabled={!data.encryptionReady} />
          <SettingsCard title={t('settingsUi.integ.hooks.checkingTitle')}>
            <p className="mb-3 text-[13px] leading-[18px] text-muted">{t('settingsUi.integ.hooks.checkingHint')}</p>
            <pre className="overflow-x-auto rounded-input border border-line-strong bg-bg px-[14px] py-3 font-mono text-[12px] leading-relaxed text-text">
              {VERIFY_SNIPPET}
            </pre>
          </SettingsCard>
        </>
      )}
    </IntegrationsShell>
  )
}

export default function WebhooksPage() {
  return (
    <ProtectedRoute permission="integrations.manage">
      <WebhooksScreen />
    </ProtectedRoute>
  )
}
