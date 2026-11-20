import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePaginatedQuery, useQuery } from 'convex/react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import AnowaBrief from '../../components/AnowaBrief'
import ProjectForm from '../../components/ProjectForm'
import { EmptyState, GhostButton, GradientButton, LoadingState, SearchField, Select, Tabs } from '../../components/ui'
import { ListRow, Panel } from '../../components/ui/Panel'
import { api } from '../../convex/_generated/api'
import { useAuth } from '../../contexts/AuthContext'
import { useLocation } from '../../contexts/LocationContext'
import { useCurrency } from '../../hooks/useCurrency'
import { usePermission } from '../../hooks/usePermission'
import { getActiveLocale, localToday } from '../../lib/format'
import { useT } from '../../lib/i18n/context'
import { PROJECT_STATUSES, barGeometry, projectBrief, timelineWindow, todayOffset } from '../../convex/lib/projects'
import { BAR_CLASS, barTone, budgetDot, compactMoney, groupProjects, monthLabel, shortDate } from '../../lib/projectsView'

/**
 * Projects (Paper 20): capex and farm improvements. Built for hundreds of
 * projects across many sites: an Anowa brief and exceptions first, filters
 * (search, site, status, owner, at risk) and grouping, and paginated lists
 * (25 at a time, "Load more"); every list is an indexed, bounded query.
 */
export default function ProjectsPage() {
  return (
    <ProtectedRoute permission="projects.view">
      <Projects />
    </ProtectedRoute>
  )
}

const PAGE = 25
const BOARD_COLUMNS = ['planned', 'active', 'on_hold', 'done']

function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

