import { useMemo, useState } from 'react'
import { usePaginatedQuery, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { Avatar, GhostButton, Modal, Pill, Table } from '../components/ui'
import { SettingsCard, SettingsFrame, useSettingsEyebrow } from '../components/settings'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../convex/_generated/api'
import AuditChainStatus from '../components/AuditChainStatus'
import { useLocale, useT } from '../lib/i18n/context'

const TABLES = [
  'cages',
  'dailyRecords',
  'biweeklyRecords',
  'stockingHistory',
  'topupHistory',
  'feedTypes',
  'feedPurchases',
  'feedInventory',
  'feedInventoryTransactions',
  'companies',
  'users',
]
const ACTIONS = ['create', 'update', 'delete', 'approve', 'reject', 'transfer', 'reversal', 'stock_override', 'settings_publish']
const RANGES = [7, 30, 90, 365]

/** Category pill for a row, derived from the table it touched (Paper 47). */
const ACCESS_TABLES = new Set(['users', 'companies', 'memberships', 'roles', 'invitations', 'apiKeys'])
const FINANCE_TABLES = new Set(['feedPurchases', 'sales', 'expenses', 'invoices', 'payments', 'payroll'])
function category(table) {
  if (ACCESS_TABLES.has(table)) return { key: 'access', tone: 'pink' }
  if (FINANCE_TABLES.has(table)) return { key: 'finance', tone: 'cyan' }
  return { key: 'data', tone: 'neutral' }
}

/** Pill dropdown from the Paper 47 table header ("Last 7 days", "Anyone"). */
const SELECT =
  'w-auto rounded-pill border border-line-strong bg-transparent py-[7px] pl-[14px] pr-8 text-[13px] leading-4 text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'

function useLabels() {
  const t = useT()
  return {
    table: (name) => (TABLES.includes(name) ? t(`settingsUi.audit.tables.${name}`) : name),
    action: (type) => (ACTIONS.includes(type) ? t(`settingsUi.audit.actions.${type}`) : type),
  }
}

function useWhen() {
  const t = useT()
  const { formatLocale, locale } = useLocale()
  const loc = formatLocale || locale || undefined
  return (ms) => {
    if (!ms) return { time: '—', day: '' }
    const d = new Date(ms)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    const same = (a, b) => a.toDateString() === b.toDateString()
    const time = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })
    const day = same(d, today)
      ? t('settingsUi.audit.today')
      : same(d, yesterday)
        ? t('settingsUi.audit.yesterday')
        : d.toLocaleDateString(loc, { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
    return { time, day }
  }
}

function AuditLogsContent() {
  const t = useT()
  const { user } = useAuth()
  const labels = useLabels()
  const when = useWhen()
  const eyebrow = useSettingsEyebrow(t('settingsUi.audit.crumb'))
  const [tableName, setTableName] = useState('')
  const [actionType, setActionType] = useState('')
  const [days, setDays] = useState(30)
  const [selected, setSelected] = useState(null)

  const dateFrom = useMemo(() => Date.now() - Number(days) * 24 * 60 * 60 * 1000, [days])

  const filters = useMemo(() => {
    const f = { dateFrom }
    if (tableName) f.tableName = tableName
    if (actionType) f.actionType = actionType
    return f
  }, [tableName, actionType, dateFrom])

  // Paginated (PLAT-001): newest first, 50 at a time, "Load more" below.
  const { results: logs, status: pageStatus, loadMore } = usePaginatedQuery(api.audit.listPage, user ? filters : 'skip', {
    initialNumItems: 50,
  })
  const summary = useQuery(api.audit.getSummary, user ? { dateFrom } : 'skip')

  const loading = pageStatus === 'LoadingFirstPage'

  const columns = [
    {
      key: 'when',
      header: t('settingsUi.audit.col.when'),
      width: '128px',
      render: (log) => {
        const w = when(log.created_at)
        return <span className="whitespace-nowrap tabular-nums">{w.time}</span>
      },
      sub: (log) => when(log.created_at).day,
    },
    {
      key: 'actor',
      header: t('settingsUi.audit.col.actor'),
      width: '194px',
      render: (log) => {
        const name = log.user_label || log.user_id || t('settingsUi.audit.unknownUser')
        return (
          <span className="flex min-w-0 items-center gap-[10px]">
            <Avatar name={name} size={28} />
            <span className="truncate">{name}</span>
          </span>
        )
      },
    },
    {
      key: 'action',
      header: t('settingsUi.audit.col.action'),
      render: (log) => (
        <button
          type="button"
          onClick={() => setSelected(log)}
          className="rounded text-left text-text hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
        >
          {labels.action(log.action_type)} · {labels.table(log.table_name)}
        </button>
      ),
      sub: (log) => <span className="font-mono">{log.record_id || '—'}</span>,
    },
    {
      key: 'category',
      header: t('settingsUi.audit.col.category'),
      width: '146px',
      render: (log) => {
        const c = category(log.table_name)
        return <Pill tone={c.tone}>{t(`settingsUi.audit.category.${c.key}`)}</Pill>
      },
    },
  ]

  const filtersUi = (
    <div className="flex flex-wrap items-center gap-[10px]">
      <select aria-label={t('settingsUi.audit.range')} className={SELECT} value={days} onChange={(e) => setDays(Number(e.target.value))}>
        {RANGES.map((d) => (
          <option key={d} value={d}>
            {t(`settingsUi.audit.ranges.d${d}`)}
          </option>
        ))}
      </select>
      <select aria-label={t('settingsUi.audit.table')} className={SELECT} value={tableName} onChange={(e) => setTableName(e.target.value)}>
        <option value="">{t('settingsUi.audit.allTables')}</option>
        {TABLES.map((name) => (
          <option key={name} value={name}>
            {labels.table(name)}
          </option>
        ))}
      </select>
      <select aria-label={t('settingsUi.audit.action')} className={SELECT} value={actionType} onChange={(e) => setActionType(e.target.value)}>
        <option value="">{t('settingsUi.audit.allActions')}</option>
        {ACTIONS.map((a) => (
          <option key={a} value={a}>
            {labels.action(a)}
          </option>
        ))}
      </select>
    </div>
  )

  return (
    <Layout title={t('settingsUi.audit.title')} eyebrow={eyebrow}>
      <SettingsFrame active="audit">
        <div className="flex flex-col gap-5">
          <AuditChainStatus />

          {summary && (
            <SettingsCard title={t('settingsUi.audit.summaryTitle')} meta={t(`settingsUi.audit.ranges.d${days}`)}>
              <dl className="grid gap-4 border-t border-line pt-4 sm:grid-cols-4">
                <div>
                  <dt className="text-[12px] leading-4 text-muted">{t('settingsUi.audit.events')}</dt>
                  <dd className="mt-1 text-[24px] font-semibold leading-7 tabular-nums text-text">{(summary.total_logs ?? 0).toLocaleString()}</dd>
                </div>
                {(summary.top_users || []).slice(0, 3).map((u) => (
                  <div key={u.userId} className="min-w-0">
                    <dt className="truncate text-[12px] leading-4 text-muted">{u.label || u.userId}</dt>
                    <dd className="mt-1 text-[24px] font-semibold leading-7 tabular-nums text-text">{u.count.toLocaleString()}</dd>
                  </div>
                ))}
              </dl>
            </SettingsCard>
          )}

          <Table
            title={t('settingsUi.audit.eventsTitle')}
            actions={filtersUi}
            columns={columns}
            rows={loading ? [] : logs}
            rowKey={(log) => log.id || log._id}
            empty={loading ? t('settingsUi.audit.loading') : t('settingsUi.audit.empty')}
          />
          {(pageStatus === 'CanLoadMore' || pageStatus === 'LoadingMore') && (
            <div className="flex justify-center">
              <GhostButton size="lg" disabled={pageStatus === 'LoadingMore'} onClick={() => loadMore(50)}>
                {pageStatus === 'LoadingMore' ? t('settingsUi.audit.loadingMore') : t('settingsUi.audit.loadMore')}
              </GhostButton>
            </div>
          )}
        </div>
      </SettingsFrame>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        size="2xl"
        title={selected ? `${labels.action(selected.action_type)} · ${labels.table(selected.table_name)}` : ''}
        description={
          selected
            ? `${selected.user_label || selected.user_id || t('settingsUi.audit.unknownUser')} · ${
                selected.created_at ? new Date(selected.created_at).toLocaleString() : '—'
              }`
            : ''
        }
        footer={
          <GhostButton size="sm" onClick={() => setSelected(null)}>
            {t('common.close')}
          </GhostButton>
        }
      >
        {selected && (
          <>
            <p className="mb-2 text-[12px] leading-4 text-muted">
              {t('settingsUi.audit.record')} <span className="font-mono text-text">{selected.record_id || '—'}</span>
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {[
                ['previous', selected.previous_values],
                ['next', selected.new_values],
              ].map(([key, value]) => (
                <div key={key}>
                  <p className="mb-1 text-[12px] font-medium leading-4 text-muted">{t(`settingsUi.audit.${key}`)}</p>
                  <pre className="max-h-64 overflow-auto rounded-input border border-line-strong bg-bg p-3 font-data text-[12px] text-text">
                    {JSON.stringify(value ?? null, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </>
        )}
      </Modal>
    </Layout>
  )
}

export default function AuditLogsPage() {
  return (
    <ProtectedRoute permission="org.audit.view">
      <AuditLogsContent />
    </ProtectedRoute>
  )
}
