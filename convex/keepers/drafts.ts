/**
 * Keeper changes through Ask Anowa's draft-and-confirm flow
 * (convex/anowa/drafts.ts): assign, rebalance, cover and nudge are built
 * here as typed draft items, re-checked at confirm, written once, and
 * undone within the Undo window (nudges are messages and stay sent).
 *
 * Who may: production.keepers.manage, and only units in the manager's
 * sites. Who may keep a unit: an active member of the organization whose
 * role records daily entries and whose sites include the unit's site.
 */
import type { Infer } from 'convex/values'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { farmDate, inScope, matchUnit, unitKey, unitsInScope } from '../bot/scope'
import type { WebMember } from '../anowa/scope'
import { addDays, isBusinessDate } from '../lib/dates'
import { notifyUsers } from '../lib/notify'
import { logAudit } from '../lib/tenancy'
import { nameList } from '../automation/checks'
import { balance } from './balance'
import { alertOnce } from './escalation'
import { mayKeep } from './board'
import {
  MAX_COVER_DAYS,
  MAX_MOVES,
  MAX_NUDGES,
  MAX_UNITS,
  byUnitName,
  coverActiveOn,
  coversOfKeeper,
  keeperSettingsOf,
  memberOf,
  needsDailyLog,
  openAssignment,
  openAssignments,
  openCovers,
  personName,
  reachesSite,
  rowOf,
} from './model'
import type {
  keeperAssignInput,
  keeperCoverInput,
  keeperNudgeInput,
  keeperRebalanceInput,
} from './validators'

type Payload = Doc<'pendingBotActions'>['payload']
type AssignPayload = Extract<Payload, { kind: 'keeper_assign' }>
type CoverPayload = Extract<Payload, { kind: 'keeper_cover' }>
type NudgePayload = Extract<Payload, { kind: 'keeper_nudge' }>
export type KeeperInput =
  | Infer<typeof keeperAssignInput>
  | Infer<typeof keeperRebalanceInput>
  | Infer<typeof keeperCoverInput>
  | Infer<typeof keeperNudgeInput>

type Built = {
  ok: true
  payload: Payload
  siteId: Id<'farmLocations'> | undefined
  date: string
  summary: string
  fingerprint: string
}
type Failed = { ok: false; error: string }

const MAX_NOTE = 1000
const NOT_MEMBER = 'That person is not an active member of this organization.'

/** An active member who may keep units at `locationId` (role records daily entries, site in their access). */
export async function keeperProblem(
  ctx: QueryCtx,
  companyId: Id<'companies'>,
  userId: Id<'users'>,
  locationId: Id<'farmLocations'> | undefined,
): Promise<string | null> {
  // Not a member: one generic answer, nothing about the person.
  const found = await memberOf(ctx, companyId, userId)
  if (!found) return NOT_MEMBER
  const { user: u, membership: m } = found
  if (!(await mayKeep(ctx, m))) return `${personName(u)}'s role cannot record daily entries.`
  if (!reachesSite(m, locationId)) return `${personName(u)} has no access to that site.`
  return null
}

/** One active member matched by name (Anowa's typed words). Capped scan of memberships. */
async function matchPerson(ctx: QueryCtx, companyId: Id<'companies'>, typed: string) {
  const key = typed.trim().toLowerCase()
  if (!key) return { error: 'Which person?' } as const
  const rows = await ctx.db
    .query('memberships')
    .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
    .take(1500)
  const hits: Doc<'users'>[] = []
  for (const r of rows) {
    if (r.status !== 'active') continue
    const u = await ctx.db.get(r.userId)
    if (!u || u.active === false || u.deletedAt) continue
    const n = personName(u).toLowerCase()
    if (n === key) return { user: u } as const
    if (n.includes(key)) hits.push(u)
  }
  if (hits.length === 1) return { user: hits[0] } as const
  return {
    error: hits.length
      ? `Which person? Matches: ${hits.slice(0, 8).map((h) => personName(h)).join(', ')}`
      : `No active member called "${typed.slice(0, 40)}".`,
  } as const
}

