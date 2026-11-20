import { useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import { Check, Link2, PenLine, Plus, Trash2, Undo2 } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import AnowaBrief from '../../components/AnowaBrief'
import ProjectForm from '../../components/ProjectForm'
import { EmptyState, ErrorState, Field, GhostButton, GradientButton, Input, KpiStrip, LoadingState, Modal, Pill, Select } from '../../components/ui'
import { Panel } from '../../components/ui/Panel'
import { useToast } from '../../components/Toast'
import { api } from '../../convex/_generated/api'
import { useAuth } from '../../contexts/AuthContext'
import { useOptionalQuery } from '../../hooks/useOptionalQuery'
import { useCurrency } from '../../hooks/useCurrency'
import { usePermission } from '../../hooks/usePermission'
import { errorMessage } from '../../lib/errorMessage'
import { getActiveLocale, localToday } from '../../lib/format'
import { useT } from '../../lib/i18n/context'
import { overBudgetPct } from '../../convex/lib/projects'
import { compactMoney, shortDate } from '../../lib/projectsView'

/**
 * One project (Paper 20 detail): budget vs actual, milestones and costs.
 * Costs page 25 at a time; a cost can link an existing expense or placed
 * purchase order, which then counts once (convex/projects.ts).
 */
export default function ProjectDetailPage() {
  return (
    <ProtectedRoute permission="projects.view">
      <ProjectDetail />
    </ProtectedRoute>
  )
}

const STATUS_TONE = { planned: 'neutral', active: 'cyan', on_hold: 'amber', done: 'green', cancelled: 'neutral' }

function ProjectDetail() {
  const t = useT()
  const router = useRouter()
  const { user } = useAuth()
  const id = typeof router.query.id === 'string' ? router.query.id : null
  const today = localToday()
  // A missing or out-of-scope project throws NOT_FOUND: show the not-found state, not the error boundary.
  const data = useOptionalQuery(api.projects.get, user && id ? { id, today } : 'skip', null)
  const { symbol, formatCurrency } = useCurrency()
  const locale = getActiveLocale()
  const money = (n) => compactMoney(n, symbol, locale)
  const [editing, setEditing] = useState(false)

  if (data === undefined) {
    return (
      <Layout title={t('projectsPage.title')}>
        <LoadingState />
      </Layout>
    )
  }
  if (data === null) {
    return (
      <Layout title={t('projectsPage.title')}>
        <ErrorState message={t('projectsPage.notFound')} />
      </Layout>
    )
  }
  const { project: p, milestones, units, canManage, notes } = data
  const late = milestones.filter((m) => m.late)
  const briefItems = []
  if (p.overBudget) briefItems.push(t('projectsPage.brief.overBudgetSelf', { pct: overBudgetPct(p.spent, p.budget) }))
  for (const m of late.slice(0, 2)) {
    briefItems.push(t('projectsPage.brief.lateSelf', { title: m.title, date: shortDate(m.dueDate, locale), pct: m.progressPct }))
  }
  if (p.pastEnd) briefItems.push(t('projectsPage.brief.pastEnd', { date: shortDate(p.targetEndDate, locale) }))

  return (
    <Layout
      title={p.name}
      eyebrow={t('projectsPage.detailEyebrow', { site: p.locationName || t('projectsPage.companyWide') })}
      actions={
        canManage ? (
          <GhostButton size="lg" icon={PenLine} onClick={() => setEditing(true)}>
            {t('projectsPage.edit')}
          </GhostButton>
        ) : null
      }
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Link href="/projects" className="hover:text-text">
            {t('projectsPage.back')}
          </Link>
          <span aria-hidden>·</span>
          <Pill tone={STATUS_TONE[p.status] || 'neutral'}>{t(`projectsPage.status.${p.status}`)}</Pill>
          <span>{t(`projectsPage.category.${p.category}`)}</span>
          <span aria-hidden>·</span>
          <span>{t('projectsPage.ownerIs', { name: p.ownerName })}</span>
          <span aria-hidden>·</span>
          <span>
            {shortDate(p.startDate, locale)} - {shortDate(p.targetEndDate, locale)}
          </span>
        </div>

        <AnowaBrief
          lead={t('projectsPage.brief.leadSelf')}
          items={briefItems}
          calm={t('projectsPage.brief.calmSelf', { pct: p.progressPct })}
          question={t('projectsPage.brief.questionSelf', { name: p.name })}
        />

        <KpiStrip
          items={[
            { label: t('projectsPage.kpi.budget'), value: p.budget ? money(p.budget) : '-' },
            { label: t('projectsPage.kpi.spent'), value: money(p.spent), valueTone: p.overBudget ? 'alert' : undefined },
            { label: t('projectsPage.kpi.used'), value: p.budgetPct == null ? '-' : `${p.budgetPct}%`, valueTone: p.overBudget ? 'alert' : undefined },
            {
              label: t('projectsPage.kpi.progress'),
              value: `${p.progressPct}%`,
              suffix: t('projectsPage.kpi.milestones', { done: p.milestonesDone, count: p.milestonesTotal }),
              suffixTone: 'unit',
            },
          ]}
        />

        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          <Milestones projectId={p.id} milestones={milestones} canManage={canManage} today={today} />
          <Costs project={p} canManage={canManage} money={money} formatCurrency={formatCurrency} />
        </div>

        {(units.length > 0 || notes) && (
          <Panel title={t('projectsPage.details')}>
            {notes && <p className="border-t border-line py-3 text-sm text-text">{notes}</p>}
            {units.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t border-line py-3">
                {units.map((u) => (
                  <Link key={u.id} href={`/cages/${u.id}`} className="rounded-pill border border-line-strong px-3 py-1 text-xs text-text hover:bg-surface-2">
                    {u.name}
                  </Link>
                ))}
              </div>
            )}
          </Panel>
        )}
        {canManage && <DangerZone project={p} />}
      </div>
      {editing && <ProjectForm open project={{ ...p, notes: notes ?? '' }} onClose={() => setEditing(false)} />}
    </Layout>
  )
}

