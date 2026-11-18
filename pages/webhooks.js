import { useState } from 'react'
import { useAction, useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { Button, Card, CardHeader, EmptyState, Field, FormPage, Input, PageHeader, Skeleton } from '../components/ui'
import { useToast } from '../components/Toast'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'

const DELIVERY_STATUS = {
  pending: { label: 'Retrying', className: 'bg-foam text-chart-ink' },
  succeeded: { label: 'Delivered', className: 'bg-kelp/15 text-kelp' },
  failed: { label: 'Failed', className: 'bg-signal/10 text-signal' },
}

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

function EventPicker({ events, value, onChange, idPrefix }) {
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  return (
    <fieldset>
      <legend className="text-sm font-medium text-chart-ink mb-2">Events</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {events.map((e) => (
          <label key={e.id} htmlFor={`${idPrefix}-${e.id}`} className="flex items-center gap-3 rounded-lg border border-foam-deep px-3 min-h-12 sm:min-h-10 text-sm">
            <input id={`${idPrefix}-${e.id}`} type="checkbox" checked={value.includes(e.id)} onChange={() => toggle(e.id)} />
            <span>
              {e.label}
              <span className="block text-xs text-muted font-mono">{e.id}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function SecretOnce({ title, secret, onDone }) {
  const t = useToasts()
  return (
    <Card className="border-lake">
      <CardHeader title={title} subtitle="Shown once. Your receiver uses it to check the X-PBA-Signature header." />
      <code className="block break-all rounded-lg bg-foam px-3 py-3 font-mono text-sm select-all">{secret}</code>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(secret)
              t.ok('Secret copied')
            } catch {
              t.fail(new Error('Copy failed; select the secret and copy it'))
            }
          }}
        >
          Copy secret
        </Button>
        <Button variant="secondary" onClick={onDone}>I have stored it</Button>
      </div>
    </Card>
  )
}

function NewEndpoint({ events, onCreated }) {
  const t = useToasts()
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
      t.fail(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <CardHeader title="Add an endpoint" subtitle="We POST each chosen event as JSON to this HTTPS address." />
      <form onSubmit={submit} className="space-y-5">
        <Field label="URL" htmlFor="wh-url" hint="https only, a public host name, port 443 or 8443" required>
          <Input id="wh-url" type="url" inputMode="url" placeholder="https://example.com/pba-webhook" value={url} onChange={(e) => setUrl(e.target.value)} required />
        </Field>
        <Field label="Description" htmlFor="wh-desc" hint="Optional, e.g. Buyer portal">
          <Input id="wh-desc" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <EventPicker events={events} value={types} onChange={setTypes} idPrefix="new" />
        <Button type="submit" disabled={busy || !url.trim() || !types.length}>
          {busy ? 'Adding…' : 'Add endpoint'}
        </Button>
      </form>
    </Card>
  )
}

function DeliveryLog({ endpointId }) {
  const t = useToasts()
  const redeliver = useMutation(api.webhooks.redeliver)
  const { results, status, loadMore } = usePaginatedQuery(api.webhooks.deliveries, { endpointId }, { initialNumItems: 10 })
  if (status === 'LoadingFirstPage') return <Skeleton className="h-24" />
  if (!results.length) return <p className="text-sm text-muted">No deliveries yet.</p>
  return (
    <div>
      <ul className="divide-y divide-foam-deep">
        {results.map((d) => {
          const s = DELIVERY_STATUS[d.status] || DELIVERY_STATUS.pending
          return (
            <li key={d.id} className="py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill className={s.className}>{s.label}</Pill>
                  <span className="font-mono text-xs text-chart-ink">{d.eventType}</span>
                  {d.redelivery && <span className="text-xs text-muted">redelivery</span>}
                </div>
                <p className="mt-1 text-muted">
                  {formatTime(d.createdAt)} · {d.attempts} attempt{d.attempts === 1 ? '' : 's'}
                  {d.responseStatus ? ` · HTTP ${d.responseStatus}` : ''}
                  {d.durationMs != null ? ` · ${d.durationMs} ms` : ''}
                </p>
                {d.lastError && d.status !== 'succeeded' && <p className="mt-0.5 text-signal">{d.lastError}</p>}
                {d.status === 'pending' && d.nextAttemptAt && (
                  <p className="mt-0.5 text-muted">Next try {formatTime(d.nextAttemptAt)}</p>
                )}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  try {
                    await redeliver({ deliveryId: d.id })
                    t.ok('Sent again')
                  } catch (err) {
                    t.fail(err)
                  }
                }}
              >
                Redeliver
              </Button>
            </li>
          )
        })}
      </ul>
      {status === 'CanLoadMore' && (
        <Button variant="ghost" size="sm" onClick={() => loadMore(20)}>
          Show older
        </Button>
      )}
    </div>
  )
}

function EndpointCard({ ep, events, onSecret }) {
  const t = useToasts()
  const update = useMutation(api.webhooks.update)
  const remove = useMutation(api.webhooks.remove)
  const sendTest = useMutation(api.webhooks.sendTest)
  const rotate = useAction(api.webhooks.rotateSecret)
  const [editing, setEditing] = useState(false)
  const [types, setTypes] = useState(ep.eventTypes)
  const [showLog, setShowLog] = useState(false)
  const label = (id) => events.find((e) => e.id === id)?.label || id

  const act = async (fn, okText) => {
    try {
      await fn()
      if (okText) t.ok(okText)
    } catch (err) {
      t.fail(err)
    }
  }

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-chart-ink break-all">{ep.description || ep.url}</span>
            <Pill className={ep.status === 'active' ? 'bg-kelp/15 text-kelp' : 'bg-signal/10 text-signal'}>
              {ep.status === 'active' ? 'On' : 'Off'}
            </Pill>
          </div>
          {ep.description && <p className="mt-1 text-sm text-muted break-all">{ep.url}</p>}
          {ep.disabledReason && ep.status !== 'active' && <p className="mt-1 text-sm text-signal">{ep.disabledReason}</p>}
          <p className="mt-1 text-sm text-muted">
            Secret {ep.secretHint || 'not set'} · Last delivered {formatTime(ep.lastSuccessAt)}
            {ep.consecutiveFailures > 0 ? ` · ${ep.consecutiveFailures} failed in a row` : ''}
          </p>
          {!editing && <p className="mt-1 text-sm text-chart-ink">{ep.eventTypes.map(label).join(', ')}</p>}
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          {ep.status === 'active' ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => act(() => sendTest({ endpointId: ep.id }), 'Test sent')}>
                Send test
              </Button>
              <Button size="sm" variant="secondary" onClick={() => act(() => update({ endpointId: ep.id, enabled: false }), 'Turned off')}>
                Turn off
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => act(() => update({ endpointId: ep.id, enabled: true }), 'Turned on')}>
              Turn on
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setEditing((x) => !x)}>
            {editing ? 'Cancel' : 'Edit events'}
          </Button>
        </div>
      </div>

      {editing && (
        <div className="mt-4 space-y-4">
          <EventPicker events={events} value={types} onChange={setTypes} idPrefix={`ep-${ep.id}`} />
          <Button
            size="sm"
            disabled={!types.length}
            onClick={() =>
              act(async () => {
                await update({ endpointId: ep.id, eventTypes: types })
                setEditing(false)
              }, 'Events saved')
            }
          >
            Save events
          </Button>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-foam-deep pt-4">
        <Button size="sm" variant="ghost" onClick={() => setShowLog((x) => !x)}>
          {showLog ? 'Hide deliveries' : 'Show deliveries'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            act(async () => {
              if (!window.confirm('Replace the signing secret? The old one stops working at once.')) return
              const res = await rotate({ endpointId: ep.id })
              onSecret(res.secret)
            })
          }
        >
          Rotate secret
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            act(async () => {
              if (!window.confirm(`Delete ${ep.url}? Nothing more is sent to it.`)) return
              await remove({ endpointId: ep.id })
            }, 'Endpoint deleted')
          }
        >
          Delete
        </Button>
      </div>
      {showLog && (
        <div className="mt-3">
          <DeliveryLog endpointId={ep.id} />
        </div>
      )}
    </Card>
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

export default function WebhooksPage() {
  const data = useQuery(api.webhooks.overview)
  const [secret, setSecret] = useState(null)

  return (
    <ProtectedRoute requiredRole="admin">
      <Layout title="Webhooks">
        <FormPage width="lg">
          <PageHeader
            showTitle={false}
            breadcrumbs={[
              { label: 'Dashboard', href: '/dashboard' },
              { label: 'Company settings', href: '/company-settings' },
              { label: 'Webhooks' },
            ]}
            description="Tell your other systems the moment something happens on the farm. Failed deliveries are retried for about a day; you can send any delivery again."
            related={[
              { label: 'API keys', href: '/api-keys' },
              { label: 'Automations', href: '/automations' },
            ]}
          />
          {!data ? (
            <Skeleton className="h-64" />
          ) : (
            <div className="space-y-6">
              {!data.encryptionReady && (
                <Card>
                  <p className="text-sm text-chart-ink">
                    Endpoints cannot be added yet: the platform encryption key is not set on the server. Ask the platform operator to set it.
                  </p>
                </Card>
              )}
              {secret && <SecretOnce title="Copy the signing secret now" secret={secret} onDone={() => setSecret(null)} />}
              {data.endpoints.length === 0 ? (
                <Card>
                  <EmptyState title="No webhook endpoints" description="Add one below to receive farm events in another system." />
                </Card>
              ) : (
                data.endpoints.map((ep) => <EndpointCard key={ep.id} ep={ep} events={data.events} onSecret={setSecret} />)
              )}
              <NewEndpoint events={data.events} onCreated={setSecret} />
              <Card>
                <CardHeader title="Checking deliveries" subtitle="Each POST carries X-PBA-Event-Id, X-PBA-Event-Type, X-PBA-Delivery-Id and X-PBA-Signature (t=unix seconds, v1=HMAC-SHA256 of t.body). The same event can arrive more than once: skip ids you have seen." />
                <pre className="overflow-x-auto rounded-lg bg-foam px-3 py-3 font-mono text-xs leading-relaxed text-chart-ink">{VERIFY_SNIPPET}</pre>
              </Card>
            </div>
          )}
        </FormPage>
      </Layout>
    </ProtectedRoute>
  )
}
