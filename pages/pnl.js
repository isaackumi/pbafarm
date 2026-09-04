import { useMemo, useState } from 'react'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { PageHeader, Field, Input, Select } from '../components/ui'
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

function CagePnL() {
  const { user } = useAuth()
  const { locationArgs } = useLocation()
  const { formatCurrency } = useCurrency()

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
    return {
      feed: list.reduce((s, r) => s + (r.feed_cost || 0), 0),
      revenue: list.reduce((s, r) => s + (r.revenue || 0), 0),
      margin: list.reduce((s, r) => s + (r.gross_margin || 0), 0),
    }
  }, [rows])

  return (
    <div data-tour="page-pnl">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Cage P&L' },
        ]}
        description="Gross margin by cage: sales revenue minus recorded feed cost (daily entries). Does not include labor or other opex."
        related={[
          { label: 'Sales', href: '/sales' },
          { label: 'Harvest', href: '/harvest' },
        ]}
      />

      <div className="page-card p-4 mb-6 grid grid-cols-1 md:grid-cols-4 gap-4">
        <Field label="From">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </Field>
        <Field label="To">
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </Field>
        <div className="md:col-span-2 flex items-end gap-4 text-sm">
          <div>
            <p className="text-xs uppercase text-muted font-semibold">Feed cost</p>
            <p className="font-data font-semibold">{formatCurrency(totals.feed)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted font-semibold">Revenue</p>
            <p className="font-data font-semibold">
              {formatCurrency(totals.revenue)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted font-semibold">Gross margin</p>
            <p
              className={`font-data font-semibold ${
                totals.margin >= 0 ? 'text-kelp' : 'text-signal'
              }`}
            >
              {formatCurrency(totals.margin)}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 page-card overflow-hidden">
          <div className="px-6 py-4 border-b border-foam-deep">
            <h3 className="text-lg font-medium text-chart-ink">By cage</h3>
          </div>
          {rows === undefined ? (
            <p className="px-6 py-8 text-sm text-muted">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="px-6 py-8 text-sm text-muted">
              No feed, harvest, or sales activity in this range.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-foam-deep">
                <thead className="bg-foam-deep/40">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">
                      Cage
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase">
                      Feed
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase">
                      Revenue
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase">
                      Margin
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase">
                      %
                    </th>
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
                          <span className="block text-xs text-muted">
                            {speciesLabel(r.species)}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-data">
                        {formatCurrency(r.feed_cost)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-data">
                        {formatCurrency(r.revenue)}
                      </td>
                      <td
                        className={`px-4 py-3 text-sm text-right font-data font-semibold ${
                          r.gross_margin >= 0 ? 'text-kelp' : 'text-signal'
                        }`}
                      >
                        {formatCurrency(r.gross_margin)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-data text-muted">
                        {r.margin_pct != null ? `${r.margin_pct.toFixed(0)}%` : '—'}
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
              <div>
                <dt className="text-muted">Species</dt>
                <dd>{speciesLabel(detail.species)}</dd>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-muted">Feed kg</dt>
                  <dd className="font-data">{detail.feed_kg.toFixed(1)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Feed cost</dt>
                  <dd className="font-data">{formatCurrency(detail.feed_cost)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Harvest kg</dt>
                  <dd className="font-data">{detail.harvest_kg.toFixed(1)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Sold kg</dt>
                  <dd className="font-data">{detail.sold_kg.toFixed(1)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Revenue</dt>
                  <dd className="font-data">{formatCurrency(detail.revenue)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Gross margin</dt>
                  <dd
                    className={`font-data font-semibold ${
                      detail.gross_margin >= 0 ? 'text-kelp' : 'text-signal'
                    }`}
                  >
                    {formatCurrency(detail.gross_margin)}
                  </dd>
                </div>
              </div>
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
                <Select
                  value={selectedCageId}
                  onChange={(e) => setSelectedCageId(e.target.value)}
                >
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
    </div>
  )
}