async function resolvePerson(
  ctx: QueryCtx,
  w: WebMember,
  id: Id<'users'> | undefined,
  typed: string | undefined,
): Promise<{ user: Doc<'users'> } | { error: string }> {
  if (id) {
    const found = await memberOf(ctx, w.binding.companyId, id)
    return found ? { user: found.user } : { error: NOT_MEMBER }
  }
  if (typed) return await matchPerson(ctx, w.binding.companyId, typed)
  return { error: 'Which person?' }
}

async function unitsFor(
  ctx: QueryCtx,
  w: WebMember,
  input: { unitIds?: Id<'cages'>[]; units?: string[]; row?: string; site?: string },
): Promise<{ units: Doc<'cages'>[] } | Failed> {
  const companyId = w.binding.companyId
  const out: Doc<'cages'>[] = []
  if (input.unitIds?.length) {
    if (input.unitIds.length > MAX_MOVES) return { ok: false, error: `At most ${MAX_MOVES} units in one change.` }
    for (const id of input.unitIds) {
      const u = await ctx.db.get(id)
      if (!u || u.companyId !== companyId || u.archivedAt || !inScope(w, u.locationId)) {
        return { ok: false, error: 'A unit is not in your access.' }
      }
      if (!out.some((x) => x._id === u._id)) out.push(u)
    }
    return { units: out }
  }
  const all = await unitsInScope(ctx, w, 2000)
  if (input.row) {
    const rowKey = unitKey(input.row.replace(/^row\s+/i, ''))
    const siteKey = input.site ? unitKey(input.site) : ''
    const sites = new Map<string, string>()
    for (const u of all) {
      if (u.locationId && !sites.has(u.locationId)) sites.set(u.locationId, unitKey((await ctx.db.get(u.locationId))?.name ?? ''))
    }
    const hit = all.filter(
      (u) => unitKey(rowOf(u)) === rowKey && (!siteKey || (sites.get(u.locationId ?? '') ?? '').includes(siteKey)),
    )
    if (!hit.length) return { ok: false, error: `No units in row ${input.row.slice(0, 20)}${input.site ? ` at ${input.site.slice(0, 40)}` : ''}.` }
    const siteSet = new Set(hit.map((u) => u.locationId))
    if (siteSet.size > 1) return { ok: false, error: 'That row exists at more than one site; say which site.' }
    return { units: hit.sort(byUnitName).slice(0, MAX_MOVES) }
  }
  for (const typed of (input.units ?? []).slice(0, MAX_MOVES)) {
    const m = matchUnit(all, typed)
    if (!m.unit) {
      return {
        ok: false,
        error: m.candidates.length ? `Which unit? Matches: ${m.candidates.join(', ')}` : `No unit called "${typed.slice(0, 40)}" in your sites.`,
      }
    }
    if (!out.some((x) => x._id === m.unit!._id)) out.push(m.unit)
  }
  if (!out.length) return { ok: false, error: 'Which units?' }
  return { units: out }
}

async function today(ctx: MutationCtx, w: WebMember, siteId?: Id<'farmLocations'>) {
  return await farmDate(ctx, w, siteId, Date.now())
}

function moveSummary(moves: AssignPayload['moves']) {
  const by = new Map<string, string[]>()
  for (const mv of moves) by.set(mv.toName, [...(by.get(mv.toName) ?? []), mv.unitName])
  return [...by.entries()].map(([to, units]) => `${nameList(units, 4)} to ${to}`).join('; ')
}

