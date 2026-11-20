/**
 * Ask Anowa "does it for you" (spec docs/plans/2026-11-20-voice-actions-cycle-planner.md §2).
 *
 * The web assistant's tools only ever create draft items: rows in
 * `pendingBotActions` with channel 'web' and a shared `draftGroup` (one draft
 * card). Nothing is written to farm records until the member taps Confirm:
 *
 * - `confirm` re-checks, per item, the member's permission and site scope
 *   (the same checks as the forms), skips items they may not do, and writes
 *   the rest through the forms' own helpers in ONE transaction. An
 *   idempotencyKeys row per item plus the item status make it once-only.
 * - Drafts expire after 24 h; Undo is open for 10 minutes after confirm.
 * - Typed payloads only: no free text from the model reaches a record
 *   except a task title and notes, which are trimmed and capped.
 */
import { v, type Infer } from 'convex/values'
import { internalMutation, mutation, query } from '../_generated/server'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { can, requireMember, type Permission } from '../lib/permissions'
import { userError } from '../lib/errors'
import { addDays } from '../lib/dates'
import { round } from '../lib/kpi'
import { siteStock } from '../lib/feedLedger'
import { feedOrderQuantity, ORDER_COVER_DAYS } from '../lib/feedOrder'
import { saveDailyBatch, removeDailyRecordAs } from '../dailyRecords'
import { recordOutboundUsageAs } from '../feed'
import { reverseTransactionAs } from '../inventory'
import { createPurchaseOrderAs } from '../procurement'
import { createTaskAs } from '../tasks'
import { cageRation, tablesFor } from '../feedingPlans'
import { logAudit } from '../lib/tenancy'
import { actAsSessionOf } from '../lib/actAs'
import { isActiveMember } from '../teams'
import { pendingPayload } from '../bot/tables'
import {
  DRAFT_TTL_MS,
  UNDO_WINDOW_MS,
  buildProposal,
  feedTypesOf,
  matchFeedType,
  proposalInput,
} from '../bot/pending'
import { farmDate, inScope, matchUnit, unitsInScope } from '../bot/scope'
import { anowaCtx, assertNotSupportAccess, webMember, type WebMember } from './scope'
import { buildKeeper, commitKeeper, keeperItemProblem, keeperUndoable, undoKeeper } from '../keepers/drafts'
import {
  isKeeperKind,
  keeperAssignInput,
  keeperCoverInput,
  keeperNudgeInput,
  keeperRebalanceInput,
} from '../keepers/validators'
import { addCostAs, addMilestoneAs, createProjectAs, removeCostAs, removeMilestoneAs, removeProjectAs } from '../projects'
import {
  buildProjectProposal,
  isProjectKind,
  projectCostInput,
  projectCreateInput,
  projectItemProblem,
  projectMilestoneInput,
} from './projects'
import {
  FARM_PERMISSION,
  FARM_REFUSAL,
  buildFarmProposal,
  commitFarm,
  farmItemProblem,
  farmProposalInputs,
  farmRefusal,
  isFarmKind,
  type FarmProposalInput,
} from './farmDrafts'

/** Items one draft card may hold. */
export const MAX_ITEMS_PER_DRAFT = 5
const MAX_TITLE = 200
const MAX_NOTES = 500

export const purchaseOrderInput = v.object({
  kind: v.literal('purchase_order'),
  feedType: v.optional(v.string()),
  units: v.optional(v.array(v.string())),
  days: v.optional(v.number()),
  supplier: v.optional(v.string()),
  notes: v.optional(v.string()),
})

export const taskInput = v.object({
  kind: v.literal('task'),
  title: v.string(),
  unit: v.optional(v.string()),
  dueInDays: v.optional(v.number()),
  assignee: v.optional(v.string()),
  notes: v.optional(v.string()),
})

export const webProposalInput = v.union(
  proposalInput,
  purchaseOrderInput,
  taskInput,
  keeperAssignInput,
  keeperRebalanceInput,
  keeperCoverInput,
  keeperNudgeInput,
  projectCreateInput,
  projectMilestoneInput,
  projectCostInput,
  ...farmProposalInputs,
)
/** What a keeper screen may draft without the assistant (no model involved). */
export const keeperProposalInput = v.union(keeperAssignInput, keeperRebalanceInput, keeperCoverInput, keeperNudgeInput)
export type WebProposalInput = Infer<typeof webProposalInput>

