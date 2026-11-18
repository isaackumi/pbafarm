import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { useToast } from '../components/Toast'
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  FormPage,
  Input,
  PageHeader,
  Select,
  Skeleton,
  TabBar,
  Textarea,
} from '../components/ui'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { useT } from '../lib/i18n/context'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const OPS = [
  { id: 'gt', label: 'is above' },
  { id: 'gte', label: 'is at least' },
  { id: 'lt', label: 'is below' },
  { id: 'lte', label: 'is at most' },
  { id: 'eq', label: 'equals' },
  { id: 'neq', label: 'is not' },
  { id: 'is_set', label: 'is recorded' },
  { id: 'not_set', label: 'is not recorded' },
]

const FARM_RULES = [
  ['dailyMortalityAlertPct', 'Daily mortality alert (%)'],
  ['cumulativeMortalityAlertPct', 'Cumulative mortality alert (%)'],
  ['targetHarvestAbwG', 'Target harvest ABW (g)'],
  ['maxFcrAlert', 'FCR alert'],
  ['targetFcr', 'Target FCR'],
  ['maxDensityFishPerM3', 'Max density (fish/m³)'],
]

const CHANNELS = [
  ['in_app', 'In app'],
  ['sms', 'SMS'],
  ['whatsapp', 'WhatsApp'],
  ['email', 'Email'],
]

const RUN_STATUS = {
  queued: { label: 'Queued', className: 'bg-foam text-chart-ink' },
  running: { label: 'Running', className: 'bg-lake/10 text-lake' },
  retrying: { label: 'Retrying', className: 'bg-amber-100 text-amber-900' },
  succeeded: { label: 'Sent', className: 'bg-kelp/15 text-kelp' },
  partial: { label: 'Partly failed', className: 'bg-amber-100 text-amber-900' },
  failed: { label: 'Failed', className: 'bg-signal/10 text-signal' },
  skipped: { label: 'Skipped', className: 'bg-foam text-muted' },
}

