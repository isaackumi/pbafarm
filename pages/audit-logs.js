import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import auditLogService from '../lib/auditLogService'

function AuditLogsContent() {
  const [logs, setLogs] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tableName, setTableName] = useState('')
  const [actionType, setActionType] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const filters = { limit: 200 }
      if (tableName) filters.tableName = tableName
      if (actionType) filters.actionType = actionType
      const [{ data, error: listErr }, { data: sum, error: sumErr }] =
        await Promise.all([
          auditLogService.getAuditLogs(filters),
          auditLogService.getSummary(),
        ])
      if (listErr) throw listErr
      if (sumErr) console.warn(sumErr)
      setLogs(data || [])
      setSummary(sum)
    } catch (err) {
      setError(err.message || String(err))
      setLogs([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [tableName, actionType])

  return (
    <Layout title="Audit Logs">
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Link
          href="/dashboard"
          className="text-lagoon-800 hover:text-lagoon-950 flex items-center text-sm font-semibold"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Dashboard
        </Link>
        <select
          value={tableName}
          onChange={(e) => setTableName(e.target.value)}
          className="border border-input-border rounded-md px-3 py-1.5 text-sm"
        >
          <option value="">All tables</option>
          <option value="cages">Cages</option>
          <option value="dailyRecords">Daily records</option>
          <option value="biweeklyRecords">Biweekly records</option>
          <option value="stockingHistory">Stocking</option>
          <option value="feedTypes">Feed types</option>
          <option value="feedPurchases">Feed purchases</option>
          <option value="users">Users</option>
          <option value="companies">Companies</option>
        </select>
        <select
          value={actionType}
          onChange={(e) => setActionType(e.target.value)}
          className="border border-input-border rounded-md px-3 py-1.5 text-sm"
        >
          <option value="">All actions</option>
          <option value="create">Create</option>
          <option value="update">Update</option>
          <option value="delete">Delete</option>
          <option value="approve">Approve</option>
          <option value="reject">Reject</option>
        </select>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="page-card p-4">
            <p className="text-xs text-muted uppercase">Total events</p>
            <p className="font-data text-xl font-bold text-chart-ink">
              {summary.total_logs ?? logs.length}
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded-md border border-signal/30 bg-signal/10 text-sm text-signal">
          {error}
        </div>
      )}

      <div className="page-card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-muted">Loading audit logs…</div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-muted">No audit events yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-foam-deep">
              <thead className="bg-foam-deep/40">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase">
                    When
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase">
                    Action
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase">
                    Table
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase">
                    Record
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase">
                    User
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foam-deep">
                {logs.map((log) => (
                  <tr key={log.id || log._id} className="hover:bg-foam/60">
                    <td className="px-4 py-3 text-sm font-data text-chart-ink whitespace-nowrap">
                      {log.created_at
                        ? new Date(log.created_at).toLocaleString()
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-lagoon-800">
                      {log.action_type}
                    </td>
                    <td className="px-4 py-3 text-sm text-chart-ink">
                      {log.table_name}
                    </td>
                    <td className="px-4 py-3 text-xs font-data text-muted truncate max-w-[10rem]">
                      {log.record_id || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs font-data text-muted truncate max-w-[10rem]">
                      {log.user_id || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
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