type Payload = Doc<'pendingBotActions'>['payload']
type Built = {
  ok: true
  payload: Payload
  siteId: Id<'farmLocations'> | undefined
  date: string
  summary: string
  fingerprint: string
}
type Failed = { ok: false; error: string }

/** What each kind needs; the same permission the matching form checks. */
export const PERMISSION: Record<Payload['kind'], Permission> = {
  daily_entry: 'production.daily.record',
  feed_issue: 'inventory.issue',
  purchase_order: 'inventory.purchase.record',
  task: 'automation.manage',
  keeper_assign: 'production.keepers.manage',
  keeper_cover: 'production.keepers.manage',
  keeper_nudge: 'production.keepers.manage',
  project_create: 'projects.manage',
  project_milestone: 'projects.manage',
  project_cost: 'projects.manage',
  ...FARM_PERMISSION,
}

const REFUSAL: Record<Payload['kind'], string> = {
  daily_entry: 'Your role cannot record daily entries.',
  feed_issue: 'Your role cannot issue feed.',
  purchase_order: 'Your role cannot create purchase orders.',
  task: 'Your role cannot assign tasks.',
  keeper_assign: 'Your role cannot assign cage keepers.',
  keeper_cover: 'Your role cannot plan cover.',
  keeper_nudge: 'Your role cannot nudge keepers.',
  project_create: 'Your role cannot create projects.',
  project_milestone: 'Your role cannot change projects.',
  project_cost: 'Your role cannot log project costs.',
  ...FARM_REFUSAL,
}

/** Why the member's role may not do this item, or null (a farm approval depends on what it approves). */
function roleRefusal(w: WebMember, p: Payload): string | null {
  if (isFarmKind(p.kind)) return farmRefusal(w, p)
  return can(w.member, PERMISSION[p.kind]) ? null : REFUSAL[p.kind]
}

const trimTo = (s: string | undefined, n: number) => s?.trim().slice(0, n) || undefined

function unitError(typed: string, candidates: string[]): Failed {
  return {
    ok: false,
    error: candidates.length ? `Which unit? Matches: ${candidates.join(', ')}` : `No unit called "${typed.slice(0, 40)}" in your sites.`,
  }
}

/** The feed type a unit was last fed. */
async function lastFeedType(ctx: QueryCtx, cageId: Id<'cages'>) {
  const rows = await ctx.db
    .query('dailyRecords')
    .withIndex('by_cage_date', (q) => q.eq('cageId', cageId))
    .order('desc')
    .take(10)
  return rows.find((r) => r.feedTypeId)?.feedTypeId
}

/**
 * Purchase order for the feed the units will eat in the next N days:
 * feeding-plan ration × days, summed over units, minus the site's stock,
 * rounded up to whole bags (lib/feedOrder).
 */
