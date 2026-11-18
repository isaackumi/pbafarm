/**
 * Departments and teams (ENT-004). A team can sit in a department; members
 * are app users of the organization, some marked lead. Tasks can be assigned
 * to a team (convex/tasks.ts) and admins or a team's leads can send the team
 * a notification through lib/notify.
 *
 * Reading teams needs workforce.view; changing them workforce.manage.
 * Everyone sees the teams they belong to (`mine`).
 */
import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { can, memberContext, requireAccount, requireMember } from './lib/permissions'
import { logAudit } from './lib/tenancy'
import { userError } from './lib/errors'
import { notifyUsers } from './lib/notify'

export const MAX_TEAMS = 200
export const MAX_TEAM_MEMBERS = 200
const kindV = v.union(v.literal('department'), v.literal('team'))

function clean(s: string | undefined, max: number, label: string) {
  const out = s?.trim()
  if (!out) return undefined
  if (out.length > max) throw userError('VALIDATION', `${label} is too long (at most ${max} characters)`)
  return out
}

async function companyTeams(ctx: QueryCtx, companyId: Id<'companies'>) {
  const departments = await ctx.db
    .query('teams')
    .withIndex('by_companyId_and_kind', (q) => q.eq('companyId', companyId).eq('kind', 'department'))
    .take(MAX_TEAMS)
  const teams = await ctx.db
    .query('teams')
    .withIndex('by_companyId_and_kind', (q) => q.eq('companyId', companyId).eq('kind', 'team'))
    .take(MAX_TEAMS)
  return [...departments, ...teams]
}

export async function ownTeam(ctx: QueryCtx, companyId: Id<'companies'> | undefined, id: Id<'teams'>) {
  const team = await ctx.db.get(id)
  if (!team || !companyId || team.companyId !== companyId) throw userError('NOT_FOUND', 'Team not found')
  return team
}

export async function teamMemberRows(ctx: QueryCtx, teamId: Id<'teams'>) {
  return await ctx.db
    .query('teamMembers')
    .withIndex('by_teamId_and_userId', (q) => q.eq('teamId', teamId))
    .take(MAX_TEAM_MEMBERS)
}

/** Teams a user belongs to in the company. */
export async function teamsOfUser(ctx: QueryCtx, companyId: Id<'companies'>, userId: Id<'users'>) {
  return await ctx.db
    .query('teamMembers')
    .withIndex('by_companyId_and_userId', (q) => q.eq('companyId', companyId).eq('userId', userId))
    .take(50)
}

/** An active member of the company: a membership row, or a legacy user of it with none. */
export async function isActiveMember(ctx: QueryCtx, companyId: Id<'companies'>, userId: Id<'users'>) {
  const person = await ctx.db.get(userId)
  if (!person || person.active === false || person.deletedAt) return false
  const row = await ctx.db
    .query('memberships')
    .withIndex('by_companyId_and_userId', (q) => q.eq('companyId', companyId).eq('userId', userId))
    .unique()
  return row ? row.status === 'active' : person.companyId === companyId
}

function displayName(u: Doc<'users'> | null, showEmail: boolean) {
  if (!u) return '—'
  return u.name || (showEmail ? u.email : undefined) || 'Member'
}

