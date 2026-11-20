import type { MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { MAX_ATTEMPTS, companyZone, prefsFor, safeLink } from '../automation/engine'
import { inQuietHours } from '../automation/schedule'
import type { DispatchEmail, EmailReading, RunDelivery } from '../automation/validators'

/**
 * System notifications on every channel (AUTO-003), for server code that is
 * not an automation rule (approval alerts, AUTO-004).
 *
 * Same rules as automation notify actions (convex/automation/engine.ts):
 * each person's channel preferences, quiet hours in the company time zone
 * (external channels only), and a missing phone/email skips that channel.
 * In-app rows are written now; SMS/WhatsApp/email are recorded on a
 * `notificationDispatches` row and sent after commit by
 * convex/notificationDispatch.ts through the company's messaging route.
 */
export type NotifyChannel = 'in_app' | 'sms' | 'whatsapp' | 'email'

export const MAX_DISPATCH_DELIVERIES = 50

export async function notifyUsers(
  ctx: MutationCtx,
  opts: {
    companyId: Id<'companies'>
    users: Doc<'users'>[]
    channels: NotifyChannel[]
    title: string
    message: string
    link?: string
    level?: 'info' | 'warning' | 'error'
    /** Per-user in-app dedupe: `${dedupeKey}:${userId}` is never written twice. */
    dedupeKey?: string
    /** Recorded on the dispatch, e.g. 'approval.requested'. */
    source: string
    /** Email only: data for the HTML template (convex/lib/notificationEmail.ts). */
    email?: DispatchEmail
    unitName?: string
    reading?: EmailReading
  },
): Promise<{ notified: number; deliveries: number; dispatchId: Id<'notificationDispatches'> | null }> {
  const { tz } = await companyZone(ctx, opts.companyId)
  const now = Date.now()
  const link = safeLink(opts.link)
  const channels = new Set(opts.channels)
  const deliveries: RunDelivery[] = []
  let notified = 0
  const seen = new Set<string>()

  for (const u of opts.users) {
    const key = String(u._id)
    if (seen.has(key)) continue
    seen.add(key)
    const dedupeKey = opts.dedupeKey ? `${opts.dedupeKey}:${key}` : undefined
    if (dedupeKey) {
      const dup = await ctx.db
        .query('notifications')
        .withIndex('by_dedupe', (q) => q.eq('dedupeKey', dedupeKey))
        .first()
      if (dup) continue
    }
    const p = await prefsFor(ctx, u._id)
    if (channels.has('in_app') && p.inApp) {
      await ctx.db.insert('notifications', {
        userId: u._id,
        title: opts.title,
        message: opts.message,
        type: opts.level ?? 'info',
        read: false,
        link,
        companyId: opts.companyId,
        dedupeKey,
      })
      notified += 1
    }
    for (const channel of ['sms', 'whatsapp', 'email'] as const) {
      if (!channels.has(channel) || !p[channel]) continue
      if (deliveries.length >= MAX_DISPATCH_DELIVERIES) break
      const to = channel === 'email' ? u.email : u.phone
      const body = channel === 'email' ? opts.message : `${opts.title}: ${opts.message}`
      const base = {
        channel,
        userId: u._id,
        to: to ?? '',
        subject: opts.title,
        body,
        attempts: 0,
        ...(channel === 'email'
          ? { link, level: opts.level ?? 'info', unitName: opts.unitName, reading: opts.reading }
          : {}),
      }
      if (!to) {
        deliveries.push({ ...base, status: 'skipped', error: channel === 'email' ? 'No email address' : 'No phone number' })
      } else if (inQuietHours(p.quietHours, now, tz)) {
        deliveries.push({ ...base, status: 'skipped', error: 'Quiet hours' })
      } else {
        deliveries.push({ ...base, status: 'pending' })
      }
    }
  }

  const pending = deliveries.filter((d) => d.status === 'pending').length
  if (!deliveries.length) return { notified, deliveries: 0, dispatchId: null }
  const dispatchId = await ctx.db.insert('notificationDispatches', {
    companyId: opts.companyId,
    source: opts.source,
    title: opts.title.slice(0, 200),
    status: pending ? 'queued' : 'skipped',
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    deliveries,
    email: opts.email,
    createdAt: now,
    ...(pending ? {} : { finishedAt: now }),
  })
  if (pending) {
    await ctx.scheduler.runAfter(0, internal.notificationDispatch.send, { dispatchId })
  }
  return { notified, deliveries: pending, dispatchId }
}