function Pill({ status }) {
  const s = RUN_STATUS[status] || RUN_STATUS.queued
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${s.className}`}>
      {s.label}
    </span>
  )
}

function fmtTime(ms) {
  if (!ms) return ''
  try {
    return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return ''
  }
}

function triggerSummary(rule, data) {
  const t = rule.trigger
  if (t.kind === 'event') {
    return `When: ${data.eventTypes.find((e) => e.type === t.eventType)?.label || t.eventType}`
  }
  const check = data.checks.find((c) => c.key === t.check)?.label || t.check
  const days = t.daysOfWeek?.length ? t.daysOfWeek.map((d) => DAYS[d]).join(', ') : 'Every day'
  return `${days} at ${t.localTime}: ${check}`
}

function recipientsSummary(r, members) {
  if (r.everyone) return 'everyone'
  const parts = []
  if (r.roles?.includes('admin')) parts.push('admins')
  if (r.roles?.includes('user')) parts.push('staff')
  for (const id of r.userIds || []) {
    const m = members.find((x) => x._id === id)
    if (m) parts.push(m.name)
  }
  return parts.join(', ') || 'nobody'
}

function actionSummary(a, members) {
  if (a.kind === 'webhook') return 'Call a webhook'
  if (a.kind === 'create_task') return `Task for ${recipientsSummary(a.recipients, members)}`
  const ch = a.channels.map((c) => CHANNELS.find(([id]) => id === c)?.[1] || c).join(' + ')
  return `${ch} to ${recipientsSummary(a.recipients, members)}`
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

function Switch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-lake disabled:opacity-50 ${
        checked ? 'bg-kelp border-kelp' : 'bg-foam border-foam-deep'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-surface shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Rule editor
// ---------------------------------------------------------------------------

function fieldOptions(draft, data) {
  if (draft.trigger.kind === 'event') {
    const ev = data.eventTypes.find((e) => e.type === draft.trigger.eventType)
    return (ev?.fields || []).map((f) => `payload.${f}`)
  }
  const check = data.checks.find((c) => c.key === draft.trigger.check)
  return (check?.fields || []).map((f) => `check.${f}`)
}

function ConditionRow({ c, fields, onChange, onRemove, idx }) {
  const noValue = c.op === 'is_set' || c.op === 'not_set'
  const allFields = fields.includes(c.field) || !c.field ? fields : [c.field, ...fields]
  return (
    <div className="grid grid-cols-1 gap-3 rounded-lg border border-foam-deep p-3 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-end">
      <Field label="Field" htmlFor={`cf-${idx}`}>
        <Select id={`cf-${idx}`} value={c.field} onChange={(e) => onChange({ ...c, field: e.target.value })}>
          <option value="">Choose…</option>
          {allFields.map((f) => (
            <option key={f} value={f}>
              {f.split('.').slice(1).join('.')}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Test" htmlFor={`co-${idx}`}>
        <Select id={`co-${idx}`} value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value })}>
          {OPS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      {noValue ? (
        <div />
      ) : (
        <Field label="Compared with" htmlFor={`cv-${idx}`}>
          <div className="flex gap-2">
            <Select
              aria-label="Compare with a number or a farm rule"
              className="max-w-[9rem]"
              value={c.valueFrom ? 'rule' : 'value'}
              onChange={(e) =>
                onChange(
                  e.target.value === 'rule'
                    ? { ...c, valueFrom: `settings.farmRules.${FARM_RULES[0][0]}`, value: '' }
                    : { ...c, valueFrom: undefined, value: '' },
                )
              }
            >
              <option value="value">Value</option>
              <option value="rule">Farm rule</option>
            </Select>
            {c.valueFrom ? (
              <Select
                id={`cv-${idx}`}
                value={c.valueFrom}
                onChange={(e) => onChange({ ...c, valueFrom: e.target.value })}
              >
                {FARM_RULES.map(([k, label]) => (
                  <option key={k} value={`settings.farmRules.${k}`}>
                    {label}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id={`cv-${idx}`}
                inputMode="decimal"
                value={c.value ?? ''}
                onChange={(e) => onChange({ ...c, value: e.target.value })}
              />
            )}
          </div>
        </Field>
      )}
      <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Remove condition">
        Remove
      </Button>
    </div>
  )
}

function Recipients({ value, onChange, members, idx }) {
  const roles = value.roles || []
  const userIds = value.userIds || []
  const toggleRole = (r) =>
    onChange({ ...value, roles: roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r] })
  const togglePerson = (id) =>
    onChange({ ...value, userIds: userIds.includes(id) ? userIds.filter((x) => x !== id) : [...userIds, id] })
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-chart-ink">Recipients</legend>
      <label className="flex items-center gap-3 text-sm min-h-11">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={!!value.everyone}
          onChange={(e) => onChange({ ...value, everyone: e.target.checked })}
        />
        Everyone in the company
      </label>
      {!value.everyone && (
        <>
          <div className="flex flex-wrap gap-x-6">
            <label className="flex items-center gap-3 text-sm min-h-11">
              <input type="checkbox" className="h-5 w-5" checked={roles.includes('admin')} onChange={() => toggleRole('admin')} />
              Admins
            </label>
            <label className="flex items-center gap-3 text-sm min-h-11">
              <input type="checkbox" className="h-5 w-5" checked={roles.includes('user')} onChange={() => toggleRole('user')} />
              Staff
            </label>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-lake min-h-11 flex items-center">
              Specific people{userIds.length ? ` (${userIds.length})` : ''}
            </summary>
            <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2" id={`people-${idx}`}>
              {members.map((m) => (
                <label key={m._id} className="flex items-center gap-3 min-h-11">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={userIds.includes(m._id)}
                    onChange={() => togglePerson(m._id)}
                  />
                  <span className="truncate">
                    {m.name}
                    <span className="text-muted"> · {m.role === 'user' ? 'staff' : m.role.replace('_', ' ')}</span>
                  </span>
                </label>
              ))}
            </div>
          </details>
        </>
      )}
    </fieldset>
  )
}

function WebhookAction({ a, idx, onChange }) {
  const hooks = useQuery(api.webhooks.overview)
  const endpoints = hooks?.endpoints || []
  return (
    <Field
      label="Webhook endpoint"
      htmlFor={`aw-${idx}`}
      required
      hint="Sends the event (or the check result) as a signed POST. Add endpoints under Webhooks."
    >
      <Select id={`aw-${idx}`} value={a.endpointId} onChange={(e) => onChange({ ...a, endpointId: e.target.value })}>
        <option value="">{hooks && !endpoints.length ? 'No endpoints yet' : 'Choose an endpoint'}</option>
        {endpoints.map((ep) => (
          <option key={ep.id} value={ep.id}>
            {ep.description || ep.url}
            {ep.status === 'active' ? '' : ' (off)'}
          </option>
        ))}
      </Select>
    </Field>
  )
}

function ActionCard({ a, idx, onChange, onRemove, members, placeholders }) {
  return (
    <div className="space-y-4 rounded-lg border border-foam-deep p-4">
      <div className="flex items-center justify-between gap-3">
        <Select
          aria-label="Action type"
          className="max-w-xs"
          value={a.kind}
          onChange={(e) =>
            onChange(
              e.target.value === 'create_task' ? blankTask() : e.target.value === 'webhook' ? blankWebhook() : blankNotify(),
            )
          }
        >
          <option value="notify">Send a notification</option>
          <option value="create_task">Create a task</option>
          <option value="webhook">Call a webhook</option>
        </Select>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          Remove
        </Button>
      </div>

      {a.kind === 'webhook' && <WebhookAction a={a} idx={idx} onChange={onChange} />}

      {a.kind === 'notify' && (
        <fieldset>
          <legend className="text-sm font-semibold text-chart-ink">Channels</legend>
          <div className="flex flex-wrap gap-x-6">
            {CHANNELS.map(([id, label]) => (
              <label key={id} className="flex items-center gap-3 text-sm min-h-11">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={a.channels.includes(id)}
                  onChange={(e) =>
                    onChange({
                      ...a,
                      channels: e.target.checked ? [...a.channels, id] : a.channels.filter((c) => c !== id),
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
          {a.channels.some((c) => c !== 'in_app') && (
            <p className="text-xs text-muted mt-1">
              Sent through your messaging channels. People without a phone or email, or in their quiet hours, are skipped.
            </p>
          )}
        </fieldset>
      )}

      {a.kind !== 'webhook' && (
      <>
      <Recipients value={a.recipients} onChange={(r) => onChange({ ...a, recipients: r })} members={members} idx={idx} />

      <Field label="Title" htmlFor={`at-${idx}`} required>
        <Input id={`at-${idx}`} value={a.title} maxLength={200} onChange={(e) => onChange({ ...a, title: e.target.value })} />
      </Field>
      {a.kind === 'notify' ? (
        <>
          <Field label="Message" htmlFor={`am-${idx}`} hint={placeholders}>
            <Textarea id={`am-${idx}`} value={a.message} maxLength={1000} onChange={(e) => onChange({ ...a, message: e.target.value })} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Link (optional)" htmlFor={`al-${idx}`} hint="An app path, e.g. /daily-entry">
              <Input id={`al-${idx}`} value={a.link || ''} onChange={(e) => onChange({ ...a, link: e.target.value })} />
            </Field>
            <Field label="Importance" htmlFor={`av-${idx}`}>
              <Select id={`av-${idx}`} value={a.level || 'info'} onChange={(e) => onChange({ ...a, level: e.target.value })}>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="error">Urgent</option>
              </Select>
            </Field>
          </div>
        </>
      ) : (
        <>
          <Field label="Details (optional)" htmlFor={`ad-${idx}`} hint={placeholders}>
            <Textarea id={`ad-${idx}`} value={a.description || ''} onChange={(e) => onChange({ ...a, description: e.target.value })} />
          </Field>
          <Field label="Due in (hours)" htmlFor={`ah-${idx}`} className="max-w-xs">
            <Input
              id={`ah-${idx}`}
              type="number"
              min="0"
              inputMode="numeric"
              value={a.dueInHours ?? ''}
              onChange={(e) => onChange({ ...a, dueInHours: e.target.value })}
            />
          </Field>
        </>
      )}
      </>
      )}
    </div>
  )
}

function RuleEditor({ data, initial, onClose }) {
  const save = useMutation(api.automation.rules.save)
  const { busy, run } = useRun()
  const [draft, setDraft] = useState(initial)
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const fields = fieldOptions(draft, data)
  const placeholders = `Placeholders: ${[...fields, 'date'].map((f) => `{{${f}}}`).join(' ')}`
  const check = data.checks.find((c) => c.key === draft.trigger.check)

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
    const ok = await run('save', () => save(toArgs(draft)), draft.ruleId ? 'Rule saved' : 'Rule created')
    if (ok) onClose()
  }

  return (
    <form onSubmit={onSave} className="space-y-6">
      <Card>
        <CardHeader title={draft.ruleId ? 'Edit rule' : 'New rule'} />
        <div className="space-y-4">
          <Field label="Name" htmlFor="rule-name" required>
            <Input id="rule-name" value={draft.name} maxLength={100} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Description (optional)" htmlFor="rule-desc">
            <Input id="rule-desc" value={draft.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
          <label className="flex items-center gap-3 text-sm min-h-11">
            <input type="checkbox" className="h-5 w-5" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            Enabled
          </label>
        </div>
      </Card>

      <Card>
        <CardHeader title="Trigger" subtitle="When this rule is checked." />
        <div className="space-y-4">
          <TabBar
            tabs={[
              { id: 'event', label: 'When something is recorded' },
              { id: 'schedule', label: 'On a schedule' },
            ]}
            active={draft.trigger.kind}
            onChange={setTriggerKind}
          />
          {draft.trigger.kind === 'event' ? (
            <Field label="Event" htmlFor="rule-event">
              <Select
                id="rule-event"
                value={draft.trigger.eventType}
                onChange={(e) => set({ trigger: { kind: 'event', eventType: e.target.value }, conditions: [] })}
              >
                {data.eventTypes.map((ev) => (
                  <option key={ev.type} value={ev.type}>
                    {ev.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Check" htmlFor="rule-check" hint={check?.description}>
                  <Select
                    id="rule-check"
                    value={draft.trigger.check}
                    onChange={(e) => set({ trigger: { ...draft.trigger, check: e.target.value, params: {} }, conditions: [] })}
                  >
                    {data.checks.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Time" htmlFor="rule-time" hint={`Farm time (${data.timezone})`}>
                  <Input
                    id="rule-time"
                    type="time"
                    value={draft.trigger.localTime}
                    onChange={(e) => set({ trigger: { ...draft.trigger, localTime: e.target.value } })}
                  />
                </Field>
              </div>
              <fieldset>
                <legend className="text-sm font-semibold text-chart-ink">Days (none selected = every day)</legend>
                <div className="flex flex-wrap gap-2 mt-2">
                  {DAYS.map((d, i) => {
                    const on = draft.trigger.daysOfWeek?.includes(i)
                    return (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={!!on}
                        onClick={() =>
                          set({
                            trigger: {
                              ...draft.trigger,
                              daysOfWeek: on
                                ? draft.trigger.daysOfWeek.filter((x) => x !== i)
                                : [...(draft.trigger.daysOfWeek || []), i].sort(),
                            },
                          })
                        }
                        className={`min-h-11 min-w-11 rounded-lg border px-3 text-sm ${
                          on ? 'border-lake bg-lake/10 text-lake' : 'border-foam-deep text-chart-ink'
                        }`}
                      >
                        {d}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
              {check?.params?.map((p) => (
                <Field key={p.key} label={p.label} htmlFor={`param-${p.key}`} className="max-w-xs">
                  <Input
                    id={`param-${p.key}`}
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
                </Field>
              ))}
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Conditions"
          subtitle={
            draft.trigger.kind === 'schedule'
              ? 'Optional. The rule already stays quiet when the check finds nothing.'
              : 'Optional. Without conditions the rule acts on every event.'
          }
          action={
            draft.conditions.length > 1 && (
              <Select aria-label="Match" value={draft.match} onChange={(e) => set({ match: e.target.value })}>
                <option value="all">All must hold</option>
                <option value="any">Any may hold</option>
              </Select>
            )
          }
        />
        <div className="space-y-3">
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
            <Button
              variant="secondary"
              size="sm"
              onClick={() => set({ conditions: [...draft.conditions, { field: fields[0] || '', op: 'gt', value: '' }] })}
            >
              Add condition
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Actions" subtitle="What happens when the rule fires." />
        <div className="space-y-4">
          {draft.actions.map((a, i) => (
            <ActionCard
              key={i}
              idx={i}
              a={a}
              members={data.members}
              placeholders={placeholders}
              onChange={(next) => set({ actions: draft.actions.map((x, j) => (j === i ? next : x)) })}
              onRemove={() => set({ actions: draft.actions.filter((_, j) => j !== i) })}
            />
          ))}
          {draft.actions.length < 5 && (
            <Button variant="secondary" size="sm" onClick={() => set({ actions: [...draft.actions, blankNotify()] })}>
              Add action
            </Button>
          )}
        </div>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy === 'save'}>
          {busy === 'save' ? 'Saving…' : 'Save rule'}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

function RuleRow({ rule, data, onEdit }) {
  const setEnabled = useMutation(api.automation.rules.setEnabled)
  const runNow = useMutation(api.automation.rules.runNow)
  const remove = useMutation(api.automation.rules.remove)
  const { busy, run } = useRun()

  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium text-chart-ink">
          {rule.name}
          {rule.builtIn && <span className="ml-2 text-xs font-normal text-muted">Built-in</span>}
        </p>
        <p className="mt-0.5 text-sm text-muted">{triggerSummary(rule, data)}</p>
        <p className="text-sm text-muted">{rule.actions.map((a) => actionSummary(a, data.members)).join(' · ')}</p>
        {rule.enabled && rule.nextRunAt && <p className="text-xs text-muted mt-1">Next run {fmtTime(rule.nextRunAt)}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Switch
          label={rule.enabled ? `Disable ${rule.name}` : `Enable ${rule.name}`}
          checked={rule.enabled}
          disabled={busy === 'toggle'}
          onChange={(enabled) =>
            run('toggle', () => setEnabled({ ruleId: rule._id, enabled }), enabled ? 'Rule enabled' : 'Rule disabled')
          }
        />
        <Button size="sm" variant="secondary" onClick={onEdit}>
          Edit
        </Button>
        {rule.trigger.kind === 'schedule' && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy === 'run'}
            onClick={() => run('run', () => runNow({ ruleId: rule._id }), 'Running now. See the history tab.')}
          >
            Run now
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy === 'remove'}
          onClick={() => {
            if (window.confirm(`Delete "${rule.name}"? Its run history stays.`)) {
              run('remove', () => remove({ ruleId: rule._id }), 'Rule deleted')
            }
          }}
        >
          Delete
        </Button>
      </div>
    </li>
  )
}

function RunHistory({ members }) {
  const runs = useQuery(api.automation.rules.runs, { limit: 50 })
  const rerun = useMutation(api.automation.rules.rerun)
  const { busy, run } = useRun()
  if (!runs) return <Skeleton className="h-48" />
  if (!runs.length) {
    return (
      <Card>
        <EmptyState title="No runs yet" description="Each time a rule fires, it shows up here with what was sent." />
      </Card>
    )
  }
  const name = (id) => members.find((m) => m._id === id)?.name || 'Member'
  return (
    <Card padding={false}>
      <ul className="divide-y divide-foam-deep">
        {runs.map((r) => {
          const deliveries = r.deliveries || []
          const sent = deliveries.filter((d) => d.status === 'sent').length
          const failed = deliveries.filter((d) => d.status === 'failed')
          const skipped = deliveries.filter((d) => d.status === 'skipped').length
          const parts = []
          if (r.notified) parts.push(`${r.notified} in-app`)
          if (r.tasksCreated) parts.push(`${r.tasksCreated} task${r.tasksCreated === 1 ? '' : 's'}`)
          if (sent) parts.push(`${sent} sent`)
          if (failed.length) parts.push(`${failed.length} failed`)
          if (skipped) parts.push(`${skipped} skipped`)
          return (
            <li key={r._id} className="p-4 sm:px-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill status={r.status} />
                    <span className="font-medium text-chart-ink">{r.ruleName}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {fmtTime(r.createdAt)} · {r.triggerKind === 'event' ? 'event' : r.triggerKind === 'manual' ? 'run by hand' : 'scheduled'}
                    {r.attempts > 1 ? ` · ${r.attempts} attempts` : ''}
                    {parts.length ? ` · ${parts.join(', ')}` : ''}
                  </p>
                  {r.note && <p className="text-sm text-muted">{r.note}</p>}
                  {r.status === 'retrying' && r.nextAttemptAt && (
                    <p className="text-sm text-muted">Next attempt {fmtTime(r.nextAttemptAt)}</p>
                  )}
                  {r.error && <p className="mt-1 text-sm text-signal break-words">{r.error}</p>}
                  {failed.length > 0 && (
                    <details className="mt-1 text-sm">
                      <summary className="cursor-pointer text-lake">Failed messages</summary>
                      <ul className="mt-1 space-y-1 text-muted">
                        {failed.map((d, i) => (
                          <li key={i} className="break-words">
                            {d.channel.toUpperCase()} to {name(d.userId)} ({d.to}): {d.error}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
                {(r.status === 'failed' || r.status === 'partial') && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === r._id}
                    onClick={() => run(r._id, () => rerun({ runId: r._id }), 'Re-running')}
                  >
                    Re-run
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function Settings({ data }) {
  const enableBuiltIns = useMutation(api.automation.rules.enableBuiltIns)
  const { busy, run } = useRun()
  return (
    <Card>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-chart-ink">
          Scheduled rules run in farm time: <span className="font-medium">{data.timezone.replace(/_/g, ' ')}</span>.{' '}
          <Link href="/company-settings" className="text-lake hover:underline">
            Change it in the organization profile
          </Link>
          .
        </p>
      </div>
      {!data.onEngine && (
        <div className="mt-4 flex flex-col gap-3 rounded-lg bg-foam p-4 text-sm text-chart-ink sm:flex-row sm:items-center sm:justify-between">
          <p>Daily reminders for missed entries and low stock still run on the old fixed 16:00 schedule. Move them here to edit, pause or extend them.</p>
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0"
            disabled={busy === 'builtins'}
            onClick={() => run('builtins', () => enableBuiltIns({}), 'Daily reminders are now rules you can edit')}
          >
            Move reminders here
          </Button>
        </div>
      )}
    </Card>
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
  const channelBoxes = (key) => (
    <div className="flex flex-wrap gap-4">
      {CHANNELS.map(([id]) => (
        <label key={id} className="inline-flex items-center gap-2 text-sm text-chart-ink min-h-11 sm:min-h-0">
          <input
            type="checkbox"
            checked={form[key].includes(id)}
            onChange={() => toggle(key, id)}
            disabled={!form.enabled}
          />
          {t(`notifications.channel.${id}`)}
        </label>
      ))}
    </div>
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
    <Card>
      <CardHeader
        title={t('notifications.approvals.title')}
        subtitle={t('notifications.approvals.intro')}
        action={
          <Switch
            checked={form.enabled}
            onChange={(enabled) => set({ enabled })}
            label={t('notifications.approvals.enabled')}
          />
        }
      />
      <div className="mt-4 space-y-4">
        <Field label={t('notifications.approvals.channels')}>{channelBoxes('channels')}</Field>
        <Field label={t('notifications.approvals.escalateAfter')} htmlFor="approval-escalate">
          <Input
            id="approval-escalate"
            type="number"
            min={0}
            max={336}
            className="max-w-32"
            value={form.escalateAfterHours}
            disabled={!form.enabled}
            onChange={(e) => set({ escalateAfterHours: e.target.value })}
          />
        </Field>
        {Number(form.escalateAfterHours) > 0 && (
          <Field label={t('notifications.approvals.escalationChannels')}>{channelBoxes('escalationChannels')}</Field>
        )}
        <div className="flex justify-end">
          <Button disabled={!draft || busy === 'approvals'} onClick={save}>
            {t('notifications.approvals.save')}
          </Button>
        </div>
      </div>
      <div className="mt-6 border-t border-foam-deep pt-4">
        <p className="text-sm font-medium text-chart-ink">{t('notifications.approvals.recent')}</p>
        {data.recent.length ? (
          <ul className="mt-2 divide-y divide-foam-deep">
            {data.recent.map((d) => (
              <li key={d.id} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-chart-ink">{d.title}</div>
                  <div className="text-xs text-muted">
                    {fmtTime(d.createdAt)} ·{' '}
                    {t('notifications.approvals.counts', { sent: d.sent, failed: d.failed, skipped: d.skipped })}
                  </div>
                  {d.error && <div className="text-xs text-signal break-words">{d.error}</div>}
                </div>
                <Pill status={d.status} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">{t('notifications.approvals.noRecent')}</p>
        )}
      </div>
    </Card>
  )
}

function Templates({ data }) {
  const create = useMutation(api.automation.rules.createFromTemplate)
  const { busy, run } = useRun()
  return (
    <Card>
      <CardHeader title="Start from a template" subtitle="Adds an enabled rule you can then edit." />
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {data.templates.map((t) => (
          <li key={t.key} className="flex flex-col justify-between gap-3 rounded-lg border border-foam-deep p-4">
            <div>
              <p className="font-medium text-chart-ink">{t.name}</p>
              <p className="mt-1 text-sm text-muted">{t.description}</p>
            </div>
            <div>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy === t.key || (t.builtIn && t.inUse)}
                onClick={() => run(t.key, () => create({ templateKey: t.key }), `"${t.name}" added`)}
              >
                {t.builtIn && t.inUse ? 'Added' : t.inUse ? 'Add another' : 'Add'}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export default function AutomationsPage() {
  const data = useQuery(api.automation.rules.overview)
  const [tab, setTab] = useState('rules')
  const [editing, setEditing] = useState(null)

  return (
    <ProtectedRoute permission="automation.manage">
      <Layout title="Automations">
        <FormPage width="lg">
          <PageHeader
            showTitle={false}
            breadcrumbs={[
              { label: 'Dashboard', href: '/dashboard' },
              { label: 'Company settings', href: '/company-settings' },
              { label: 'Automations' },
            ]}
            description="Reminders and alerts that run on their own: on a schedule, or when something is recorded. Each rule checks its conditions, then notifies people or creates tasks."
            actions={
              data &&
              !editing && (
                <Button onClick={() => setEditing(blankDraft(data))}>New rule</Button>
              )
            }
            related={[
              { label: 'Messaging', href: '/messaging-settings' },
              { label: 'My tasks', href: '/tasks' },
            ]}
          />
          {!data ? (
            <div className="space-y-4">
              <Skeleton className="h-24" />
              <Skeleton className="h-48" />
            </div>
          ) : editing ? (
            <RuleEditor key={editing.ruleId || 'new'} data={data} initial={editing} onClose={() => setEditing(null)} />
          ) : (
            <div className="space-y-6">
              <Settings data={data} />
              <ApprovalAlerts />
              <TabBar
                tabs={[
                  { id: 'rules', label: `Rules (${data.rules.length})` },
                  { id: 'history', label: 'Run history' },
                ]}
                active={tab}
                onChange={setTab}
              />
              {tab === 'rules' ? (
                <>
                  <Card>
                    {data.rules.length ? (
                      <ul className="divide-y divide-foam-deep -my-4">
                        {data.rules.map((r) => (
                          <RuleRow key={r._id} rule={r} data={data} onEdit={() => setEditing(draftFromRule(r))} />
                        ))}
                      </ul>
                    ) : (
                      <EmptyState
                        title="No rules yet"
                        description="Add one from a template below, or start from scratch."
                      />
                    )}
                  </Card>
                  <Templates data={data} />
                </>
              ) : (
                <RunHistory members={data.members} />
              )}
            </div>
          )}
        </FormPage>
      </Layout>
    </ProtectedRoute>
  )
}
