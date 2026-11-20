/**
 * HTML email for a notification delivery (approvals, automation alerts, the
 * weekly report), rendered when the send starts so the stored delivery rows
 * stay small. Picks the template from the dispatch data:
 *   approval → E4, weekly → E6, anything else → E5 (urgent when level=error).
 * The text part replaces the delivery body for email; SMS/WhatsApp are untouched.
 */
import type { QueryCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import type { DispatchEmail, EmailReading, RunDelivery } from '../automation/validators'
import { alertEmail, approvalEmail, emailContext, weeklySummaryEmail, type EmailContent } from './emailTemplates'

const APPROVAL_PATH: Record<NonNullable<DispatchEmail['approval']>['kind'], string> = {
  stocking: '/approvals',
  topup: '/approvals',
  transfer: '/approvals',
  join_request: '/users',
}

export function renderNotificationEmail(opts: {
  locale: string | undefined
  orgName: string
  source: string
  email?: DispatchEmail
  delivery: Pick<RunDelivery, 'subject' | 'body' | 'link' | 'level' | 'unitName' | 'reading'>
  env?: Record<string, string | undefined>
}): EmailContent {
  const ctx = emailContext(opts.locale, opts.env)
  const d = opts.delivery
  if (opts.email?.approval) {
    const a = opts.email.approval
    return approvalEmail(ctx, {
      kind: a.kind,
      requesterName: a.requesterName,
      summary: a.summary,
      orgName: opts.orgName,
      path: d.link ?? APPROVAL_PATH[a.kind],
      waitedHours: a.waitedHours,
    })
  }
  if (opts.email?.weekly) {
    const w = opts.email.weekly
    return weeklySummaryEmail(ctx, {
      orgName: opts.orgName,
      siteName: w.siteName,
      weekStart: w.weekStart,
      weekEnd: w.weekEnd,
      units: w.units,
      goodNumber: w.goodNumber ?? null,
      things: w.things,
      report: d.body,
      path: d.link ?? '/weekly-report',
    })
  }
  const steps = opts.email?.alert?.steps ?? []
  // The in-app message often ends with the first step; say it once.
  const message = steps[0] && d.body.endsWith(steps[0]) ? d.body.slice(0, -steps[0].length).trim() : d.body
  return alertEmail(ctx, {
    title: d.subject,
    message,
    steps,
    level: d.level ?? 'info',
    orgName: opts.orgName,
    path: d.link,
    unitName: d.unitName,
    reading: d.reading,
  })
}

/** Locale per recipient and the company name, read once per send. */
export async function notificationEmailReader(ctx: Pick<QueryCtx, 'db'>, companyId: Id<'companies'>) {
  const company = await ctx.db.get(companyId)
  const orgName = company?.name ?? ''
  const locales = new Map<string, string | undefined>()
  return {
    orgName,
    async locale(userId: Id<'users'>) {
      const key = String(userId)
      if (!locales.has(key)) locales.set(key, (await ctx.db.get(userId))?.locale)
      return locales.get(key)
    },
  }
}

/**
 * The first out-of-range reading of a water-quality breach event
 * (convex/waterQuality.ts adds breach* fields), for the E5 reading band.
 */
export function readingFromPayload(payload: unknown): { unitName?: string; reading?: EmailReading } {
  if (!payload || typeof payload !== 'object') return {}
  const p = payload as Record<string, unknown>
  const unitName = typeof p.unitName === 'string' && p.unitName ? p.unitName.slice(0, 60) : undefined
  const { breachLabel, breachValue, breachLimit, breachDirection, breachUnit } = p
  if (
    typeof breachLabel !== 'string' ||
    typeof breachValue !== 'number' ||
    typeof breachLimit !== 'number' ||
    !Number.isFinite(breachValue) ||
    !Number.isFinite(breachLimit) ||
    (breachDirection !== 'low' && breachDirection !== 'high')
  ) {
    return { unitName }
  }
  return {
    unitName,
    reading: {
      label: breachLabel.slice(0, 60),
      value: breachValue,
      limit: breachLimit,
      direction: breachDirection,
      ...(typeof breachUnit === 'string' && breachUnit ? { unit: breachUnit.slice(0, 16) } : {}),
    },
  }
}
