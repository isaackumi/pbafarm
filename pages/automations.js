import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery } from 'convex/react'
import { Plus } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { useToast } from '../components/Toast'
import { GhostButton, GradientButton, Pill, Segmented, Skeleton, Toggle } from '../components/ui'
import {
  FIELD,
  FIELD_LABEL,
  LineTabs,
  Notice,
  SettingsCard,
  SettingsField,
  SettingsFrame,
  SettingsRow,
  useSettingsEyebrow,
} from '../components/settings'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { useT } from '../lib/i18n/context'

const DAYS = [0, 1, 2, 3, 4, 5, 6]
const OPS = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'is_set', 'not_set']
const FARM_RULES = [
  'dailyMortalityAlertPct',
  'cumulativeMortalityAlertPct',
  'targetHarvestAbwG',
  'maxFcrAlert',
  'targetFcr',
  'maxDensityFishPerM3',
]
const CHANNELS = ['in_app', 'sms', 'whatsapp', 'email']

const RUN_TONE = {
  queued: 'neutral',
  running: 'cyan',
  retrying: 'amber',
  succeeded: 'green',
  partial: 'amber',
  failed: 'red',
  skipped: 'neutral',
}

function RunPill({ status }) {
  const t = useT()
  const key = status in RUN_TONE ? status : 'queued'
  return <Pill tone={RUN_TONE[key]}>{t(`settingsUi.auto.run.${key}`)}</Pill>
}

function fmtTime(ms) {
  if (!ms) return ''
  try {
    return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return ''
  }
}

function triggerSummary(rule, data, t) {
  const tr = rule.trigger
  if (tr.kind === 'event') {
    return t('settingsUi.auto.sum.event', { event: data.eventTypes.find((e) => e.type === tr.eventType)?.label || tr.eventType })
  }
  const check = data.checks.find((c) => c.key === tr.check)?.label || tr.check
  const days = tr.daysOfWeek?.length ? tr.daysOfWeek.map((d) => t(`settingsUi.auto.days.${d}`)).join(', ') : t('settingsUi.auto.everyDay')
  return t('settingsUi.auto.sum.schedule', { days, time: tr.localTime, check })
}

function recipientsSummary(r, members, t) {
  if (r.everyone) return t('settingsUi.auto.sum.everyone')
  const parts = []
  if (r.roles?.includes('admin')) parts.push(t('settingsUi.auto.sum.admins'))
  if (r.roles?.includes('user')) parts.push(t('settingsUi.auto.sum.staff'))
  for (const id of r.userIds || []) {
    const m = members.find((x) => x._id === id)
    if (m) parts.push(m.name)
  }
  return parts.join(', ') || t('settingsUi.auto.sum.nobody')
}

function actionSummary(a, members, t) {
  if (a.kind === 'webhook') return t('settingsUi.auto.kind.webhook')
  const who = recipientsSummary(a.recipients, members, t)
  if (a.kind === 'create_task') return t('settingsUi.auto.sum.task', { who })
  const ch = a.channels.map((c) => t(`notifications.channel.${c}`)).join(' + ')
  return t('settingsUi.auto.sum.notify', { channels: ch, who })
}

const blankNotify = () => ({
  kind: 'notify',
  channels: ['in_app'],
  recipients: { roles: ['admin'] },
  title: '',
  message: '',
  link: '',
  level: 'warning',
})

const blankTask = () => ({
  kind: 'create_task',
  recipients: { roles: ['admin'] },
  title: '',
  description: '',
  dueInHours: 24,
})

const blankWebhook = () => ({ kind: 'webhook', endpointId: '' })

function blankDraft(data) {
  return {
    name: '',
    description: '',
    enabled: true,
    trigger: { kind: 'event', eventType: data.eventTypes[0]?.type || `daily.recorded` },
    match: 'all',
    conditions: [],
    actions: [blankNotify()],
  }
}

function draftFromRule(rule) {
  return {
    ruleId: rule._id,
    name: rule.name,
    description: rule.description || '',
    enabled: rule.enabled,
    trigger: rule.trigger,
    match: rule.match || 'all',
    conditions: rule.conditions.map((c) => ({ ...c, value: c.value ?? '' })),
    actions: rule.actions.map((a) => ({ ...a })),
  }
}

/** Number-looking text becomes a number; true/false become booleans. */
function coerce(value) {
  if (typeof value !== 'string') return value
  const s = value.trim()
  if (s === '') return undefined
  if (s === 'true') return true
  if (s === 'false') return false
  return Number.isFinite(Number(s)) ? Number(s) : s
}

function toArgs(draft) {
  const trigger =
    draft.trigger.kind === 'event'
      ? { kind: 'event', eventType: draft.trigger.eventType }
      : {
          kind: 'schedule',
          localTime: draft.trigger.localTime,
          daysOfWeek: draft.trigger.daysOfWeek?.length ? draft.trigger.daysOfWeek : undefined,
          check: draft.trigger.check,
          params: Object.keys(draft.trigger.params || {}).length ? draft.trigger.params : undefined,
        }
  const conditions = draft.conditions.map((c) => {
    const out = { field: c.field, op: c.op }
    if (c.op === 'is_set' || c.op === 'not_set') return out
    if (c.valueFrom) return { ...out, valueFrom: c.valueFrom }
    return { ...out, value: coerce(c.value) }
  })
  const actions = draft.actions.map((a) => {
    if (a.kind === 'webhook') return { kind: 'webhook', endpointId: a.endpointId }
    const recipients = {
      everyone: a.recipients.everyone || undefined,
      roles: a.recipients.everyone || !a.recipients.roles?.length ? undefined : a.recipients.roles,
      userIds: a.recipients.everyone || !a.recipients.userIds?.length ? undefined : a.recipients.userIds,
    }
    if (a.kind === 'create_task') {
      return {
        kind: 'create_task',
        recipients,
        title: a.title,
        description: a.description || undefined,
        dueInHours: a.dueInHours === '' || a.dueInHours == null ? undefined : Number(a.dueInHours),
      }
    }
    return {
      kind: 'notify',
      channels: a.channels,
      recipients,
      title: a.title,
      message: a.message,
      link: a.link || undefined,
      level: a.level || undefined,
      dedupeKey: a.dedupeKey || undefined,
    }
  })
  return {
    ruleId: draft.ruleId,
    name: draft.name,
    description: draft.description || undefined,
    enabled: draft.enabled,
    trigger,
    match: draft.match,
    conditions,
    actions,
  }
}

