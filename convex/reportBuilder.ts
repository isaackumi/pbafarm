import { v } from 'convex/values'
import { internalQuery, mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id, TableNames } from './_generated/dataModel'
import { userError } from './lib/errors'
import { can, memberContextIn, requireMember, requirePermission, type MemberContext } from './lib/permissions'
import { logAudit } from './lib/tenancy'
import { todayIn } from './lib/dates'
import { orgProfile } from './lib/orgProfile'
import {
  DATASETS,
  LIMITS,
  aggregate,
  checkDefinition,
  periodLabel,
  reportColumns,
  resolveRange,
  type DimensionId,
  type Fact,
  type ReportColumn,
  type ReportDefinition,
} from './lib/reportCatalog'
import { reportDefinition, reportVisibility } from './lib/reportValidators'

/**
 * Report builder (ANLY-001). Saved report definitions over the rollups and
 * company-indexed tables (lib/reportCatalog describes the datasets). Every
 * read is company-scoped through an index and capped (LIMITS.sourceRows,
 * take(n + 1) flags truncation); site-scoped members see their sites only.
 */

type Ctx = QueryCtx | MutationCtx
type SiteScope = MemberContext['siteScope']

const cell = v.union(v.string(), v.number(), v.null())

export const reportResult = v.object({
  columns: v.array(
    v.object({
      id: v.string(),
      label: v.string(),
      kind: v.union(v.literal('dimension'), v.literal('measure')),
      format: v.optional(v.string()),
    }),
  ),
  rows: v.array(v.record(v.string(), cell)),
  /** Source rows hit LIMITS.sourceRows: totals are partial. */
  sourceTruncated: v.boolean(),
  /** More groups than the row limit. */
  rowsTruncated: v.boolean(),
  from: v.union(v.string(), v.null()),
  to: v.union(v.string(), v.null()),
  today: v.string(),
})

export type ReportResult = {
  columns: ReportColumn[]
  rows: Array<Record<string, string | number | null>>
  sourceTruncated: boolean
  rowsTruncated: boolean
  from: string | null
  to: string | null
  today: string
}

function invalid(message: string): never {
  throw userError('VALIDATION', message)
}

function inScope(scope: SiteScope, locationId: Id<'farmLocations'> | undefined): boolean {
  if (scope === 'all') return true
  return !!locationId && scope.has(locationId)
}

/** Throws unless the member may read the dataset. */
export function assertDatasetAccess(m: MemberContext, def: ReportDefinition) {
  requirePermission(m, 'reports.view')
  requirePermission(m, DATASETS[def.dataset].permission)
}

export function canReadDataset(m: MemberContext, def: ReportDefinition) {
  return can(m, 'reports.view') && can(m, DATASETS[def.dataset].permission)
}

function cap<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  return rows.length > LIMITS.sourceRows
    ? { rows: rows.slice(0, LIMITS.sourceRows), truncated: true }
    : { rows, truncated: false }
}

/** Get a document of the company by an id taken from data (never trusted blindly). */
async function companyDoc<T extends TableNames>(
  ctx: Ctx,
  table: T,
  key: string,
  companyId: Id<'companies'>,
): Promise<Doc<T> | null> {
  const id = ctx.db.normalizeId(table, key)
  if (!id) return null
  const doc = (await ctx.db.get(id)) as (Doc<T> & { companyId?: Id<'companies'> }) | null
  return doc && doc.companyId === companyId ? doc : null
}

type Loaded = { facts: Fact[]; truncated: boolean; labels: Map<string, string> }

function needs(def: ReportDefinition, dim: DimensionId) {
  return def.dimensions.includes(dim) || def.filters.some((f) => f.dimension === dim && f.values.length)
}