async function assignBuilt(
  ctx: MutationCtx,
  w: WebMember,
  moves: Array<{ unit: Doc<'cages'>; to: Doc<'users'> }>,
  reason: 'assign' | 'rebalance',
  backup: Doc<'users'> | null,
  unplaced = 0,
): Promise<Built | Failed> {
  const companyId = w.binding.companyId
  if (!moves.length) {
    return { ok: false, error: unplaced ? 'Nobody at those sites has room under the capacity; raise it or add a keeper.' : 'Nothing to change: every unit already has that keeper.' }
  }
  const out: AssignPayload['moves'] = []
  for (const { unit, to } of moves.slice(0, MAX_MOVES)) {
    const problem = await keeperProblem(ctx, companyId, to._id, unit.locationId)
    if (problem) return { ok: false, error: `${unit.name}: ${problem}` }
    const open = await openAssignment(ctx, unit._id)
    if (open?.keeperId === to._id && (!backup || open.backupId === backup._id)) continue
    out.push({
      unitId: unit._id,
      unitName: unit.name,
      fromKeeperId: open?.keeperId,
      fromName: open ? personName(await ctx.db.get(open.keeperId)) : undefined,
      toKeeperId: to._id,
      toName: personName(to),
    })
  }
  if (!out.length) return { ok: false, error: 'Nothing to change: every unit already has that keeper.' }
  if (backup) {
    const problem = await keeperProblem(ctx, companyId, backup._id, moves[0].unit.locationId)
    if (problem) return { ok: false, error: `Backup: ${problem}` }
  }
  const sites = new Set(moves.map((m) => m.unit.locationId))
  const siteId = sites.size === 1 ? [...sites][0] : undefined
  const date = await today(ctx, w, siteId)
  const payload: AssignPayload = {
    kind: 'keeper_assign',
    reason,
    moves: out,
    backupId: backup?._id,
    backupName: backup ? personName(backup) : undefined,
    unplaced: unplaced || undefined,
  }
  return {
    ok: true,
    payload,
    siteId,
    date,
    summary: `${reason === 'rebalance' ? 'Rebalance' : 'Assign'} ${out.length} unit${out.length === 1 ? '' : 's'}: ${moveSummary(out)}${backup ? `; backup ${personName(backup)}` : ''}${unplaced ? `; ${unplaced} could not be placed` : ''}.`,
    fingerprint: `keeper_assign|${out.map((m) => `${m.unitId}>${m.toKeeperId}`).sort().join(',')}`,
  }
}

async function buildAssign(ctx: MutationCtx, w: WebMember, input: Infer<typeof keeperAssignInput>): Promise<Built | Failed> {
  const backupRes = input.backupId || input.backup ? await resolvePerson(ctx, w, input.backupId, input.backup) : null
  if (backupRes && 'error' in backupRes) return { ok: false, error: backupRes.error }
  const backup = backupRes?.user ?? null
  if (input.moves?.length) {
    if (input.moves.length > MAX_MOVES) return { ok: false, error: `At most ${MAX_MOVES} moves in one change.` }
    const pairs: Array<{ unit: Doc<'cages'>; to: Doc<'users'> }> = []
    for (const mv of input.moves) {
      const unit = await ctx.db.get(mv.unitId)
      if (!unit || unit.companyId !== w.binding.companyId || unit.archivedAt || !inScope(w, unit.locationId)) {
        return { ok: false, error: 'A unit is not in your access.' }
      }
      const to = (await memberOf(ctx, w.binding.companyId, mv.keeperId))?.user
      if (!to) return { ok: false, error: NOT_MEMBER }
      pairs.push({ unit, to })
    }
    return await assignBuilt(ctx, w, pairs, 'assign', backup)
  }
  const units = await unitsFor(ctx, w, input)
  if ('ok' in units) return units
  const who = await resolvePerson(ctx, w, input.keeperId, input.keeper)
  if ('error' in who) return { ok: false, error: who.error }
  if (backup && backup._id === who.user._id) return { ok: false, error: 'The backup must be someone else than the keeper.' }
  return await assignBuilt(
    ctx,
    w,
    units.units.map((unit) => ({ unit, to: who.user })),
    'assign',
    backup,
  )
}