function fieldOptions(draft, data) {
  if (draft.trigger.kind === 'event') {
    const ev = data.eventTypes.find((e) => e.type === draft.trigger.eventType)
    return (ev?.fields || []).map((f) => `payload.${f}`)
  }
  const check = data.checks.find((c) => c.key === draft.trigger.check)
  return (check?.fields || []).map((f) => `check.${f}`)
}

function useRun() {
  const { showToast } = useToast()
  const [busy, setBusy] = useState(null)
  const run = async (key, fn, success) => {
    setBusy(key)
    try {
      const result = await fn()
      if (success) showToast('success', success)
      return result ?? true
    } catch (err) {
      showToast('error', errorMessage(err))
      return undefined
    } finally {
      setBusy(null)
    }
  }
  return { busy, run }
}

/** Pressable pill for channels, roles and weekdays. */
function Chip({ on, onClick, disabled, children, ...rest }) {
  return (
    <button
      type="button"
      aria-pressed={!!on}
      disabled={disabled}
      onClick={onClick}
      className={`min-h-9 rounded-pill border px-3.5 text-[13px] leading-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:cursor-not-allowed disabled:opacity-50 ${
        on ? 'border-cyan bg-surface-2 text-text' : 'border-line-strong text-muted hover:text-text'
      }`}
      {...rest}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Rule editor (Paper 21: flow canvas + side panel)
// ---------------------------------------------------------------------------

const NODE_COLOR = { when: 'var(--cyan)', if: 'var(--pink)', then: 'var(--good)', and: 'var(--warn)' }

/** One step on the canvas: coloured marker, uppercase kicker, title, then its form. */
function FlowNode({ tone, kicker, title, meta, action, children, highlight = false }) {
  const color = NODE_COLOR[tone]
  return (
    <section
      className={`relative w-full rounded-card border bg-surface px-5 py-5 shadow-[var(--shadow-card)] sm:px-6 ${highlight ? '' : 'border-line'}`}
      style={highlight ? { borderColor: color } : undefined}
    >
      <div className="flex items-start gap-4">
        <span aria-hidden className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-surface-2">
          <span className="size-3 rounded-[3px]" style={{ backgroundColor: color }} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] font-medium uppercase leading-4 tracking-[0.1em]" style={{ color }}>
              {kicker}
            </p>
            {action}
          </div>
          {title && <h2 className="mt-1 text-[17px] font-semibold leading-[22px] text-text">{title}</h2>}
          {meta && <p className="mt-1 text-[13px] leading-4 text-muted">{meta}</p>}
        </div>
      </div>
      {children && <div className="mt-4 flex flex-col gap-4 sm:pl-14">{children}</div>}
    </section>
  )
}

function Connector({ label }) {
  return (
    <div aria-hidden className="relative flex h-12 items-center justify-center">
      <span className="absolute inset-y-0 left-1/2 border-l border-dashed border-line-strong" />
      {label && (
        <span className="relative rounded-pill border border-line bg-bg px-3 py-0.5 text-[12px] leading-4 text-muted">{label}</span>
      )}
    </div>
  )
}

function ConditionRow({ c, fields, onChange, onRemove, idx }) {
  const t = useT()
  const noValue = c.op === 'is_set' || c.op === 'not_set'
  const allFields = fields.includes(c.field) || !c.field ? fields : [c.field, ...fields]
  return (
    <div className="grid grid-cols-1 gap-3 rounded-input border border-line p-3 sm:grid-cols-[1fr_auto_1.3fr_auto] sm:items-end">
      <SettingsField label={t('settingsUi.auto.cond.field')} htmlFor={`cf-${idx}`}>
        <select id={`cf-${idx}`} className={FIELD} value={c.field} onChange={(e) => onChange({ ...c, field: e.target.value })}>
          <option value="">{t('settingsUi.auto.choose')}</option>
          {allFields.map((f) => (
            <option key={f} value={f}>
              {f.split('.').slice(1).join('.')}
            </option>
          ))}
        </select>
      </SettingsField>
      <SettingsField label={t('settingsUi.auto.cond.op')} htmlFor={`co-${idx}`}>
        <select id={`co-${idx}`} className={FIELD} value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value })}>
          {OPS.map((o) => (
            <option key={o} value={o}>
              {t(`settingsUi.auto.ops.${o}`)}
            </option>
          ))}
        </select>
      </SettingsField>
      {noValue ? (
        <div />
      ) : (
        <SettingsField label={t('settingsUi.auto.cond.value')} htmlFor={`cv-${idx}`}>
          <div className="flex gap-2">
            <select
              aria-label={t('settingsUi.auto.cond.compareWith')}
              className={`${FIELD} !w-auto`}
              value={c.valueFrom ? 'rule' : 'value'}
              onChange={(e) =>
                onChange(
                  e.target.value === 'rule'
                    ? { ...c, valueFrom: `settings.farmRules.${FARM_RULES[0]}`, value: '' }
                    : { ...c, valueFrom: undefined, value: '' },
                )
              }
            >
              <option value="value">{t('settingsUi.auto.cond.number')}</option>
              <option value="rule">{t('settingsUi.auto.cond.farmRule')}</option>
            </select>
            {c.valueFrom ? (
              <select id={`cv-${idx}`} className={FIELD} value={c.valueFrom} onChange={(e) => onChange({ ...c, valueFrom: e.target.value })}>
                {FARM_RULES.map((k) => (
                  <option key={k} value={`settings.farmRules.${k}`}>
                    {t(`settingsUi.auto.farmRules.${k}`)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`cv-${idx}`}
                className={FIELD}
                inputMode="decimal"
                value={c.value ?? ''}
                onChange={(e) => onChange({ ...c, value: e.target.value })}
              />
            )}
          </div>
        </SettingsField>
      )}
      <GhostButton size="sm" tone="danger" onClick={onRemove} aria-label={t('settingsUi.auto.cond.remove')} className="sm:mb-2">
        {t('settingsUi.auto.remove')}
      </GhostButton>
    </div>
  )
}

function Recipients({ value, onChange, members, idx }) {
  const t = useT()
  const roles = value.roles || []
  const userIds = value.userIds || []
  const toggleRole = (r) => onChange({ ...value, roles: roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r] })
  const togglePerson = (id) =>
    onChange({ ...value, userIds: userIds.includes(id) ? userIds.filter((x) => x !== id) : [...userIds, id] })
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={FIELD_LABEL}>{t('settingsUi.auto.recipients')}</legend>
      <div className="flex flex-wrap gap-2">
        <Chip on={value.everyone} onClick={() => onChange({ ...value, everyone: !value.everyone })}>
          {t('settingsUi.auto.everyone')}
        </Chip>
        {!value.everyone && (
          <>
            <Chip on={roles.includes('admin')} onClick={() => toggleRole('admin')}>
              {t('settingsUi.auto.admins')}
            </Chip>
            <Chip on={roles.includes('user')} onClick={() => toggleRole('user')}>
              {t('settingsUi.auto.staff')}
            </Chip>
          </>
        )}
      </div>
      {!value.everyone && (
        <details className="text-[13px] leading-4">
          <summary className="flex min-h-9 cursor-pointer items-center rounded text-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
            {t('settingsUi.auto.people')}
            {userIds.length ? ` (${userIds.length})` : ''}
          </summary>
          <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2" id={`people-${idx}`}>
            {members.map((m) => (
              <label key={m._id} className="flex min-h-10 items-center gap-3 text-text">
                <input type="checkbox" className="size-4 accent-[var(--cyan)]" checked={userIds.includes(m._id)} onChange={() => togglePerson(m._id)} />
                <span className="truncate">
                  {m.name}
                  <span className="text-muted"> · {m.role === 'user' ? t('settingsUi.auto.sum.staff') : m.role.replace('_', ' ')}</span>
                </span>
              </label>
            ))}
          </div>
        </details>
      )}
    </fieldset>
  )
}

