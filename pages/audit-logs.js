import { useMemo, useState } from 'react'
import { usePaginatedQuery, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { PageHeader, Button, Select, StatCard, EmptyState } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../convex/_generated/api'

function AuditLogsContent() {
  const { user } = useAuth()
  const [tableName, setTableName] = useState('')
  const [actionType, setActionType] = useState('')
  const [days, setDays] = useState(30)
  const [selected, setSelected] = useState(null)

  const dateFrom = useMemo(
    () => Date.now() - Number(days) * 24 * 60 * 60 * 1000,
    [days],
  )

  const filters = useMemo(() => {
    const f = { dateFrom }
    if (tableName) f.tableName = tableName
    if (actionType) f.actionType = actionType
    return f
  }, [tableName, actionType, dateFrom])

  // Paginated (PLAT-001): newest first, 50 at a time, "Load more" below.
  const {
    results: logs,
    status: pageStatus,
    loadMore,
  } = usePaginatedQuery(api.audit.listPage, user ? filters : 'skip', {
    initialNumItems: 50,
  })
  const summary = useQuery(
    api.audit.getSummary,
    user ? { dateFrom } : 'skip',
  )

  const loading = pageStatus === 'LoadingFirstPage'

  return (
    <Layout title="Audit Logs">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Admin' },
          { label: 'Audit logs' },
        ]}
        description="Who changed what across cages, feed stock, settings, and users."
        related={[
          { label: 'Approvals', href: '/approvals' },
          { label: 'Company settings', href: '/company-settings' },
          { label: 'Users', href: '/users' },
        ]}
        actions={
          <Button href="/dashboard" variant="secondary" size="sm">
            Dashboard
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:max-w-3xl">
        <Select
          aria-label="Date range"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </Select>
        <Select
          aria-label="Table"
          value={tableName}
          onChange={(e) => setTableName(e.target.value)}
        >
          <option value="">All tables</option>
          <option value="cages">Cages</option>
          <option value="dailyRecords">Daily records</option>
          <option value="biweeklyRecords">Biweekly records</option>
          <option value="stockingHistory">Stocking</option>
          <option value="topupHistory">Top-ups</option>
          <option value="feedTypes">Feed types</option>
          <option value="feedPurchases">Feed purchases</option>
          <option value="feedInventory">Feed inventory lots</option>
          <option value="feedInventoryTransactions">Feed ledger</option>
          <option value="companies">Companies / settings</option>
          <option value="users">Users</option>
        </Select>
        <Select
          aria-label="Action"
          value={actionType}
          onChange={(e) => setActionType(e.target.value)}
        >
          <option value="">All actions</option>
          <option value="create">Create</option>
          <option value="update">Update</option>
          <option value="delete">Delete</option>
          <option value="approve">Approve</option>
          <option value="reject">Reject</option>
          <option value="transfer">Transfer</option>
          <option value="reversal">Reversal</option>
          <option value="stock_override">Stock override</option>
          <option value="settings_publish">Settings publish</option>
        </Select>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard label="Events in range" value={summary.total_logs ?? 0} />
          {(summary.top_users || []).slice(0, 3).map((u) => (
            <StatCard
              key={u.userId}
              label={<span className="block truncate">{u.label || u.userId}</span>}
              value={u.count}
              unit="events"
            />
          ))}
        </div>
      )}

      <div className="page-card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-muted">Loading audit logs…</div>
        ) : logs.length === 0 ? (
          <EmptyState
            title="No audit events yet"
            description="Changes to cages, feed stock, settings and users will show up here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-foam-deep">
              <thead className="bg-foam">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted">
                    When
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted">
                    Action
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted">
                    Table
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted">
                    Record
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted">
                    User
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foam-deep">
                {logs.map((log) => (
                  <tr
                    key={log.id || log._id}
                    className="hover:bg-foam cursor-pointer"
                    onClick={() => setSelected(log)}
                  >
                    <td className="px-4 py-3 text-sm font-data tabular-nums text-chart-ink whitespace-nowrap">
                      {log.created_at
                        ? new Date(log.created_at).toLocaleString()
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-lake">
                      {log.action_type}
                    </td>
                    <td className="px-4 py-3 text-sm text-chart-ink">
                      {log.table_name}
                    </td>
                    <td className="px-4 py-3 text-xs font-data text-muted truncate max-w-[10rem]">
                      {log.record_id || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted truncate max-w-[12rem]">
                      {log.user_label || log.user_id || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pageStatus === 'CanLoadMore' || pageStatus === 'LoadingMore' ? (
              <div className="p-4 text-center border-t border-foam-deep">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pageStatus === 'LoadingMore'}
                  onClick={() => loadMore(50)}
                >
                  {pageStatus === 'LoadingMore' ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 modal-backdrop"
            onClick={() => setSelected(null)}
          />
          <div role="dialog" aria-modal="true" className="relative bg-surface border border-foam-deep rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-auto p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="text-lg font-semibold text-chart-ink">
                  {selected.action_type} · {selected.table_name}
                </h3>
                <p className="text-sm text-muted">
                  {selected.user_label || selected.user_id || 'Unknown user'} ·{' '}
                  {selected.created_at
                    ? new Date(selected.created_at).toLocaleString()
                    : '—'}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                Close
              </Button>
            </div>
            <p className="text-xs text-muted mb-2">Record: {selected.record_id || '—'}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-muted mb-1">
                  Previous
                </p>
                <pre className="text-xs bg-foam border border-foam-deep text-chart-ink rounded-lg p-3 overflow-auto max-h-64 font-data">
                  {JSON.stringify(selected.previous_values ?? null, null, 2)}
                </pre>
              </div>
              <div>
                <p className="text-xs font-medium text-muted mb-1">New</p>
                <pre className="text-xs bg-foam border border-foam-deep text-chart-ink rounded-lg p-3 overflow-auto max-h-64 font-data">
                  {JSON.stringify(selected.new_values ?? null, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}

export default function AuditLogsPage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <AuditLogsContent />
    </ProtectedRoute>
  )
}