async function loadProduction(
  ctx: Ctx,
  companyId: Id<'companies'>,
  scope: SiteScope,
  range: { from: string; to: string },
): Promise<Loaded> {
  // Cycles active in the period: closed on/after `from` (open ones carry 9999-12-31).
  const raw = await ctx.db
    .query('batchStats')
    .withIndex('by_companyId_and_lastDate', (q) => q.eq('companyId', companyId).gte('lastDate', range.from))
    .take(LIMITS.sourceRows + 1)
  const { rows, truncated } = cap(raw)
  const facts: Fact[] = []
  for (const r of rows) {
    if (!inScope(scope, r.locationId)) continue
    if (r.kpis.opened_on && r.kpis.opened_on > range.to) continue
    const k = r.kpis
    facts.push({
      dims: {
        site: r.locationId ?? '',
        cage: r.unitId,
        species: r.speciesCode ?? '',
        batch: r.batchId,
      },
      date: k.opened_on ?? undefined,
      values: {
        live_fish: Math.max(0, k.count),
        biomass_kg: k.current_biomass_kg,
        fish_in: k.stocked_count + k.in_count,
        survivors: k.count + k.harvested_count + k.out_count,
        feed_kg: k.feed_kg,
        feed_cost: r.feedCostLedger,
        gain_kg: k.gain_kg,
        harvested_kg: k.harvested_kg,
        mortality: k.mortality,
      },
    })
  }
  const labels = new Map<string, string>()
  for (const r of rows) labels.set(`batch:${r.batchId}`, r.batchNumber)
  return { facts, truncated, labels }
}

async function loadDaily(
  ctx: Ctx,
  companyId: Id<'companies'>,
  scope: SiteScope,
  range: { from: string; to: string },
  def: ReportDefinition,
): Promise<Loaded> {
  const raw = await ctx.db
    .query('unitDailyStats')
    .withIndex('by_companyId_and_date', (q) =>
      q.eq('companyId', companyId).gte('date', range.from).lte('date', range.to),
    )
    .take(LIMITS.sourceRows + 1)
  const { rows, truncated } = cap(raw)
  const withSpecies = needs(def, 'species')
  const batches = new Map<string, Doc<'batches'> | null>()
  const labels = new Map<string, string>()
  const facts: Fact[] = []
  for (const r of rows) {
    if (!inScope(scope, r.locationId)) continue
    if (def.dataset === 'harvest' && !(r.flows.harvestedKg > 0 || r.flows.harvestedCount > 0)) continue
    let species = ''
    if (r.batchId && (withSpecies || def.dimensions.includes('batch'))) {
      const key = String(r.batchId)
      if (!batches.has(key) && batches.size < 500) {
        const b = await ctx.db.get(r.batchId)
        batches.set(key, b && b.companyId === companyId ? b : null)
      }
      const b = batches.get(key)
      species = b?.speciesCode ?? ''
      if (b) labels.set(`batch:${key}`, b.batchNumber)
    }
    facts.push({
      dims: { site: r.locationId ?? '', cage: r.unitId, batch: r.batchId ?? '', species },
      date: r.date,
      values: {
        feed_kg: r.feedKg,
        feed_cost: r.feedCostList,
        mortality: r.mortalityRecorded,
        mortality_kg: r.flows.mortalityKgEst,
        unaccounted: r.flows.unaccountedCount,
        harvested_count: r.flows.harvestedCount,
        harvested_kg: r.flows.harvestedKg,
      },
    })
  }
  return { facts, truncated, labels }
}

async function loadSales(
  ctx: Ctx,
  companyId: Id<'companies'>,
  scope: SiteScope,
  range: { from: string; to: string },
): Promise<Loaded> {
  const raw = await ctx.db
    .query('sales')
    .withIndex('by_company_and_saleDate', (q) =>
      q.eq('companyId', companyId).gte('saleDate', range.from).lte('saleDate', range.to),
    )
    .take(LIMITS.sourceRows + 1)
  const { rows, truncated } = cap(raw)
  const labels = new Map<string, string>()
  const facts: Fact[] = []
  for (const s of rows) {
    if (!inScope(scope, s.locationId)) continue
    const name = s.customerName?.trim()
    const customer = s.customerId ? String(s.customerId) : name ? `name:${name.toLowerCase()}` : ''
    if (!s.customerId && name) labels.set(`customer:${customer}`, name)
    const status = s.paymentStatus ?? 'pending'
    const paid = s.amountPaid ?? (status === 'paid' ? s.totalAmount : 0)
    facts.push({
      dims: { site: s.locationId ?? '', cage: s.cageId ?? '', customer, payment_status: status },
      date: s.saleDate,
      values: {
        weight_kg: s.weightKg,
        revenue: s.totalAmount,
        amount_paid: paid,
        outstanding: Math.max(0, s.totalAmount - paid),
      },
    })
  }
  return { facts, truncated, labels }
}