async function buildRebalance(ctx: MutationCtx, w: WebMember, input: Infer<typeof keeperRebalanceInput>): Promise<Built | Failed> {
  const companyId = w.binding.companyId
  const { settings } = await keeperSettingsOf(ctx, companyId)
  let siteId = input.siteId
  if (!siteId && input.site) {
    const key = unitKey(input.site)
    const sites = (
      await ctx.db
        .query('farmLocations')
        .withIndex('by_company', (q) => q.eq('companyId', companyId))
        .take(500)
    ).filter((s) => inScope(w, s._id) && unitKey(s.name).includes(key))
    if (sites.length !== 1) return { ok: false, error: sites.length ? `Which site? ${sites.map((s) => s.name).join(', ')}` : `No site called "${input.site.slice(0, 40)}".` }
    siteId = sites[0]._id
  }
  if (siteId) {
    const s = await ctx.db.get(siteId)
    if (!s || s.companyId !== companyId || !inScope(w, siteId)) return { ok: false, error: 'That site is not in your access.' }
  }
  const units = (await unitsInScope(ctx, { ...w, site: siteId ? await ctx.db.get(siteId) : null }, 2000)).filter(
    (u) => needsDailyLog(u) && (!input.row || unitKey(rowOf(u)) === unitKey(input.row.replace(/^row\s+/i, ''))),
  )
  const assignments = await openAssignments(ctx, companyId)
  const date = await today(ctx, w, siteId)
  const away = new Set((await openCovers(ctx, companyId, date)).filter((c) => coverActiveOn(c, date)).map((c) => c.keeperId as string))
  let sources: Set<string> | undefined
  if (input.keeperIds?.length || input.keepers?.length) {
    sources = new Set()
    for (const id of (input.keeperIds ?? []).slice(0, MAX_NUDGES)) sources.add(id)
    for (const typed of (input.keepers ?? []).slice(0, 20)) {
      const p = await matchPerson(ctx, companyId, typed)
      if ('error' in p) return { ok: false, error: p.error ?? 'Which person?' }
      sources.add(p.user._id)
    }
  }
  const balanced = balance({
    units: units.map((u) => ({
      id: u._id,
      name: u.name,
      site: u.locationId ?? '',
      row: rowOf(u),
      keeperId: assignments.get(u._id)?.keeperId ?? null,
    })),
    capacity: settings.capacity,
    // Unassigned only: no keeper gives units away, the pool is the units without one.
    sources: input.unassignedOnly ? new Set() : sources,
    eligible: (k) => !away.has(k),
    maxMoves: MAX_MOVES,
  })
  const pairs: Array<{ unit: Doc<'cages'>; to: Doc<'users'> }> = []
  const byId = new Map(units.map((u) => [u._id as string, u]))
  for (const mv of balanced.moves) {
    const unit = byId.get(mv.unitId)
    const to = await ctx.db.get(mv.toKeeperId as Id<'users'>)
    if (unit && to && !(await keeperProblem(ctx, companyId, to._id, unit.locationId))) pairs.push({ unit, to })
  }
  return await assignBuilt(ctx, w, pairs, 'rebalance', null, balanced.unplaced)
}

