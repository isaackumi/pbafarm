import type { QueryCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import type { EffectiveSettings } from '../lib/farmRules'
import { addDays } from './schedule'

/**
 * Checks for schedule rules (docs/architecture/07 §5). A schedule rule never
 * runs an arbitrary query: it names one of these, which reads only the
 * company's indexed rows and returns a bounded summary. `count === 0` means
 * nothing to report and the run is skipped.
 *
 * Every check returns `title`, `message` and `link` already worded, so the
 * built-in templates can render exactly what the legacy daily digest sent
 * (`{{check.title}}`); custom rules can use the other fields.
 */
export type CheckResult = {
  count: number
  title: string
  message: string
  link: string
  [key: string]: string | number
}

type Params = Record<string, string | number | boolean>

type CheckDef = {
  label: string
  description: string
  /** Fields available as check.* in conditions and messages. */
  fields: string[]
  params?: { key: string; label: string; default?: number }[]
  run: (
    ctx: QueryCtx,
    companyId: Id<'companies'>,
    date: string,
    params: Params,
    settings: EffectiveSettings,
  ) => Promise<CheckResult>
}

const kg = (n: number) => Math.round(n).toLocaleString('en-US')

/** List names, but keep the message short: "B2, C1, C4 and 3 more". */
export function nameList(names: string[], max = 6) {
  if (names.length <= max) return names.join(', ')
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function num(params: Params, key: string, fallback: number) {
  const x = params[key]
  const n = typeof x === 'number' ? x : typeof x === 'string' ? Number(x) : NaN
  return Number.isFinite(n) ? n : fallback
}

const EMPTY = { count: 0, title: '', message: '', link: '' }

export const CHECKS: Record<string, CheckDef> = {
  missed_daily_entry: {
    label: 'Missed daily entry',
    description: 'Active cages with no daily entry for the day',
    fields: ['count', 'done', 'total', 'cages'],
    async run(ctx, companyId, date): Promise<CheckResult> {
      const cages = await ctx.db
        .query('cages')
        .withIndex('by_company_status', (q) => q.eq('companyId', companyId).eq('status', 'active'))
        .take(500)
      const logged = new Set(
        (
          await ctx.db
            .query('dailyRecords')
            .withIndex('by_company_and_date', (q) => q.eq('companyId', companyId).eq('date', date))
            .take(2000)
        ).map((r) => r.cageId),
      )
      const missing = cages
        .filter((c) => !logged.has(c._id))
        .sort((a, b) => a.name.localeCompare(b.name))
      if (!missing.length) return { ...EMPTY, done: logged.size, total: cages.length }
      const names = nameList(missing.map((c) => c.name))
      return {
        count: missing.length,
        done: logged.size,
        total: cages.length,
        cages: names,
        title: `Daily entry missing for ${plural(missing.length, 'cage')}`,
        message: `No feed or mortality logged on ${date} for ${names} (${logged.size} of ${cages.length} done).`,
        link: `/daily-entry?cages=${missing.map((c) => c._id).join(',')}`,
      }
    },
  },

  low_feed_stock: {
    label: 'Low feed stock',
    description: 'Feed types at or below their minimum stock',
    fields: ['count', 'items'],
    async run(ctx, companyId): Promise<CheckResult> {
      const low = (
        await ctx.db
          .query('feedTypes')
          .withIndex('by_company', (q) => q.eq('companyId', companyId))
          .take(500)
      )
        .filter(
          (f) =>
            !f.deletedAt &&
            f.active !== false &&
            (f.minimumStock ?? 0) > 0 &&
            f.currentStock <= f.minimumStock,
        )
        .sort((a, b) => a.currentStock - b.currentStock)
      if (!low.length) return EMPTY
      const items = nameList(
        low.map((f) => `${f.name} ${kg(f.currentStock)} kg left (minimum ${kg(f.minimumStock)} kg)`),
        4,
      )
      return {
        count: low.length,
        items,
        title: `Low feed stock: ${plural(low.length, 'feed type')}`,
        message: items,
        link: '/stock-levels',
      }
    },
  },

  low_item_stock: {
    label: 'Low item stock',
    description: 'Non-feed inventory items at or below their reorder level',
    fields: ['count', 'items'],
    async run(ctx, companyId): Promise<CheckResult> {
      const items = (
        await ctx.db
          .query('inventoryItems')
          .withIndex('by_company', (q) => q.eq('companyId', companyId))
          .take(500)
      ).filter((i) => !i.deletedAt && i.active && i.minimumStock > 0)
      if (!items.length) return EMPTY
      const held = new Map<string, number>()
      for (const s of await ctx.db
        .query('inventoryItemStock')
        .withIndex('by_company', (q) => q.eq('companyId', companyId))
        .take(5000)) {
        held.set(String(s.itemId), (held.get(String(s.itemId)) ?? 0) + s.quantity)
      }
      const low: { name: string; unit: string; have: number; min: number }[] = []
      for (const i of items) {
        const have = held.get(String(i._id)) ?? 0
        if (have <= i.minimumStock) low.push({ name: i.name, unit: i.unit, have, min: i.minimumStock })
      }
      if (!low.length) return EMPTY
      low.sort((a, b) => a.have / a.min - b.have / b.min)
      const list = nameList(
        low.map((i) => `${i.name} ${kg(i.have)} ${i.unit} left (minimum ${kg(i.min)} ${i.unit})`),
        4,
      )
      return {
        count: low.length,
        items: list,
        title: `Low stock: ${plural(low.length, 'item')}`,
        message: list,
        link: '/inventory/items',
      }
    },
  },

  harvest_ready_abw: {
    label: 'Harvest-ready ABW',
    description: 'Active cages whose average body weight reached the harvest target',
    fields: ['count', 'cages', 'targetAbwG'],
    params: [{ key: 'targetAbwG', label: 'Target ABW (g); blank uses the farm rule' }],
    async run(ctx, companyId, _date, params, settings): Promise<CheckResult> {
      const target = num(params, 'targetAbwG', settings.farmRules.targetHarvestAbwG ?? 0)
      if (!(target > 0)) return EMPTY
      const ready = (
        await ctx.db
          .query('cages')
          .withIndex('by_company_status', (q) => q.eq('companyId', companyId).eq('status', 'active'))
          .take(500)
      )
        .filter((c) => (c.currentWeight ?? 0) >= target)
        .sort((a, b) => a.name.localeCompare(b.name))
      if (!ready.length) return { ...EMPTY, targetAbwG: target }
      const cages = nameList(ready.map((c) => `${c.name} (${Math.round(c.currentWeight ?? 0)} g)`))
      return {
        count: ready.length,
        cages,
        targetAbwG: target,
        title: `${plural(ready.length, 'cage')} at harvest weight`,
        message: `ABW at or above ${target} g: ${cages}.`,
        link: '/harvest',
      }
    },
  },

  withdrawal_ending: {
    label: 'Withdrawal period ending',
    description: 'Treatments whose withdrawal period ends within the next days',
    fields: ['count', 'treatments', 'days'],
    params: [{ key: 'days', label: 'Days ahead', default: 3 }],
    async run(ctx, companyId, date, params): Promise<CheckResult> {
      const days = Math.max(0, Math.min(30, Math.round(num(params, 'days', 3))))
      const until = addDays(date, days)
      const rows = await ctx.db
        .query('healthTreatments')
        .withIndex('by_company_and_withdrawalUntil', (q) =>
          q.eq('companyId', companyId).gte('withdrawalUntil', date).lte('withdrawalUntil', until),
        )
        .take(100)
      if (!rows.length) return { ...EMPTY, days }
      const names = new Map<string, string>()
      for (const r of rows) {
        if (!names.has(String(r.cageId))) {
          const cage = await ctx.db.get(r.cageId)
          names.set(String(r.cageId), cage?.name ?? 'cage')
        }
      }
      const treatments = nameList(
        rows.map(
          (r) => `${names.get(String(r.cageId))}: ${r.productName || r.treatment} until ${r.withdrawalUntil}`,
        ),
        4,
      )
      return {
        count: rows.length,
        days,
        treatments,
        title: `Withdrawal ending for ${plural(rows.length, 'treatment')}`,
        message: `Within ${days} days: ${treatments}.`,
        link: '/health',
      }
    },
  },
}

export function checkExists(key: string) {
  return Object.prototype.hasOwnProperty.call(CHECKS, key)
}