async function loadInventory(ctx: Ctx, companyId: Id<'companies'>, scope: SiteScope): Promise<Loaded> {
  const labels = new Map<string, string>()
  const facts: Fact[] = []
  const itemRaw = await ctx.db
    .query('inventoryItemStock')
    .withIndex('by_company', (q) => q.eq('companyId', companyId))
    .take(LIMITS.sourceRows + 1)
  const feedRaw = await ctx.db
    .query('feedInventory')
    .withIndex('by_company', (q) => q.eq('companyId', companyId))
    .take(LIMITS.sourceRows + 1)
  const items = cap(itemRaw)
  const feed = cap(feedRaw)
  const itemDocs = new Map<string, Doc<'inventoryItems'> | null>()
  for (const s of items.rows) {
    if (!inScope(scope, s.locationId)) continue
    const key = String(s.itemId)
    if (!itemDocs.has(key)) {
      const item = await ctx.db.get(s.itemId)
      itemDocs.set(key, item && item.companyId === companyId && !item.deletedAt ? item : null)
    }
    const item = itemDocs.get(key)
    if (!item) continue
    labels.set(`item:item:${key}`, `${item.name} (${item.unit})`)
    facts.push({
      dims: { site: s.locationId, item: `item:${key}`, category: item.category },
      values: { quantity: s.quantity, stock_value: s.quantity * (item.unitCost ?? 0) },
    })
  }
  const feedTypes = new Map<string, Doc<'feedTypes'> | null>()
  for (const f of feed.rows) {
    if (!inScope(scope, f.locationId)) continue
    const key = String(f.feedTypeId)
    if (!feedTypes.has(key)) {
      const ft = await ctx.db.get(f.feedTypeId)
      feedTypes.set(key, ft && ft.companyId === companyId ? ft : null)
    }
    const ft = feedTypes.get(key)
    if (!ft) continue
    labels.set(`item:feed:${key}`, `${ft.name} (kg)`)
    facts.push({
      dims: { site: f.locationId ?? '', item: `feed:${key}`, category: 'Feed' },
      values: { quantity: f.quantityKg, stock_value: f.quantityKg * (ft.pricePerKg ?? 0) },
    })
  }
  return { facts, truncated: items.truncated || feed.truncated, labels }
}

const PAYMENT_LABELS: Record<string, string> = { paid: 'Paid', partial: 'Partly paid', pending: 'Unpaid' }

async function labelFor(
  ctx: Ctx,
  companyId: Id<'companies'>,
  dim: DimensionId,
  key: string,
  def: ReportDefinition,
  known: Map<string, string>,
): Promise<string> {
  if (dim === 'period') return periodLabel(key, def.granularity)
  if (!key) return '—'
  const hit = known.get(`${dim}:${key}`)
  if (hit !== undefined) return hit
  switch (dim) {
    case 'site':
      return (await companyDoc(ctx, 'farmLocations', key, companyId))?.name ?? 'Unknown site'
    case 'cage':
      return (await companyDoc(ctx, 'cages', key, companyId))?.name ?? 'Unknown unit'
    case 'batch':
      return (await companyDoc(ctx, 'batches', key, companyId))?.batchNumber ?? 'Unknown batch'
    case 'customer':
      return (await companyDoc(ctx, 'customers', key, companyId))?.name ?? 'Unknown customer'
    case 'species': {
      const sp = await ctx.db
        .query('species')
        .withIndex('by_companyId_and_key', (q) => q.eq('companyId', companyId).eq('key', key))
        .first()
      return sp?.name ?? key
    }
    case 'payment_status':
      return PAYMENT_LABELS[key] ?? key
    default:
      return key
  }
}