async function buildPurchaseOrder(
  ctx: MutationCtx,
  w: WebMember,
  input: Infer<typeof purchaseOrderInput>,
): Promise<Built | Failed> {
  const companyId = w.binding.companyId
  const types = (await feedTypesOf(ctx, companyId)).filter((f) => f.active)
  if (!types.length) return { ok: false, error: 'No feed types are set up yet.' }
  const all = await unitsInScope(ctx, w)
  let units: Doc<'cages'>[]
  if (input.units?.length) {
    units = []
    for (const typed of input.units.slice(0, 50)) {
      const m = matchUnit(all, typed)
      if (!m.unit) return unitError(typed, m.candidates)
      if (!units.some((u) => u._id === m.unit!._id)) units.push(m.unit)
    }
  } else {
    units = all.filter((u) => u.status === 'active' || u.status === 'harvesting')
  }
  if (!units.length) return { ok: false, error: 'No stocked units in your sites to order feed for.' }

  const last = new Map<string, Id<'feedTypes'> | undefined>()
  for (const u of units) last.set(String(u._id), await lastFeedType(ctx, u._id))
  let feedType: Doc<'feedTypes'> | null = null
  if (input.feedType) {
    feedType = matchFeedType(types, input.feedType)
  } else {
    const counts = new Map<string, number>()
    for (const id of last.values()) if (id) counts.set(String(id), (counts.get(String(id)) ?? 0) + 1)
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    feedType = types.find((f) => String(f._id) === top) ?? (types.length === 1 ? types[0] : null)
  }
  if (!feedType) return { ok: false, error: `Which feed type? Options: ${types.slice(0, 10).map((f) => f.name).join(', ')}` }

  // Units named by the user count whole; otherwise only units on this feed (or not fed yet).
  const counted = input.units?.length
    ? units
    : units.filter((u) => {
        const id = last.get(String(u._id))
        return !id || id === feedType!._id
      })
  const tables = await tablesFor(ctx, companyId)
  const dailyKg: number[] = []
  for (const u of counted) {
    const r = await cageRation(ctx, u, tables)
    if (r.ration.ok) dailyKg.push(r.ration.kgPerDay)
  }
  if (!dailyKg.length) {
    return {
      ok: false,
      error: 'The feeding plan cannot work out a ration for these units (no fish count, ABW or species). Ask the user to enter the quantity in the purchase order form.',
    }
  }

  const sites = new Set(counted.map((u) => u.locationId).filter(Boolean))
  const siteId = w.site?._id ?? (sites.size === 1 ? [...sites][0] : undefined)
  const stock = siteId ? (await siteStock(ctx, feedType, siteId)).available : feedType.currentStock || 0
  const days = input.days != null && Number.isInteger(input.days) && input.days >= 1 && input.days <= 60 ? input.days : ORDER_COVER_DAYS
  const order = feedOrderQuantity({ dailyKg, stockKg: stock, days, bagKg: feedType.bagSizeKg })
  if (order.bags === 0) {
    return {
      ok: false,
      error: `No order needed: ${order.stockKg} kg of ${feedType.name} on hand covers the ${order.needKg} kg the next ${days} days need.`,
    }
  }

  const suppliers = (
    await ctx.db
      .query('feedSuppliers')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .take(200)
  ).filter((s) => !s.deletedAt)
  let supplier: Doc<'feedSuppliers'> | null = null
  if (input.supplier) {
    const key = input.supplier.toLowerCase().replace(/[^a-z0-9]/g, '')
    const hits = suppliers.filter((s) => s.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(key))
    supplier = key && hits.length === 1 ? hits[0] : null
  } else {
    supplier = suppliers.find((s) => s._id === feedType!.supplierId) ?? (suppliers.length === 1 ? suppliers[0] : null)
  }
  if (!supplier) {
    return {
      ok: false,
      error: suppliers.length
        ? `Which supplier? Options: ${suppliers.slice(0, 10).map((s) => s.name).join(', ')}`
        : 'No feed suppliers are set up yet; add one under Feed suppliers first.',
    }
  }

  const date = await farmDate(ctx, w, siteId, Date.now())
  const payload: Payload = {
    kind: 'purchase_order',
    feedTypeId: feedType._id,
    feedTypeName: feedType.name,
    supplierId: supplier._id,
    supplierName: supplier.name,
    quantityKg: order.quantityKg,
    bags: order.bags,
    bagKg: order.bagKg,
    pricePerKg: feedType.pricePerKg || 0,
    days: order.days,
    needKg: order.needKg,
    stockKg: order.stockKg,
    units: dailyKg.length,
    notes: trimTo(input.notes, MAX_NOTES),
  }
  return {
    ok: true,
    payload,
    siteId,
    date,
    summary: `Purchase order: ${order.quantityKg} kg ${feedType.name} (${order.bags} bags) from ${supplier.name}; ${order.needKg} kg needed for ${days} days, ${round(order.stockKg, 1)} kg on hand.`,
    fingerprint: `po|${feedType._id}|${date}|${order.quantityKg}`,
  }
}

