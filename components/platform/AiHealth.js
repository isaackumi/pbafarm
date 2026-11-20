import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { Badge, Card, CardHeader, GhostButton, LoadingState, StatCard } from '../ui'
import { useToast } from '../Toast'
import { errorMessage } from '../../lib/errorMessage'
import { SimpleTable } from './PlatformLayout'

/**
 * AI health for the platform console (AI protections, D-023): calls, errors
 * and p95 latency over the last hour, server-key spend this month, open
 * circuit breakers, active alerts, and each tenant's budget (paginated).
 * Every read is bounded on the Convex side (convex/aiGuard.ts).
 */

/** Rounded to 5 minutes so the subscription stays stable (queries do not read the clock). */
function useNow() {
  return useMemo(() => Math.floor(Date.now() / 300_000) * 300_000, [])
}

const money = (n) => `$${(n ?? 0).toFixed(2)}`
const seconds = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`)
/** The query's clock is rounded to 5 minutes: drop breakers that closed since. */
const stillOpen = (breakers) => breakers.filter((b) => b.openUntil > Date.now())
const percent = (x) => `${Math.round((x ?? 0) * 1000) / 10}%`
const until = (ms) => new Date(ms).toISOString().slice(11, 16) + ' UTC'

/** Compact card for the overview page. */
export function AiHealthCard() {
  const now = useNow()
  const h = useQuery(api.aiGuard.platformHealth, { now })
  if (h === undefined) return <LoadingState label="Loading AI health…" />
  const errorTone = h.lastHour.calls >= 20 && h.lastHour.errorRate >= 0.25 ? 'warn' : 'default'
  return (
    <Card>
      <CardHeader
        title="AI health"
        subtitle="Last hour, all tenants"
        action={
          <Link className="text-sm text-pearl-cyan hover:underline" href="/platform/ai">
            Details
          </Link>
        }
      />
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
        <div><dt className="text-muted">Calls</dt><dd className="text-xl tabular-nums">{h.lastHour.calls}</dd></div>
        <div><dt className="text-muted">Errors</dt><dd className={`text-xl tabular-nums ${errorTone === 'warn' ? 'text-alert' : ''}`}>{percent(h.lastHour.errorRate)}</dd></div>
        <div><dt className="text-muted">p95</dt><dd className="text-xl tabular-nums">{seconds(h.lastHour.p95Ms)}</dd></div>
        <div><dt className="text-muted">Server key, month</dt><dd className="text-xl tabular-nums">{money(h.monthSpendUsd.server)}</dd></div>
        <div><dt className="text-muted">Open breakers</dt><dd className={`text-xl tabular-nums ${stillOpen(h.breakers).length ? 'text-alert' : ''}`}>{stillOpen(h.breakers).length}</dd></div>
      </dl>
      {h.alerts.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {h.alerts.slice(0, 3).map((a, i) => (
            <li key={i} className="text-alert">{a.message}</li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function TenantOverride({ row }) {
  const set = useMutation(api.aiGuard.setTenantOverride)
  const { showToast } = useToast()
  const [budget, setBudget] = useState(row.platformBudgetUsd == null ? '' : String(row.platformBudgetUsd))
  const [busy, setBusy] = useState(false)
  const save = async (allowOverBudget) => {
    const trimmed = budget.trim()
    const value = trimmed === '' ? null : Number(trimmed)
    if (value !== null && !(Number.isFinite(value) && value > 0)) return showToast('Enter a positive amount or leave it empty', 'error')
    setBusy(true)
    try {
      await set({ companyId: row.companyId, platformBudgetUsd: value, allowOverBudget })
      showToast('Tenant AI budget updated', 'success')
    } catch (err) {
      showToast(errorMessage(err, 'Could not update the budget'), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <input
        aria-label={`Platform budget for ${row.name}`}
        type="number"
        min={0}
        step="1"
        placeholder="Default"
        value={budget}
        onChange={(e) => setBudget(e.target.value)}
        className="w-24 rounded-[10px] border border-line bg-surface px-2 py-1 text-sm text-text"
      />
      <GhostButton size="sm" disabled={busy} onClick={() => save(row.allowedOver)}>
        Save
      </GhostButton>
      <GhostButton size="sm" disabled={busy} onClick={() => save(!row.allowedOver)}>
        {row.allowedOver ? 'Stop override' : 'Allow over budget'}
      </GhostButton>
    </div>
  )
}

function ResetBreaker({ row }) {
  const reset = useMutation(api.aiGuard.resetBreaker)
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      await reset({ breakerId: row.id })
      showToast(`${row.providerId}/${row.model} is available again`, 'success')
    } catch (err) {
      showToast(errorMessage(err, 'Could not reset the breaker'), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <GhostButton size="sm" disabled={busy} onClick={run} aria-label={`Reset breaker for ${row.providerId}/${row.model}`}>
      Reset
    </GhostButton>
  )
}

/** Full AI health page: per provider, open breakers, alerts, tenant budgets. */
export function AiHealthDetails() {
  const now = useNow()
  const h = useQuery(api.aiGuard.platformHealth, { now })
  const tenants = usePaginatedQuery(api.aiGuard.tenantBudgets, { now }, { initialNumItems: 25 })
  if (h === undefined) return <LoadingState label="Loading AI health…" />
  return (
    <div className="space-y-6">
      {h.truncated && <p className="text-sm text-alert">The last hour has more calls than one scan covers; figures are for the newest calls.</p>}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Calls, last hour" value={h.lastHour.calls} />
        <StatCard label="Errors" value={percent(h.lastHour.errorRate)} hint={`${h.lastHour.errors} failed`} tone={h.lastHour.errorRate >= 0.25 && h.lastHour.calls >= 20 ? 'warn' : 'default'} />
        <StatCard label="p95 latency" value={seconds(h.lastHour.p95Ms)} />
        <StatCard
          label="Server key, this month"
          value={money(h.monthSpendUsd.server)}
          hint={h.monthSpendUsd.serverBudgetUsd == null ? 'No budget set' : `of ${money(h.monthSpendUsd.serverBudgetUsd)}`}
        />
        <StatCard label="Open breakers" value={stillOpen(h.breakers).length} tone={stillOpen(h.breakers).length ? 'warn' : 'default'} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Providers" subtitle="Last hour" />
          <SimpleTable
            rowKey={(r) => r.providerId}
            rows={h.providers}
            empty="No AI calls in the last hour"
            columns={[
              { key: 'providerId', label: 'Provider' },
              { key: 'calls', label: 'Calls', align: 'right', render: (r) => r.stats.calls },
              { key: 'errors', label: 'Errors', align: 'right', render: (r) => percent(r.stats.errorRate) },
              { key: 'p95', label: 'p95', align: 'right', render: (r) => seconds(r.stats.p95Ms) },
              { key: 'cost', label: 'Spend', align: 'right', render: (r) => money(r.stats.costUsd) },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Open breakers" subtitle="Models paused after failures; Auto skips them" />
          <SimpleTable
            rowKey={(r) => r.id}
            rows={stillOpen(h.breakers)}
            empty="All models are closed (healthy)"
            columns={[
              { key: 'model', label: 'Model', render: (r) => `${r.providerId}/${r.model}` },
              { key: 'scope', label: 'Key', render: (r) => (r.scope === 'server' ? 'Server' : r.tenant ?? 'Org') },
              { key: 'why', label: 'Why', render: (r) => (r.refused ? <Badge tone="alert">no quota</Badge> : r.lastKind ?? '—') },
              { key: 'openUntil', label: 'Until', render: (r) => until(r.openUntil) },
              { key: 'reset', label: '', align: 'right', render: (r) => <ResetBreaker row={r} /> },
            ]}
          />
        </Card>
      </div>
      {h.alerts.length > 0 && (
        <Card>
          <CardHeader title="Active alerts" subtitle="Checked every 5 minutes; admins are emailed at most hourly per alert" />
          <ul className="space-y-2 text-sm">
            {h.alerts.map((a, i) => (
              <li key={i} className="flex gap-3">
                <Badge tone="warn">{a.kind.replace(/_/g, ' ')}</Badge>
                <span className="text-text">{a.message}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card>
        <CardHeader title="Budgets per tenant" subtitle="This month (UTC), highest spend first. Empty platform budget = the env default. Allow over budget also lifts the tenant's share cap on the server key." />
        <SimpleTable
          rowKey={(r) => r.companyId}
          rows={tenants.results}
          empty={tenants.status === 'LoadingFirstPage' ? 'Loading…' : 'No AI spend this month'}
          columns={[
            {
              key: 'name',
              label: 'Tenant',
              render: (r) => (
                <Link className="text-pearl-cyan hover:underline" href={`/platform/tenants/${r.companyId}`}>
                  {r.name}
                </Link>
              ),
            },
            { key: 'calls', label: 'Calls', align: 'right' },
            { key: 'errors', label: 'Errors', align: 'right' },
            { key: 'spentUsd', label: 'Spend', align: 'right', render: (r) => money(r.spentUsd) },
            {
              key: 'usedPct',
              label: 'Budget',
              align: 'right',
              render: (r) =>
                r.effectiveUsd == null ? (
                  'None'
                ) : (
                  <span className={r.usedPct >= 100 && !r.allowedOver ? 'text-alert' : r.usedPct >= 80 ? 'text-warn' : ''}>
                    {r.usedPct}% of {money(r.effectiveUsd)}
                    {r.allowedOver ? ' (override)' : ''}
                  </span>
                ),
            },
            { key: 'override', label: 'Platform override', align: 'right', render: (r) => <TenantOverride row={r} /> },
          ]}
        />
        {tenants.status === 'CanLoadMore' && (
          <div className="mt-3">
            <GhostButton size="sm" onClick={() => tenants.loadMore(25)}>
              Load more
            </GhostButton>
          </div>
        )}
      </Card>
    </div>
  )
}
