// lib/anowaDraft.js — Anowa automation drafts (AI-AUTO-001).
//
// Pure helpers shared by the Next route (pages/api/llm/automation-draft.js)
// and the chat card (components/AiAssistant.js):
// - buildDraftSystemPrompt: the catalog from automation.rules.draftCatalog
//   plus strict output rules matching convex/automation/validators.ts;
// - extractJson / normalizeDraft: tolerant parsing and a shape check with
//   problems a person (or the model, on the repair turn) can act on;
// - describeDraft: the trigger, conditions and actions in plain words.

export const MAX_REQUEST_CHARS = 1000

const OPS_WORDS = {
  eq: 'is',
  neq: 'is not',
  gt: 'is above',
  gte: 'is at least',
  lt: 'is below',
  lte: 'is at most',
  is_set: 'is recorded',
  not_set: 'is missing',
}
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const CHANNEL_WORDS = { in_app: 'in the app', sms: 'SMS', whatsapp: 'WhatsApp', email: 'email' }

/** The system prompt for a draft: what exists, and the exact JSON to return. */
export function buildDraftSystemPrompt(catalog) {
  const events = catalog.eventTypes
    .map((e) => `- ${e.type} (${e.label}). Fields: ${e.fields.map((f) => `payload.${f}`).join(', ')}`)
    .join('\n')
  const checks = catalog.checks
    .map((c) => {
      const params = c.params.length
        ? ` Params: ${c.params.map((p) => `${p.key} (${p.label}${p.default !== undefined ? `, default ${p.default}` : ''})`).join(', ')}.`
        : ''
      return `- ${c.key} (${c.label}: ${c.description}). Fields: ${c.fields.map((f) => `check.${f}`).join(', ')}.${params}`
    })
    .join('\n')
  const rules = catalog.farmRuleKeys.map((k) => `settings.farmRules.${k}`).join(', ')
  return `You are Anowa, the assistant in the Anowa fish farm app. Turn the user's request into ONE automation rule.

Return ONLY a JSON object, no prose and no code fences:
{
  "name": string (max 100 chars),
  "description": string,
  "trigger": {"kind":"event","eventType":<event>} OR {"kind":"schedule","localTime":"HH:MM","daysOfWeek":[0-6] (optional, 0=Sunday; omit for every day),"check":<check>,"params":{...} (optional)},
  "match": "all" | "any",
  "conditions": [{"field": <path>, "op": one of ${catalog.conditionOps.join('|')}, "value": number|string|boolean} or {"field": <path>, "op": ..., "valueFrom": <path>}] (max ${catalog.maxConditions}),
  "actions": [
    {"kind":"notify","channels":[one or more of ${catalog.channels.join('|')}],"recipients":{"everyone":true} or {"roles":[${catalog.recipientRoles.map((r) => `"${r}"`).join(', ')}]},"title":string,"message":string,"level":"info"|"warning"|"error","link":"/app/path" (optional)}
    or {"kind":"create_task","recipients":{...},"title":string,"description":string,"dueInHours":number}
  ] (1 to ${catalog.maxActions}),
  "explanation": one or two sentences for the user saying what the rule does
}

Rules:
- Use only the events, checks and fields listed here. Event rules compare payload.* fields; schedule rules compare check.* fields. Compare with a company threshold using "valueFrom": "settings.farmRules.<key>".
- Times are in the farm's time zone (${catalog.timezone}). Use 24-hour HH:MM.
- Recipients are "everyone" or roles only; "admin" means managers and owners, "user" means field staff. Never name people, never use webhooks.
- Messages may use {{placeholders}} from the same paths, e.g. {{payload.cageName}}, {{check.message}}.
- If the request cannot be built from this catalog, still return the closest rule and say what is missing in "explanation".

Events:
${events}

Schedule checks:
${checks}

Company thresholds: ${rules}`
}