async function buildTask(ctx: MutationCtx, w: WebMember, input: Infer<typeof taskInput>): Promise<Built | Failed> {
  const title = input.title.trim().replace(/\s+/g, ' ')
  if (!title || title.length > MAX_TITLE) return { ok: false, error: 'A task needs a short title (up to 200 characters).' }
  let cage: Doc<'cages'> | null = null
  if (input.unit) {
    const m = matchUnit(await unitsInScope(ctx, w), input.unit)
    if (!m.unit) return unitError(input.unit, m.candidates)
    cage = m.unit
  }
  const siteId = cage?.locationId ?? w.site?._id
  const today = await farmDate(ctx, w, siteId, Date.now())
  const dueIn = input.dueInDays
  if (dueIn != null && !(Number.isInteger(dueIn) && dueIn >= 0 && dueIn <= 365)) {
    return { ok: false, error: 'dueInDays must be a whole number from 0 to 365.' }
  }
  const dueDate = dueIn != null ? addDays(today, dueIn) : undefined

  // Assignee: a named active member of the organization, else the user.
  const companyId = w.binding.companyId
  let assignee: Doc<'users'> = w.account
  if (input.assignee?.trim()) {
    const key = input.assignee.trim().toLowerCase()
    const rows = await ctx.db
      .query('memberships')
      .withIndex('by_companyId_and_userId', (q) => q.eq('companyId', companyId))
      .take(500)
    const people: Doc<'users'>[] = []
    for (const r of rows) {
      if (r.status !== 'active') continue
      const u = await ctx.db.get(r.userId)
      if (u && u.active !== false && !u.deletedAt && (u.name ?? '').toLowerCase().includes(key)) people.push(u)
    }
    if (people.length !== 1) {
      return {
        ok: false,
        error: people.length
          ? `Which person? Matches: ${people.slice(0, 8).map((p) => p.name).join(', ')}`
          : `No active member called "${input.assignee.slice(0, 40)}".`,
      }
    }
    assignee = people[0]
  }
  if (!(await isActiveMember(ctx, companyId, assignee._id))) return { ok: false, error: 'The assignee is not an active member.' }

  const payload: Payload = {
    kind: 'task',
    title,
    assigneeUserId: assignee._id,
    assigneeName: assignee.name || assignee.email || 'Member',
    dueDate,
    cageId: cage?._id,
    cageName: cage?.name,
    notes: trimTo(input.notes, MAX_NOTES),
  }
  return {
    ok: true,
    payload,
    siteId,
    date: today,
    summary: `Task "${title}" for ${payload.assigneeName}${dueDate ? `, due ${dueDate}` : ''}${cage ? ` (${cage.name})` : ''}.`,
    fingerprint: `task|${title.toLowerCase()}|${assignee._id}|${dueDate ?? '-'}`,
  }
}

/** Groups are opaque random ids (crypto.randomUUID) minted by the action. */
function assertGroup(draftGroup: string) {
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(draftGroup)) throw userError('VALIDATION', 'Invalid draft')
}

async function groupRows(ctx: QueryCtx, userId: Id<'users'>, draftGroup: string) {
  return await ctx.db
    .query('pendingBotActions')
    .withIndex('by_userId_and_draftGroup', (q) => q.eq('userId', userId).eq('draftGroup', draftGroup))
    .take(MAX_ITEMS_PER_DRAFT + 1)
}

/**
 * Store one draft item (an agent tool call). The member and scope come from
 * the signed-in user, re-checked here; what the model typed is matched
 * against units, feed types and people the member can see. An item the role
 * may not do is still stored, with `refusal`, so the card can show why.
 */
const proposeResult = v.union(
  v.object({ ok: v.literal(true), itemId: v.id('pendingBotActions'), summary: v.string(), refused: v.union(v.string(), v.null()) }),
  v.object({ ok: v.literal(false), error: v.string() }),
)

async function proposeAs(ctx: MutationCtx, w: WebMember, draftGroup: string, input: WebProposalInput) {
  const existing = await groupRows(ctx, w.account._id, draftGroup)
  if (existing.length >= MAX_ITEMS_PER_DRAFT) {
    return { ok: false as const, error: 'Too many changes in one draft; ask the user to do the rest separately.' }
  }
  if (existing.some((r) => r.status !== 'pending' || r.companyId !== w.binding.companyId)) {
    return { ok: false as const, error: 'This draft is closed.' }
  }
  const now = Date.now()
  let built: Built | Failed
  if (input.kind === 'daily_entry' || input.kind === 'feed_issue') {
    built = await buildProposal(ctx, w, input, now)
  } else if (input.kind === 'purchase_order') {
    built = await buildPurchaseOrder(ctx, w, input)
  } else if (input.kind === 'task') {
    built = await buildTask(ctx, w, input)
  } else if (input.kind === 'project_create' || input.kind === 'project_milestone' || input.kind === 'project_cost') {
    built = await buildProjectProposal(ctx, w, input)
  } else if (
    input.kind === 'keeper_assign' ||
    input.kind === 'keeper_rebalance' ||
    input.kind === 'keeper_cover' ||
    input.kind === 'keeper_nudge'
  ) {
    built = await buildKeeper(ctx, w, input)
  } else {
    built = await buildFarmProposal(ctx, w, input satisfies FarmProposalInput)
  }
  if (!built.ok) return built
  if (existing.some((r) => r.fingerprint === built.fingerprint)) {
    return { ok: false as const, error: 'That change is already in this draft.' }
  }
  const refusal = roleRefusal(w, built.payload) ?? undefined
  const itemId = await ctx.db.insert('pendingBotActions', {
    channel: 'web',
    draftGroup,
    userId: w.account._id,
    companyId: w.binding.companyId,
    siteId: built.siteId,
    payload: built.payload,
    date: built.date,
    eventTime: now,
    sourceMessageId: `web:${draftGroup}`,
    summary: built.summary,
    fingerprint: built.fingerprint,
    refusal,
    status: 'pending',
    createdAt: now,
    // Every item of a card shares the first item's expiry.
    expiresAt: existing[0]?.expiresAt ?? now + DRAFT_TTL_MS,
  })
  return { ok: true as const, itemId, summary: built.summary, refused: refusal ?? null }
}

