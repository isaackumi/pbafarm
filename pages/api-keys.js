import { useMemo, useState } from 'react'
import { useAction, useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { Button, Card, CardHeader, EmptyState, Field, FormPage, Input, PageHeader, Select, Skeleton } from '../components/ui'
import { useToast } from '../components/Toast'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'

const STATUS = {
  active: { label: 'Active', className: 'bg-kelp/15 text-kelp' },
  revoked: { label: 'Revoked', className: 'bg-signal/10 text-signal' },
  expired: { label: 'Expired', className: 'bg-foam text-chart-ink' },
}

function formatTime(ms) {
  if (!ms) return 'Never'
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return '—'
  }
}

function NewKeyCard({ scopes, sites, onCreated }) {
  const { showToast } = useToast()
  const create = useAction(api.apiKeys.create)
  const [name, setName] = useState('')
  const [chosen, setChosen] = useState(['cages:read'])
  const [siteIds, setSiteIds] = useState([])
  const [expiry, setExpiry] = useState('')
  const [busy, setBusy] = useState(false)

  const toggle = (list, setList, id) =>
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await create({
        name,
        scopes: chosen,
        locationIds: siteIds.length ? siteIds : undefined,
        expiresInDays: expiry ? Number(expiry) : undefined,
      })
      onCreated(res)
      setName('')
    } catch (err) {
      showToast('error', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader title="New API key" subtitle="Give a partner system or script its own key with only the permissions it needs." />
      <form onSubmit={submit} className="space-y-5">
        <Field label="Name" htmlFor="key-name" hint="Who or what uses it, e.g. Feed supplier portal" required>
          <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </Field>
        <fieldset>
          <legend className="text-sm font-medium text-chart-ink mb-2">Permissions</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {scopes.map((s) => (
              <label key={s.id} className="flex items-center gap-3 rounded-lg border border-foam-deep px-3 min-h-12 sm:min-h-10 text-sm">
                <input type="checkbox" checked={chosen.includes(s.id)} onChange={() => toggle(chosen, setChosen, s.id)} />
                <span>
                  {s.label}
                  <span className="block text-xs text-muted font-mono">{s.id}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {sites.length > 1 && (
          <fieldset>
            <legend className="text-sm font-medium text-chart-ink mb-1">Sites</legend>
            <p className="text-sm text-muted mb-2">Leave all unticked to allow every site.</p>
            <div className="flex flex-wrap gap-2">
              {sites.map((s) => (
                <label key={s.id} className="flex items-center gap-2 rounded-lg border border-foam-deep px-3 min-h-12 sm:min-h-10 text-sm">
                  <input type="checkbox" checked={siteIds.includes(s.id)} onChange={() => toggle(siteIds, setSiteIds, s.id)} />
                  {s.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <Field label="Expires" htmlFor="key-expiry">
          <Select id="key-expiry" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
            <option value="">Never</option>
            <option value="30">In 30 days</option>
            <option value="90">In 90 days</option>
            <option value="365">In a year</option>
          </Select>
        </Field>
        <Button type="submit" disabled={busy || !name.trim() || !chosen.length}>
          {busy ? 'Creating…' : 'Create key'}
        </Button>
      </form>
    </Card>
  )
}

function CreatedKey({ created, onDone }) {
  const { showToast } = useToast()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created.key)
      showToast('success', 'Key copied')
    } catch {
      showToast('error', 'Copy failed; select the key and copy it')
    }
  }
  return (
    <Card className="border-lake">
      <CardHeader title="Copy your new key now" subtitle="This is the only time it is shown. Store it in the other system's secret settings." />
      <code className="block break-all rounded-lg bg-foam px-3 py-3 font-mono text-sm text-chart-ink select-all">{created.key}</code>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={copy}>Copy key</Button>
        <Button variant="secondary" onClick={onDone}>I have stored it</Button>
      </div>
    </Card>
  )
}

function KeyRow({ k, sitesById }) {
  const { showToast } = useToast()
  const revoke = useMutation(api.apiKeys.revoke)
  const s = STATUS[k.status] || STATUS.active
  const onRevoke = async () => {
    if (!window.confirm(`Revoke "${k.name}"? Systems using it stop working immediately.`)) return
    try {
      await revoke({ keyId: k.id })
      showToast('success', 'Key revoked')
    } catch (err) {
      showToast('error', errorMessage(err))
    }
  }
  return (
    <li className="py-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-chart-ink">{k.name}</span>
          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${s.className}`}>{s.label}</span>
        </div>
        <p className="mt-1 font-mono text-xs text-muted">{k.prefix}</p>
        <p className="mt-1 text-sm text-muted">{k.scopes.join(', ')}</p>
        <p className="mt-1 text-sm text-muted">
          {k.locationIds.length ? `Sites: ${k.locationIds.map((id) => sitesById[id] || 'removed site').join(', ')}` : 'All sites'}
          {' · '}Last used {formatTime(k.lastUsedAt)}
          {k.expiresAt ? ` · Expires ${formatTime(k.expiresAt)}` : ''}
        </p>
        <p className="mt-1 text-xs text-muted">Created {formatTime(k.createdAt)}{k.createdBy ? ` by ${k.createdBy}` : ''}</p>
      </div>
      {k.status === 'active' && (
        <Button variant="secondary" size="sm" onClick={onRevoke}>Revoke</Button>
      )}
    </li>
  )
}

export default function ApiKeysPage() {
  const [now] = useState(() => Date.now())
  const data = useQuery(api.apiKeys.overview, { now })
  const [created, setCreated] = useState(null)
  const sitesById = useMemo(
    () => Object.fromEntries((data?.sites || []).map((s) => [s.id, s.name])),
    [data],
  )

  return (
    <ProtectedRoute requiredRole="admin">
      <Layout title="API keys">
        <FormPage width="lg">
          <PageHeader
            showTitle={false}
            breadcrumbs={[
              { label: 'Dashboard', href: '/dashboard' },
              { label: 'Company settings', href: '/company-settings' },
              { label: 'API keys' },
            ]}
            description="Keys let other systems read your farm data and record daily entries and sampling through the API. Each key only sees your company."
            related={[
              { label: 'API documentation', href: '/api-docs' },
              { label: 'Webhooks', href: '/webhooks' },
            ]}
          />
          {!data ? (
            <Skeleton className="h-64" />
          ) : (
            <div className="space-y-6">
              {created && <CreatedKey created={created} onDone={() => setCreated(null)} />}
              <Card>
                <CardHeader title="Keys" subtitle="Revoke a key you no longer use. Revoked keys stay listed for the record." />
                {data.keys.length === 0 ? (
                  <EmptyState title="No API keys yet" description="Create one below when a partner or script needs access." />
                ) : (
                  <ul className="divide-y divide-foam-deep">
                    {data.keys.map((k) => (
                      <KeyRow key={k.id} k={k} sitesById={sitesById} />
                    ))}
                  </ul>
                )}
              </Card>
              <NewKeyCard scopes={data.scopes} sites={data.sites} onCreated={setCreated} />
            </div>
          )}
        </FormPage>
      </Layout>
    </ProtectedRoute>
  )
}