function Projects() {
  const t = useT()
  const { user } = useAuth()
  const { locations } = useLocation()
  const canManage = usePermission('projects.manage')
  const { symbol } = useCurrency()
  const locale = getActiveLocale()
  const money = (n) => compactMoney(n, symbol, locale)
  const today = localToday()

  const [tab, setTab] = useState('timeline')
  const [search, setSearch] = useState('')
  const [siteId, setSiteId] = useState('')
  const [status, setStatus] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [atRisk, setAtRisk] = useState(false)
  const [groupBy, setGroupBy] = useState('none')
  const [creating, setCreating] = useState(false)
  const q = useDebounced(search.trim())

  const owners = useQuery(api.projects.ownerOptions, user ? {} : 'skip')
  const summary = useQuery(api.projects.summary, user ? { today, ...(siteId ? { locationId: siteId } : {}) } : 'skip')
  const filters = {
    today,
    ...(q ? { search: q } : {}),
    ...(siteId ? { locationId: siteId } : {}),
    ...(status ? { status } : {}),
    ...(ownerId ? { ownerUserId: ownerId } : {}),
    ...(atRisk ? { atRisk: true } : {}),
  }
  const list = usePaginatedQuery(api.projects.list, user && tab !== 'board' ? filters : 'skip', { initialNumItems: PAGE })

  const brief = useMemo(() => (summary ? projectBrief(summary) : null), [summary])
  const briefItems = (brief?.items || []).map((i) => {
    if (i.kind === 'over_budget') return t('projectsPage.brief.overBudget', { name: i.name, pct: i.pct })
    if (i.kind === 'late') return t('projectsPage.brief.late', { title: i.title, name: i.name, date: shortDate(i.dueDate, locale), pct: i.progressPct })
    return t('projectsPage.brief.dueSoon', { title: i.title, date: shortDate(i.dueDate, locale), pct: i.progressPct })
  })

  const statusLabels = Object.fromEntries(PROJECT_STATUSES.map((s) => [s, t(`projectsPage.status.${s}`)]))
  const filtered = !!(q || siteId || status || ownerId || atRisk)

  return (
    <Layout
      title={t('projectsPage.title')}
      eyebrow={t('projectsPage.eyebrow')}
      actions={
        canManage ? (
          <GradientButton variant="lime" icon={Plus} onClick={() => setCreating(true)}>
            {t('projectsPage.new')}
          </GradientButton>
        ) : null
      }
    >
      <div className="flex flex-col gap-[28px]">
        <AnowaBrief
          loading={summary === undefined}
          lead={t('projectsPage.brief.lead', { count: brief?.count ?? 0 })}
          items={briefItems}
          calm={t('projectsPage.brief.calm')}
          question={t('projectsPage.brief.question')}
        />

        <Tabs
          variant="page"
          label={t('projectsPage.tabsLabel')}
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'timeline', label: t('projectsPage.tabs.timeline') },
            { value: 'board', label: t('projectsPage.tabs.board') },
            { value: 'budget', label: t('projectsPage.tabs.budget') },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2">
          <SearchField
            className="sm:w-64"
            placeholder={t('projectsPage.filters.search')}
            aria-label={t('projectsPage.filters.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select size="sm" aria-label={t('projectsPage.filters.site')} value={siteId} onChange={(e) => setSiteId(e.target.value)} className="w-auto">
            <option value="">{t('projectsPage.filters.allSites')}</option>
            {locations.map((l) => (
              <option key={l.id || l._id} value={l.id || l._id}>
                {l.name}
              </option>
            ))}
          </Select>
          {tab !== 'board' && (
            <Select size="sm" aria-label={t('projectsPage.filters.status')} value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
              <option value="">{t('projectsPage.filters.allStatuses')}</option>
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabels[s]}
                </option>
              ))}
            </Select>
          )}
          <Select size="sm" aria-label={t('projectsPage.filters.owner')} value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="w-auto">
            <option value="">{t('projectsPage.filters.allOwners')}</option>
            {(owners || []).map((o) => (
              <option key={o.userId} value={o.userId}>
                {o.name}
              </option>
            ))}
          </Select>
          <button
            type="button"
            aria-pressed={atRisk}
            onClick={() => setAtRisk((v) => !v)}
            className={`rounded-pill border px-3 py-[7px] text-xs leading-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
              atRisk ? 'border-alert/60 bg-alert/10 text-alert' : 'border-line-strong text-muted hover:text-text'
            }`}
          >
            {t('projectsPage.filters.atRisk')}
          </button>
          {tab !== 'board' && (
            <Select size="sm" aria-label={t('projectsPage.filters.group')} value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className="w-auto sm:ml-auto">
              {['none', 'site', 'owner', 'status'].map((g) => (
                <option key={g} value={g}>
                  {t(`projectsPage.group.${g}`)}
                </option>
              ))}
            </Select>
          )}
        </div>

        {tab === 'board' ? (
          <Board filters={filters} money={money} statusLabels={statusLabels} />
        ) : list.status === 'LoadingFirstPage' ? (
          <LoadingState />
        ) : list.results.length === 0 ? (
          <EmptyState
            title={filtered ? t('projectsPage.empty.noMatch') : t('projectsPage.empty.title')}
            description={filtered ? t('projectsPage.empty.noMatchBody') : t('projectsPage.empty.body')}
            action={
              canManage && !filtered ? (
                <GradientButton variant="solid" icon={Plus} onClick={() => setCreating(true)}>
                  {t('projectsPage.new')}
                </GradientButton>
              ) : null
            }
          />
        ) : tab === 'timeline' ? (
          <>
            <Timeline groups={groupProjects(list.results, groupBy, { companyWide: t('projectsPage.companyWide'), status: statusLabels })} today={today} money={money} />
            <More list={list} />
            <Exceptions summary={summary} rows={list.results} money={money} today={today} />
          </>
        ) : (
          <>
            <BudgetTable groups={groupProjects(list.results, groupBy, { companyWide: t('projectsPage.companyWide'), status: statusLabels })} money={money} />
            <More list={list} />
          </>
        )}
      </div>
      {creating && <ProjectForm open onClose={() => setCreating(false)} />}
    </Layout>
  )
}

function More({ list }) {
  const t = useT()
  if (list.status === 'Exhausted') return null
  return (
    <div className="flex justify-center">
      <GhostButton size="lg" onClick={() => list.loadMore(PAGE)} disabled={list.status !== 'CanLoadMore'}>
        {list.status === 'LoadingMore' ? t('projectsPage.loading') : t('projectsPage.loadMore')}
      </GhostButton>
    </div>
  )
}

