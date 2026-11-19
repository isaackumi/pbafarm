import { useMemo, useState } from 'react'
import { useQuery } from 'convex/react'
import { Plus, X } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { Field, GhostButton, GradientButton, Input, Segmented, Table } from '../components/ui'
import NavTabs from '../components/ui/NavTabs'
import { ListRow, Panel } from '../components/ui/Panel'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { useCurrency } from '../hooks/useCurrency'
import { usePermission } from '../hooks/usePermission'
import { useT } from '../lib/i18n/context'
import { speciesLabel } from '../lib/fishSpecies'
import { mortalityCauseLabel } from '../lib/farmHealth'
import { financeTabs } from '../lib/sectionTabs'
import { cageBars, costBreakdown, summarizePnl } from '../lib/pnlSummary'

export default function PnLPage() {
  return (
    <ProtectedRoute>
      <CagePnL />
    </ProtectedRoute>
  )
}

const marginClass = (n) => (n >= 0 ? 'text-good' : 'text-alert')
const DOTS = ['cyan', 'pink', 'neutral', 'neutral']
const fmtPct = (n) => (n == null ? '—' : `${n.toFixed(1)}%`)

function CagePnL() {
  const t = useT()
  const { user } = useAuth()
  const { locationArgs } = useLocation()
  const { formatCurrency } = useCurrency()
  const canRecordSale = usePermission('finance.sales.record')
  const canAddExpense = usePermission('finance.expenses.record')

  const [view, setView] = useState('cage')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedCageId, setSelectedCageId] = useState('')
  const [species, setSpecies] = useState('all')
  const [search, setSearch] = useState('')

  const listArgs = useMemo(() => {
    if (!user) return 'skip'
    const args = { ...locationArgs }
    if (dateFrom) args.dateFrom = dateFrom
    if (dateTo) args.dateTo = dateTo
    return args
  }, [user, locationArgs, dateFrom, dateTo])

  const rows = useQuery(api.reports.listCagePnL, listArgs)
  const overheads = useQuery(api.reports.pnlOverheads, listArgs)
  const categories = useQuery(api.expenses.listCategories, user ? { includeInactive: true } : 'skip')
  const cycles = useQuery(api.reports.listCyclePnL, user && view === 'cycle' ? locationArgs : 'skip')
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

  const totals = useMemo(() => summarizePnl(rows || [], overheads), [rows, overheads])
  const breakdown = useMemo(() => costBreakdown(rows || [], overheads), [rows, overheads])
  const bars = useMemo(() => cageBars(rows || []), [rows])
  const labelOf = useMemo(() => {
    const map = new Map((categories || []).map((c) => [c.key, c.label]))
    return (key) => (key === 'feed' ? t('ops.pnl.feed') : map.get(key) || key)
  }, [categories, t])

  const speciesTabs = useMemo(() => {
    const set = [...new Set((rows || []).map((r) => r.species).filter(Boolean))]
    return set.length > 1
      ? [{ value: 'all', label: t('ops.pnl.all') }, ...set.map((s) => ({ value: s, label: speciesLabel(s) }))]
      : null
  }, [rows, t])

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter(
      (r) => (species === 'all' || r.species === species) && (!q || r.cage_name.toLowerCase().includes(q)),
    )
  }, [rows, species, search])

  const perKg = (n) => (n == null ? '—' : t('ops.pnl.perKg', { value: formatCurrency(n) }))
  const loading = rows === undefined || overheads === undefined

  const cageCell = (r) => (
    <button
      type="button"
      aria-pressed={selectedCageId === r.cage_id}
      onClick={(e) => {
        e.stopPropagation()
        setSelectedCageId(r.cage_id)
      }}
      className={`rounded-sm text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
        selectedCageId === r.cage_id ? 'text-pearl-cyan' : 'text-text'
      }`}
    >
      {r.cage_name}
    </button>
  )

  return (
    <Layout
      title={t('ops.pnl.title')}
      eyebrow={t('ops.pnl.eyebrow')}
      actions={
        <>
          {canRecordSale && (
            <GradientButton href="/sales" icon={Plus}>
              {t('ops.sales.recordSale')}
            </GradientButton>
          )}
          {canAddExpense && (
            <GradientButton href="/expenses" reverse icon={Plus}>
              {t('ops.pnl.addExpense')}
            </GradientButton>
          )}
        </>
      }
    >
      <div data-tour="page-pnl" className="flex flex-col gap-[28px]">
        <NavTabs tabs={financeTabs(t)} label={t('ops.tabs.finance')} />

        <div className="flex flex-wrap items-end justify-between gap-4">
          <Segmented
            size="md"
            label={t('ops.pnl.view')}
            value={view}
            onChange={setView}
            options={[
              { value: 'cage', label: t('ops.pnl.byCage') },
              { value: 'cycle', label: t('ops.pnl.byCycle') },
            ]}
          />
          {view === 'cage' && (
            <div className="grid w-full grid-cols-2 gap-4 sm:w-96">
              <Field label={t('ops.ledger.from')} htmlFor="pnl-from">
                <Input id="pnl-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </Field>
              <Field label={t('ops.ledger.to')} htmlFor="pnl-to">
                <Input id="pnl-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </Field>
            </div>
          )}
        </div>

        {view === 'cycle' ? (
          <CycleTable cycles={cycles} formatCurrency={formatCurrency} perKg={perKg} t={t} />
        ) : (
          <>
            <div className="flex flex-col gap-[20px] lg:flex-row">
              <section
                aria-labelledby="pnl-net"
                className="flex min-h-[330px] min-w-0 grow-[1.15] basis-0 flex-col gap-1 rounded-card border border-line bg-surface px-5 py-[26px] shadow-[var(--shadow-card)] sm:px-7"
              >
                <h2 id="pnl-net" className="text-[13px] font-normal leading-4 text-muted">
                  {dateFrom || dateTo ? t('ops.pnl.netRange') : t('ops.pnl.netToDate')}
                </h2>
                <p className="text-[40px] font-semibold leading-[48px] tracking-[-0.035em] text-text tabular-nums sm:text-[48px] sm:leading-[58px]">
                  {loading ? '—' : formatCurrency(totals.net)}
                </p>
                {!loading && (
                  <p className={`text-[13px] leading-4 ${totals.net >= 0 ? 'text-good' : 'text-alert'}`}>
                    {totals.marginPct == null ? t('ops.pnl.noRevenue') : t('ops.pnl.marginPct', { pct: totals.marginPct.toFixed(1) })}
                    {totals.costPerKg != null && (
                      <span className="text-faint"> · {t('ops.pnl.costPerKgProduced', { value: formatCurrency(totals.costPerKg) })}</span>
                    )}
                  </p>
                )}
                {bars.length > 0 && (
                  <figure className="flex grow basis-0 flex-col pt-6">
                    <figcaption className="sr-only">{t('ops.pnl.barsCaption')}</figcaption>
                    <div className="flex grow items-end gap-[14px]">
                      {bars.map((b) => (
                        <div key={b.id} className="flex h-full min-w-0 grow basis-0 flex-col items-center justify-end gap-[6px]">
                          <div
                            className="flex h-[150px] w-full shrink-0 items-end gap-1"
                            title={`${b.label}: ${t('ops.pnl.revenue')} ${formatCurrency(b.revenue)} · ${t('ops.pnl.cost')} ${formatCurrency(b.cost)}`}
                          >
                            <div
                              className="grow basis-0 rounded-[4px]"
                              style={{ height: `${Math.max(b.revenueH * 100, 1)}%`, backgroundImage: 'linear-gradient(in oklab 180deg, var(--cyan-fill) 0%, var(--pink-fill) 100%)' }}
                            />
                            <div className="grow basis-0 rounded-[4px] bg-line-strong" style={{ height: `${Math.max(b.costH * 100, 1)}%` }} />
                          </div>
                          <span className="max-w-full truncate text-xs leading-4 text-faint">{b.label}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-4 pt-3 text-xs leading-4 text-muted">
                      <span className="inline-flex items-center gap-2">
                        <span aria-hidden className="size-[7px] rounded-pill" style={{ backgroundImage: 'var(--gradient-brand-rev)' }} />
                        {t('ops.pnl.revenue')}
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <span aria-hidden className="size-[7px] rounded-pill bg-line-strong" />
                        {t('ops.pnl.cost')}
                      </span>
                    </div>
                  </figure>
                )}
              </section>

              <Panel title={t('ops.pnl.costBreakdown')} titleId="pnl-breakdown" className="grow basis-0">
                {breakdown.length === 0 ? (
                  <p className="border-t border-line py-[11px] text-[13px] leading-5 text-muted">{loading ? t('common.loading') : t('ops.pnl.noCosts')}</p>
                ) : (
                  breakdown.map((line, i) => (
                    <ListRow
                      key={line.key}
                      dot={DOTS[Math.min(i, DOTS.length - 1)]}
                      title={labelOf(line.key)}
                      sub={i === 0 ? t('ops.pnl.ofCost', { pct: line.pct }) : `${line.pct}%`}
                      value={formatCurrency(line.amount)}
                    />
                  ))
                )}
              </Panel>
            </div>

            <Table
              title={t('ops.pnl.cageProfitability')}
              tabs={speciesTabs || undefined}
              tab={species}
              onTabChange={setSpecies}
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder={t('ops.pnl.searchCage')}
              rowKey={(r) => r.cage_id}
              onRowClick={(r) => setSelectedCageId(r.cage_id)}
              rows={visibleRows}
              empty={rows === undefined ? t('common.loading') : t('ops.pnl.empty')}
              columns={[
                { key: 'cage', header: t('ops.pnl.cage'), width: 126, render: cageCell, sub: (r) => (r.species ? speciesLabel(r.species) : null) },
                { key: 'revenue', header: t('ops.pnl.revenue'), width: 164, align: 'right', render: (r) => formatCurrency(r.revenue) },
                { key: 'cost', header: t('ops.pnl.cost'), width: 164, align: 'right', render: (r) => formatCurrency(r.total_cost) },
                {
                  key: 'margin',
                  header: t('ops.pnl.margin'),
                  width: 164,
                  align: 'right',
                  render: (r) => <span className={r.net_margin_pct == null ? 'text-muted' : marginClass(r.net_margin)}>{fmtPct(r.net_margin_pct)}</span>,
                },
                { key: 'perKg', header: t('ops.pnl.costKg'), width: 144, align: 'right', render: (r) => perKg(r.cost_per_kg) },
                {
                  key: 'net',
                  header: t('ops.pnl.net'),
                  align: 'right',
                  render: (r) => <span className={`font-medium ${marginClass(r.net_margin)}`}>{formatCurrency(r.net_margin)}</span>,
                },
              ]}
            />

            {selectedCageId && (
              <CageDetail detail={detail} perKg={perKg} formatCurrency={formatCurrency} onClose={() => setSelectedCageId('')} t={t} />
            )}
          </>
        )}
      </div>
    </Layout>
  )
}

function CageDetail({ detail, perKg, formatCurrency, onClose, t }) {
  const cell = (label, value, extra) => (
    <div className="flex flex-col gap-[2px]">
      <dt className="text-xs leading-4 text-muted">{label}</dt>
      <dd className="text-[14px] leading-[18px] text-text tabular-nums">{value}</dd>
      {extra}
    </div>
  )
  return (
    <section
      aria-labelledby="pnl-detail"
      className="flex flex-col gap-4 rounded-card border border-line bg-surface px-5 py-6 shadow-[var(--shadow-card)] sm:px-[26px]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs leading-4 text-muted">{t('ops.pnl.detail')}</p>
          <h2 id="pnl-detail" className="text-[20px] font-semibold leading-6 text-text">
            {detail?.cage_name || '—'}
          </h2>
        </div>
        <GhostButton size="sm" icon={X} onClick={onClose}>
          {t('common.close')}
        </GhostButton>
      </div>
      {detail === undefined ? (
        <p className="text-[13px] leading-5 text-muted">{t('common.loading')}</p>
      ) : !detail ? (
        <p className="text-[13px] leading-5 text-muted">{t('ops.pnl.notFound')}</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-[14px] border border-line bg-bg p-4 sm:grid-cols-4">
            {cell(
              t('ops.pnl.feedKg', { kg: detail.feed_kg.toFixed(1) }),
              formatCurrency(detail.feed_cost),
              Math.abs(detail.feed_cost_list - detail.feed_cost) > 0.005 && (
                <dd className="text-xs text-muted">{t('ops.pnl.atList', { value: formatCurrency(detail.feed_cost_list) })}</dd>
              ),
            )}
            {cell(t('ops.pnl.fingerlings'), formatCurrency(detail.fingerling_cost))}
            {cell(t('ops.pnl.otherExpenses'), formatCurrency(detail.other_expenses))}
            {cell(t('ops.pnl.totalCost'), formatCurrency(detail.total_cost))}
            {cell(t('ops.pnl.harvestKg'), detail.harvest_kg.toFixed(1))}
            {cell(t('ops.pnl.costKg'), perKg(detail.cost_per_kg))}
            {cell(t('ops.pnl.revenueSold', { kg: detail.sold_kg.toFixed(1) }), formatCurrency(detail.revenue))}
            {cell(t('ops.pnl.net'), <span className={`font-semibold ${marginClass(detail.net_margin)}`}>{formatCurrency(detail.net_margin)}</span>)}
          </dl>
          {detail.feed_list_priced_kg > 0 && (
            <p className="text-xs text-muted">{t('ops.pnl.listPricedNote', { kg: detail.feed_list_priced_kg.toFixed(1) })}</p>
          )}
          <div>
            <p className="pb-1 text-[13px] leading-5 font-semibold text-text">{t('ops.pnl.mortality', { count: detail.mortality })}</p>
            {Object.keys(detail.mortality_by_cause || {}).length === 0 ? (
              <p className="text-[13px] leading-5 text-muted">—</p>
            ) : (
              Object.entries(detail.mortality_by_cause).map(([k, v]) => (
                <ListRow key={k} title={mortalityCauseLabel(k)} value={v} />
              ))
            )}
          </div>
        </>
      )}
    </section>
  )
}

function CycleTable({ cycles, formatCurrency, perKg, t }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] leading-5 text-muted">{t('ops.pnl.cycleIntro')}</p>
      <Table
        title={t('ops.pnl.byCycleTitle')}
        rows={cycles || []}
        rowKey={(c) => c.cycle_id}
        empty={cycles === undefined ? t('common.loading') : t('ops.pnl.noCycles')}
        columns={[
          {
            key: 'cycle',
            header: t('ops.pnl.cycle'),
            render: (c) => c.cage_name,
            sub: (c) => `${c.batch_number} · ${t('ops.pnl.cycleRange', { from: c.start_date, to: c.open ? t('ops.pnl.now') : c.end_date })}`,
          },
          { key: 'feed', header: t('ops.pnl.feed'), align: 'right', render: (c) => formatCurrency(c.feed_cost) },
          { key: 'fingerlings', header: t('ops.pnl.fingerlings'), align: 'right', render: (c) => formatCurrency(c.fingerling_cost) },
          { key: 'other', header: t('ops.pnl.otherCosts'), align: 'right', render: (c) => formatCurrency(c.other_expenses) },
          { key: 'harvest', header: t('ops.pnl.harvestKg'), align: 'right', render: (c) => c.harvest_kg.toFixed(1) },
          { key: 'perKg', header: t('ops.pnl.costKg'), align: 'right', render: (c) => perKg(c.cost_per_kg) },
          {
            key: 'net',
            header: t('ops.pnl.net'),
            align: 'right',
            render: (c) => <span className={`font-medium ${marginClass(c.net_margin)}`}>{formatCurrency(c.net_margin)}</span>,
          },
        ]}
      />
    </div>
  )
}