async function buildCover(ctx: MutationCtx, w: WebMember, input: Infer<typeof keeperCoverInput>): Promise<Built | Failed> {
  const companyId = w.binding.companyId
  const keeper = await resolvePerson(ctx, w, input.keeperId, input.keeper)
  if ('error' in keeper) return { ok: false, error: keeper.error }
  const cover = await resolvePerson(ctx, w, input.coverId, input.cover)
  if ('error' in cover) return { ok: false, error: cover.error }
  if (keeper.user._id === cover.user._id) return { ok: false, error: 'Someone else must cover.' }
  const theirs = (
    await ctx.db
      .query('cageKeepers')
      .withIndex('by_keeperId_and_active', (q) => q.eq('keeperId', keeper.user._id).eq('active', true))
      .take(500)
  ).filter((a) => a.companyId === companyId)
  if (!theirs.length) return { ok: false, error: `${personName(keeper.user)} keeps no units.` }
  const units: Doc<'cages'>[] = []
  for (const a of theirs) {
    const u = await ctx.db.get(a.unitId)
    if (!u || u.archivedAt) continue
    if (!inScope(w, u.locationId)) return { ok: false, error: `${personName(keeper.user)} keeps units outside your sites.` }
    units.push(u)
  }
  units.sort(byUnitName)
  const siteId = units[0]?.locationId
  const now = await today(ctx, w, siteId)
  const fromDate = input.fromDate ?? now
  const toDate = input.toDate ?? (input.days != null ? addDays(fromDate, Math.round(input.days)) : undefined)
  if (!isBusinessDate(fromDate) || !toDate || !isBusinessDate(toDate)) return { ok: false, error: 'Give the first day away and the day they are back (YYYY-MM-DD).' }
  if (toDate <= fromDate) return { ok: false, error: 'The day they are back must be after the first day away.' }
  if (toDate <= now) return { ok: false, error: 'That cover is already over.' }
  if (addDays(fromDate, MAX_COVER_DAYS) < toDate) return { ok: false, error: `A cover can last at most ${MAX_COVER_DAYS} days.` }
  const overlap = (await coversOfKeeper(ctx, keeper.user._id, now)).find((c) => c.companyId === companyId && c.fromDate < toDate && fromDate < c.toDate)
  if (overlap) return { ok: false, error: `${personName(keeper.user)} already has cover from ${overlap.fromDate} to ${overlap.toDate}.` }

  const split: NonNullable<CoverPayload['split']> = []
  const people = new Map<string, Doc<'users'>>([[cover.user._id, cover.user]])
  for (const s of (input.split ?? []).slice(0, MAX_MOVES)) {
    const u = units.find((x) => x._id === s.unitId)
    if (!u) return { ok: false, error: 'A split unit is not one of their units.' }
    const p = people.get(s.coverId) ?? (await memberOf(ctx, companyId, s.coverId))?.user
    if (!p) return { ok: false, error: NOT_MEMBER }
    if (p._id === keeper.user._id) return { ok: false, error: 'Someone else must cover.' }
    people.set(p._id, p)
    if (s.coverId !== cover.user._id) split.push({ unitId: u._id, unitName: u.name, coverId: p._id, coverName: personName(p) })
  }
  for (const u of units) {
    const who = split.find((s) => s.unitId === u._id)?.coverId ?? cover.user._id
    const problem = await keeperProblem(ctx, companyId, who, u.locationId)
    if (problem) return { ok: false, error: `${u.name}: ${problem}` }
  }
  const note = input.note?.trim().slice(0, MAX_NOTE) || undefined
  const payload: CoverPayload = {
    kind: 'keeper_cover',
    keeperId: keeper.user._id,
    keeperName: personName(keeper.user),
    coverId: cover.user._id,
    coverName: personName(cover.user),
    fromDate,
    toDate,
    units: units.length,
    split: split.length ? split : undefined,
    note,
  }
  const names = [...new Set([payload.coverName, ...split.map((s) => s.coverName)])]
  return {
    ok: true,
    payload,
    siteId,
    date: now,
    summary: `${names.join(' and ')} cover${names.length === 1 ? 's' : ''} ${payload.keeperName}'s ${units.length} units from ${fromDate}; back on ${toDate}.`,
    fingerprint: `keeper_cover|${keeper.user._id}|${fromDate}|${toDate}`,
  }
}