/** Departments and teams with members and leads. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const m = await requireMember(ctx, { permission: 'workforce.view' })
    if (!m.companyId) return []
    const showEmail = can(m, 'workforce.manage')
    const out = []
    for (const t of await companyTeams(ctx, m.companyId)) {
      const rows = await teamMemberRows(ctx, t._id)
      const members = []
      for (const r of rows) {
        const u = await ctx.db.get(r.userId)
        members.push({ userId: r.userId, role: r.role, name: displayName(u, showEmail) })
      }
      members.sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'lead' ? -1 : 1))
      out.push({
        _id: t._id,
        name: t.name,
        kind: t.kind,
        parentId: t.parentId ?? null,
        locationId: t.locationId ?? null,
        description: t.description ?? null,
        active: t.active,
        members,
      })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  },
})

/** The caller's teams (any member): for tasks and team messages. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAccount(ctx)
    if (!user.companyId) return []
    const out = []
    for (const r of await teamsOfUser(ctx, user.companyId, user._id)) {
      const t = await ctx.db.get(r.teamId)
      if (t && t.companyId === user.companyId && t.active) out.push({ _id: t._id, name: t.name, kind: t.kind, role: r.role })
    }
    return out
  },
})

export const create = mutation({
  args: {
    name: v.string(),
    kind: kindV,
    parentId: v.optional(v.id('teams')),
    locationId: v.optional(v.id('farmLocations')),
    description: v.optional(v.string()),
  },
  returns: v.id('teams'),
  handler: async (ctx, args) => {
    const { user, companyId } = await requireMember(ctx, { permission: 'workforce.manage', locationId: args.locationId })
    if (!companyId) throw userError('FORBIDDEN', 'No organization')
    const name = clean(args.name, 120, 'Name')
    if (!name) throw userError('VALIDATION', 'Name is required')
    const existing = await companyTeams(ctx, companyId)
    if (existing.length >= MAX_TEAMS * 2) throw userError('VALIDATION', 'Too many teams')
    if (existing.some((t) => t.kind === args.kind && t.name.toLowerCase() === name.toLowerCase())) {
      throw userError('DUPLICATE', `A ${args.kind} with this name already exists`)
    }
    if (args.parentId) {
      const parent = await ownTeam(ctx, companyId, args.parentId)
      if (args.kind !== 'team' || parent.kind !== 'department') {
        throw userError('VALIDATION', 'Only a team can sit in a department')
      }
    }
    const id = await ctx.db.insert('teams', {
      companyId,
      name,
      kind: args.kind,
      parentId: args.parentId,
      locationId: args.locationId,
      description: clean(args.description, 500, 'Description'),
      active: true,
      updatedAt: Date.now(),
      updatedBy: user._id,
    })
    await logAudit(ctx, { actionType: 'create', tableName: 'teams', recordId: id, newValues: { ...args, name } })
    return id
  },
})

export const update = mutation({
  args: {
    id: v.id('teams'),
    patch: v.object({
      name: v.optional(v.string()),
      parentId: v.optional(v.union(v.id('teams'), v.null())),
      locationId: v.optional(v.union(v.id('farmLocations'), v.null())),
      description: v.optional(v.string()),
      active: v.optional(v.boolean()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { id, patch }) => {
    const { user, companyId } = await requireMember(ctx, { permission: 'workforce.manage', locationId: patch.locationId })
    const team = await ownTeam(ctx, companyId, id)
    const next: Partial<Doc<'teams'>> = { updatedAt: Date.now(), updatedBy: user._id }
    if (patch.name !== undefined) {
      const name = clean(patch.name, 120, 'Name')
      if (!name) throw userError('VALIDATION', 'Name is required')
      next.name = name
    }
    if (patch.parentId !== undefined) {
      if (patch.parentId) {
        const parent = await ownTeam(ctx, companyId, patch.parentId)
        if (team.kind !== 'team' || parent.kind !== 'department') throw userError('VALIDATION', 'Only a team can sit in a department')
      }
      next.parentId = patch.parentId ?? undefined
    }
    if (patch.locationId !== undefined) next.locationId = patch.locationId ?? undefined
    if (patch.description !== undefined) next.description = clean(patch.description, 500, 'Description')
    if (patch.active !== undefined) next.active = patch.active
    await ctx.db.patch(id, next)
    await logAudit(ctx, { actionType: 'update', tableName: 'teams', recordId: id, previousValues: team, newValues: patch })
    return null
  },
})

/** Delete a team or department with no teams inside it; its members and open tasks are released. */
export const remove = mutation({
  args: { id: v.id('teams') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const { companyId } = await requireMember(ctx, { permission: 'workforce.manage' })
    const team = await ownTeam(ctx, companyId, id)
    const all = await companyTeams(ctx, team.companyId)
    if (all.some((t) => t.parentId === id)) throw userError('CONFLICT', 'Move or delete the teams in this department first')
    const open = await ctx.db
      .query('tasks')
      .withIndex('by_teamId_and_status', (q) => q.eq('teamId', id).eq('status', 'open'))
      .first()
    if (open) throw userError('CONFLICT', 'This team still has open tasks')
    for (const r of await teamMemberRows(ctx, id)) await ctx.db.delete(r._id)
    await ctx.db.delete(id)
    await logAudit(ctx, { actionType: 'delete', tableName: 'teams', recordId: id, previousValues: team })
    return null
  },
})

