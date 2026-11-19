import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from 'convex/react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { EmptyState, GradientButton, LoadingState, Segmented } from '../components/ui'
import { api } from '../convex/_generated/api'
import { useLocation } from '../contexts/LocationContext'
import { usePermissions } from '../hooks/usePermission'
import { routePermission } from '../lib/routePermissions'
import { useLocale, useT } from '../lib/i18n/context'
import { byDate, isoDate, monthGrid, shiftMonth } from '../lib/calendarGrid'

/** Event kinds → legend colour (18 Calendar chips: border-l-2 in the tone). */
const KINDS = {
  task: { border: 'border-l-cyan', dot: 'bg-cyan' },
  maintenance: { border: 'border-l-pink', dot: 'bg-pink' },
  harvest: { border: 'border-l-good', dot: 'bg-good' },
  withdrawal: { border: 'border-l-warn', dot: 'bg-warn' },
}
const MAX_CHIPS = 3

function useCalendarEvents(month, t) {
  const { locationArgs } = useLocation()
  const weeks = useMemo(() => monthGrid(month), [month])
  const from = weeks[0][0].iso
  const to = weeks.at(-1).at(-1).iso
  const today = isoDate(new Date())

  const tasks = useQuery(api.tasks.mine, { includeClosed: true })
  const harvests = useQuery(api.harvest.list, { ...locationArgs, dateFrom: from, dateTo: to })
  const withdrawals = useQuery(api.health.activeWithdrawals, { ...locationArgs, asOf: from })
  const due = useQuery(api.equipment.due, { ...locationArgs, asOf: today, days: 90 })

  const loading = [tasks, harvests, withdrawals, due].some((x) => x === undefined)
  const events = useMemo(() => {
    const list = []
    for (const task of [...(tasks?.open || []), ...(tasks?.closed || [])]) {
      if (!task.dueDate || task.status === 'cancelled') continue
      list.push({
        id: `task-${task._id}`,
        kind: 'task',
        date: task.dueDate,
        title: task.title,
        detail: task.cageName ? t('calendarUi.cage', { name: task.cageName }) : null,
        done: task.status === 'done',
        href: '/tasks',
      })
    }
    for (const row of [...(due?.overdue || []), ...(due?.dueSoon || [])]) {
      list.push({
        id: `due-${row.id}`,
        kind: 'maintenance',
        date: row.due,
        title: row.name,
        detail: row.detail,
        href: row.unitId ? `/units/${row.unitId}/maintenance` : '/maintenance',
      })
    }
    for (const h of harvests || []) {
      list.push({
        id: `harvest-${h.id || h._id}`,
        kind: 'harvest',
        date: h.harvest_date,
        title: t('calendarUi.harvest', { name: h.cage?.name || h.cages?.name || '' }),
        detail: h.total_weight != null ? t('calendarUi.kg', { kg: Math.round(h.total_weight).toLocaleString() }) : null,
        href: '/harvest',
      })
    }
    for (const w of withdrawals || []) {
      if (!w.withdrawal_until) continue
      list.push({
        id: `withdrawal-${w.id || w._id}`,
        kind: 'withdrawal',
        date: w.withdrawal_until,
        title: t('calendarUi.withdrawal', { name: w.cage_name || '' }),
        detail: w.product_name || null,
        href: w.cage_id ? `/cages/${w.cage_id}` : '/health',
      })
    }
    return list.filter((e) => e.date >= from && e.date <= to)
  }, [tasks, due, harvests, withdrawals, from, to, t])

  return { weeks, events, byDay: byDate(events), loading, today }
}

function Chip({ event }) {
  return (
    <Link
      href={event.href}
      title={[event.title, event.detail].filter(Boolean).join(' · ')}
      className={`block truncate rounded-[6px] border-l-2 bg-surface-2 px-2 py-1 text-[11px] leading-[14px] text-text hover:bg-line focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${KINDS[event.kind].border} ${event.done ? 'text-muted line-through' : ''}`}
    >
      {event.title}
    </Link>
  )
}

function DayCell({ cell, events, today, tall, t, first }) {
  const isToday = cell.iso === today
  const extra = events.length - MAX_CHIPS
  return (
    <div
      className={`flex min-w-0 grow basis-0 flex-col gap-[6px] p-2 ${tall ? 'min-h-[320px]' : 'min-h-[118px]'} ${first ? '' : 'border-l border-line'} ${cell.inMonth ? '' : 'bg-bg'}`}
    >
      <span
        className={`flex size-[26px] shrink-0 items-center justify-center rounded-pill text-[13px] leading-4 ${
          isToday ? 'bg-button font-medium text-button-text' : cell.inMonth ? 'text-text' : 'text-faint'
        }`}
        aria-current={isToday ? 'date' : undefined}
      >
        {cell.day}
      </span>
      {(tall ? events : events.slice(0, MAX_CHIPS)).map((e) => (
        <Chip key={e.id} event={e} />
      ))}
      {!tall && extra > 0 && <span className="px-2 text-[11px] text-muted">{t('calendarUi.more', { count: extra })}</span>}
    </div>
  )
}

