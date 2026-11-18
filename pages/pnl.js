import { useMemo, useState } from 'react'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { PageHeader, Field, Input, Select, StatCard, TabBar } from '../components/ui'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { useCurrency } from '../hooks/useCurrency'
import { speciesLabel } from '../lib/fishSpecies'
import { mortalityCauseLabel } from '../lib/farmHealth'

export default function PnLPage() {
  return (
    <ProtectedRoute>
      <Layout title="Cage P&L">
        <CagePnL />
      </Layout>
    </ProtectedRoute>
  )
}

const marginClass = (n) => (n >= 0 ? 'text-kelp' : 'text-signal')

function CagePnL() {
  const { user } = useAuth()
  const { locationArgs } = useLocation()
  const { formatCurrency } = useCurrency()

  const [view, setView] = useState('cage')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedCageId, setSelectedCageId] = useState('')

  const listArgs = useMemo(() => {
    if (!user) return 'skip'
    const args = { ...locationArgs }
    if (dateFrom) args.dateFrom = dateFrom
    if (dateTo) args.dateTo = dateTo
    return args
  }, [user, locationArgs, dateFrom, dateTo])

  const rows = useQuery(api.reports.listCagePnL, listArgs)
  const overheads = useQuery(api.reports.pnlOverheads, listArgs)
  const cycles = useQuery(
    api.reports.listCyclePnL,
    user && view === 'cycle' ? locationArgs : 'skip',
  )
  const detail = useQuery(
    api.reports.getCagePnL,
    user && selectedCageId
      ? {
          cageId: selectedCageId,
          ...(dateFrom ? { dateFrom } : {}),
          ...(dateTo ? { dateTo } : {}),
        }
      : 'skip',
  )

  const totals = useMemo(() => {
    const list = rows || []
    const sum = (k) => list.reduce((s, r) => s + (r[k] || 0), 0)
    const overhead = overheads?.total || 0
    const cost = sum('total_cost') + overhead
    const revenue = sum('revenue')
    const harvestKg = sum('harvest_kg')
    return {
      feed: sum('feed_cost'),
      revenue,
      overhead,
      cost,
      net: revenue - cost,
      costPerKg: harvestKg > 0 ? cost / harvestKg : null,
    }
  }, [rows, overheads])

  const perKg = (n) => (n == null ? '—' : `${formatCurrency(n)}/kg`)

  return (
    <div data-tour="page-pnl">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Cage P&L' },
        ]}
        description="Revenue against full cost: feed at what it was bought for, fingerlings and other expenses. Cost per kg is total cost over harvested kg."
        related={[
          { label: 'Expenses', href: '/expenses' },
          { label: 'Sales', href: '/sales' },
          { label: 'Harvest', href: '/harvest' },
        ]}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Revenue" value={formatCurrency(totals.revenue)} />
        <StatCard
          label="Total cost"
          value={formatCurrency(totals.cost)}
          hint={`Feed ${formatCurrency(totals.feed)} · overheads ${formatCurrency(totals.overhead)}`}
        />
        <StatCard
          label="Net margin"
          value={formatCurrency(totals.net)}
          tone={totals.net >= 0 ? 'good' : 'warn'}
        />
        <StatCard label="Cost per kg" value={perKg(totals.costPerKg)} hint="Farm-wide, incl. overheads" />
      </div>

      <div className="page-card p-4 mb-6 flex flex-col md:flex-row md:items-end gap-4">
        <TabBar
          tabs={[
            { id: 'cage', label: 'By cage' },
            { id: 'cycle', label: 'By cycle' },
          ]}
          active={view}
          onChange={setView}
        />
        {view === 'cage' && (
          <div className="grid grid-cols-2 gap-4 md:w-96">
            <Field label="From">
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </Field>
            <Field label="To">
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </Field>
          </div>
        )}
      </div>

      {view === 'cycle' ? (
        <CycleTable cycles={cycles} formatCurrency={formatCurrency} perKg={perKg} />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 page-card overflow-hidden">
            <div className="px-6 py-4 border-b border-foam-deep">
              <h3 className="text-lg font-medium text-chart-ink">By cage</h3>
            </div>
            {rows === undefined ? (
              <p className="px-6 py-8 text-sm text-muted">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="px-6 py-8 text-sm text-muted">
                No feed, expenses, harvest or sales in this range.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-foam-deep">
                  <thead className="bg-foam-deep/40">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted">Cage</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted">Revenue</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted">Total cost</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted">Cost/kg</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted">Net margin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-foam-deep">
                    {rows.map((r) => (
                      <tr
                        key={r.cage_id}
                        className={`cursor-pointer hover:bg-foam/60 ${
                          selectedCageId === r.cage_id ? 'bg-foam/80' : ''
                        }`}
                        onClick={() => setSelectedCageId(r.cage_id)}
                      >
                        <td className="px-4 py-3 text-sm">
                          <span className="font-medium">{r.cage_name}</span>
                          {r.species ? (
                            <span className="block text-xs text-muted">{speciesLabel(r.species)}</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-data">{formatCurrency(r.revenue)}</td>
                        <td className="px-4 py-3 text-sm text-right font-data">{formatCurrency(r.total_cost)}</td>
                        <td className="px-4 py-3 text-sm text-right font-data">{perKg(r.cost_per_kg)}</td>
                        <td className={`px-4 py-3 text-sm text-right font-data font-semibold ${marginClass(r.net_margin)}`}>
                          {formatCurrency(r.net_margin)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="page-card p-6">
            <h3 className="text-lg font-medium text-chart-ink mb-4">Detail</h3>
            {!selectedCageId ? (
              <p className="text-sm text-muted">Select a cage row for detail.</p>
            ) : detail === undefined ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : !detail ? (
              <p className="text-sm text-muted">Cage not found.</p>
            ) : (
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-muted">Cage</dt>
                  <dd className="font-semibold">{detail.cage_name}</dd>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-muted">Feed ({detail.feed_kg.toFixed(1)} kg)</dt>
                    <dd className="font-data">{formatCurrency(detail.feed_cost)}</dd>
                    {Math.abs(detail.feed_cost_list - detail.feed_cost) > 0.005 && (
                      <dd className="text-xs text-muted">
                        {formatCurrency(detail.feed_cost_list)} at list price
                      </dd>
                    )}
                  </div>
                  <div>
                    <dt className="text-muted">Fingerlings</dt>
                    <dd className="font-data">{formatCurrency(detail.fingerling_cost)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Other expenses</dt>
                    <dd className="font-data">{formatCurrency(detail.other_expenses)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Total cost</dt>
                    <dd className="font-data font-semibold">{formatCurrency(detail.total_cost)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Harvest kg</dt>
                    <dd className="font-data">{detail.harvest_kg.toFixed(1)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Cost per kg</dt>
                    <dd className="font-data">{perKg(detail.cost_per_kg)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Revenue ({detail.sold_kg.toFixed(1)} kg sold)</dt>
                    <dd className="font-data">{formatCurrency(detail.revenue)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Net margin</dt>
                    <dd className={`font-data font-semibold ${marginClass(detail.net_margin)}`}>
                      {formatCurrency(detail.net_margin)}
                    </dd>
                  </div>
                </div>
                {detail.feed_list_priced_kg > 0 && (
                  <p className="text-xs text-muted">
                    {detail.feed_list_priced_kg.toFixed(1)} kg of feed has no purchase on record and is costed at list price.
                  </p>
                )}
                <div>
                  <dt className="text-muted mb-1">Mortality ({detail.mortality})</dt>
                  <dd className="space-y-0.5">
                    {Object.keys(detail.mortality_by_cause || {}).length === 0 ? (
                      <span className="text-muted">—</span>
                    ) : (
                      Object.entries(detail.mortality_by_cause).map(([k, v]) => (
                        <div key={k} className="flex justify-between font-data">
                          <span>{mortalityCauseLabel(k)}</span>
                          <span>{v}</span>
                        </div>
                      ))
                    )}
                  </dd>
                </div>
              </dl>
            )}
            {(rows || []).length > 0 && (
              <div className="mt-6">
                <Field label="Or pick cage">
                  <Select value={selectedCageId} onChange={(e) => setSelectedCageId(e.target.value)}>
                    <option value="">Select…</option>
                    {(rows || []).map((r) => (
                      <option key={r.cage_id} value={r.cage_id}>
                        {r.cage_name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function CycleTable({ cycles, formatCurrency, perKg }) {
  return (
    <div className="page-card overflow-hidden">
      <div className="px-6 py-4 border-b border-foam-deep">
        <h3 className="text-lg font-medium text-chart-ink">By production cycle</h3>
        <p className="text-sm text-muted mt-1">
          Each approved stocking, from stocking to close. Open cycles run to today.
        </p>
      </div>
      {cycles === undefined ? (
        <p className="px-6 py-8 text-sm text-muted">Loading…</p>
      ) : cycles.length === 0 ? (
        <p className="px-6 py-8 text-sm text-muted">No approved stockings yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-foam-deep">
            <thead className="bg-foam-deep/40">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted">Cycle</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted">Feed</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted">Fingerlings</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted">Other</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted">Harvest kg</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted">Cost/kg</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted">Net margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-foam-deep">
              {cycles.map((c) => (
                <tr key={c.cycle_id}>
                  <td className="px-4 py-3 text-sm">
                    <span className="font-medium">
                      {c.cage_name} · {c.batch_number}
                    </span>
                    <span className="block text-xs text-muted">
                      {c.start_date} to {c.open ? 'now' : c.end_date}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-right font-data">{formatCurrency(c.feed_cost)}</td>
                  <td className="px-4 py-3 text-sm text-right font-data">{formatCurrency(c.fingerling_cost)}</td>
                  <td className="px-4 py-3 text-sm text-right font-data">{formatCurrency(c.other_expenses)}</td>
                  <td className="px-4 py-3 text-sm text-right font-data">{c.harvest_kg.toFixed(1)}</td>
                  <td className="px-4 py-3 text-sm text-right font-data">{perKg(c.cost_per_kg)}</td>
                  <td className={`px-4 py-3 text-sm text-right font-data font-semibold ${marginClass(c.net_margin)}`}>
                    {formatCurrency(c.net_margin)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