/** The first JSON object in a model reply (code fences and prose tolerated), or null. */
export function extractJson(text) {
  if (typeof text !== 'string') return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fenced ? fenced[1] : text).trim()
  const start = body.indexOf('{')
  if (start < 0) return null
  // Walk to the matching brace (strings may contain braces).
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < body.length; i += 1) {
    const ch = body[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(body.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const str = (x, max) => (typeof x === 'string' ? x.slice(0, max) : undefined)

function cleanRecipients(r, problems, i) {
  if (!isObj(r)) {
    problems.push(`Action ${i + 1} needs recipients`)
    return { everyone: true }
  }
  if (Array.isArray(r.userIds) && r.userIds.length) problems.push('Choose recipients by role or everyone, not by name')
  const out = {}
  if (r.everyone === true) out.everyone = true
  if (Array.isArray(r.roles)) {
    const roles = r.roles.filter((x) => x === 'user' || x === 'admin')
    if (roles.length) out.roles = [...new Set(roles)]
  }
  if (!out.everyone && !out.roles) problems.push(`Action ${i + 1} needs recipients (everyone or a role)`)
  return out
}

function cleanAction(a, problems, i) {
  if (!isObj(a)) {
    problems.push(`Action ${i + 1} is not an object`)
    return null
  }
  if (a.kind === 'webhook') {
    problems.push('Anowa cannot add webhook actions; add them in Automations')
    return null
  }
  if (a.kind === 'notify') {
    const channels = Array.isArray(a.channels)
      ? [...new Set(a.channels.filter((c) => ['in_app', 'sms', 'whatsapp', 'email'].includes(c)))]
      : []
    if (!channels.length) problems.push(`Action ${i + 1}: choose at least one channel`)
    const out = {
      kind: 'notify',
      channels: channels.length ? channels : ['in_app'],
      recipients: cleanRecipients(a.recipients, problems, i),
      title: str(a.title, 200) || '',
      message: str(a.message, 1000) || '',
    }
    if (['info', 'warning', 'error'].includes(a.level)) out.level = a.level
    // In-app paths only: '//host' and backslashes would leave the app.
    if (typeof a.link === 'string' && /^\/(?![/\\])[^\s\\]*$/.test(a.link)) out.link = a.link.slice(0, 300)
    if (!out.title.trim()) problems.push(`Action ${i + 1} needs a title`)
    return out
  }
  if (a.kind === 'create_task') {
    const out = {
      kind: 'create_task',
      recipients: cleanRecipients(a.recipients, problems, i),
      title: str(a.title, 200) || '',
    }
    if (typeof a.description === 'string' && a.description.trim()) out.description = a.description.slice(0, 2000)
    if (typeof a.dueInHours === 'number' && Number.isFinite(a.dueInHours)) out.dueInHours = a.dueInHours
    if (!out.title.trim()) problems.push(`Action ${i + 1} needs a title`)
    return out
  }
  problems.push(`Action ${i + 1} must be "notify" or "create_task"`)
  return null
}

function cleanCondition(c, problems, i) {
  if (!isObj(c) || typeof c.field !== 'string' || typeof c.op !== 'string') {
    problems.push(`Condition ${i + 1} needs a field and an op`)
    return null
  }
  const out = { field: c.field, op: c.op }
  if (['string', 'number', 'boolean'].includes(typeof c.value)) out.value = c.value
  if (typeof c.valueFrom === 'string') out.valueFrom = c.valueFrom
  return out
}

function cleanTrigger(t, problems) {
  if (isObj(t) && t.kind === 'event' && typeof t.eventType === 'string') {
    return { kind: 'event', eventType: t.eventType }
  }
  if (isObj(t) && t.kind === 'schedule' && typeof t.localTime === 'string' && typeof t.check === 'string') {
    const out = { kind: 'schedule', localTime: t.localTime, check: t.check }
    if (Array.isArray(t.daysOfWeek) && t.daysOfWeek.length) {
      out.daysOfWeek = t.daysOfWeek.filter((d) => Number.isInteger(d))
    }
    if (isObj(t.params)) {
      const params = {}
      for (const [k, v] of Object.entries(t.params)) {
        if (['string', 'number', 'boolean'].includes(typeof v)) params[k] = v
      }
      if (Object.keys(params).length) out.params = params
    }
    return out
  }
  problems.push('The trigger must be an event or a schedule with a time and a check')
  return null
}

/**
 * The parsed model output reduced to exactly the fields
 * automation.rules.save / checkDraft accept, plus shape problems.
 * `draft` is null when it cannot be repaired into that shape.
 */
export function normalizeDraft(raw) {
  const problems = []
  if (!isObj(raw)) return { draft: null, explanation: '', problems: ['Anowa did not return a rule'] }
  const trigger = cleanTrigger(raw.trigger, problems)
  const conditions = (Array.isArray(raw.conditions) ? raw.conditions : [])
    .map((c, i) => cleanCondition(c, problems, i))
    .filter(Boolean)
  const actions = (Array.isArray(raw.actions) ? raw.actions : [])
    .map((a, i) => cleanAction(a, problems, i))
    .filter(Boolean)
  if (!actions.length && !problems.some((p) => /webhook/.test(p))) problems.push('Add at least one action')
  const name = (str(raw.name, 100) || '').trim()
  if (!name) problems.push('The rule needs a name')
  const draft = trigger
    ? {
        name: name || 'Anowa rule',
        ...(typeof raw.description === 'string' && raw.description.trim()
          ? { description: raw.description.trim().slice(0, 500) }
          : {}),
        trigger,
        match: raw.match === 'any' ? 'any' : 'all',
        conditions,
        actions,
      }
    : null
  return { draft, explanation: str(raw.explanation, 600) || '', problems }
}

function pathLabel(path, catalog) {
  const parts = String(path).split('.')
  const root = parts[0]
  // The last segment names the value: payload.dissolvedOxygen → "dissolved oxygen".
  const key = parts.length > 1 ? parts[parts.length - 1] : ''
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase()
  if (root === 'settings') return `your ${words} threshold`
  if (root === 'check' && catalog) return words
  return words || path
}

function formatValue(v) {
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  return String(v)
}

function recipientsText(r) {
  if (!r) return 'nobody'
  if (r.everyone) return 'everyone'
  const roles = (r.roles || []).map((x) => (x === 'admin' ? 'managers' : 'field staff'))
  return roles.length ? roles.join(' and ') : 'nobody'
}

/** Plain-language lines for the draft card. */
export function describeDraft(draft, catalog) {
  if (!draft) return { trigger: '', conditions: [], actions: [] }
  const t = draft.trigger
  let trigger
  if (t.kind === 'event') {
    const e = catalog?.eventTypes?.find((x) => x.type === t.eventType)
    trigger = `When: ${e ? e.label.toLowerCase() : t.eventType}`
  } else {
    const c = catalog?.checks?.find((x) => x.key === t.check)
    const days = t.daysOfWeek?.length ? t.daysOfWeek.map((d) => DAY_NAMES[d] ?? d).join(', ') : 'every day'
    trigger = `Every ${days === 'every day' ? 'day' : days} at ${t.localTime}: check ${c ? c.label.toLowerCase() : t.check}`
  }
  const conditions = (draft.conditions || []).map((c) => {
    const op = OPS_WORDS[c.op] || c.op
    if (c.op === 'is_set' || c.op === 'not_set') return `${pathLabel(c.field, catalog)} ${op}`
    const right = c.valueFrom ? pathLabel(c.valueFrom, catalog) : formatValue(c.value)
    return `${pathLabel(c.field, catalog)} ${op} ${right}`
  })
  const actions = (draft.actions || []).map((a) => {
    if (a.kind === 'notify') {
      const ch = a.channels.map((c) => CHANNEL_WORDS[c] || c).join(', ')
      return `Notify ${recipientsText(a.recipients)} by ${ch}: “${a.title}”`
    }
    if (a.kind === 'create_task') {
      const due = typeof a.dueInHours === 'number' ? `, due in ${a.dueInHours} h` : ''
      return `Create a task for ${recipientsText(a.recipients)}: “${a.title}”${due}`
    }
    return a.kind
  })
  return {
    trigger,
    conditions,
    actions,
    match: draft.match === 'any' && conditions.length > 1 ? 'any' : 'all',
  }
}

/** The repair turn: the problems, and a request for the full JSON again. */
export function repairMessage(problems) {
  return `That rule has problems:\n${problems.map((p) => `- ${p}`).join('\n')}\nFix them and return the complete JSON object again, nothing else.`
}
