import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import Link from 'next/link'
import { Check, Plus, X } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { useToast } from '../components/Toast'
import { EmptyState, GradientButton, LoadingState, Pill, Tabs } from '../components/ui'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { useLocale, useT } from '../lib/i18n/context'
import { usePermissions } from '../hooks/usePermission'
import { routePermission } from '../lib/routePermissions'

function isoToday() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function shortDate(iso, locale) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
}

/** Category pill: overdue wins, then automation, team, or a plain assignment. */
function TaskPill({ task, today, t }) {
  if (task.status === 'open' && task.dueDate && task.dueDate < today) return <Pill tone="red">{t('tasksUi.pill.overdue')}</Pill>
  if (task.status === 'cancelled') return <Pill tone="neutral">{t('tasksUi.pill.dismissed')}</Pill>
  if (task.ruleId) return <Pill tone="cyan">{t('tasksUi.pill.automation')}</Pill>
  if (task.teamName) return <Pill tone="pink">{task.teamName}</Pill>
  return <Pill tone="neutral">{t('tasksUi.pill.assigned')}</Pill>
}

function TaskRow({ task, onStatus, busy, today, t, locale }) {
  const open = task.status === 'open'
  const sub = [
    task.cageName && t('tasksUi.cage', { name: task.cageName }),
    task.description,
  ].filter(Boolean).join(' · ')
  const when = !task.dueDate
    ? t('tasksUi.noDue')
    : task.dueDate === today
      ? t('tasksUi.today')
      : shortDate(task.dueDate, locale)
  return (
    <li className="group flex items-center gap-4 border-b border-line px-6 py-4 last:border-b-0">
      <button
        type="button"
        onClick={() => onStatus(task._id, open ? 'done' : 'open')}
        disabled={busy}
        aria-label={open ? t('tasksUi.markDone', { title: task.title }) : t('tasksUi.reopen', { title: task.title })}
        className={`flex size-5 shrink-0 items-center justify-center rounded-pill focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:opacity-50 ${
          open ? 'border-[1.5px] border-line-strong hover:border-text' : 'bg-text text-bg'
        }`}
      >
        {!open && <Check size={12} strokeWidth={3} aria-hidden />}
      </button>
      <div className="flex min-w-0 grow basis-0 flex-col gap-[3px]">
        <span className={`text-[14px] leading-[18px] ${open ? 'text-text' : 'text-faint line-through'}`}>{task.title}</span>
        {sub && <span className="truncate text-xs leading-4 text-muted">{sub}</span>}
      </div>
      <TaskPill task={task} today={today} t={t} />
      <span className="min-w-[60px] shrink-0 whitespace-nowrap text-right text-[13px] leading-4 text-muted">{open ? when : t('tasksUi.done')}</span>
      {open && (
        <button
          type="button"
          onClick={() => onStatus(task._id, 'cancelled')}
          disabled={busy}
          aria-label={t('tasksUi.dismiss', { title: task.title })}
          title={t('tasksUi.dismissShort')}
          className="flex size-7 shrink-0 items-center justify-center rounded-pill text-faint hover:bg-surface-2 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:opacity-50"
        >
          <X size={14} aria-hidden />
        </button>
      )}
    </li>
  )
}

function Tasks() {
  const t = useT()
  const { can } = usePermissions()
  const [tab, setTab] = useState('today')
  const data = useQuery(api.tasks.mine, { includeClosed: tab === 'done' })
  const setStatus = useMutation(api.tasks.setStatus)
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)
  const today = isoToday()
  const { formatLocale } = useLocale()
  const locale = formatLocale || undefined

  const onStatus = async (taskId, status) => {
    setBusy(true)
    try {
      await setStatus({ taskId, status })
      if (status === 'done') showToast(t('tasksUi.doneToast'), 'success')
    } catch (err) {
      showToast(errorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const groups = useMemo(() => {
    const open = data?.open || []
    return {
      today: open.filter((task) => !task.dueDate || task.dueDate <= today),
      upcoming: open.filter((task) => task.dueDate && task.dueDate > today),
      done: data?.closed || [],
    }
  }, [data, today])

  const rows = groups[tab]
  const openCount = data?.open.length
  const dateText = new Date().toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })
  const canCreate = can('automation.manage') && can(routePermission('/teams'))

  return (
    <Layout
      title={t('tasksUi.title')}
      eyebrow={
        openCount == null
          ? t('tasksUi.eyebrowLoading', { date: dateText })
          : t('tasksUi.eyebrow', { date: dateText, count: openCount })
      }
      actions={
        canCreate && (
          <GradientButton href="/teams" icon={Plus}>
            {t('tasksUi.new')}
          </GradientButton>
        )
      }
    >
      <div className="flex flex-col gap-7">
        <Tabs
          variant="page"
          label={t('tasksUi.tabsLabel')}
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'today', label: t('tasksUi.tab.today') },
            { value: 'upcoming', label: t('tasksUi.tab.upcoming') },
            { value: 'done', label: t('tasksUi.tab.done') },
          ]}
        />
        <section
          aria-label={t(`tasksUi.tab.${tab}`)}
          className="max-w-[640px] rounded-card border border-line bg-surface shadow-[var(--shadow-card)]"
        >
          {!data ? (
            <LoadingState />
          ) : rows.length ? (
            <ul>
              {rows.map((task) => (
                <TaskRow key={task._id} task={task} onStatus={onStatus} busy={busy} today={today} t={t} locale={locale} />
              ))}
            </ul>
          ) : (
            <EmptyState
              title={t(`tasksUi.empty.${tab}`)}
              description={tab === 'done' ? undefined : t('tasksUi.emptyHint')}
            />
          )}
        </section>
        {tab !== 'done' && (
          <p className="text-xs text-muted">
            {t('tasksUi.footer')}{' '}
            <Link href="/calendar" className="text-cyan hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
              {t('tasksUi.calendarLink')}
            </Link>
          </p>
        )}
      </div>
    </Layout>
  )
}

export default function TasksPage() {
  return (
    <ProtectedRoute>
      <Tasks />
    </ProtectedRoute>
  )
}
