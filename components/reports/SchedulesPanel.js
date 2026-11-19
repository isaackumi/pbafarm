import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { Button, Card, CardHeader, EmptyState, Field, Input, LoadingState, Select } from '../ui'
import { useT } from '../../lib/i18n/context'
import { usePermission } from '../../hooks/usePermission'
import { useToast } from '../Toast'
import { errorMessage } from '../../lib/errorMessage'
import { formatDateTime, getActiveZone } from '../../lib/format'

function zones() {
  try {
    if (typeof Intl.supportedValuesOf === 'function') return Intl.supportedValuesOf('timeZone')
  } catch {
    // older browsers
  }
  return ['Africa/Accra', 'Africa/Lagos', 'Africa/Abidjan', 'Africa/Nairobi', 'Europe/Paris', 'Europe/London', 'UTC']
}

function weekdayName(day, locale) {
  // 2023-01-01 was a Sunday (weekday 0).
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(Date.UTC(2023, 0, 1 + day))
}

const EMPTY = { frequency: 'weekly', localTime: '07:00', weekday: 1, dayOfMonth: 1, recipientIds: [], enabled: true }

function ScheduleForm({ reports, schedule, onDone }) {
  const t = useT()
  const { showToast } = useToast()
  const create = useMutation(api.reportSchedules.create)
  const update = useMutation(api.reportSchedules.update)
  const [form, setForm] = useState(() =>
    schedule
      ? {
          reportId: schedule.reportId,
          frequency: schedule.frequency,
          localTime: schedule.localTime,
          weekday: schedule.weekday ?? 1,
          dayOfMonth: schedule.dayOfMonth ?? 1,
          timezone: schedule.timezone,
          recipientIds: schedule.recipients.map((r) => r.userId),
          enabled: schedule.enabled,
        }
      : { ...EMPTY, reportId: reports[0]?._id ?? '', timezone: getActiveZone() },
  )
  const [saving, setSaving] = useState(false)
  const options = useQuery(api.reportSchedules.recipientOptions, form.reportId ? { reportId: form.reportId } : 'skip')
  const zoneList = useMemo(zones, [])
  const set = (p) => setForm((f) => ({ ...f, ...p }))
  const toggleRecipient = (id) =>
    set({
      recipientIds: form.recipientIds.includes(id)
        ? form.recipientIds.filter((x) => x !== id)
        : [...form.recipientIds, id].slice(0, 20),
    })

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    const args = {
      frequency: form.frequency,
      localTime: form.localTime,
      weekday: form.frequency === 'weekly' ? Number(form.weekday) : undefined,
      dayOfMonth: form.frequency === 'monthly' ? Number(form.dayOfMonth) : undefined,
      timezone: form.timezone,
      recipientIds: form.recipientIds,
      enabled: form.enabled,
    }
    try {
      if (schedule) await update({ scheduleId: schedule._id, ...args })
      else await create({ reportId: form.reportId, ...args })
      showToast(t('reportBuilder.schedules.saved'), 'success')
      onDone()
    } catch (err) {
      showToast(errorMessage(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={t('reportBuilder.schedules.report')} htmlFor="rs-report" required>
        <Select
          id="rs-report"
          value={form.reportId}
          disabled={!!schedule}
          onChange={(e) => set({ reportId: e.target.value, recipientIds: [] })}
        >
          {reports.map((r) => (
            <option key={r._id} value={r._id}>
              {r.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t('reportBuilder.schedules.frequency')} htmlFor="rs-frequency">
          <Select id="rs-frequency" value={form.frequency} onChange={(e) => set({ frequency: e.target.value })}>
            {['daily', 'weekly', 'monthly'].map((f) => (
              <option key={f} value={f}>
                {t(`reportBuilder.frequency.${f}`)}
              </option>
            ))}
          </Select>
        </Field>
        {form.frequency === 'weekly' && (
          <Field label={t('reportBuilder.schedules.weekday')} htmlFor="rs-weekday">
            <Select id="rs-weekday" value={form.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <option key={d} value={d}>
                  {weekdayName(d)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {form.frequency === 'monthly' && (
          <Field label={t('reportBuilder.schedules.dayOfMonth')} htmlFor="rs-day" hint={t('reportBuilder.schedules.dayOfMonthHint')}>
            <Select id="rs-day" value={form.dayOfMonth} onChange={(e) => set({ dayOfMonth: Number(e.target.value) })}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t('reportBuilder.schedules.time')} htmlFor="rs-time">
          <Input id="rs-time" type="time" value={form.localTime} onChange={(e) => set({ localTime: e.target.value })} required />
        </Field>
      </div>
      <Field label={t('reportBuilder.schedules.timezone')} htmlFor="rs-zone">
        <Select id="rs-zone" value={form.timezone} onChange={(e) => set({ timezone: e.target.value })}>
          {(zoneList.includes(form.timezone) ? zoneList : [form.timezone, ...zoneList]).map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-chart-ink">{t('reportBuilder.schedules.recipients')}</legend>
        {options === undefined ? (
          <LoadingState />
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-foam-deep p-2">
            {options.map((o) => (
              <li key={o.userId}>
                <label className={`flex items-start gap-2 text-sm ${o.reason ? 'text-muted' : 'cursor-pointer'}`}>
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4"
                    checked={form.recipientIds.includes(o.userId)}
                    disabled={!!o.reason && !form.recipientIds.includes(o.userId)}
                    onChange={() => toggleRecipient(o.userId)}
                  />
                  <span>
                    {o.name}
                    {o.email && <span className="text-muted"> · {o.email}</span>}
                    {o.reason && <span className="block text-xs">{o.reason}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs text-muted">{t('reportBuilder.schedules.recipientsHint')}</p>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        {t('reportBuilder.schedules.enabled')}
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={saving || !form.reportId || !form.recipientIds.length}>
          {schedule ? t('reportBuilder.schedules.update') : t('reportBuilder.schedules.create')}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          {t('reportBuilder.schedules.cancel')}
        </Button>
      </div>
    </form>
  )
}

function describe(t, s) {
  const time = s.localTime
  if (s.frequency === 'daily') return t('reportBuilder.schedules.everyDay', { time })
  if (s.frequency === 'weekly') return t('reportBuilder.schedules.everyWeek', { day: weekdayName(s.weekday ?? 1), time })
  return t('reportBuilder.schedules.everyMonth', { day: s.dayOfMonth ?? 1, time })
}

/** Scheduled report emails (ANLY-007). */
export default function SchedulesPanel() {
  const t = useT()
  const { showToast } = useToast()
  const canManage = usePermission('reports.manage')
  const canExport = usePermission('reports.export')
  const schedules = useQuery(api.reportSchedules.list, {})
  const reports = useQuery(api.reportBuilder.list, {})
  const setEnabled = useMutation(api.reportSchedules.setEnabled)
  const remove = useMutation(api.reportSchedules.remove)
  const sendNow = useMutation(api.reportSchedules.sendNow)
  const [editing, setEditing] = useState(null) // null | 'new' | schedule

  const run = async (fn, ok) => {
    try {
      await fn()
      if (ok) showToast(ok, 'success')
    } catch (e) {
      showToast(errorMessage(e), 'error')
    }
  }

  if (schedules === undefined || reports === undefined) return <LoadingState />
  const mayCreate = canManage && canExport

  return (
    <div className="space-y-6">
      {editing ? (
        <Card>
          <CardHeader title={editing === 'new' ? t('reportBuilder.schedules.new') : t('reportBuilder.schedules.edit')} />
          <ScheduleForm
            reports={reports}
            schedule={editing === 'new' ? null : editing}
            onDone={() => setEditing(null)}
          />
        </Card>
      ) : (
        mayCreate && (
          <div className="flex justify-end">
            <Button onClick={() => setEditing('new')} disabled={!reports.length}>
              {t('reportBuilder.schedules.new')}
            </Button>
          </div>
        )
      )}
      {!schedules.length ? (
        <EmptyState
          title={t('reportBuilder.schedules.emptyTitle')}
          description={reports.length ? t('reportBuilder.schedules.emptyBody') : t('reportBuilder.schedules.needReport')}
        />
      ) : (
        <ul className="space-y-3">
          {schedules.map((s) => (
            <li key={s._id}>
              <Card>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-chart-ink">{s.reportName}</p>
                    <p className="text-sm text-muted">
                      {describe(t, s)} ({s.timezone}) · {t('reportBuilder.schedules.recipientCount', { count: s.recipients.length })}
                    </p>
                    <p className="text-xs text-muted">
                      {s.enabled && s.nextRunAt
                        ? t('reportBuilder.schedules.next', { when: formatDateTime(s.nextRunAt, { zone: s.timezone }) })
                        : t('reportBuilder.schedules.paused')}
                      {s.lastStatus && ` · ${t('reportBuilder.schedules.last', { status: t(`reportBuilder.status.${s.lastStatus}`) })}`}
                      {` · ${t('reportBuilder.schedules.owner', { name: s.createdByName })}`}
                    </p>
                  </div>
                  {s.canEdit && canManage && (
                    <div className="flex flex-wrap gap-2">
                      {canExport && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => run(() => sendNow({ scheduleId: s._id }), t('reportBuilder.schedules.queued'))}
                        >
                          {t('reportBuilder.schedules.sendNow')}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => run(() => setEnabled({ scheduleId: s._id, enabled: !s.enabled }))}
                      >
                        {s.enabled ? t('reportBuilder.schedules.pause') : t('reportBuilder.schedules.resume')}
                      </Button>
                      {canExport && (
                        <Button size="sm" variant="secondary" onClick={() => setEditing(s)}>
                          {t('reportBuilder.schedules.editShort')}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          window.confirm(t('reportBuilder.schedules.confirmRemove')) &&
                          run(() => remove({ scheduleId: s._id }), t('reportBuilder.schedules.removed'))
                        }
                      >
                        {t('reportBuilder.schedules.remove')}
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">{t('reportBuilder.schedules.footnote')}</p>
    </div>
  )
}