function WebhookAction({ a, idx, onChange }) {
  const t = useT()
  const hooks = useQuery(api.webhooks.overview)
  const endpoints = hooks?.endpoints || []
  return (
    <SettingsField label={t('settingsUi.auto.webhook')} htmlFor={`aw-${idx}`} required hint={t('settingsUi.auto.webhookHint')}>
      <select id={`aw-${idx}`} className={FIELD} value={a.endpointId} onChange={(e) => onChange({ ...a, endpointId: e.target.value })}>
        <option value="">{hooks && !endpoints.length ? t('settingsUi.auto.noEndpoints') : t('settingsUi.auto.chooseEndpoint')}</option>
        {endpoints.map((ep) => (
          <option key={ep.id} value={ep.id}>
            {ep.description || ep.url}
            {ep.status === 'active' ? '' : ` (${t('integ.common.off')})`}
          </option>
        ))}
      </select>
    </SettingsField>
  )
}

function ActionNode({ a, idx, onChange, onRemove, members, placeholders }) {
  const t = useT()
  return (
    <FlowNode
      tone={idx === 0 ? 'then' : 'and'}
      kicker={idx === 0 ? t('settingsUi.auto.kicker.then') : t('settingsUi.auto.kicker.and')}
      title={actionSummary(a, members, t)}
      action={
        <GhostButton size="sm" tone="danger" onClick={onRemove}>
          {t('settingsUi.auto.remove')}
        </GhostButton>
      }
    >
      <SettingsField label={t('settingsUi.auto.actionType')} htmlFor={`ak-${idx}`} className="sm:max-w-xs">
        <select
          id={`ak-${idx}`}
          className={FIELD}
          value={a.kind}
          onChange={(e) =>
            onChange(e.target.value === 'create_task' ? blankTask() : e.target.value === 'webhook' ? blankWebhook() : blankNotify())
          }
        >
          <option value="notify">{t('settingsUi.auto.kind.notify')}</option>
          <option value="create_task">{t('settingsUi.auto.kind.create_task')}</option>
          <option value="webhook">{t('settingsUi.auto.kind.webhook')}</option>
        </select>
      </SettingsField>

      {a.kind === 'webhook' && <WebhookAction a={a} idx={idx} onChange={onChange} />}

      {a.kind === 'notify' && (
        <fieldset className="flex flex-col gap-2">
          <legend className={FIELD_LABEL}>{t('settingsUi.auto.channels')}</legend>
          <div className="flex flex-wrap gap-2">
            {CHANNELS.map((id) => {
              const on = a.channels.includes(id)
              return (
                <Chip key={id} on={on} onClick={() => onChange({ ...a, channels: on ? a.channels.filter((c) => c !== id) : [...a.channels, id] })}>
                  {t(`notifications.channel.${id}`)}
                </Chip>
              )
            })}
          </div>
          {a.channels.some((c) => c !== 'in_app') && <p className="text-[12px] leading-4 text-faint">{t('settingsUi.auto.channelsHint')}</p>}
        </fieldset>
      )}

      {a.kind !== 'webhook' && (
        <>
          <Recipients value={a.recipients} onChange={(r) => onChange({ ...a, recipients: r })} members={members} idx={idx} />
          <SettingsField label={t('settingsUi.auto.titleLabel')} htmlFor={`at-${idx}`} required>
            <input id={`at-${idx}`} className={FIELD} value={a.title} maxLength={200} onChange={(e) => onChange({ ...a, title: e.target.value })} />
          </SettingsField>
          {a.kind === 'notify' ? (
            <>
              <SettingsField label={t('settingsUi.auto.message')} htmlFor={`am-${idx}`} hint={placeholders}>
                <textarea
                  id={`am-${idx}`}
                  rows={3}
                  className={FIELD}
                  value={a.message}
                  maxLength={1000}
                  onChange={(e) => onChange({ ...a, message: e.target.value })}
                />
              </SettingsField>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <SettingsField label={t('settingsUi.auto.link')} htmlFor={`al-${idx}`} hint={t('settingsUi.auto.linkHint')}>
                  <input id={`al-${idx}`} className={FIELD} value={a.link || ''} onChange={(e) => onChange({ ...a, link: e.target.value })} />
                </SettingsField>
                <SettingsField label={t('settingsUi.auto.importance')} htmlFor={`av-${idx}`}>
                  <select id={`av-${idx}`} className={FIELD} value={a.level || 'info'} onChange={(e) => onChange({ ...a, level: e.target.value })}>
                    <option value="info">{t('settingsUi.auto.level.info')}</option>
                    <option value="warning">{t('settingsUi.auto.level.warning')}</option>
                    <option value="error">{t('settingsUi.auto.level.error')}</option>
                  </select>
                </SettingsField>
              </div>
            </>
          ) : (
            <>
              <SettingsField label={t('settingsUi.auto.details')} htmlFor={`ad-${idx}`} hint={placeholders}>
                <textarea
                  id={`ad-${idx}`}
                  rows={3}
                  className={FIELD}
                  value={a.description || ''}
                  onChange={(e) => onChange({ ...a, description: e.target.value })}
                />
              </SettingsField>
              <SettingsField label={t('settingsUi.auto.dueIn')} htmlFor={`ah-${idx}`} className="sm:max-w-xs">
                <input
                  id={`ah-${idx}`}
                  className={FIELD}
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={a.dueInHours ?? ''}
                  onChange={(e) => onChange({ ...a, dueInHours: e.target.value })}
                />
              </SettingsField>
            </>
          )}
        </>
      )}
    </FlowNode>
  )
}