/**
 * Store one draft item (an agent tool call). The member and scope come from
 * the signed-in user, re-checked here; what the model typed is matched
 * against units, feed types and people the member can see. An item the role
 * may not do is still stored, with `refusal`, so the card can show why.
 */
export const propose = internalMutation({
  args: {
    draftGroup: v.string(),
    siteId: v.optional(v.id('farmLocations')),
    input: webProposalInput,
  },
  returns: proposeResult,
  handler: async (ctx, { draftGroup, siteId, input }) => {
    assertGroup(draftGroup)
    const w = await webMember(ctx, await requireMember(ctx, { permission: 'ai.use' }), siteId)
    if (actAsSessionOf(w.account)) return { ok: false as const, error: 'Changes cannot be drafted during support access.' }
    if (w.company.settings?.aiAssistantEnabled !== true) {
      return { ok: false as const, error: 'The assistant is turned off for this organization.' }
    }
    return await proposeAs(ctx, w, draftGroup, input)
  },
})

/**
 * Keeper screens (Paper 54 to 57) draft their changes into the same card the
 * assistant uses: a brief fix, a drag between keepers, a bulk nudge or a
 * cover sheet becomes a pending item the manager confirms; nothing is written
 * here. No model is involved, so the assistant switch and ai.use do not apply;
 * the manager needs production.keepers.manage. The browser mints the group id.
 */
export const draftKeeper = mutation({
  args: {
    draftGroup: v.string(),
    siteId: v.optional(v.id('farmLocations')),
    input: keeperProposalInput,
  },
  returns: proposeResult,
  handler: async (ctx, { draftGroup, siteId, input }) => {
    assertGroup(draftGroup)
    const w = await webMember(ctx, await requireMember(ctx, { permission: 'production.keepers.manage' }), siteId)
    assertNotSupportAccess(w)
    return await proposeAs(ctx, w, draftGroup, input)
  },
})

/** Why this member may not write this item now (permission, site, unit, stale), or null. */
async function itemProblem(ctx: QueryCtx, w: WebMember, row: Doc<'pendingBotActions'>): Promise<string | null> {
  const p = row.payload
  if (row.companyId !== w.binding.companyId) return 'Not in your organization.'
  const refusal = roleRefusal(w, p)
  if (refusal) return refusal
  if (row.siteId && !inScope(w, row.siteId)) return 'That site is not in your access.'
  if (isKeeperKind(p.kind)) return await keeperItemProblem(ctx, w, row)
  if (isFarmKind(p.kind)) return await farmItemProblem(ctx, w, row)
  if (isProjectKind(p.kind)) return await projectItemProblem(ctx, w, p)
  const cageId = p.kind === 'daily_entry' || p.kind === 'feed_issue' || p.kind === 'task' ? p.cageId : undefined
  if (cageId) {
    const cage = await ctx.db.get(cageId)
    if (!cage || cage.companyId !== w.binding.companyId || cage.archivedAt || !inScope(w, cage.locationId)) {
      return 'That unit is not in your access.'
    }
  }
  if (p.kind === 'daily_entry' && row.status === 'pending') {
    const dup = await ctx.db
      .query('dailyRecords')
      .withIndex('by_cage_date', (q) => q.eq('cageId', p.cageId).eq('date', row.date))
      .first()
    if (dup) return `${p.cageName} already has an entry for ${row.date}.`
  }
  return null
}

/**
 * The reader of a draft card: a member with the assistant (any card) or a
 * keeper manager (cards of keeper items only, drafted from the keeper
 * screens). Rows of other kinds are hidden from a member without ai.use.
 */
async function draftReader(ctx: QueryCtx | MutationCtx) {
  let member
  try {
    member = await requireMember(ctx, { permission: 'ai.use' })
  } catch (err) {
    member = await requireMember(ctx, { permission: 'production.keepers.manage' }).catch(() => {
      throw err
    })
  }
  const w = await webMember(ctx, member)
  const visible = (r: Doc<'pendingBotActions'>) =>
    r.channel === 'web' && r.companyId === w.binding.companyId && (can(member, 'ai.use') || isKeeperKind(r.payload.kind))
  return { w, visible }
}