/**
 * Run a definition for a member of `companyId` (the caller, or a schedule's
 * owner). The caller has already checked dataset access.
 */
export async function runReport(
  ctx: Ctx,
  m: MemberContext,
  companyId: Id<'companies'>,
  def: ReportDefinition,
  today: string,
): Promise<ReportResult> {
  const problem = checkDefinition(def)
  if (problem) invalid(problem)
  const ds = DATASETS[def.dataset]
  const range = ds.dated ? resolveRange(def.range, today) : null
  const scope = m.siteScope
  let loaded: Loaded
  if (def.dataset === 'production') loaded = await loadProduction(ctx, companyId, scope, range!)
  else if (def.dataset === 'sales') loaded = await loadSales(ctx, companyId, scope, range!)
  else if (def.dataset === 'inventory') loaded = await loadInventory(ctx, companyId, scope)
  else loaded = await loadDaily(ctx, companyId, scope, range!, def)

  const { rows, truncated } = aggregate(loaded.facts, def)
  const cache = new Map<string, string>()
  const out: ReportResult['rows'] = []
  for (const r of rows) {
    const row: Record<string, string | number | null> = {}
    for (const dim of def.dimensions) {
      const key = r.keys[dim] ?? ''
      const id = `${dim}:${key}`
      let label = cache.get(id)
      if (label === undefined) {
        label = await labelFor(ctx, companyId, dim, key, def, loaded.labels)
        cache.set(id, label)
      }
      row[dim] = label
    }
    for (const [mId, value] of Object.entries(r.values)) row[mId] = value
    out.push(row)
  }
  return {
    columns: reportColumns(def),
    rows: out,
    sourceTruncated: loaded.truncated,
    rowsTruncated: truncated,
    from: range?.from ?? null,
    to: range?.to ?? null,
    today,
  }
}

async function companyToday(ctx: Ctx, companyId: Id<'companies'>) {
  const company = await ctx.db.get(companyId)
  return todayIn(orgProfile(company).timezone)
}

function companyOf(m: MemberContext): Id<'companies'> {
  if (!m.companyId) throw userError('FORBIDDEN', 'Choose an organization first')
  return m.companyId
}

/** Whether the member can see a saved report (company match, then visibility). */
export function canSeeReport(m: MemberContext, r: Doc<'savedReports'>) {
  return r.companyId === m.companyId && (r.visibility === 'company' || r.createdBy === m.user._id)
}

/** Author, or an organization admin (org.settings.manage). */
export function canEditReport(m: MemberContext, r: Doc<'savedReports'>) {
  return canSeeReport(m, r) && (r.createdBy === m.user._id || can(m, 'org.settings.manage'))
}

async function visibleReport(ctx: Ctx, m: MemberContext, reportId: Id<'savedReports'>) {
  const r = await ctx.db.get(reportId)
  if (!r || !canSeeReport(m, r)) throw userError('NOT_FOUND', 'Report not found')
  return r
}

// ─── Running ────────────────────────────────────────────────────────────────

/** Run an unsaved definition (the builder's live preview). */
export const preview = query({
  args: { definition: reportDefinition },
  returns: reportResult,
  handler: async (ctx, { definition }) => {
    const m = await requireMember(ctx, { permission: 'reports.view' })
    const companyId = companyOf(m)
    assertDatasetAccess(m, definition)
    return await runReport(ctx, m, companyId, definition, await companyToday(ctx, companyId))
  },
})

export const runSaved = query({
  args: { reportId: v.id('savedReports') },
  returns: reportResult,
  handler: async (ctx, { reportId }) => {
    const m = await requireMember(ctx, { permission: 'reports.view' })
    const companyId = companyOf(m)
    const r = await visibleReport(ctx, m, reportId)
    assertDatasetAccess(m, r.definition)
    return await runReport(ctx, m, companyId, r.definition, await companyToday(ctx, companyId))
  },
})