function TriggerNode({ draft, data, set, setTriggerKind }) {
  const t = useT()
  const check = data.checks.find((c) => c.key === draft.trigger.check)
  const isEvent = draft.trigger.kind === 'event'
  const title = isEvent
    ? data.eventTypes.find((e) => e.type === draft.trigger.eventType)?.label || draft.trigger.eventType
    : check?.label || draft.trigger.check
  return (
    <FlowNode
      tone="when"
      kicker={isEvent ? t('settingsUi.auto.kicker.whenEvent') : t('settingsUi.auto.kicker.whenSchedule')}
      title={title}
      meta={isEvent ? draft.trigger.eventType : t('settingsUi.auto.farmTime', { time: draft.trigger.localTime || '—', tz: data.timezone })}
    >
      <Segmented
        label={t('settingsUi.auto.trigger')}
        value={draft.trigger.kind}
        onChange={setTriggerKind}
        options={[
          { value: 'event', label: t('settingsUi.auto.onEvent') },
          { value: 'schedule', label: t('settingsUi.auto.onSchedule') },
        ]}
        className="self-start"
      />
      {isEvent ? (
        <SettingsField label={t('settingsUi.auto.event')} htmlFor="rule-event">
          <select
            id="rule-event"
            className={FIELD}
            value={draft.trigger.eventType}
            onChange={(e) => set({ trigger: { kind: 'event', eventType: e.target.value }, conditions: [] })}
          >
            {data.eventTypes.map((ev) => (
              <option key={ev.type} value={ev.type}>
                {ev.label}
              </option>
            ))}
          </select>
        </SettingsField>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SettingsField label={t('settingsUi.auto.check')} htmlFor="rule-check" hint={check?.description}>
              <select
                id="rule-check"
                className={FIELD}
                value={draft.trigger.check}
                onChange={(e) => set({ trigger: { ...draft.trigger, check: e.target.value, params: {} }, conditions: [] })}
              >
                {data.checks.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </SettingsField>
            <SettingsField label={t('settingsUi.auto.time')} htmlFor="rule-time" hint={t('settingsUi.auto.timeHint', { tz: data.timezone })}>
              <input
                id="rule-time"
                type="time"
                className={FIELD}
                value={draft.trigger.localTime}
                onChange={(e) => set({ trigger: { ...draft.trigger, localTime: e.target.value } })}
              />
            </SettingsField>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className={FIELD_LABEL}>{t('settingsUi.auto.daysLabel')}</legend>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((i) => {
                const on = draft.trigger.daysOfWeek?.includes(i)
                return (
                  <Chip
                    key={i}
                    on={on}
                    onClick={() =>
                      set({
                        trigger: {
                          ...draft.trigger,
                          daysOfWeek: on ? draft.trigger.daysOfWeek.filter((x) => x !== i) : [...(draft.trigger.daysOfWeek || []), i].sort(),
                        },
                      })
                    }
                  >
                    {t(`settingsUi.auto.days.${i}`)}
                  </Chip>
                )
              })}
            </div>
          </fieldset>
          {check?.params?.map((p) => (
            <SettingsField key={p.key} label={p.label} htmlFor={`param-${p.key}`} className="sm:max-w-xs">
              <input
                id={`param-${p.key}`}
                className={FIELD}
                inputMode="decimal"
                placeholder={p.default != null ? String(p.default) : ''}
                value={draft.trigger.params?.[p.key] ?? ''}
                onChange={(e) => {
                  const params = { ...(draft.trigger.params || {}) }
                  const val = coerce(e.target.value)
                  if (val === undefined) delete params[p.key]
                  else params[p.key] = val
                  set({ trigger: { ...draft.trigger, params } })
                }}
              />
            </SettingsField>
          ))}
        </>
      )}
    </FlowNode>
  )
}