const itemView = v.object({
  id: v.id('pendingBotActions'),
  status: v.union(
    v.literal('pending'),
    v.literal('committed'),
    v.literal('cancelled'),
    v.literal('expired'),
    v.literal('undone'),
    v.literal('failed'),
  ),
  /** Why the member cannot do this item (greyed on the card), or null. */
  problem: v.union(v.string(), v.null()),
  date: v.string(),
  siteId: v.union(v.id('farmLocations'), v.null()),
  payload: pendingPayload,
})

/** One draft card, live: items, what the member may do now, expiry and Undo window. */
export const get = query({
  args: { draftGroup: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      draftGroup: v.string(),
      expiresAt: v.number(),
      undoUntil: v.union(v.number(), v.null()),
      items: v.array(itemView),
    }),
  ),
  handler: async (ctx, { draftGroup }) => {
    assertGroup(draftGroup)
    const { w, visible } = await draftReader(ctx)
    const rows = (await groupRows(ctx, w.account._id, draftGroup)).filter(visible)
    if (!rows.length) return null
    const items = []
    for (const r of rows) {
      const live = r.status === 'pending' || r.status === 'committed'
      items.push({
        id: r._id,
        status: r.status,
        problem: r.status === 'cancelled' && r.error ? r.error : live ? await itemProblem(ctx, w, r) : null,
        date: r.date,
        siteId: r.siteId ?? null,
        payload: r.payload,
      })
    }
    return {
      draftGroup,
      expiresAt: rows[0].expiresAt,
      undoUntil: rows.find((r) => r.status === 'committed')?.undoUntil ?? null,
      items,
    }
  },
})

const confirmResult = v.union(
  v.object({ status: v.literal('saved'), saved: v.number(), skipped: v.number(), undoUntil: v.number() }),
  v.object({ status: v.literal('already') }),
  v.object({ status: v.literal('expired') }),
  v.object({ status: v.literal('nothing_allowed') }),
  v.object({ status: v.literal('closed') }),
)

async function loadAnowaDraft(ctx: MutationCtx, draftGroup: string) {
  assertGroup(draftGroup)
  const { w, visible } = await draftReader(ctx)
  assertNotSupportAccess(w)
  const rows = (await groupRows(ctx, w.account._id, draftGroup)).filter(visible)
  if (!rows.length) throw userError('NOT_FOUND', 'Draft not found')
  return { w, rows }
}

/**
 * Confirm a draft card: write every item the member may do, once. Items the
 * member may not do are closed with the reason and never written. Any write
 * error throws and rolls the whole card back (nothing half-saved).
 */