function Calendar() {
  const t = useT()
  const { formatLocale } = useLocale()
  const { can } = usePermissions()
  const [month, setMonth] = useState(() => shiftMonth(new Date(), 0))
  const [view, setView] = useState('month')
  const { weeks, events, byDay, loading, today } = useCalendarEvents(month, t)

  const monthLabel = month.toLocaleDateString(formatLocale, { month: 'long', year: 'numeric' })
  const weekdays = weeks[0].map((c) => {
    const [y, m, d] = c.iso.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString(formatLocale, { weekday: 'short' })
  })
  const currentWeek = weeks.find((w) => w.some((c) => c.iso === today)) || weeks.find((w) => w.some((c) => c.inMonth))
  const monthEvents = events
    .filter((e) => e.date.slice(0, 7) === isoDate(month).slice(0, 7))
    .sort((a, b) => a.date.localeCompare(b.date))
  const agendaDays = [...byDate(monthEvents).entries()]
  const navBtn =
    'inline-flex size-8 items-center justify-center rounded-pill text-muted hover:bg-surface-2 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'
  const canSchedule = can('automation.manage') && can(routePermission('/teams'))
  const card = 'overflow-hidden rounded-card border border-line bg-surface shadow-[var(--shadow-card)]'

  return (
    <Layout
      title={t('calendarUi.title')}
      eyebrow={t('calendarUi.eyebrow', { month: monthLabel })}
      actions={
        canSchedule && (
          <GradientButton href="/teams" icon={Plus}>
            {t('calendarUi.schedule')}
          </GradientButton>
        )
      }
    >
      <div className="flex flex-col gap-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-[14px]">
            <h2 className="text-[20px] font-semibold capitalize leading-6 text-text" aria-live="polite">
              {monthLabel}
            </h2>
            <div className="flex items-center gap-1 text-[14px] text-muted">
              <button type="button" className={navBtn} onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label={t('calendarUi.prev')}>
                <ChevronLeft size={16} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setMonth(shiftMonth(new Date(), 0))}
                className="rounded-pill px-2 py-1 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
              >
                {t('calendarUi.today')}
              </button>
              <button type="button" className={navBtn} onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label={t('calendarUi.next')}>
                <ChevronRight size={16} aria-hidden />
              </button>
            </div>
          </div>
          <Segmented
            size="md"
            label={t('calendarUi.viewLabel')}
            value={view}
            onChange={setView}
            options={[
              { value: 'month', label: t('calendarUi.view.month') },
              { value: 'week', label: t('calendarUi.view.week') },
              { value: 'agenda', label: t('calendarUi.view.agenda') },
            ]}
          />
          <ul className="flex flex-wrap gap-[14px]" aria-label={t('calendarUi.legend')}>
            {Object.entries(KINDS).map(([kind, k]) => (
              <li key={kind} className="flex items-center gap-1.5 text-xs text-muted">
                <span className={`size-[7px] rounded-full ${k.dot}`} aria-hidden />
                {t(`calendarUi.kind.${kind}`)}
              </li>
            ))}
          </ul>
        </div>

        {loading ? (
          <LoadingState />
        ) : view === 'agenda' ? (
          <section className={card} aria-label={t('calendarUi.view.agenda')}>
            {agendaDays.length === 0 ? (
              <EmptyState title={t('calendarUi.empty')} description={t('calendarUi.emptyHint')} />
            ) : (
              <ul>
                {agendaDays.map(([date, list]) => {
                  const [y, m, d] = date.split('-').map(Number)
                  const label = new Date(y, m - 1, d).toLocaleDateString(formatLocale, { weekday: 'short', day: 'numeric', month: 'short' })
                  return (
                    <li key={date} className="flex gap-6 border-t border-line px-6 py-4 first:border-t-0">
                      <span className={`w-24 shrink-0 text-sm ${date === today ? 'font-medium text-text' : 'text-muted'}`}>{label}</span>
                      <ul className="flex min-w-0 grow flex-col gap-2">
                        {list.map((e) => (
                          <li key={e.id} className="flex min-w-0 items-center gap-3">
                            <span className={`size-[7px] shrink-0 rounded-full ${KINDS[e.kind].dot}`} aria-hidden />
                            <Link
                              href={e.href}
                              className={`truncate text-[14px] text-text hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${e.done ? 'text-muted line-through' : ''}`}
                            >
                              {e.title}
                            </Link>
                            {e.detail && <span className="truncate text-xs text-muted">{e.detail}</span>}
                            <span className="ml-auto shrink-0 text-xs text-faint">{t(`calendarUi.kind.${e.kind}`)}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        ) : (
          <section className={`${card} overflow-x-auto`} aria-label={monthLabel}>
            <div className="min-w-[720px]">
              <div className="flex border-b border-line" aria-hidden>
                {weekdays.map((d) => (
                  <div key={d} className="grow basis-0 px-[14px] py-3 text-[11px] uppercase tracking-[0.08em] text-faint">
                    {d}
                  </div>
                ))}
              </div>
              {(view === 'week' ? [currentWeek] : weeks).map((week, wi) => (
                <div key={week[0].iso} className={`flex ${wi ? 'border-t border-line' : ''}`}>
                  {week.map((cell, ci) => (
                    <DayCell
                      key={cell.iso}
                      cell={cell}
                      events={byDay.get(cell.iso) || []}
                      today={today}
                      tall={view === 'week'}
                      first={ci === 0}
                      t={t}
                    />
                  ))}
                </div>
              ))}
            </div>
          </section>
        )}
        <p className="text-xs text-faint">{t('calendarUi.sources')}</p>
      </div>
    </Layout>
  )
}

export default function CalendarPage() {
  return (
    <ProtectedRoute permission="production.view">
      <Calendar />
    </ProtectedRoute>
  )
}