async function buildNudge(ctx: MutationCtx, w: WebMember, input: Infer<typeof keeperNudgeInput>): Promise<Built | Failed> {
  const companyId = w.binding.companyId
  const date = await today(ctx, w, w.site?._id)
  const assignments = await openAssignments(ctx, companyId)
  const covers = (await openCovers(ctx, companyId, date)).filter((c) => coverActiveOn(c, date))
  const wanted = new Set<string>()
  for (const id of (input.keeperIds ?? []).slice(0, MAX_NUDGES)) wanted.add(id)
  for (const typed of (input.keepers ?? []).slice(0, 20)) {
    const p = await matchPerson(ctx, companyId, typed)
    if ('error' in p) return { ok: false, error: p.error ?? 'Which person?' }
    wanted.add(p.user._id)
  }
  // Due units by the person who should log them today (cover first).
  const due = new Map<string, Doc<'cages'>[]>()
  const logged = new Set(
    (
      await ctx.db
        .query('dailyRecords')
        .withIndex('by_company_and_date', (q) => q.eq('companyId', companyId).eq('date', date))
        .take(MAX_UNITS * 2)
    ).map((r) => r.cageId as string),
  )
  for (const a of assignments.values()) {
    if (logged.has(a.unitId)) continue
    const u = await ctx.db.get(a.unitId)
    if (!u || u.archivedAt || !needsDailyLog(u) || !inScope(w, u.locationId)) continue
    const c = covers.find((x) => x.keeperId === a.keeperId)
    const who = c ? c.split?.find((s) => s.unitId === u._id)?.coverId ?? c.coverId : a.keeperId
    if (wanted.size && !wanted.has(who) && !wanted.has(a.keeperId)) continue
    due.set(who, [...(due.get(who) ?? []), u])
  }
  const keepers: NudgePayload['keepers'] = []
  for (const [id, units] of [...due.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, MAX_NUDGES)) {
    // Someone no longer in the organization is never messaged about its units.
    const found = await memberOf(ctx, companyId, id as Id<'users'>)
    if (!found) continue
    const u = found.user
    keepers.push({ userId: id as Id<'users'>, name: personName(u), due: units.length, units: units.sort(byUnitName).slice(0, 10).map((x) => x.name) })
  }
  if (!keepers.length) return { ok: false, error: 'Nobody is behind: every unit with a keeper is logged today.' }
  const total = keepers.reduce((n, k) => n + k.due, 0)
  return {
    ok: true,
    payload: { kind: 'keeper_nudge', keepers },
    siteId: w.site?._id,
    date,
    summary: `Nudge ${keepers.length} keeper${keepers.length === 1 ? '' : 's'} on WhatsApp about ${total} unit${total === 1 ? '' : 's'} still due today: ${nameList(keepers.map((k) => k.name), 5)}.`,
    fingerprint: `keeper_nudge|${date}|${keepers.map((k) => k.userId).sort().join(',')}`,
  }
}

export async function buildKeeper(ctx: MutationCtx, w: WebMember, input: KeeperInput): Promise<Built | Failed> {
  if (input.kind === 'keeper_assign') return await buildAssign(ctx, w, input)
  if (input.kind === 'keeper_rebalance') return await buildRebalance(ctx, w, input)
  if (input.kind === 'keeper_cover') return await buildCover(ctx, w, input)
  return await buildNudge(ctx, w, input)
}