export const confirm = mutation({
  args: { draftGroup: v.string() },
  returns: confirmResult,
  handler: async (ctx, { draftGroup }) => {
    const { w, rows } = await loadAnowaDraft(ctx, draftGroup)
    if (rows.some((r) => r.status === 'committed' || r.status === 'undone')) return { status: 'already' as const }
    const pending = rows.filter((r) => r.status === 'pending')
    if (!pending.length) return { status: 'closed' as const }
    const now = Date.now()
    if (pending[0].expiresAt <= now) {
      for (const r of pending) await ctx.db.patch(r._id, { status: 'expired' })
      return { status: 'expired' as const }
    }

    const allowed: Doc<'pendingBotActions'>[] = []
    const refused: Array<{ row: Doc<'pendingBotActions'>; problem: string }> = []
    for (const r of pending) {
      const problem = await itemProblem(ctx, w, r)
      if (problem) refused.push({ row: r, problem })
      else allowed.push(r)
    }
    if (!allowed.length) return { status: 'nothing_allowed' as const }

    const wctx = anowaCtx(ctx, w, draftGroup)
    // Farm records (harvest, sale, approval, …) feed ledgers and approvals: no Undo on a card that has one.
    const undoUntil = allowed.some((r) => isFarmKind(r.payload.kind)) ? now : now + UNDO_WINDOW_MS
    for (const r of allowed) {
      const idemKey = `anowa:${r._id}`
      const prior = await ctx.db
        .query('idempotencyKeys')
        .withIndex('by_user_and_key', (q) => q.eq('userId', r.userId).eq('key', idemKey))
        .first()
      if (prior) continue
      const p = r.payload
      const ids: Partial<
        Pick<
          Doc<'pendingBotActions'>,
          | 'dailyRecordId'
          | 'feedUsageId'
          | 'purchaseOrderId'
          | 'taskId'
          | 'projectId'
          | 'projectMilestoneId'
          | 'projectCostId'
          | 'recordRef'
        >
      > = {}
      if (isFarmKind(p.kind)) {
        ids.recordRef = await commitFarm(wctx, w, r)
      } else if (p.kind === 'daily_entry') {
        const [id] = await saveDailyBatch(wctx, w.actor, {
          date: r.date,
          records: [
            {
              cageId: p.cageId,
              feedAmount: p.feedKg,
              feedTypeId: p.feedTypeId,
              mortality: p.mortality,
              mortalityCause: p.mortalityCause,
              notes: p.notes,
              dissolvedOxygen: p.dissolvedOxygen,
              temperatureC: p.temperatureC,
            },
          ],
        })
        ids.dailyRecordId = id
      } else if (p.kind === 'feed_issue') {
        ids.feedUsageId = await recordOutboundUsageAs(wctx, w.actor, {
          feedTypeId: p.feedTypeId,
          cageId: p.cageId,
          quantity: p.quantityKg,
          usageDate: r.date,
          notes: p.notes,
          source: 'issue',
          transactionType: 'issue',
          locationId: r.siteId,
        })
      } else if (p.kind === 'purchase_order') {
        // A draft PO: placing it is still the existing admin step (procurement.markOrdered).
        ids.purchaseOrderId = await createPurchaseOrderAs(wctx, w.actor, {
          supplierId: p.supplierId,
          locationId: r.siteId,
          lines: [{ feedTypeId: p.feedTypeId, quantityKg: p.quantityKg, pricePerKg: p.pricePerKg }],
          notes:
            p.notes ??
            `Drafted with Anowa: ${p.needKg} kg needed for ${p.days} days over ${p.units} units, ${p.stockKg} kg on hand.`,
        })
      } else if (p.kind === 'project_create') {
        ids.projectId = await createProjectAs(wctx, w.member, {
          name: p.name,
          category: p.category as Parameters<typeof createProjectAs>[2]['category'],
          ownerUserId: p.ownerUserId,
          locationId: p.locationId,
          startDate: p.startDate,
          targetEndDate: p.targetEndDate,
          budget: p.budget,
        })
      } else if (p.kind === 'project_milestone') {
        ids.projectMilestoneId = await addMilestoneAs(wctx, w.member, p.projectId, {
          title: p.title,
          dueDate: p.dueDate,
          progressPct: p.progressPct,
        })
      } else if (p.kind === 'project_cost') {
        ids.projectCostId = await addCostAs(wctx, w.member, p.projectId, { amount: p.amount, date: r.date, note: p.note })
      } else if (p.kind !== 'task') {
        await commitKeeper(wctx, w, r, now)
      } else {
        ids.taskId = await createTaskAs(wctx, w.actor, {
          title: p.title,
          description: p.notes,
          assigneeUserId: p.assigneeUserId,
          dueDate: p.dueDate,
          cageId: p.cageId,
        })
      }
      await ctx.db.patch(r._id, { status: 'committed', committedAt: now, undoUntil, ...ids })
      await ctx.db.insert('idempotencyKeys', {
        userId: r.userId,
        key: idemKey,
        mutation: 'anowa.confirm',
        result: { draftGroup, kind: p.kind },
        createdAt: now,
      })
    }
    for (const { row, problem } of refused) await ctx.db.patch(row._id, { status: 'cancelled', error: problem })
    return { status: 'saved' as const, saved: allowed.length, skipped: refused.length, undoUntil }
  },
})

/** Cancel: the card closes, nothing is written. */
export const cancel = mutation({
  args: { draftGroup: v.string() },
  returns: v.number(),
  handler: async (ctx, { draftGroup }) => {
    const { rows } = await loadAnowaDraft(ctx, draftGroup)
    let n = 0
    for (const r of rows) {
      if (r.status !== 'pending') continue
      await ctx.db.patch(r._id, { status: 'cancelled' })
      n += 1
    }
    return n
  },
})

/**
 * Undo within 10 minutes: the same delete / reversal the app does. All or
 * nothing: when any saved item has been changed since (edited record, PO
 * placed, task closed, feed used), nothing is undone.
 */
