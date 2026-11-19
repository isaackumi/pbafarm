/**
 * Dashboard layouts (CUSTOM-005, D-007). The dashboard shows the caller's own
 * layout, else the organization default, else lib/dashboardLayout
 * DEFAULT_DASHBOARD. Widgets come from the code catalog and read existing
 * report/rollup queries only.
 */
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Id } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'
import { requireMember, requirePermission } from './lib/permissions'
import { userError } from './lib/errors'
import { logAudit } from './lib/tenancy'
import {
  DASHBOARD_KEYS,
  DEFAULT_DASHBOARD,
  cleanDashboard,
  dashboardProblems,
} from './lib/dashboardLayout'
import { dashboardWidget } from './schema'

const scopeValidator = v.union(v.literal('me'), v.literal('org'))

async function row(ctx: QueryCtx, companyId: Id<'companies'>, key: string, userId: Id<'users'> | undefined) {
  return await ctx.db
    .query('dashboardLayouts')
    .withIndex('by_companyId_and_key_and_userId', (q) =>
      q.eq('companyId', companyId).eq('key', key).eq('userId', userId),
    )
    .unique()
}

function requireKey(key: string) {
  if (!(DASHBOARD_KEYS as readonly string[]).includes(key)) throw userError('VALIDATION', 'Unknown dashboard', { field: 'key' })
}

const widgetRow = v.object({
  widget: v.string(),
  size: v.union(
    v.literal('full'),
    v.literal('half'),
    v.literal('sm'),
    v.literal('md'),
    v.literal('lg'),
  ),
})

/** The layout to show, and where it came from ('me' | 'org' | 'default'). */
export const get = query({
  args: { key: v.string() },
  returns: v.union(
    v.object({
      widgets: v.array(widgetRow),
      source: v.literal('default'),
      hasOrgDefault: v.boolean(),
    }),
    v.object({ widgets: v.array(widgetRow), source: v.literal('me'), hasOrgDefault: v.boolean() }),
    v.object({ widgets: v.array(widgetRow), source: v.literal('org'), hasOrgDefault: v.boolean() }),
  ),
  handler: async (ctx, { key }) => {
    const m = await requireMember(ctx, { permission: 'reports.view' })
    const fallback = { widgets: DEFAULT_DASHBOARD, source: 'default' as const, hasOrgDefault: false }
    if (!m.companyId || !(DASHBOARD_KEYS as readonly string[]).includes(key)) return fallback
    const [mine, org] = await Promise.all([row(ctx, m.companyId, key, m.user._id), row(ctx, m.companyId, key, undefined)])
    if (mine) return { widgets: cleanDashboard(mine.widgets), source: 'me' as const, hasOrgDefault: !!org }
    if (org) return { widgets: cleanDashboard(org.widgets), source: 'org' as const, hasOrgDefault: true }
    return fallback
  },
})

/** The organization default only (the Customization editor). */
export const getOrgDefault = query({
  args: { key: v.string() },
  returns: v.union(v.object({ widgets: v.array(widgetRow), updatedAt: v.number() }), v.null()),
  handler: async (ctx, { key }) => {
    const m = await requireMember(ctx, { permission: 'customization.manage' })
    if (!m.companyId || !(DASHBOARD_KEYS as readonly string[]).includes(key)) return null
    const org = await row(ctx, m.companyId, key, undefined)
    return org ? { widgets: cleanDashboard(org.widgets), updatedAt: org.updatedAt } : null
  },
})

/**
 * Save a layout for the caller ('me', anyone who sees the dashboard) or as the
 * organization default ('org', customization.manage).
 */
export const save = mutation({
  args: { key: v.string(), scope: scopeValidator, widgets: v.array(dashboardWidget) },
  returns: v.id('dashboardLayouts'),
  handler: async (ctx, { key, scope, widgets }) => {
    const m = await requireMember(ctx, { permission: 'reports.view' })
    if (scope === 'org') requirePermission(m, 'customization.manage')
    const companyId = m.companyId
    if (!companyId) throw userError('FORBIDDEN', 'Choose an organization first')
    requireKey(key)
    const problems = dashboardProblems(widgets)
    if (problems.length) throw userError('VALIDATION', problems.join('. '))
    const userId = scope === 'me' ? m.user._id : undefined
    const existing = await row(ctx, companyId, key, userId)
    const doc = { companyId, key, userId, widgets, updatedBy: m.user._id, updatedAt: Date.now() }
    let id: Id<'dashboardLayouts'>
    if (existing) {
      await ctx.db.replace(existing._id, doc)
      id = existing._id
    } else {
      id = await ctx.db.insert('dashboardLayouts', doc)
    }
    if (scope === 'org') {
      await logAudit(ctx, {
        actionType: existing ? 'update' : 'create',
        tableName: 'dashboardLayouts',
        recordId: id,
        previousValues: existing ? { widgets: existing.widgets } : undefined,
        newValues: { key, widgets },
      })
    }
    return id
  },
})

/** Drop the caller's own layout ('me') or the organization default ('org'). */
export const reset = mutation({
  args: { key: v.string(), scope: scopeValidator },
  returns: v.null(),
  handler: async (ctx, { key, scope }) => {
    const m = await requireMember(ctx, { permission: 'reports.view' })
    if (scope === 'org') requirePermission(m, 'customization.manage')
    if (!m.companyId) throw userError('FORBIDDEN', 'Choose an organization first')
    requireKey(key)
    const existing = await row(ctx, m.companyId, key, scope === 'me' ? m.user._id : undefined)
    if (!existing) return null
    await ctx.db.delete(existing._id)
    if (scope === 'org') {
      await logAudit(ctx, {
        actionType: 'delete',
        tableName: 'dashboardLayouts',
        recordId: existing._id,
        previousValues: { key, widgets: existing.widgets },
      })
    }
    return null
  },
})