/** Choices for the filter pickers: the member's sites, units and species (bounded). */
export const filterOptions = query({
  args: {},
  returns: v.object({
    site: v.array(v.object({ value: v.string(), label: v.string() })),
    cage: v.array(v.object({ value: v.string(), label: v.string(), site: v.optional(v.string()) })),
    species: v.array(v.object({ value: v.string(), label: v.string() })),
  }),
  handler: async (ctx) => {
    const m = await requireMember(ctx, { permission: 'reports.view' })
    const companyId = companyOf(m)
    const sites = await ctx.db
      .query('farmLocations')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .take(200)
    const cages = await ctx.db
      .query('cages')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .take(1000)
    const species = await ctx.db
      .query('species')
      .withIndex('by_companyId_and_key', (q) => q.eq('companyId', companyId))
      .take(200)
    const byName = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label)
    return {
      site: sites
        .filter((s) => inScope(m.siteScope, s._id))
        .map((s) => ({ value: String(s._id), label: s.name }))
        .sort(byName),
      cage: cages
        .filter((c) => inScope(m.siteScope, c.locationId))
        .map((c) => ({ value: String(c._id), label: c.name, site: c.locationId ? String(c.locationId) : undefined }))
        .sort(byName),
      species: species.map((s) => ({ value: s.key, label: s.name })).sort(byName),
    }
  },
})

/** Internal: run a saved report as `ownerId` for a scheduled delivery (ANLY-007). */
export const runForOwner = internalQuery({
  args: { reportId: v.id('savedReports'), ownerId: v.id('users'), companyId: v.id('companies') },
  handler: async (ctx, args): Promise<
    { ok: true; name: string; dataset: ReportDefinition['dataset']; result: ReportResult } | { ok: false; error: string }
  > => {
    const report = await ctx.db.get(args.reportId)
    if (!report || report.companyId !== args.companyId) return { ok: false, error: 'The report was deleted' }
    const owner = await ctx.db.get(args.ownerId)
    const m = owner ? await memberContextIn(ctx, owner, args.companyId) : null
    if (!m || !canSeeReport(m, report) || !canReadDataset(m, report.definition) || !can(m, 'reports.export')) {
      return { ok: false, error: 'The schedule owner can no longer run or export this report' }
    }
    try {
      const result = await runReport(ctx, m, args.companyId, report.definition, await companyToday(ctx, args.companyId))
      return { ok: true, name: report.name, dataset: report.definition.dataset, result }
    } catch (e) {
      return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }
    }
  },
})

// ─── Saved reports ──────────────────────────────────────────────────────────

const reportSummary = v.object({
  _id: v.id('savedReports'),
  name: v.string(),
  description: v.optional(v.string()),
  visibility: reportVisibility,
  definition: reportDefinition,
  createdBy: v.id('users'),
  createdByName: v.string(),
  updatedAt: v.number(),
  canEdit: v.boolean(),
})

/** Reports the caller can open: their own and the company's shared ones, readable datasets only. */
export const list = query({
  args: {},
  returns: v.array(reportSummary),
  handler: async (ctx) => {
    const m = await requireMember(ctx, { permission: 'reports.view' })
    const companyId = companyOf(m)
    const shared = await ctx.db
      .query('savedReports')
      .withIndex('by_companyId_and_visibility', (q) => q.eq('companyId', companyId).eq('visibility', 'company'))
      .take(200)
    const mine = await ctx.db
      .query('savedReports')
      .withIndex('by_companyId_and_createdBy', (q) => q.eq('companyId', companyId).eq('createdBy', m.user._id))
      .take(200)
    const seen = new Set<string>()
    const names = new Map<string, string>()
    const out = []
    for (const r of [...mine, ...shared]) {
      if (seen.has(r._id) || !canReadDataset(m, r.definition)) continue
      seen.add(r._id)
      let name = names.get(r.createdBy)
      if (name === undefined) {
        const u = await ctx.db.get(r.createdBy)
        name = (u?.name || '').trim() || u?.email || 'Former member'
        names.set(r.createdBy, name)
      }
      out.push({
        _id: r._id,
        name: r.name,
        description: r.description,
        visibility: r.visibility,
        definition: r.definition,
        createdBy: r.createdBy,
        createdByName: name,
        updatedAt: r.updatedAt,
        canEdit: canEditReport(m, r),
      })
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt)
  },
})