/** Why a keeper item can no longer be confirmed (re-checked at confirm and on the card), or null. */
export async function keeperItemProblem(ctx: QueryCtx, w: WebMember, row: Doc<'pendingBotActions'>): Promise<string | null> {
  const p = row.payload
  const companyId = w.binding.companyId
  if (p.kind === 'keeper_assign') {
    for (const mv of p.moves) {
      const u = await ctx.db.get(mv.unitId)
      if (!u || u.companyId !== companyId || u.archivedAt || !inScope(w, u.locationId)) return 'A unit is not in your access.'
      if (row.status === 'pending') {
        const open = await openAssignment(ctx, u._id)
        if ((open?.keeperId ?? undefined) !== mv.fromKeeperId) return `${u.name} changed keeper since this draft.`
      }
      const problem = await keeperProblem(ctx, companyId, mv.toKeeperId, u.locationId)
      if (problem) return `${u.name}: ${problem}`
    }
    if (p.backupId) {
      const problem = await keeperProblem(ctx, companyId, p.backupId, undefined)
      if (problem) return `Backup: ${problem}`
    }
    return null
  }
  if (p.kind === 'keeper_cover') {
    for (const id of [p.keeperId, p.coverId, ...(p.split ?? []).map((s) => s.coverId)]) {
      const problem = await keeperProblem(ctx, companyId, id, undefined)
      if (problem) return problem
    }
    if (row.status === 'pending') {
      const overlap = (await coversOfKeeper(ctx, p.keeperId, row.date)).find(
        (c) => c.companyId === companyId && c.fromDate < p.toDate && p.fromDate < c.toDate,
      )
      if (overlap) return `${p.keeperName} already has cover from ${overlap.fromDate} to ${overlap.toDate}.`
    }
    return null
  }
  if (p.kind === 'keeper_nudge') {
    for (const k of p.keepers) {
      if (!(await memberOf(ctx, companyId, k.userId))) return `${k.name} is not an active member.`
    }
    return null
  }
  return null
}

/** Write a confirmed keeper item (inside drafts.confirm's transaction). */
export async function commitKeeper(ctx: MutationCtx, w: WebMember, row: Doc<'pendingBotActions'>, now: number) {
  const p = row.payload
  const companyId = w.binding.companyId
  const me = w.account._id
  if (p.kind === 'keeper_assign') {
    const gained = new Map<string, string[]>()
    for (const mv of p.moves) {
      const unit = await ctx.db.get(mv.unitId)
      if (!unit) continue
      const date = await farmDate(ctx, w, unit.locationId, now)
      const open = await openAssignment(ctx, unit._id)
      if (open) await ctx.db.patch(open._id, { active: false, untilDate: date, endedBy: me, endedAt: now })
      const backupId = p.backupId ?? (open?.backupId !== mv.toKeeperId ? open?.backupId : undefined)
      await ctx.db.insert('cageKeepers', {
        companyId,
        unitId: unit._id,
        locationId: unit.locationId,
        keeperId: mv.toKeeperId,
        backupId: backupId === mv.toKeeperId ? undefined : backupId,
        sinceDate: date,
        active: true,
        assignedBy: me,
        assignedAt: now,
        sourceDraft: row._id,
        replaces: open?._id,
      })
      gained.set(mv.toKeeperId, [...(gained.get(mv.toKeeperId) ?? []), unit.name])
    }
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'cageKeepers',
      recordId: row._id,
      newValues: { moves: p.moves.map((m) => ({ unit: m.unitName, from: m.fromName ?? null, to: m.toName })), backup: p.backupName ?? null },
      locationId: row.siteId,
    })
    for (const [userId, units] of gained) {
      const u = await ctx.db.get(userId as Id<'users'>)
      if (!u) continue
      await notifyUsers(ctx, {
        companyId,
        users: [u],
        channels: ['in_app'],
        title: units.length === 1 ? `You now keep ${units[0]}` : `You now keep ${units.length} more units`,
        message: `${nameList(units, 6)}. They are in My cages with daily reminders.`,
        link: '/my-cages',
        dedupeKey: `keeper-assigned:${row._id}`,
        source: 'keepers.assign',
      })
    }
    return
  }
  if (p.kind === 'keeper_cover') {
    const id = await ctx.db.insert('keeperCovers', {
      companyId,
      keeperId: p.keeperId,
      coverId: p.coverId,
      split: p.split?.map((s) => ({ unitId: s.unitId, coverId: s.coverId })),
      fromDate: p.fromDate,
      toDate: p.toDate,
      note: p.note,
      createdBy: me,
      createdAt: now,
      sourceDraft: row._id,
    })
    await logAudit(ctx, { actionType: 'create', tableName: 'keeperCovers', recordId: id, newValues: p, locationId: row.siteId })
    const people = new Map<string, number>([[p.coverId, p.units - (p.split?.length ?? 0)]])
    for (const s of p.split ?? []) people.set(s.coverId, (people.get(s.coverId) ?? 0) + 1)
    for (const [userId, n] of people) {
      if (n <= 0) continue
      const u = await ctx.db.get(userId as Id<'users'>)
      if (!u) continue
      await notifyUsers(ctx, {
        companyId,
        users: [u],
        channels: ['in_app', 'whatsapp'],
        title: `You cover ${p.keeperName}'s ${n} unit${n === 1 ? '' : 's'} from ${p.fromDate}`,
        message: `Until ${p.keeperName} is back on ${p.toDate} they are in My cages with daily reminders.${p.note ? ` Handover: ${p.note}` : ''}`,
        link: '/my-cages',
        dedupeKey: `keeper-cover:${id}`,
        source: 'keepers.cover',
      })
    }
    return
  }
  if (p.kind === 'keeper_nudge') {
    for (const k of p.keepers) {
      const u = (await memberOf(ctx, companyId, k.userId))?.user
      if (!u) continue
      // One manual nudge per keeper per day, whoever sends it.
      await alertOnce(ctx, companyId, u, `keeper-nudge:${row.date}`, {
        title: `${k.due} unit${k.due === 1 ? '' : 's'} still to log today`,
        message: `${nameList(k.units, 6)}${k.due > k.units.length ? ` and ${k.due - k.units.length} more` : ''}. Open My cages to log them.`,
        link: '/my-cages',
        source: 'keepers.nudge',
      })
    }
    await logAudit(ctx, { actionType: 'notify', tableName: 'cageKeepers', recordId: row._id, newValues: { nudged: p.keepers.length } })
  }
}