/** Add, re-role (lead/member) or remove (role null) a member of a team. */
export const setMember = mutation({
  args: {
    teamId: v.id('teams'),
    userId: v.id('users'),
    role: v.union(v.literal('lead'), v.literal('member'), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, companyId } = await requireMember(ctx, { permission: 'workforce.manage' })
    const team = await ownTeam(ctx, companyId, args.teamId)
    const existing = await ctx.db
      .query('teamMembers')
      .withIndex('by_teamId_and_userId', (q) => q.eq('teamId', team._id).eq('userId', args.userId))
      .unique()
    if (args.role === null) {
      if (existing) await ctx.db.delete(existing._id)
    } else {
      if (!(await isActiveMember(ctx, team.companyId, args.userId))) {
        throw userError('NOT_FOUND', 'Person not found in your organization')
      }
      if (existing) {
        await ctx.db.patch(existing._id, { role: args.role })
      } else {
        if ((await teamMemberRows(ctx, team._id)).length >= MAX_TEAM_MEMBERS) {
          throw userError('VALIDATION', `At most ${MAX_TEAM_MEMBERS} members per team`)
        }
        await ctx.db.insert('teamMembers', {
          companyId: team.companyId,
          teamId: team._id,
          userId: args.userId,
          role: args.role,
          addedAt: Date.now(),
          addedBy: user._id,
        })
      }
    }
    await logAudit(ctx, { actionType: 'update', tableName: 'teamMembers', recordId: team._id, newValues: args })
    return null
  },
})

/** Send every member of a team an in-app notification (workforce admins and the team's leads). */
export const notify = mutation({
  args: { teamId: v.id('teams'), title: v.string(), message: v.string() },
  returns: v.object({ notified: v.number() }),
  handler: async (ctx, args) => {
    const user = await requireAccount(ctx)
    const m = await memberContext(ctx, user)
    if (!m.companyId) throw userError('FORBIDDEN', 'No organization')
    const team = await ownTeam(ctx, m.companyId, args.teamId)
    const rows = await teamMemberRows(ctx, team._id)
    const isLead = rows.some((r) => r.userId === user._id && r.role === 'lead')
    if (!can(m, 'workforce.manage') && !isLead) {
      throw userError('FORBIDDEN', 'Only an admin or a lead of this team can message it', { permission: 'workforce.manage' })
    }
    const title = clean(args.title, 120, 'Title')
    const message = clean(args.message, 1000, 'Message')
    if (!title || !message) throw userError('VALIDATION', 'Title and message are required')
    const users = []
    for (const r of rows) {
      if (r.userId === user._id) continue
      const u = await ctx.db.get(r.userId)
      if (u && u.active !== false && u.companyId === team.companyId) users.push(u)
    }
    const { notified } = await notifyUsers(ctx, {
      companyId: team.companyId,
      users,
      channels: ['in_app'],
      title: `${team.name}: ${title}`,
      message,
      link: '/teams',
      source: 'team.message',
    })
    await logAudit(ctx, { actionType: 'create', tableName: 'notifications', recordId: team._id, newValues: { teamId: team._id, title } })
    return { notified }
  },
})
