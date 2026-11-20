import { describe, expect, it } from 'vitest'
import { isAutomationRequest } from './anowaIntent'
import { buildDraftSystemPrompt, describeDraft, extractJson, normalizeDraft, repairMessage } from './anowaDraft'

const catalog = {
  timezone: 'Africa/Accra',
  eventTypes: [{ type: 'daily.recorded', label: 'Daily entry recorded', fields: ['cageName', 'dissolvedOxygen'] }],
  checks: [
    {
      key: 'missed_daily_entry',
      label: 'Missed daily entry',
      description: 'Active cages with no daily entry for the day',
      fields: ['count', 'cages'],
      params: [{ key: 'minDays', label: 'Days', default: 1 }],
    },
  ],
  farmRuleKeys: ['dailyMortalityAlertPct'],
  conditionOps: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_set', 'not_set'],
  channels: ['in_app', 'sms', 'whatsapp', 'email'],
  recipientRoles: ['user', 'admin'],
  maxConditions: 10,
  maxActions: 5,
}

const good = {
  name: 'Low oxygen alert',
  description: 'Warn managers',
  trigger: { kind: 'event', eventType: 'daily.recorded' },
  match: 'all',
  conditions: [{ field: 'payload.dissolvedOxygen', op: 'lt', value: 4 }],
  actions: [
    {
      kind: 'notify',
      channels: ['sms', 'in_app'],
      recipients: { roles: ['admin'] },
      title: 'Low DO in {{payload.cageName}}',
      message: 'DO is {{payload.dissolvedOxygen}}',
      level: 'warning',
    },
  ],
  explanation: 'Texts managers when a daily entry has DO below 4 mg/L.',
}

describe('isAutomationRequest', () => {
  it.each([
    'Alert the managers by SMS when dissolved oxygen drops below 4 mg/L',
    'Automate: remind feeders every morning',
    'every morning at 6 send feeders a reminder',
    'remind me to sample cages on Fridays',
    'notify admins if mortality is above 1%',
    'Create an alert for low oxygen',
    'Automatiser : alerter les responsables quand l’oxygène baisse',
    'Préviens-moi chaque matin des cages sans saisie',
  ])('routes "%s" to a draft', (text) => {
    expect(isAutomationRequest(text)).toBe(true)
  })

  it.each([
    'What was the FCR last month?',
    'Why did C-07 lose fish?',
    'How much feed did we use?',
    'Show me the harvest plan',
    'hi',
    '',
  ])('leaves "%s" as a question', (text) => {
    expect(isAutomationRequest(text)).toBe(false)
  })
})

describe('extractJson', () => {
  it('reads plain JSON, fenced JSON and JSON inside prose', () => {
    expect(extractJson(JSON.stringify(good))).toEqual(good)
    expect(extractJson('```json\n' + JSON.stringify(good) + '\n```')).toEqual(good)
    expect(extractJson('Sure! Here it is:\n' + JSON.stringify(good) + '\nHope that helps.')).toEqual(good)
  })
  it('keeps braces inside strings', () => {
    expect(extractJson('{"title":"Low {{payload.cageName}}","n":1} trailing }')).toEqual({
      title: 'Low {{payload.cageName}}',
      n: 1,
    })
  })
  it('returns null for no or broken JSON', () => {
    expect(extractJson('no json here')).toBeNull()
    expect(extractJson('{"a": ')).toBeNull()
    expect(extractJson(null)).toBeNull()
  })
})