function OtherRules({ data, currentId, onEdit }) {
  const t = useT()
  const others = data.rules.filter((r) => r._id !== currentId)
  return (
    <SettingsCard title={t('settingsUi.auto.others')}>
      {others.length === 0 ? (
        <p className="border-t border-line py-3 text-[13px] leading-4 text-muted">{t('settingsUi.auto.noOthers')}</p>
      ) : (
        <ul>
          {others.map((r) => (
            <li key={r._id} className="flex items-center gap-3 border-t border-line py-3">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: r.enabled ? 'var(--good)' : 'var(--faint)' }}
              />
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => onEdit(r)}
                  className="truncate rounded text-left text-[15px] leading-5 text-text hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                >
                  {r.name}
                </button>
                <p className="truncate text-[13px] leading-4 text-muted">{triggerSummary(r, data, t)}</p>
              </div>
              <span className="text-[14px] leading-[18px] text-text">{r.enabled ? t('integ.common.on') : t('integ.common.off')}</span>
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  )
}

function RuleEditor({ data, initial, onClose, onSwitch }) {
  const t = useT()
  const save = useMutation(api.automation.rules.save)
  const { busy, run } = useRun()
  const eyebrow = useSettingsEyebrow(t('settingsUi.auto.title'))
  const [draft, setDraft] = useState(initial)
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const fields = fieldOptions(draft, data)
  const placeholders = t('settingsUi.auto.placeholders', { list: [...fields, 'date'].map((f) => `{{${f}}}`).join(' ') })

  const setTriggerKind = (kind) =>
    set({
      conditions: [],
      trigger:
        kind === 'event'
          ? { kind: 'event', eventType: data.eventTypes[0]?.type }
          : { kind: 'schedule', localTime: '16:00', check: data.checks[0]?.key, params: {} },
    })

  const onSave = async (e) => {
    e.preventDefault()
    const ok = await run('save', () => save(toArgs(draft)), draft.ruleId ? t('settingsUi.auto.saved') : t('settingsUi.auto.created'))
    if (ok) onClose()
  }

  const condMeta =
    draft.trigger.kind === 'schedule' ? t('settingsUi.auto.condHintSchedule') : t('settingsUi.auto.condHintEvent')

  return (
    <Layout
      title={draft.name || (draft.ruleId ? t('settingsUi.auto.editRule') : t('settingsUi.auto.newRule'))}
      eyebrow={eyebrow}
      actions={
        <>
          <GhostButton size="lg" onClick={onClose}>
            {t('common.cancel')}
          </GhostButton>
          <GradientButton type="submit" form="rule-form" disabled={busy === 'save'}>
            {busy === 'save' ? t('settingsUi.saving') : t('settingsUi.auto.save')}
          </GradientButton>
        </>
      }
    >
      <form id="rule-form" onSubmit={onSave} className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div
          className="rounded-card border border-line px-4 py-6 sm:px-8"
          style={{
            backgroundImage: 'radial-gradient(var(--line-strong) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
          }}
        >
          <div className="mx-auto flex max-w-2xl flex-col">
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <Pill tone={draft.enabled ? 'green' : 'neutral'}>
                <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: draft.enabled ? 'var(--good)' : 'var(--faint)' }} />
                {draft.enabled ? t('settingsUi.auto.live') : t('settingsUi.auto.paused')}
              </Pill>
            </div>
            <TriggerNode draft={draft} data={data} set={set} setTriggerKind={setTriggerKind} />
            <Connector />
            <FlowNode
              tone="if"
              highlight
              kicker={t('settingsUi.auto.kicker.if')}
              title={
                draft.conditions.length
                  ? t('settingsUi.auto.condCount', { count: draft.conditions.length })
                  : t('settingsUi.auto.noConditions')
              }
              meta={condMeta}
              action={
                draft.conditions.length > 1 && (
                  <select aria-label={t('settingsUi.auto.match')} className={`${FIELD} !w-auto !py-1.5 !text-[13px]`} value={draft.match} onChange={(e) => set({ match: e.target.value })}>
                    <option value="all">{t('settingsUi.auto.matchAll')}</option>
                    <option value="any">{t('settingsUi.auto.matchAny')}</option>
                  </select>
                )
              }
            >
              {draft.conditions.map((c, i) => (
                <ConditionRow
                  key={i}
                  idx={i}
                  c={c}
                  fields={fields}
                  onChange={(next) => set({ conditions: draft.conditions.map((x, j) => (j === i ? next : x)) })}
                  onRemove={() => set({ conditions: draft.conditions.filter((_, j) => j !== i) })}
                />
              ))}
              {draft.conditions.length < 10 && (
                <div>
                  <GhostButton
                    size="sm"
                    icon={Plus}
                    onClick={() => set({ conditions: [...draft.conditions, { field: fields[0] || '', op: 'gt', value: '' }] })}
                  >
                    {t('settingsUi.auto.addCondition')}
                  </GhostButton>
                </div>
              )}
            </FlowNode>
            {draft.actions.map((a, i) => (
              <div key={i}>
                <Connector />
                <ActionNode
                  idx={i}
                  a={a}
                  members={data.members}
                  placeholders={placeholders}
                  onChange={(next) => set({ actions: draft.actions.map((x, j) => (j === i ? next : x)) })}
                  onRemove={() => set({ actions: draft.actions.filter((_, j) => j !== i) })}
                />
              </div>
            ))}
            {draft.actions.length < 5 && (
              <>
                <Connector />
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => set({ actions: [...draft.actions, blankNotify()] })}
                    className="flex items-center gap-1.5 rounded-pill border border-dashed border-line-strong bg-bg px-5 py-2 text-[14px] leading-[18px] text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                  >
                    <Plus size={14} aria-hidden />
                    {t('settingsUi.auto.addStep')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <SettingsCard title={t('settingsUi.auto.ruleCard')}>
            <div className="flex flex-col gap-4">
              <SettingsField label={t('settingsUi.auto.name')} htmlFor="rule-name" required>
                <input id="rule-name" className={FIELD} value={draft.name} maxLength={100} onChange={(e) => set({ name: e.target.value })} />
              </SettingsField>
              <SettingsField label={t('settingsUi.auto.description')} htmlFor="rule-desc">
                <input id="rule-desc" className={FIELD} value={draft.description} onChange={(e) => set({ description: e.target.value })} />
              </SettingsField>
            </div>
            <SettingsRow label={t('settingsUi.auto.enabled')} helper={t('settingsUi.auto.enabledHint')} className="mt-3">
              <Toggle checked={draft.enabled} onChange={(enabled) => set({ enabled })} label={t('settingsUi.auto.enabled')} />
            </SettingsRow>
          </SettingsCard>
          <OtherRules data={data} currentId={draft.ruleId} onEdit={onSwitch} />
        </div>
      </form>
    </Layout>
  )
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

function RuleRow({ rule, data, onEdit }) {
  const t = useT()
  const setEnabled = useMutation(api.automation.rules.setEnabled)
  const runNow = useMutation(api.automation.rules.runNow)
  const remove = useMutation(api.automation.rules.remove)
  const { busy, run } = useRun()

  return (
    <li className="flex flex-col gap-3 border-t border-line py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden
          className="mt-1.5 size-2 shrink-0 rounded-full"
          style={{ backgroundColor: rule.enabled ? 'var(--good)' : 'var(--faint)' }}
        />
        <div className="min-w-0">
          <p className="text-[15px] leading-5 text-text">
            {rule.name}
            {rule.builtIn && (
              <Pill tone="neutral" className="ml-2 align-middle">
                {t('settingsUi.auto.builtIn')}
              </Pill>
            )}
          </p>
          <p className="mt-1 text-[13px] leading-4 text-muted">{triggerSummary(rule, data, t)}</p>
          <p className="mt-0.5 text-[13px] leading-4 text-muted">{rule.actions.map((a) => actionSummary(a, data.members, t)).join(' · ')}</p>
          {rule.enabled && rule.nextRunAt && (
            <p className="mt-1 text-[12px] leading-4 text-faint">{t('settingsUi.auto.nextRun', { time: fmtTime(rule.nextRunAt) })}</p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Toggle
          label={t(rule.enabled ? 'settingsUi.auto.disableRule' : 'settingsUi.auto.enableRule', { name: rule.name })}
          checked={rule.enabled}
          disabled={busy === 'toggle'}
          onChange={(enabled) =>
            run('toggle', () => setEnabled({ ruleId: rule._id, enabled }), enabled ? t('settingsUi.auto.ruleOn') : t('settingsUi.auto.ruleOff'))
          }
        />
        <GhostButton size="sm" onClick={onEdit}>
          {t('settingsUi.auto.edit')}
        </GhostButton>
        {rule.trigger.kind === 'schedule' && (
          <GhostButton
            size="sm"
            disabled={busy === 'run'}
            onClick={() => run('run', () => runNow({ ruleId: rule._id }), t('settingsUi.auto.runningNow'))}
          >
            {t('settingsUi.auto.runNow')}
          </GhostButton>
        )}
        <GhostButton
          size="sm"
          tone="danger"
          disabled={busy === 'remove'}
          onClick={() => {
            if (window.confirm(t('settingsUi.auto.deleteConfirm', { name: rule.name }))) {
              run('remove', () => remove({ ruleId: rule._id }), t('settingsUi.auto.deleted'))
            }
          }}
        >
          {t('settingsUi.auto.delete')}
        </GhostButton>
      </div>
    </li>
  )
}

function RunHistory({ members }) {
  const t = useT()
  const runs = useQuery(api.automation.rules.runs, { limit: 50 })
  const rerun = useMutation(api.automation.rules.rerun)
  const { busy, run } = useRun()
  if (!runs) return <Skeleton className="h-48" />
  if (!runs.length) return <Notice tone="cyan">{t('settingsUi.auto.noRuns')}</Notice>
  const name = (id) => members.find((m) => m._id === id)?.name || t('settingsUi.auto.member')
  return (
    <SettingsCard title={t('settingsUi.auto.history')} meta={runs.length}>
      <ul>
        {runs.map((r) => {
          const deliveries = r.deliveries || []
          const sent = deliveries.filter((d) => d.status === 'sent').length
          const failed = deliveries.filter((d) => d.status === 'failed')
          const skipped = deliveries.filter((d) => d.status === 'skipped').length
          const parts = []
          if (r.notified) parts.push(t('settingsUi.auto.parts.inApp', { count: r.notified }))
          if (r.tasksCreated) parts.push(t('settingsUi.auto.parts.tasks', { count: r.tasksCreated }))
          if (sent) parts.push(t('settingsUi.auto.parts.sent', { count: sent }))
          if (failed.length) parts.push(t('settingsUi.auto.parts.failed', { count: failed.length }))
          if (skipped) parts.push(t('settingsUi.auto.parts.skipped', { count: skipped }))
          const kind = r.triggerKind === 'event' ? 'event' : r.triggerKind === 'manual' ? 'manual' : 'schedule'
          return (
            <li key={r._id} className="flex flex-col gap-2 border-t border-line py-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <RunPill status={r.status} />
                  <span className="text-[15px] leading-5 text-text">{r.ruleName}</span>
                </div>
                <p className="mt-1.5 text-[13px] leading-4 text-muted">
                  {fmtTime(r.createdAt)} · {t(`settingsUi.auto.triggerKind.${kind}`)}
                  {r.attempts > 1 ? ` · ${t('settingsUi.auto.attempts', { count: r.attempts })}` : ''}
                  {parts.length ? ` · ${parts.join(', ')}` : ''}
                </p>
                {r.note && <p className="mt-1 text-[13px] leading-4 text-muted">{r.note}</p>}
                {r.status === 'retrying' && r.nextAttemptAt && (
                  <p className="mt-1 text-[13px] leading-4 text-muted">{t('settingsUi.auto.nextAttempt', { time: fmtTime(r.nextAttemptAt) })}</p>
                )}
                {r.error && <p className="mt-1 break-words text-[13px] leading-4 text-alert">{r.error}</p>}
                {failed.length > 0 && (
                  <details className="mt-1 text-[13px] leading-4">
                    <summary className="cursor-pointer rounded text-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
                      {t('settingsUi.auto.failedMessages')}
                    </summary>
                    <ul className="mt-1 flex flex-col gap-1 text-muted">
                      {failed.map((d, i) => (
                        <li key={i} className="break-words">
                          {t('settingsUi.auto.failedLine', { channel: d.channel.toUpperCase(), name: name(d.userId), to: d.to, error: d.error })}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
              {(r.status === 'failed' || r.status === 'partial') && (
                <GhostButton size="sm" disabled={busy === r._id} onClick={() => run(r._id, () => rerun({ runId: r._id }), t('settingsUi.auto.rerunning'))}>
                  {t('settingsUi.auto.rerun')}
                </GhostButton>
              )}
            </li>
          )
        })}
      </ul>
    </SettingsCard>
  )
}

function EngineSettings({ data }) {
  const t = useT()
  const enableBuiltIns = useMutation(api.automation.rules.enableBuiltIns)
  const { busy, run } = useRun()
  return (
    <>
      <p className="text-[14px] leading-[18px] text-muted">
        {t('settingsUi.auto.tzLine', { tz: data.timezone.replace(/_/g, ' ') })}{' '}
        <Link href="/company-settings" className="rounded text-cyan hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
          {t('settingsUi.auto.tzLink')}
        </Link>
      </p>
      {!data.onEngine && (
        <Notice
          tone="warn"
          action={
            <GhostButton
              size="sm"
              disabled={busy === 'builtins'}
              onClick={() => run('builtins', () => enableBuiltIns({}), t('settingsUi.auto.movedReminders'))}
            >
              {t('settingsUi.auto.moveReminders')}
            </GhostButton>
          }
        >
          {t('settingsUi.auto.oldReminders')}
        </Notice>
      )}
    </>
  )
}

function ApprovalAlerts() {
  const t = useT()
  const data = useQuery(api.approvalAlerts.settings)
  const update = useMutation(api.approvalAlerts.updateSettings)
  const { busy, run } = useRun()
  const [draft, setDraft] = useState(null)
  if (!data) return <Skeleton className="h-40" />
  const form = draft ?? data.settings
  const set = (patch) => setDraft({ ...form, ...patch })
  const toggle = (key, channel) =>
    set({ [key]: form[key].includes(channel) ? form[key].filter((c) => c !== channel) : [...form[key], channel] })
  const channelChips = (key, labelKey) => (
    <fieldset className="flex flex-col gap-2">
      <legend className={FIELD_LABEL}>{t(labelKey)}</legend>
      <div className="flex flex-wrap gap-2">
        {CHANNELS.map((id) => (
          <Chip key={id} on={form[key].includes(id)} disabled={!form.enabled} onClick={() => toggle(key, id)}>
            {t(`notifications.channel.${id}`)}
          </Chip>
        ))}
      </div>
    </fieldset>
  )
  const save = async () => {
    const ok = await run(
      'approvals',
      () =>
        update({
          enabled: form.enabled,
          channels: form.channels,
          escalateAfterHours: Number(form.escalateAfterHours) || 0,
          escalationChannels: form.escalationChannels,
        }),
      t('notifications.approvals.saved'),
    )
    if (ok) setDraft(null)
  }
  return (
    <SettingsCard
      title={t('notifications.approvals.title')}
      action={<Toggle checked={form.enabled} onChange={(enabled) => set({ enabled })} label={t('notifications.approvals.enabled')} />}
    >
      <p className="text-[13px] leading-4 text-muted">{t('notifications.approvals.intro')}</p>
      <div className="mt-4 flex flex-col gap-4 border-t border-line pt-4">
        {channelChips('channels', 'notifications.approvals.channels')}
        <SettingsField label={t('notifications.approvals.escalateAfter')} htmlFor="approval-escalate" className="max-w-40">
          <input
            id="approval-escalate"
            type="number"
            min={0}
            max={336}
            className={FIELD}
            value={form.escalateAfterHours}
            disabled={!form.enabled}
            onChange={(e) => set({ escalateAfterHours: e.target.value })}
          />
        </SettingsField>
        {Number(form.escalateAfterHours) > 0 && channelChips('escalationChannels', 'notifications.approvals.escalationChannels')}
        <div className="flex justify-end">
          <GradientButton size="sm" disabled={!draft || busy === 'approvals'} onClick={save}>
            {t('notifications.approvals.save')}
          </GradientButton>
        </div>
      </div>
      <div className="mt-4 border-t border-line pt-4">
        <p className="text-[13px] font-medium leading-4 text-text">{t('notifications.approvals.recent')}</p>
        {data.recent.length ? (
          <ul className="mt-1">
            {data.recent.map((d) => (
              <li key={d.id} className="flex flex-col gap-1 border-t border-line py-3 first:border-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-[14px] leading-[18px] text-text">{d.title}</div>
                  <div className="text-[12px] leading-4 text-muted">
                    {fmtTime(d.createdAt)} · {t('notifications.approvals.counts', { sent: d.sent, failed: d.failed, skipped: d.skipped })}
                  </div>
                  {d.error && <div className="break-words text-[12px] leading-4 text-alert">{d.error}</div>}
                </div>
                <RunPill status={d.status} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[13px] leading-4 text-muted">{t('notifications.approvals.noRecent')}</p>
        )}
      </div>
    </SettingsCard>
  )
}

function Templates({ data }) {
  const t = useT()
  const create = useMutation(api.automation.rules.createFromTemplate)
  const { busy, run } = useRun()
  return (
    <SettingsCard title={t('settingsUi.auto.templates')} meta={t('settingsUi.auto.templatesHint')}>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {data.templates.map((tpl) => (
          <li key={tpl.key} className="flex flex-col justify-between gap-3 rounded-input border border-line p-4">
            <div>
              <p className="text-[15px] leading-5 text-text">{tpl.name}</p>
              <p className="mt-1 text-[13px] leading-4 text-muted">{tpl.description}</p>
            </div>
            <div>
              <GhostButton
                size="sm"
                icon={tpl.builtIn && tpl.inUse ? undefined : Plus}
                disabled={busy === tpl.key || (tpl.builtIn && tpl.inUse)}
                onClick={() => run(tpl.key, () => create({ templateKey: tpl.key }), t('settingsUi.auto.added', { name: tpl.name }))}
              >
                {tpl.builtIn && tpl.inUse ? t('settingsUi.auto.addedLabel') : tpl.inUse ? t('settingsUi.auto.addAnother') : t('settingsUi.auto.add')}
              </GhostButton>
            </div>
          </li>
        ))}
      </ul>
    </SettingsCard>
  )
}

function AutomationsScreen() {
  const t = useT()
  const data = useQuery(api.automation.rules.overview)
  const [tab, setTab] = useState('rules')
  const [editing, setEditing] = useState(null)
  const eyebrow = useSettingsEyebrow(t('settingsUi.auto.crumb'))

  if (data && editing) {
    return (
      <RuleEditor
        key={editing.ruleId || 'new'}
        data={data}
        initial={editing}
        onClose={() => setEditing(null)}
        onSwitch={(rule) => setEditing(draftFromRule(rule))}
      />
    )
  }

  return (
    <Layout
      title={t('settingsUi.auto.title')}
      eyebrow={eyebrow}
      actions={
        data && (
          <GradientButton icon={Plus} onClick={() => setEditing(blankDraft(data))}>
            {t('settingsUi.auto.newRule')}
          </GradientButton>
        )
      }
    >
      <SettingsFrame active="automations">
        {!data ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-48" />
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <p className="max-w-3xl text-[14px] leading-[18px] text-muted">{t('settingsUi.auto.description')}</p>
            <EngineSettings data={data} />
            <LineTabs
              label={t('settingsUi.auto.title')}
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'rules', label: t('settingsUi.auto.rulesTab'), count: data.rules.length },
                { value: 'history', label: t('settingsUi.auto.history') },
                { value: 'approvals', label: t('notifications.approvals.title') },
              ]}
            />
            {tab === 'rules' && (
              <>
                <SettingsCard title={t('settingsUi.auto.rulesTab')} meta={t('settingsUi.auto.activeCount', { count: data.rules.filter((r) => r.enabled).length })}>
                  {data.rules.length ? (
                    <ul>
                      {data.rules.map((r) => (
                        <RuleRow key={r._id} rule={r} data={data} onEdit={() => setEditing(draftFromRule(r))} />
                      ))}
                    </ul>
                  ) : (
                    <p className="border-t border-line py-4 text-[13px] leading-4 text-muted">{t('settingsUi.auto.noRules')}</p>
                  )}
                </SettingsCard>
                <Templates data={data} />
              </>
            )}
            {tab === 'history' && <RunHistory members={data.members} />}
            {tab === 'approvals' && <ApprovalAlerts />}
          </div>
        )}
      </SettingsFrame>
    </Layout>
  )
}

export default function AutomationsPage() {
  return (
    <ProtectedRoute permission="automation.manage">
      <AutomationsScreen />
    </ProtectedRoute>
  )
}
