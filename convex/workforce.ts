/**
 * Workforce roster (ENT-004): staff records with job, site, department and a
 * work contact. Personal data is kept minimal (doc 21): no national ids,
 * birth dates, addresses or pay. Phone, email and notes are returned only to
 * holders of workforce.manage; workforce.view sees names, jobs and sites.
 * Members limited to some sites see staff of those sites only.
 */
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { assertSiteInScope, can, requireMember } from './lib/permissions'
import type { MemberContext } from './lib/permissions'
import { logAudit } from './lib/tenancy'
import { userError } from './lib/errors'
import { isBusinessDate } from './lib/dates'
import { isActiveMember, ownTeam } from './teams'

export const MAX_STAFF = 1000

const employmentV = v.union(v.literal('permanent'), v.literal('contract'), v.literal('casual'), v.literal('seasonal'))
const fields = {
  fullName: v.string(),
  userId: v.optional(v.id('users')),
  jobTitle: v.optional(v.string()),
  employeeCode: v.optional(v.string()),
  employmentType: v.optional(employmentV),
  locationId: v.optional(v.id('farmLocations')),
  departmentId: v.optional(v.id('teams')),
  phone: v.optional(v.string()),
  email: v.optional(v.string()),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  notes: v.optional(v.string()),
}

function clean(s: string | undefined, max: number, label: string) {
  const out = s?.trim()
  if (!out) return undefined
  if (out.length > max) throw userError('VALIDATION', `${label} is too long (at most ${max} characters)`)
  return out
}

async function validate(ctx: MutationCtx, m: MemberContext, args: Partial<Record<keyof typeof fields, unknown>> & {
  userId?: Id<'users'>
  locationId?: Id<'farmLocations'>
  departmentId?: Id<'teams'>
  email?: string
  startDate?: string
  endDate?: string
}) {
  const companyId = m.companyId!
  if (args.locationId) {
    const site = await ctx.db.get(args.locationId)
    if (!site || site.companyId !== companyId) throw userError('NOT_FOUND', 'Site not found')
    assertSiteInScope(m, args.locationId)
  }
  if (args.departmentId) await ownTeam(ctx, companyId, args.departmentId)
  if (args.userId && !(await isActiveMember(ctx, companyId, args.userId))) {
    throw userError('NOT_FOUND', 'Person not found in your organization')
  }
  for (const d of [args.startDate, args.endDate]) {
    if (d !== undefined && d !== '' && !isBusinessDate(d)) throw userError('VALIDATION', 'Dates must be real dates (YYYY-MM-DD)')
  }
  if (args.startDate && args.endDate && args.endDate < args.startDate) throw userError('VALIDATION', 'End date is before start date')
  if (args.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.email.trim())) throw userError('VALIDATION', 'Enter a valid email')
}

function contact(s: Doc<'staffRecords'>, showContact: boolean) {
  return showContact ? { phone: s.phone ?? null, email: s.email ?? null, notes: s.notes ?? null } : {}
}

/** The roster (active by default). Contact details only for workforce.manage. */
export const list = query({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'workforce.view' })
    if (!m.companyId) return { canSeeContact: false, staff: [] }
    const companyId = m.companyId
    const showContact = can(m, 'workforce.manage')
    const active = await ctx.db
      .query('staffRecords')
      .withIndex('by_companyId_and_status', (q) => q.eq('companyId', companyId).eq('status', 'active'))
      .take(MAX_STAFF)
    const inactive = args.includeInactive
      ? await ctx.db
          .query('staffRecords')
          .withIndex('by_companyId_and_status', (q) => q.eq('companyId', companyId).eq('status', 'inactive'))
          .take(MAX_STAFF)
      : []
    const names = new Map<string, string>()
    const nameOf = async (id: Id<'farmLocations'> | Id<'teams'> | undefined) => {
      if (!id) return null
      if (!names.has(id)) names.set(id, ((await ctx.db.get(id)) as { name?: string } | null)?.name ?? '')
      return names.get(id) || null
    }
    const staff = []
    for (const s of [...active, ...inactive]) {
      if (m.siteScope !== 'all' && (!s.locationId || !m.siteScope.has(s.locationId))) continue
      staff.push({
        _id: s._id,
        fullName: s.fullName,
        userId: s.userId ?? null,
        jobTitle: s.jobTitle ?? null,
        employeeCode: s.employeeCode ?? null,
        employmentType: s.employmentType ?? null,
        locationId: s.locationId ?? null,
        siteName: await nameOf(s.locationId),
        departmentId: s.departmentId ?? null,
        departmentName: await nameOf(s.departmentId),
        startDate: s.startDate ?? null,
        endDate: s.endDate ?? null,
        status: s.status,
        ...contact(s, showContact),
      })
    }
    staff.sort((a, b) => a.fullName.localeCompare(b.fullName))
    return { canSeeContact: showContact, staff }
  },
})