describe('normalizeDraft', () => {
  it('keeps a valid draft and drops unknown fields', () => {
    const { draft, explanation, problems } = normalizeDraft({ ...good, extra: 1 })
    expect(problems).toEqual([])
    expect(explanation).toMatch(/Texts managers/)
    expect(draft).toEqual({
      name: good.name,
      description: good.description,
      trigger: good.trigger,
      match: 'all',
      conditions: good.conditions,
      actions: good.actions,
    })
    expect(draft).not.toHaveProperty('extra')
    expect(draft).not.toHaveProperty('explanation')
  })

  it('rejects webhooks and named people', () => {
    const r = normalizeDraft({
      ...good,
      actions: [{ kind: 'webhook', endpointId: 'x' }, { ...good.actions[0], recipients: { userIds: ['u1'] } }],
    })
    expect(r.problems).toContain('Anowa cannot add webhook actions; add them in Automations')
    expect(r.problems).toContain('Choose recipients by role or everyone, not by name')
  })

  it('drops links that leave the app', () => {
    for (const link of ['//evil.example/x', '/\\evil.example', 'https://evil.example', '/ok path']) {
      expect(normalizeDraft({ ...good, actions: [{ ...good.actions[0], link }] }).draft.actions[0]).not.toHaveProperty('link')
    }
    expect(normalizeDraft({ ...good, actions: [{ ...good.actions[0], link: '/cages?status=alert' }] }).draft.actions[0].link).toBe('/cages?status=alert')
  })

  it('reports a missing trigger and no rule', () => {
    expect(normalizeDraft({ ...good, trigger: { kind: 'sometimes' } }).draft).toBeNull()
    expect(normalizeDraft(null).problems).toEqual(['Anowa did not return a rule'])
  })

  it('keeps schedule triggers with days and params', () => {
    const { draft, problems } = normalizeDraft({
      ...good,
      trigger: { kind: 'schedule', localTime: '06:00', daysOfWeek: [1, 3, 'x'], check: 'missed_daily_entry', params: { minDays: 2, bad: {} } },
    })
    expect(problems).toEqual([])
    expect(draft.trigger).toEqual({ kind: 'schedule', localTime: '06:00', daysOfWeek: [1, 3], check: 'missed_daily_entry', params: { minDays: 2 } })
  })
})

describe('buildDraftSystemPrompt', () => {
  it('lists the catalog and the output contract', () => {
    const p = buildDraftSystemPrompt(catalog)
    expect(p).toContain('You are Anowa')
    expect(p).toContain('daily.recorded (Daily entry recorded)')
    expect(p).toContain('payload.dissolvedOxygen')
    expect(p).toContain('missed_daily_entry')
    expect(p).toContain('minDays (Days, default 1)')
    expect(p).toContain('settings.farmRules.dailyMortalityAlertPct')
    expect(p).toContain('Africa/Accra')
    expect(p).toContain('Return ONLY a JSON object')
    expect(p).toMatch(/never use webhooks/i)
  })
  it('repair turn lists the problems', () => {
    expect(repairMessage(['Time must be HH:MM'])).toContain('- Time must be HH:MM')
  })
})

describe('describeDraft', () => {
  it('puts the rule in plain words', () => {
    const w = describeDraft(normalizeDraft(good).draft, catalog)
    expect(w.trigger).toBe('When: daily entry recorded')
    expect(w.conditions).toEqual(['dissolved oxygen is below 4'])
    expect(w.actions).toEqual(['Notify managers by SMS, in the app: “Low DO in {{payload.cageName}}”'])
  })
  it('describes schedules and thresholds', () => {
    const w = describeDraft(
      {
        ...good,
        trigger: { kind: 'schedule', localTime: '06:00', daysOfWeek: [1, 5], check: 'missed_daily_entry' },
        conditions: [{ field: 'check.count', op: 'gte', valueFrom: 'settings.farmRules.dailyMortalityAlertPct' }],
        actions: [{ kind: 'create_task', recipients: { everyone: true }, title: 'Log entries', dueInHours: 4 }],
      },
      catalog,
    )
    expect(w.trigger).toBe('Every Mon, Fri at 06:00: check missed daily entry')
    expect(w.conditions).toEqual(['count is at least your daily mortality alert pct threshold'])
    expect(w.actions).toEqual(['Create a task for everyone: “Log entries”, due in 4 h'])
  })
})