/** One-line sub under a project name: "12 units · GH₵ 840k · Kwame A." */
function subLine(t, p, money) {
  const parts = []
  if (p.unitCount) parts.push(t('projectsPage.units', { count: p.unitCount }))
  if (p.budget) parts.push(money(p.budget))
  parts.push(p.ownerName)
  return parts.join(' · ')
}

function Timeline({ groups, today, money }) {
  const t = useT()
  const locale = getActiveLocale()
  const [offset, setOffset] = useState(0)
  const win = useMemo(() => timelineWindow(today, 6, offset), [today, offset])
  const todayPct = todayOffset(today, win)
  const currentMonth = today.slice(0, 7)

  return (
    <section aria-label={t('projectsPage.tabs.timeline')} className="overflow-x-auto rounded-card border border-line bg-surface shadow-[var(--shadow-card)]">
      <div className="min-w-[760px]">
        <div className="flex border-b border-line">
          <div className="flex w-[300px] shrink-0 items-center justify-between px-6 py-[14px]">
            <span className="text-[11px] uppercase leading-[14px] tracking-[0.08em] text-faint">{t('projectsPage.timeline.project')}</span>
            <span className="flex gap-1">
              <button
                type="button"
                onClick={() => setOffset((o) => o - 3)}
                aria-label={t('projectsPage.timeline.earlier')}
                className="rounded-sm p-1 text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
              >
                <ChevronLeft size={14} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setOffset((o) => o + 3)}
                aria-label={t('projectsPage.timeline.later')}
                className="rounded-sm p-1 text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
              >
                <ChevronRight size={14} aria-hidden />
              </button>
            </span>
          </div>
          {win.months.map((m) => (
            <div key={m} className="grow basis-0 border-l border-line px-3 py-[14px]">
              <span className={`text-[11px] uppercase leading-[14px] tracking-[0.08em] ${m.slice(0, 7) === currentMonth ? 'text-text' : 'text-faint'}`}>
                {monthLabel(m, locale)}
              </span>
            </div>
          ))}
        </div>
        {groups.map((g) => (
          <div key={g.key} role="rowgroup">
            {g.label && <div className="border-t border-line bg-surface-2 px-6 py-2 text-xs font-medium leading-4 text-muted">{g.label}</div>}
            {g.rows.map((p) => {
              const bar = barGeometry(p.startDate, p.targetEndDate, win)
              const tone = barTone(p)
              const fill = tone === 'planned' ? 100 : Math.max(0, Math.min(100, p.progressPct))
              return (
                <Link
                  key={p.id}
                  href={`/projects/${p.id}`}
                  className="flex h-[72px] items-center border-t border-line hover:bg-surface-2/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan"
                >
                  <div className="flex w-[300px] shrink-0 flex-col gap-[3px] px-6">
                    <span className="flex items-center gap-2 truncate text-[14px] leading-[18px] text-text">
                      <span className="truncate">{p.name}</span>
                      {p.atRisk && <span className={`size-[7px] shrink-0 rounded-pill ${p.overBudget ? 'bg-dot-alert' : 'bg-dot-warn'}`} aria-label={t('projectsPage.atRisk')} role="img" />}
                    </span>
                    <span className="truncate text-xs leading-4 text-muted">{subLine(t, p, money)}</span>
                  </div>
                  <div className="relative h-[72px] grow border-l border-line">
                    {bar && (
                      <div
                        className="absolute top-[22px] flex h-[28px] overflow-hidden rounded-pill border border-line-strong bg-surface-2"
                        style={{ left: `${bar.left}%`, width: `max(${bar.width}%, 8px)` }}
                        role="img"
                        aria-label={t('projectsPage.timeline.bar', {
                          start: shortDate(p.startDate, locale),
                          end: shortDate(p.targetEndDate, locale),
                          pct: p.progressPct,
                        })}
                      >
                        <div className={`h-full opacity-85 ${BAR_CLASS[tone]}`} style={{ width: `${fill}%` }} />
                      </div>
                    )}
                    {todayPct != null && (
                      <div className="absolute top-0 h-[72px] w-px bg-alert opacity-60" style={{ left: `${todayPct}%` }} aria-hidden />
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        ))}
      </div>
      <p className="sr-only">{t('projectsPage.timeline.todayLine')}</p>
    </section>
  )
}

/** Below the timeline (Paper 20): milestones that need someone, and budget vs actual worst first. */
function Exceptions({ summary, rows, money, today }) {
  const t = useT()
  const locale = getActiveLocale()
  const milestones = summary ? [...summary.lateMilestones, ...summary.dueSoon].slice(0, 6) : []
  const budget = [...rows]
    .filter((p) => p.budget > 0)
    .sort((a, b) => (b.budgetPct ?? 0) - (a.budgetPct ?? 0))
    .slice(0, 6)
  return (
    <div className="flex flex-col gap-5 lg:flex-row">
      <Panel title={t('projectsPage.milestonesNeed')} className="grow basis-0">
        {summary === undefined ? (
          <LoadingState />
        ) : milestones.length === 0 ? (
          <p className="border-t border-line py-[11px] text-sm text-muted">{t('projectsPage.noMilestonesNeed')}</p>
        ) : (
          milestones.map((m) => (
            <ListRow
              key={m.id}
              href={`/projects/${m.projectId}`}
              dot={m.dueDate < today ? 'alert' : 'warn'}
              dotLabel={m.dueDate < today ? t('projectsPage.late') : t('projectsPage.dueSoon')}
              title={`${m.projectName} · ${m.title}`}
              sub={t(m.dueDate < today ? 'projectsPage.milestone.lateSub' : 'projectsPage.milestone.dueSub', {
                date: shortDate(m.dueDate, locale),
                pct: m.progressPct,
              })}
            />
          ))
        )}
      </Panel>
      <Panel title={t('projectsPage.budgetVsActual')} className="grow basis-0">
        {budget.length === 0 ? (
          <p className="border-t border-line py-[11px] text-sm text-muted">{t('projectsPage.noBudgets')}</p>
        ) : (
          budget.map((p) => (
            <ListRow
              key={p.id}
              href={`/projects/${p.id}`}
              dot={budgetDot(p)}
              title={p.name}
              sub={t('projectsPage.spentOf', { spent: money(p.spent), budget: money(p.budget) })}
              value={`${p.budgetPct}%`}
              valueClassName={p.overBudget ? 'text-alert' : ''}
            />
          ))
        )}
      </Panel>
    </div>
  )
}

function BudgetTable({ groups, money }) {
  const t = useT()
  return (
    <section aria-label={t('projectsPage.tabs.budget')} className="overflow-x-auto rounded-card border border-line bg-surface shadow-[var(--shadow-card)]">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="text-[11px] uppercase leading-[14px] tracking-[0.08em] text-faint">
            <th scope="col" className="px-6 py-[14px] font-normal">{t('projectsPage.table.project')}</th>
            <th scope="col" className="px-3 py-[14px] font-normal">{t('projectsPage.table.site')}</th>
            <th scope="col" className="px-3 py-[14px] text-right font-normal">{t('projectsPage.table.budget')}</th>
            <th scope="col" className="px-3 py-[14px] text-right font-normal">{t('projectsPage.table.spent')}</th>
            <th scope="col" className="w-[28%] px-6 py-[14px] font-normal">{t('projectsPage.table.used')}</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.key}>
            {g.label && (
              <tr>
                <th colSpan={5} scope="rowgroup" className="border-t border-line bg-surface-2 px-6 py-2 text-xs font-medium text-muted">
                  {g.label}
                </th>
              </tr>
            )}
            {g.rows.map((p) => {
              const pct = p.budgetPct
              return (
                <tr key={p.id} className="border-t border-line">
                  <td className="px-6 py-3">
                    <Link href={`/projects/${p.id}`} className="text-[14px] leading-[18px] text-text hover:underline">
                      {p.name}
                    </Link>
                    <div className="text-xs leading-4 text-muted">{p.ownerName}</div>
                  </td>
                  <td className="px-3 py-3 text-muted">{p.locationName || t('projectsPage.companyWide')}</td>
                  <td className="px-3 py-3 text-right font-data tabular-nums text-text">{p.budget ? money(p.budget) : '-'}</td>
                  <td className="px-3 py-3 text-right font-data tabular-nums text-text">{money(p.spent)}</td>
                  <td className="px-6 py-3">
                    {pct == null ? (
                      <span className="text-muted">{t('projectsPage.noBudget')}</span>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className="h-2 grow overflow-hidden rounded-pill bg-line" role="img" aria-label={`${pct}%`}>
                          <div
                            className={`h-full rounded-pill ${p.overBudget ? 'bg-alert' : pct >= 90 ? 'bg-warn' : BAR_CLASS.normal}`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <span className={`w-12 shrink-0 text-right font-medium tabular-nums ${p.overBudget ? 'text-alert' : 'text-text'}`}>{pct}%</span>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        ))}
      </table>
    </section>
  )
}

/** Board: one paginated column per status (20 cards, then "Load more"). */
function Board({ filters, money, statusLabels }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {BOARD_COLUMNS.map((s) => (
        <BoardColumn key={s} status={s} label={statusLabels[s]} filters={filters} money={money} />
      ))}
    </div>
  )
}

function BoardColumn({ status, label, filters, money }) {
  const t = useT()
  const { user } = useAuth()
  const list = usePaginatedQuery(api.projects.list, user ? { ...filters, status } : 'skip', { initialNumItems: 20 })
  return (
    <section aria-label={label} className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
      <h2 className="flex items-center justify-between text-[14px] font-semibold leading-[18px] text-text">
        {label}
        <span className="text-xs font-normal text-muted">{list.status === 'Exhausted' ? list.results.length : `${list.results.length}+`}</span>
      </h2>
      <div className="flex max-h-[640px] flex-col gap-2 overflow-y-auto">
        {list.status === 'LoadingFirstPage' ? (
          <LoadingState />
        ) : list.results.length === 0 ? (
          <p className="py-2 text-sm text-muted">{t('projectsPage.board.empty')}</p>
        ) : (
          list.results.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="flex flex-col gap-2 rounded-lg border border-line bg-bg/40 p-3 hover:border-line-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
            >
              <span className="flex items-center gap-2 text-[14px] leading-[18px] text-text">
                <span className="truncate">{p.name}</span>
                {p.atRisk && <span className={`size-[7px] shrink-0 rounded-pill ${p.overBudget ? 'bg-dot-alert' : 'bg-dot-warn'}`} role="img" aria-label={t('projectsPage.atRisk')} />}
              </span>
              <span className="truncate text-xs leading-4 text-muted">
                {p.ownerName} · {p.locationName || t('projectsPage.companyWide')}
              </span>
              <div className="h-1.5 overflow-hidden rounded-pill bg-line" role="img" aria-label={t('projectsPage.progress', { pct: p.progressPct })}>
                <div className={`h-full ${BAR_CLASS[barTone(p)]}`} style={{ width: `${p.progressPct}%` }} />
              </div>
              <span className="flex justify-between text-xs leading-4 text-muted">
                <span>{t('projectsPage.progress', { pct: p.progressPct })}</span>
                {p.budgetPct != null && (
                  <span className={p.overBudget ? 'text-alert' : ''}>
                    {money(p.spent)} · {p.budgetPct}%
                  </span>
                )}
              </span>
            </Link>
          ))
        )}
      </div>
      {list.status !== 'Exhausted' && list.status !== 'LoadingFirstPage' && (
        <GhostButton size="sm" onClick={() => list.loadMore(20)} disabled={list.status !== 'CanLoadMore'}>
          {t('projectsPage.loadMore')}
        </GhostButton>
      )}
    </section>
  )
}