function cleanText(s: string | undefined, max: number) {
  const t = (s ?? '').trim()
  return t.slice(0, max)
}

/** Create (no reportId) or update a saved report. Sharing with the company needs reports.manage too. */
export const save = mutation({
  args: {
    reportId: v.optional(v.id('savedReports')),
    name: v.string(),
    description: v.optional(v.string()),
    visibility: reportVisibility,
    definition: reportDefinition,
  },
  returns: v.id('savedReports'),
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'reports.manage' })
    const companyId = companyOf(m)
    assertDatasetAccess(m, args.definition)
    const problem = checkDefinition(args.definition)
    if (problem) invalid(problem)
    const name = cleanText(args.name, LIMITS.nameLength)
    if (!name) invalid('Give the report a name')
    const description = cleanText(args.description, LIMITS.descriptionLength) || undefined
    for (const f of args.definition.filters) {
      if (f.dimension === 'site') {
        for (const s of f.values) {
          if (!(await companyDoc(ctx, 'farmLocations', s, companyId))) invalid('A filtered site is not in this organization')
        }
      }
    }
    const now = Date.now()
    if (args.reportId) {
      const r = await visibleReport(ctx, m, args.reportId)
      if (!canEditReport(m, r)) throw userError('FORBIDDEN', 'Only the author or an admin can change this report')
      await ctx.db.patch(r._id, {
        name,
        description,
        visibility: args.visibility,
        definition: args.definition,
        updatedBy: m.user._id,
        updatedAt: now,
      })
      await logAudit(ctx, {
        actionType: 'update',
        tableName: 'savedReports',
        recordId: r._id,
        previousValues: { name: r.name, visibility: r.visibility },
        newValues: { name, visibility: args.visibility, dataset: args.definition.dataset },
      })
      return r._id
    }
    const existing = await ctx.db
      .query('savedReports')
      .withIndex('by_companyId_and_createdBy', (q) => q.eq('companyId', companyId).eq('createdBy', m.user._id))
      .take(201)
    if (existing.length >= 200) invalid('You have 200 saved reports; delete some first')
    const id = await ctx.db.insert('savedReports', {
      companyId,
      name,
      description,
      visibility: args.visibility,
      definition: args.definition,
      createdBy: m.user._id,
      updatedAt: now,
    })
    await logAudit(ctx, {
      actionType: 'create',
      tableName: 'savedReports',
      recordId: id,
      newValues: { name, visibility: args.visibility, dataset: args.definition.dataset },
    })
    return id
  },
})

/** Delete a saved report and its schedules (delivery log rows stay until pruned). */
export const remove = mutation({
  args: { reportId: v.id('savedReports') },
  returns: v.null(),
  handler: async (ctx, { reportId }) => {
    const m = await requireMember(ctx, { permission: 'reports.manage' })
    const r = await visibleReport(ctx, m, reportId)
    if (!canEditReport(m, r)) throw userError('FORBIDDEN', 'Only the author or an admin can delete this report')
    const schedules = await ctx.db
      .query('reportSchedules')
      .withIndex('by_reportId', (q) => q.eq('reportId', reportId))
      .take(100)
    for (const s of schedules) await ctx.db.delete(s._id)
    await ctx.db.delete(reportId)
    await logAudit(ctx, {
      actionType: 'delete',
      tableName: 'savedReports',
      recordId: reportId,
      previousValues: { name: r.name, schedules: schedules.length },
    })
    return null
  },
})