export const create = mutation({
  args: fields,
  returns: v.id('staffRecords'),
  handler: async (ctx, args) => {
    const m = await requireMember(ctx, { permission: 'workforce.manage' })
    if (!m.companyId) throw userError('FORBIDDEN', 'No organization')
    const fullName = clean(args.fullName, 120, 'Name')
    if (!fullName) throw userError('VALIDATION', 'Name is required')
    await validate(ctx, m, args)
    const count = await ctx.db
      .query('staffRecords')
      .withIndex('by_companyId_and_status', (q) => q.eq('companyId', m.companyId!).eq('status', 'active'))
      .take(MAX_STAFF)
    if (count.length >= MAX_STAFF) throw userError('VALIDATION', `At most ${MAX_STAFF} active staff records`)
    const id = await ctx.db.insert('staffRecords', {
      companyId: m.companyId,
      userId: args.userId,
      fullName,
      jobTitle: clean(args.jobTitle, 120, 'Job title'),
      employeeCode: clean(args.employeeCode, 40, 'Employee code'),
      employmentType: args.employmentType,
      locationId: args.locationId,
      departmentId: args.departmentId,
      phone: clean(args.phone, 40, 'Phone'),
      email: clean(args.email, 200, 'Email'),
      startDate: args.startDate || undefined,
      endDate: args.endDate || undefined,
      status: 'active',
      notes: clean(args.notes, 1000, 'Notes'),
      updatedAt: Date.now(),
      updatedBy: m.user._id,
    })
    // Audit names the record, not its contact details.
    await logAudit(ctx, { actionType: 'create', tableName: 'staffRecords', recordId: id, newValues: { fullName }, locationId: args.locationId })
    return id
  },
})

export const update = mutation({
  args: {
    id: v.id('staffRecords'),
    patch: v
      .object(fields)
      .partial()
      .extend({ status: v.optional(v.union(v.literal('active'), v.literal('inactive'))) }),
  },
  returns: v.null(),
  handler: async (ctx, { id, patch }) => {
    const m = await requireMember(ctx, { permission: 'workforce.manage' })
    const row = await ctx.db.get(id)
    if (!row || row.companyId !== m.companyId) throw userError('NOT_FOUND', 'Staff record not found')
    assertSiteInScope(m, row.locationId)
    await validate(ctx, m, patch)
    const next: Partial<Doc<'staffRecords'>> = { updatedAt: Date.now(), updatedBy: m.user._id }
    if (patch.fullName !== undefined) {
      const fullName = clean(patch.fullName, 120, 'Name')
      if (!fullName) throw userError('VALIDATION', 'Name is required')
      next.fullName = fullName
    }
    const text: Array<[keyof Doc<'staffRecords'>, string | undefined, number, string]> = [
      ['jobTitle', patch.jobTitle, 120, 'Job title'],
      ['employeeCode', patch.employeeCode, 40, 'Employee code'],
      ['phone', patch.phone, 40, 'Phone'],
      ['email', patch.email, 200, 'Email'],
      ['notes', patch.notes, 1000, 'Notes'],
    ]
    for (const [key, value, max, label] of text) {
      if (value !== undefined) (next as Record<string, unknown>)[key] = clean(value, max, label)
    }
    if (patch.userId !== undefined) next.userId = patch.userId
    if (patch.employmentType !== undefined) next.employmentType = patch.employmentType
    if (patch.locationId !== undefined) next.locationId = patch.locationId
    if (patch.departmentId !== undefined) next.departmentId = patch.departmentId
    if (patch.startDate !== undefined) next.startDate = patch.startDate || undefined
    if (patch.endDate !== undefined) next.endDate = patch.endDate || undefined
    if (patch.status !== undefined) next.status = patch.status
    await ctx.db.patch(id, next)
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'staffRecords',
      recordId: id,
      newValues: { fields: Object.keys(patch) },
      locationId: row.locationId,
    })
    return null
  },
})

/** Delete a record entered by mistake or no longer needed (data minimisation). */
export const remove = mutation({
  args: { id: v.id('staffRecords') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const m = await requireMember(ctx, { permission: 'workforce.manage' })
    const row = await ctx.db.get(id)
    if (!row || row.companyId !== m.companyId) throw userError('NOT_FOUND', 'Staff record not found')
    assertSiteInScope(m, row.locationId)
    await ctx.db.delete(id)
    await logAudit(ctx, { actionType: 'delete', tableName: 'staffRecords', recordId: id, previousValues: { fullName: row.fullName } })
    return null
  },
})