function Milestones({ projectId, milestones, canManage, today }) {
  const t = useT()
  const locale = getActiveLocale()
  const { showToast } = useToast()
  const add = useMutation(api.projects.addMilestone)
  const update = useMutation(api.projects.updateMilestone)
  const remove = useMutation(api.projects.removeMilestone)
  const [form, setForm] = useState({ title: '', dueDate: '' })
  const [busy, setBusy] = useState(false)
  const run = async (fn) => {
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      showToast('error', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const onAdd = (e) => {
    e.preventDefault()
    run(async () => {
      await add({ projectId, title: form.title, dueDate: form.dueDate })
      setForm({ title: '', dueDate: '' })
    })
  }
  return (
    <Panel title={t('projectsPage.milestones')} className="grow basis-0">
      {milestones.length === 0 && <p className="border-t border-line py-[11px] text-sm text-muted">{t('projectsPage.noMilestones')}</p>}
      {milestones.map((m) => {
        const tone = m.done ? 'bg-dot-good' : m.late ? 'bg-dot-alert' : m.dueDate <= addDaysIso(today, 14) ? 'bg-dot-warn' : 'bg-faint'
        return (
          <div key={m.id} className="flex items-center gap-[14px] border-t border-line py-[11px]">
            <span className={`size-[7px] shrink-0 rounded-pill ${tone}`} aria-hidden />
            <div className="flex min-w-0 grow basis-0 flex-col gap-[2px]">
              <span className="truncate text-[14px] leading-[18px] text-text">{m.title}</span>
              <span className={`text-xs leading-4 ${m.late ? 'text-alert' : 'text-muted'}`}>
                {m.done
                  ? t('projectsPage.milestone.done', { date: shortDate(m.doneDate || m.dueDate, locale) })
                  : t(m.late ? 'projectsPage.milestone.lateSub' : 'projectsPage.milestone.dueSub', { date: shortDate(m.dueDate, locale), pct: m.progressPct })}
              </span>
            </div>
            {canManage && (
              <div className="flex shrink-0 items-center gap-1">
                {!m.done && (
                  <Select
                    size="sm"
                    aria-label={t('projectsPage.milestone.progress', { title: m.title })}
                    value={String(Math.round(m.progressPct / 10) * 10)}
                    disabled={busy}
                    onChange={(e) => run(() => update({ id: m.id, progressPct: Number(e.target.value) }))}
                    className="w-auto"
                  >
                    {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90].map((n) => (
                      <option key={n} value={n}>
                        {n}%
                      </option>
                    ))}
                  </Select>
                )}
                <IconAction
                  label={m.done ? t('projectsPage.milestone.reopen', { title: m.title }) : t('projectsPage.milestone.markDone', { title: m.title })}
                  disabled={busy}
                  onClick={() => run(() => update({ id: m.id, doneDate: m.done ? null : today }))}
                >
                  {m.done ? <Undo2 size={14} aria-hidden /> : <Check size={14} aria-hidden />}
                </IconAction>
                <IconAction label={t('projectsPage.milestone.remove', { title: m.title })} disabled={busy} onClick={() => run(() => remove({ id: m.id }))}>
                  <Trash2 size={14} aria-hidden />
                </IconAction>
              </div>
            )}
          </div>
        )
      })}
      {canManage && (
        <form onSubmit={onAdd} className="flex flex-col gap-2 border-t border-line pt-3 sm:flex-row">
          <Input
            aria-label={t('projectsPage.milestone.title')}
            placeholder={t('projectsPage.milestone.title')}
            value={form.title}
            maxLength={160}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className="grow"
          />
          <Input
            type="date"
            aria-label={t('projectsPage.milestone.due')}
            value={form.dueDate}
            onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
            className="sm:w-40"
          />
          <GhostButton size="lg" icon={Plus} type="submit" disabled={busy || !form.title.trim() || !form.dueDate}>
            {t('projectsPage.milestone.add')}
          </GhostButton>
        </form>
      )}
    </Panel>
  )
}

function addDaysIso(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function IconAction({ label, children, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="rounded-pill p-2 text-muted hover:bg-surface-2 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:opacity-50"
      {...props}
    >
      {children}
    </button>
  )
}

function Costs({ project: p, canManage, money, formatCurrency }) {
  const t = useT()
  const locale = getActiveLocale()
  const { user } = useAuth()
  const { showToast } = useToast()
  const costs = usePaginatedQuery(api.projects.listCosts, user ? { projectId: p.id } : 'skip', { initialNumItems: 25 })
  const add = useMutation(api.projects.addCost)
  const remove = useMutation(api.projects.removeCost)
  const [form, setForm] = useState({ amount: '', date: localToday(), note: '' })
  const [busy, setBusy] = useState(false)
  const [linking, setLinking] = useState(false)
  const pct = p.budgetPct
  const onAdd = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await add({ projectId: p.id, amount: Number(form.amount), date: form.date, note: form.note || undefined })
      setForm((f) => ({ ...f, amount: '', note: '' }))
    } catch (err) {
      showToast('error', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel
      title={t('projectsPage.budgetVsActual')}
      className="grow basis-0"
      action={canManage ? { label: t('projectsPage.cost.link'), onClick: () => setLinking(true) } : undefined}
    >
      <div className="flex flex-col gap-2 border-t border-line py-3">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted">{t('projectsPage.spentOf', { spent: money(p.spent), budget: p.budget ? money(p.budget) : '-' })}</span>
          {pct != null && <span className={`font-medium tabular-nums ${p.overBudget ? 'text-alert' : 'text-text'}`}>{pct}%</span>}
        </div>
        {pct != null && (
          <div className="h-2 overflow-hidden rounded-pill bg-line" role="img" aria-label={`${pct}%`}>
            <div
              className={`h-full rounded-pill ${p.overBudget ? 'bg-alert' : pct >= 90 ? 'bg-warn' : 'bg-gradient-to-r from-sky to-sky-soft'}`}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
        )}
      </div>
      {costs.status === 'LoadingFirstPage' ? (
        <LoadingState />
      ) : costs.results.length === 0 ? (
        <p className="border-t border-line py-[11px] text-sm text-muted">{t('projectsPage.noCosts')}</p>
      ) : (
        costs.results.map((c) => (
          <div key={c.id} className="flex items-center gap-[14px] border-t border-line py-[11px]">
            <div className="flex min-w-0 grow basis-0 flex-col gap-[2px]">
              <span className="truncate text-[14px] leading-[18px] text-text">
                {c.note || c.sourceLabel || t(`projectsPage.cost.source.${c.source}`)}
              </span>
              <span className="flex items-center gap-1 text-xs leading-4 text-muted">
                {c.source !== 'manual' && <Link2 size={12} aria-hidden />}
                {shortDate(c.date, locale)} · {t(`projectsPage.cost.source.${c.source}`)}
                {c.source !== 'manual' && c.sourceLabel ? ` · ${c.sourceLabel}` : ''}
              </span>
            </div>
            <span className="shrink-0 font-data text-[14px] tabular-nums text-text">{formatCurrency(c.amount, { maximumFractionDigits: 0 })}</span>
            {canManage && (
              <IconAction
                label={t('projectsPage.cost.remove')}
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    await remove({ id: c.id })
                  } catch (err) {
                    showToast('error', errorMessage(err))
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <Trash2 size={14} aria-hidden />
              </IconAction>
            )}
          </div>
        ))
      )}
      {costs.status === 'CanLoadMore' && (
        <div className="border-t border-line pt-3">
          <GhostButton size="sm" onClick={() => costs.loadMore(25)}>
            {t('projectsPage.loadMore')}
          </GhostButton>
        </div>
      )}
      {canManage && (
        <form onSubmit={onAdd} className="flex flex-col gap-2 border-t border-line pt-3 sm:flex-row">
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            aria-label={t('projectsPage.cost.amount')}
            placeholder={t('projectsPage.cost.amount')}
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            className="sm:w-32"
          />
          <Input type="date" aria-label={t('projectsPage.cost.date')} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className="sm:w-40" />
          <Input
            aria-label={t('projectsPage.cost.note')}
            placeholder={t('projectsPage.cost.note')}
            value={form.note}
            maxLength={500}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            className="grow"
          />
          <GhostButton size="lg" icon={Plus} type="submit" disabled={busy || !(Number(form.amount) > 0) || !form.date}>
            {t('projectsPage.cost.add')}
          </GhostButton>
        </form>
      )}
      {linking && <LinkCost projectId={p.id} onClose={() => setLinking(false)} formatCurrency={formatCurrency} />}
    </Panel>
  )
}

/** Pick an existing expense or placed order: it counts once, at its own amount. */
function LinkCost({ projectId, onClose, formatCurrency }) {
  const t = useT()
  const locale = getActiveLocale()
  const { showToast } = useToast()
  const canFinance = usePermission('finance.view')
  const options = useQuery(api.projects.linkable, { projectId })
  const add = useMutation(api.projects.addCost)
  const [busy, setBusy] = useState(false)
  const link = async (args) => {
    setBusy(true)
    try {
      await add({ projectId, ...args })
      showToast('success', t('projectsPage.cost.linked'))
      onClose()
    } catch (err) {
      showToast('error', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const row = (key, title, sub, amount, onClick) => (
    <li key={key} className="flex items-center gap-3 border-t border-line py-[10px]">
      <div className="flex min-w-0 grow flex-col">
        <span className="truncate text-[14px] text-text">{title}</span>
        <span className="truncate text-xs text-muted">{sub}</span>
      </div>
      <span className="shrink-0 font-data text-sm tabular-nums text-text">{formatCurrency(amount, { maximumFractionDigits: 0 })}</span>
      <GhostButton size="sm" onClick={onClick} disabled={busy}>
        {t('projectsPage.cost.linkThis')}
      </GhostButton>
    </li>
  )
  return (
    <Modal open onClose={onClose} showClose size="xl" title={t('projectsPage.cost.linkTitle')} description={t('projectsPage.cost.linkHint')}>
      {options === undefined ? (
        <LoadingState />
      ) : options.expenses.length === 0 && options.purchaseOrders.length === 0 ? (
        <EmptyState title={t('projectsPage.cost.nothingToLink')} description={canFinance ? null : t('projectsPage.cost.needFinance')} />
      ) : (
        <div className="flex flex-col gap-4">
          {options.expenses.length > 0 && (
            <section>
              <h3 className="text-xs font-medium uppercase tracking-[0.06em] text-faint">{t('projectsPage.cost.expenses')}</h3>
              <ul>
                {options.expenses.map((e) =>
                  row(e.id, e.notes || e.category, `${shortDate(e.date, locale)} · ${e.category}`, e.amount, () => link({ expenseId: e.id })),
                )}
              </ul>
            </section>
          )}
          {options.purchaseOrders.length > 0 && (
            <section>
              <h3 className="text-xs font-medium uppercase tracking-[0.06em] text-faint">{t('projectsPage.cost.orders')}</h3>
              <ul>
                {options.purchaseOrders.map((po) => row(po.id, po.poNumber, po.status, po.amount, () => link({ purchaseOrderId: po.id })))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Modal>
  )
}

function DangerZone({ project: p }) {
  const t = useT()
  const router = useRouter()
  const { showToast } = useToast()
  const update = useMutation(api.projects.update)
  const remove = useMutation(api.projects.remove)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const run = async (fn) => {
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      showToast('error', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      {p.status !== 'cancelled' && (
        <GhostButton size="md" disabled={busy} onClick={() => run(() => update({ id: p.id, status: 'cancelled' }))}>
          {t('projectsPage.cancelProject')}
        </GhostButton>
      )}
      <GhostButton size="md" tone="danger" icon={Trash2} disabled={busy} onClick={() => setConfirming(true)}>
        {t('projectsPage.delete')}
      </GhostButton>
      {confirming && (
        <Modal
          open
          role="alertdialog"
          onClose={() => setConfirming(false)}
          title={t('projectsPage.deleteTitle', { name: p.name })}
          description={t('projectsPage.deleteBody')}
          footer={
            <>
              <GhostButton size="lg" onClick={() => setConfirming(false)}>
                {t('common.cancel')}
              </GhostButton>
              <GradientButton
                variant="solid"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await remove({ id: p.id })
                    router.push('/projects')
                  })
                }
              >
                {t('projectsPage.delete')}
              </GradientButton>
            </>
          }
        />
      )}
    </div>
  )
}
