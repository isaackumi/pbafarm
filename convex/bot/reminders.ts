/**
 * Daily entry reminders over chat (BOT-004, doc 23 §8). Opt-in per binding
 * with the user's time and timezone (set on /account). Lists the units in the
 * binding's scope with no entry for today. Inside WhatsApp's 24-hour window
 * the reminder is a free-form message with buttons; outside it, the approved
 * utility template `farm_daily_reminder` (EN/FR) with quick replies.
 * Telegram is always free-form.
 */
import { v } from 'convex/values'
import { internalAction, internalMutation, internalQuery } from '../_generated/server'
import { internal } from '../_generated/api'
import { can } from '../lib/permissions'
import { todayIn } from '../lib/dates'
import { isValidTimezone } from '../lib/orgProfile'
import { checkBinding } from './scope'
import { missingToday } from './reads'
import { REMINDER_TEMPLATES, t } from './i18n'
import { chatMessage, targetValidator, type ChatMessageValue } from './validators'
import { deliver } from './outbound'
import { ownUnitIds } from '../keepers/escalation'

const WINDOW_MS = 24 * 60 * 60 * 1000
/** A reminder is sent from its time until this many minutes later (cron runs every 15). */
const SEND_SPAN_MIN = 180

function minutesIn(timeZone: string, now: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(now))
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return h * 60 + m
}

function hhmm(value: string | undefined): number {
  const m = /^(\d{2}):(\d{2})$/.exec(value ?? '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : 17 * 60
}

/** Every 15 minutes: schedule the reminders that are due now. */
export const tick = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now()
    const rows = await ctx.db
      .query('channelBindings')
      .withIndex('by_reminderEnabled', (q) => q.eq('reminderEnabled', true))
      .take(1000)
    let queued = 0
    for (const b of rows) {
      if (b.revokedAt) continue
      const tz = b.reminderTimezone && isValidTimezone(b.reminderTimezone) ? b.reminderTimezone : 'UTC'
      const today = todayIn(tz, now)
      if (b.lastReminderDate === today) continue
      const since = minutesIn(tz, now) - hhmm(b.reminderTime)
      if (since < 0 || since > SEND_SPAN_MIN) continue
      await ctx.db.patch(b._id, { lastReminderDate: today })
      await ctx.scheduler.runAfter(0, internal.bot.reminders.send, { bindingId: b._id })
      queued++
    }
    return queued
  },
})

/** The reminder for one binding, or null when nothing is missing or the binding is dead. */
export const compose = internalQuery({
  args: { bindingId: v.id('channelBindings') },
  returns: v.union(v.null(), v.object({ target: targetValidator, messages: v.array(chatMessage) })),
  handler: async (ctx, { bindingId }) => {
    const binding = await ctx.db.get(bindingId)
    if (!binding || !binding.reminderEnabled) return null
    const checked = await checkBinding(ctx, binding)
    if (!checked.ok) return null
    const bound = checked.bound
    if (!can(bound.member, 'production.view')) return null
    const today = await missingToday(ctx, bound, Date.now())
    // A cage keeper is reminded of their own units only (cover included).
    const own = today.date ? await ownUnitIds(ctx, binding.companyId, binding.userId, today.date) : null
    const missing = own ? today.missing.filter((u) => own.has(u._id)) : today.missing
    if (!missing.length) return null
    const s = t(bound.locale)
    const names = missing.slice(0, 15).map((u) => u.name).join(', ') + (missing.length > 15 ? ', …' : '')
    const body = s.reminderBody(missing.length, names)
    const buttons = [
      { id: 'rem:enter', title: s.enterNow },
      { id: 'rem:later', title: s.remindLater },
      { id: 'rem:stop', title: s.stopReminders },
    ]
    const inWindow = (binding.lastInboundAt ?? 0) > Date.now() - WINDOW_MS
    const tpl = REMINDER_TEMPLATES[bound.locale]
    const message: ChatMessageValue =
      binding.provider === 'telegram' || inWindow
        ? { kind: 'buttons', text: body, buttons }
        : {
            kind: 'template',
            name: tpl.name,
            language: tpl.language,
            bodyParams: [String(missing.length), names],
            quickReplies: buttons.map((b) => b.id),
            fallbackText: body,
            fallbackButtons: buttons,
          }
    return {
      target: {
        provider: binding.provider,
        address: binding.address,
        companyId: binding.companyId,
        bindingId: binding._id,
        locale: bound.locale,
      },
      messages: [message],
    }
  },
})

export const send = internalAction({
  args: { bindingId: v.id('channelBindings') },
  returns: v.null(),
  handler: async (ctx, { bindingId }) => {
    const r = await ctx.runQuery(internal.bot.reminders.compose, { bindingId })
    if (r) await deliver(ctx, r.target, r.messages)
    return null
  },
})