/** Can this saved keeper item still be undone? (Nudges are sent: undo leaves them.) */
export async function keeperUndoable(ctx: QueryCtx, row: Doc<'pendingBotActions'>): Promise<boolean> {
  const p = row.payload
  if (p.kind === 'keeper_assign') {
    const rows = await ctx.db
      .query('cageKeepers')
      .withIndex('by_sourceDraft', (q) => q.eq('sourceDraft', row._id))
      .take(MAX_MOVES + 1)
    return rows.every((r) => r.active)
  }
  if (p.kind === 'keeper_cover') {
    const c = await ctx.db
      .query('keeperCovers')
      .withIndex('by_sourceDraft', (q) => q.eq('sourceDraft', row._id))
      .first()
    return !!c && !c.cancelledAt
  }
  return true
}

export async function undoKeeper(ctx: MutationCtx, w: WebMember, row: Doc<'pendingBotActions'>, now: number) {
  const p = row.payload
  if (p.kind === 'keeper_assign') {
    const rows = await ctx.db
      .query('cageKeepers')
      .withIndex('by_sourceDraft', (q) => q.eq('sourceDraft', row._id))
      .take(MAX_MOVES + 1)
    for (const r of rows) {
      await ctx.db.delete(r._id)
      if (r.replaces) {
        const prev = await ctx.db.get(r.replaces)
        if (prev && !prev.active && prev.endedAt === r.assignedAt) {
          await ctx.db.patch(prev._id, { active: true, untilDate: undefined, endedBy: undefined, endedAt: undefined })
        }
      }
    }
    await logAudit(ctx, { actionType: 'delete', tableName: 'cageKeepers', recordId: row._id, previousValues: { moves: p.moves.length } })
  } else if (p.kind === 'keeper_cover') {
    const c = await ctx.db
      .query('keeperCovers')
      .withIndex('by_sourceDraft', (q) => q.eq('sourceDraft', row._id))
      .first()
    if (c) {
      await ctx.db.patch(c._id, { cancelledAt: now, cancelledBy: w.account._id })
      await logAudit(ctx, { actionType: 'update', tableName: 'keeperCovers', recordId: c._id, newValues: { cancelled: true } })
    }
  }
}
