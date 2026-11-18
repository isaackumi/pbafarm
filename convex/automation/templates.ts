import type {
  AutomationAction,
  AutomationCondition,
  AutomationTrigger,
} from './validators'

/**
 * Rule templates (AUTO-006, docs/architecture/07 §9). Creating a rule from a
 * template copies it into `automationRules` with `templateKey`; the company
 * can then edit it like any other rule.
 *
 * The three `builtIn` templates are the legacy daily digest
 * (convex/reminders.ts) expressed as rules: same time (16:00, company zone,
 * default UTC = Accra), same recipients, same wording and the same in-app
 * dedupe keys, so a company moved onto the engine sees exactly the same
 * notifications and never a duplicate of one the legacy cron already sent.
 */
export type RuleTemplate = {
  key: string
  name: string
  description: string
  builtIn?: boolean
  trigger: AutomationTrigger
  match?: 'all' | 'any'
  conditions: AutomationCondition[]
  actions: AutomationAction[]
}

const ADMINS = { roles: ['admin' as const] }

export const TEMPLATES: RuleTemplate[] = [
  {
    key: 'missed_daily_entry',
    name: 'Missed daily entry',
    description: 'At 16:00, remind everyone about active cages with no daily entry today.',
    builtIn: true,
    trigger: { kind: 'schedule', localTime: '16:00', check: 'missed_daily_entry' },
    conditions: [],
    actions: [
      {
        kind: 'notify',
        channels: ['in_app'],
        recipients: { everyone: true },
        title: '{{check.title}}',
        message: '{{check.message}}',
        link: '{{check.link}}',
        level: 'warning',
        dedupeKey: 'missed-entry:{{date}}:{{userId}}',
      },
    ],
  },
  {
    key: 'low_feed_stock',
    name: 'Low feed stock',
    description: 'At 16:00, tell admins which feed types are at or below their minimum.',
    builtIn: true,
    trigger: { kind: 'schedule', localTime: '16:00', check: 'low_feed_stock' },
    conditions: [],
    actions: [
      {
        kind: 'notify',
        channels: ['in_app'],
        recipients: ADMINS,
        title: '{{check.title}}',
        message: '{{check.message}}',
        link: '{{check.link}}',
        level: 'warning',
        dedupeKey: 'low-stock:{{date}}:{{userId}}',
      },
    ],
  },
  {
    key: 'low_item_stock',
    name: 'Low item stock',
    description: 'At 16:00, tell admins which inventory items are at or below their reorder level.',
    builtIn: true,
    trigger: { kind: 'schedule', localTime: '16:00', check: 'low_item_stock' },
    conditions: [],
    actions: [
      {
        kind: 'notify',
        channels: ['in_app'],
        recipients: ADMINS,
        title: '{{check.title}}',
        message: '{{check.message}}',
        link: '{{check.link}}',
        level: 'warning',
        dedupeKey: 'low-items:{{date}}:{{userId}}',
      },
    ],
  },
  {
    key: 'high_mortality',
    name: 'High mortality',
    description:
      'When a daily entry crosses the daily or cumulative mortality alert in farm rules, alert admins. Replaces the built-in mortality alert while enabled.',
    trigger: { kind: 'event', eventType: 'daily.recorded' },
    match: 'any',
    conditions: [
      { field: 'payload.dailyMortalityPct', op: 'gte', valueFrom: 'settings.farmRules.dailyMortalityAlertPct' },
      {
        field: 'payload.cumulativeMortalityPct',
        op: 'gte',
        valueFrom: 'settings.farmRules.cumulativeMortalityAlertPct',
      },
    ],
    actions: [
      {
        kind: 'notify',
        channels: ['in_app'],
        recipients: ADMINS,
        title: 'Mortality alert: {{payload.cageName}}',
        message:
          '{{payload.mortality}} dead on {{payload.date}}: daily {{payload.dailyMortalityPct}}% (alert at {{settings.farmRules.dailyMortalityAlertPct}}%), cumulative {{payload.cumulativeMortalityPct}}% (alert at {{settings.farmRules.cumulativeMortalityAlertPct}}%).',
        link: '/daily-entry',
        level: 'warning',
      },
    ],
  },
  {
    key: 'low_dissolved_oxygen',
    name: 'Low dissolved oxygen',
    description: 'When a daily entry records DO below 4 mg/L, alert admins.',
    trigger: { kind: 'event', eventType: 'daily.recorded' },
    conditions: [{ field: 'payload.dissolvedOxygen', op: 'lt', value: 4 }],
    actions: [
      {
        kind: 'notify',
        channels: ['in_app'],
        recipients: ADMINS,
        title: 'Low DO: {{payload.cageName}}',
        message: 'Dissolved oxygen {{payload.dissolvedOxygen}} mg/L on {{payload.date}}.',
        link: '/daily-data',
        level: 'error',
      },
    ],
  },
  {
    key: 'harvest_ready_abw',
    name: 'Harvest-ready ABW',
    description: 'Each Monday at 07:00, list active cages at or above the harvest weight in farm rules.',
    trigger: { kind: 'schedule', localTime: '07:00', daysOfWeek: [1], check: 'harvest_ready_abw' },
    conditions: [],
    actions: [
      {
        kind: 'notify',
        channels: ['in_app'],
        recipients: ADMINS,
        title: '{{check.title}}',
        message: '{{check.message}}',
        link: '{{check.link}}',
        level: 'info',
      },
    ],
  },
  {
    key: 'withdrawal_ending',
    name: 'Withdrawal period ending',
    description: 'Each day at 07:00, list treatments whose withdrawal period ends in the next 3 days.',
    trigger: {
      kind: 'schedule',
      localTime: '07:00',
      check: 'withdrawal_ending',
      params: { days: 3 },
    },
    conditions: [],
    actions: [
      {
        kind: 'notify',
        channels: ['in_app'],
        recipients: ADMINS,
        title: '{{check.title}}',
        message: '{{check.message}}',
        link: '{{check.link}}',
        level: 'info',
      },
    ],
  },
]

