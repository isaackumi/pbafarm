/**
 * Pure helpers for the platform console (Paper 40/44). Inputs are the
 * existing console reads (platform.tenants.list/detail,
 * platform.billing.listSubscriptions); nothing here talks to Convex.
 */

const DAY = 24 * 60 * 60 * 1000

/** Tenant list tabs: each maps to the `state` / `subscriptionStatus` filters of platform.tenants.list. */
export const TENANT_TABS = [
  { value: 'all', filter: {} },
  { value: 'active', filter: { state: 'active' } },
  { value: 'trialing', filter: { subscriptionStatus: 'trialing' } },
  { value: 'past_due', filter: { subscriptionStatus: 'past_due' } },
  { value: 'suspended', filter: { state: 'suspended' } },
  { value: 'pending', filter: { state: 'pending' } },
  { value: 'rejected', filter: { state: 'rejected' } },
]

export function tenantTabFilter(tab) {
  return (TENANT_TABS.find((t) => t.value === tab) || TENANT_TABS[0]).filter
}

/** Tab counts from platform.overview.kpis. */
export function tenantTabCounts(kpis) {
  if (!kpis) return {}
  return {
    all: kpis.tenants.total,
    active: kpis.tenants.active,
    trialing: kpis.subscriptions.trialing,
    past_due: kpis.subscriptions.past_due,
    suspended: kpis.tenants.suspended,
    pending: kpis.tenants.pending,
    rejected: kpis.tenants.rejected,
  }
}

/**
 * One status per tenant row, most urgent first: the organization state
 * (suspended, pending, rejected) wins over the subscription's.
 * Returns { key, tone } where tone is a StatusDot / Badge tone.
 */
export function tenantStatus(state, subscriptionStatus) {
  if (state === 'suspended') return { key: 'suspended', tone: 'alert' }
  if (state === 'rejected') return { key: 'rejected', tone: 'neutral' }
  if (state === 'pending') return { key: 'pending', tone: 'cyan' }
  if (subscriptionStatus === 'past_due') return { key: 'past_due', tone: 'warn' }
  if (subscriptionStatus === 'suspended') return { key: 'suspended', tone: 'alert' }
  if (subscriptionStatus === 'trialing') return { key: 'trialing', tone: 'cyan' }
  if (subscriptionStatus === 'cancelled') return { key: 'cancelled', tone: 'neutral' }
  if (subscriptionStatus === 'active') return { key: 'active', tone: 'good' }
  return { key: 'no_plan', tone: 'neutral' }
}

/** listSubscriptions is newest first; keep each company's latest subscription. */
function latestPerCompany(subs) {
  const seen = new Set()
  const out = []
  for (const s of subs || []) {
    if (seen.has(s.companyId)) continue
    seen.add(s.companyId)
    out.push(s)
  }
  return out
}

/**
 * Renewals in the next `days`: paid periods ending, trials ending and
 * grace periods running out, soonest first.
 */
export function upcomingRenewals(subs, now, days = 7) {
  const until = now + days * DAY
  const out = []
  for (const s of latestPerCompany(subs)) {
    const at =
      s.status === 'trialing'
        ? s.trialEndsAt
        : s.status === 'past_due'
          ? s.graceEndsAt
          : s.status === 'active'
            ? s.currentPeriodEnd
            : null
    if (at != null && at >= now && at <= until) out.push({ ...s, at })
  }
  return out.sort((a, b) => a.at - b.at)
}

/** Live subscriptions per plan (cancelled excluded), largest first. */
export function planMix(subs) {
  const counts = new Map()
  for (const s of latestPerCompany(subs)) {
    if (s.status === 'cancelled') continue
    counts.set(s.planName, (counts.get(s.planName) || 0) + 1)
  }
  return [...counts.entries()].map(([plan, count]) => ({ plan, count })).sort((a, b) => b.count - a.count || a.plan.localeCompare(b.plan))
}

/** Whole days left until `at` (rounded up; 0 once passed). */
export function daysUntil(at, now) {
  if (at == null) return null
  return Math.max(0, Math.ceil((at - now) / DAY))
}

/** The open invoice due soonest, or null. */
export function nextOpenInvoice(invoices) {
  return (invoices || []).filter((i) => i.status === 'open' && i.totalMinor > i.paidMinor).sort((a, b) => a.dueAt - b.dueAt)[0] || null
}

/** `used` and `max` for one limit kind of tenants.detail `limits`. */
export function limitOf(limits, kind) {
  const l = (limits || []).find((x) => x.kind === kind)
  return l ? { used: l.used, max: l.max } : null
}