export const undo = mutation({
  args: { draftGroup: v.string() },
  returns: v.union(v.object({ status: v.literal('undone'), count: v.number() }), v.object({ status: v.literal('too_late') })),
  handler: async (ctx, { draftGroup }) => {
    const { w, rows } = await loadAnowaDraft(ctx, draftGroup)
    const saved = rows.filter((r) => r.status === 'committed')
    const now = Date.now()
    if (!saved.length || saved.some((r) => !r.undoUntil || r.undoUntil < now || isFarmKind(r.payload.kind))) {
      return { status: 'too_late' as const }
    }
    // Check every item before touching any.
    for (const r of saved) {
      if (await itemProblem(ctx, w, r)) return { status: 'too_late' as const }
      const p = r.payload
      if (p.kind === 'daily_entry') {
        const rec = r.dailyRecordId ? await ctx.db.get(r.dailyRecordId) : null
        if (!rec || rec.feedAmount !== p.feedKg || rec.mortality !== p.mortality) return { status: 'too_late' as const }
      } else if (p.kind === 'purchase_order') {
        const po = r.purchaseOrderId ? await ctx.db.get(r.purchaseOrderId) : null
        if (!po || po.status !== 'draft') return { status: 'too_late' as const }
      } else if (p.kind === 'task') {
        const task = r.taskId ? await ctx.db.get(r.taskId) : null
        if (!task || task.status !== 'open') return { status: 'too_late' as const }
      } else if (isKeeperKind(p.kind)) {
        if (!(await keeperUndoable(ctx, r))) return { status: 'too_late' as const }
      } else if (p.kind === 'project_create') {
        // Only an untouched project can be undone (no milestones or costs since).
        // Nothing changed since the confirm (no edit, milestone or cost by anyone).
        const project = r.projectId ? await ctx.db.get(r.projectId) : null
        if (!project || project.milestonesTotal > 0 || project.spent !== 0 || project.updatedAt > (r.committedAt ?? 0)) {
          return { status: 'too_late' as const }
        }
      } else if (p.kind === 'project_milestone') {
        const ms = r.projectMilestoneId ? await ctx.db.get(r.projectMilestoneId) : null
        if (!ms || ms.updatedAt > (r.committedAt ?? 0)) return { status: 'too_late' as const }
      } else if (p.kind === 'project_cost') {
        const cost = r.projectCostId ? await ctx.db.get(r.projectCostId) : null
        if (!cost || cost.updatedAt > (r.committedAt ?? 0)) return { status: 'too_late' as const }
      }
    }
    const wctx = anowaCtx(ctx, w, draftGroup)
    for (const r of saved) {
      const p = r.payload
      if (p.kind === 'daily_entry' && r.dailyRecordId) {
        await removeDailyRecordAs(wctx, w.actor, r.dailyRecordId)
      } else if (p.kind === 'feed_issue' && r.feedUsageId) {
        const txn = await ctx.db
          .query('feedInventoryTransactions')
          .withIndex('by_reference', (q) => q.eq('referenceId', String(r.feedUsageId)))
          .first()
        if (!txn || txn.transactionType !== 'issue') throw userError('CONFLICT', 'This feed issue can no longer be undone')
        // Throws (and rolls back) when the feed has been fed from the bin since.
        await reverseTransactionAs(wctx, w.actor, { transactionId: txn._id, reason: 'Undone from Ask Anowa' })
      } else if (p.kind === 'purchase_order' && r.purchaseOrderId) {
        const po = await ctx.db.get(r.purchaseOrderId)
        await ctx.db.delete(r.purchaseOrderId)
        await logAudit(wctx, {
          actionType: 'delete',
          tableName: 'purchaseOrders',
          recordId: r.purchaseOrderId,
          previousValues: po,
          locationId: po?.locationId,
        })
      } else if (p.kind === 'project_create' && r.projectId) {
        await removeProjectAs(wctx, w.member, r.projectId)
      } else if (p.kind === 'project_milestone' && r.projectMilestoneId) {
        await removeMilestoneAs(wctx, w.member, r.projectMilestoneId)
      } else if (p.kind === 'project_cost' && r.projectCostId) {
        await removeCostAs(wctx, w.member, r.projectCostId)
      } else if (p.kind === 'task' && r.taskId) {
        await ctx.db.patch(r.taskId, { status: 'cancelled', updatedAt: now })
        await logAudit(wctx, { actionType: 'update', tableName: 'tasks', recordId: r.taskId, newValues: { status: 'cancelled' } })
      } else if (isKeeperKind(p.kind)) {
        // A nudge is a sent message: it stays sent.
        await undoKeeper(wctx, w, r, now)
      }
      await ctx.db.patch(r._id, { status: 'undone' })
    }
    return { status: 'undone' as const, count: saved.length }
  },
})