export const BUILT_IN_KEYS = TEMPLATES.filter((t) => t.builtIn).map((t) => t.key)

export function templateByKey(key: string) {
  return TEMPLATES.find((t) => t.key === key) ?? null
}

/**
 * Events rules can listen to, with the payload fields they carry (shown in
 * the rule editor as condition fields and {{placeholders}}).
 */
export const EVENT_TYPES: { type: string; label: string; fields: string[] }[] = [
  {
    type: 'daily.recorded',
    label: 'Daily entry recorded',
    fields: [
      'cageName',
      'date',
      'mortality',
      'dailyMortalityPct',
      'cumulativeMortalityPct',
      'feedAmount',
      'dissolvedOxygen',
      'temperatureC',
      'secchiCm',
    ],
  },
  {
    type: 'sampling.recorded',
    label: 'Sampling recorded',
    fields: ['date', 'lines', 'cageName', 'averageBodyWeight'],
  },
  {
    type: 'sensor.readings.recorded',
    label: 'Sensor readings received',
    fields: ['readings', 'cageNames', 'minDissolvedOxygen', 'maxTemperatureC'],
  },
  {
    type: 'inventory.stock.low',
    label: 'Feed stock fell to its minimum',
    fields: ['feedTypeName', 'stockKg', 'minimumKg'],
  },
  ...['stock_in', 'mortality', 'transfer_in', 'transfer_out', 'harvest', 'grading_split', 'merge', 'count_adjustment', 'reversal'].map(
    (t) => ({
      type: `stock.${t}`,
      label: `Stock ledger: ${t.replace(/_/g, ' ')}`,
      fields: ['eventCount', 'qtyDelta', 'biomassKgDelta', 'eventDate', 'unitNames'],
    }),
  ),
]
