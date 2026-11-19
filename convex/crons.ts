import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

// 16:00 UTC is 4pm in Accra: late enough that the day's feeding is done,
// early enough to fix gaps before dark. (crons.cron, not crons.daily: the
// Convex guidelines allow only cron/interval.) Companies whose reminders
// moved onto automation rules are skipped (reminders.companyDigest).
crons.cron(
  'daily entry and low stock reminders',
  '0 16 * * *',
  internal.reminders.dailyDigest,
  {},
)

// Automation engine (AUTO-002): queue schedule rules that are due, each in
// its company's time zone.
crons.interval('automation tick', { minutes: 5 }, internal.automation.engine.tick, {})

// Domain event outbox retention (30 days).
crons.cron('prune domain events', '45 3 * * *', internal.automation.engine.pruneEvents, {})

// System notification sends (AUTO-003): same 30-day retention.
crons.cron('prune notification dispatches', '50 3 * * *', internal.notificationDispatch.prune, {})

// 01:30 UTC, after the day's entries: compare cage counts with the stock
// ledger and tell admins about any drift (PROD-005).
crons.cron('stock ledger reconciliation', '30 1 * * *', internal.reconciliation.run, {})

// Outbox replay keys older than 30 days (MOBILE-002).
crons.cron('prune idempotency keys', '30 3 * * *', internal.idempotency.prune, {})

// Rollups (PLAT-002): recompute occupancies changed since the last run.
crons.interval('rollup dirty occupancies', { minutes: 5 }, internal.rollups.processDirty, {})

// 00:30 UTC: roll open occupancies to the new day (days of culture, snapshots).
crons.cron('rollup open occupancies', '30 0 * * *', internal.rollups.queueOpen, {})

// Public API idempotency keys are kept 30 days (INT-004).
crons.cron('prune api idempotency keys', '30 3 * * *', internal.publicApi.pruneIdempotencyKeys, {})

// Webhook delivery log is kept 30 days (INT-005).
crons.cron('prune webhook deliveries', '45 3 * * *', internal.webhooks.pruneDeliveries, {})

// Inbound webhook event log is kept 30 days (INT-003).
crons.cron('prune inbound webhook events', '50 3 * * *', internal.inboundWebhooks.pruneEvents, {})

// LLM usage log is kept 400 days (INT-009).
crons.cron('prune llm usage', '55 3 * * *', internal.llmGateway.pruneUsage, {})

// 03:00 UTC: yesterday's weather and a short forecast for sites with
// coordinates (INT-006). Open-Meteo, no key.
crons.cron('fetch site weather', '0 3 * * *', internal.weather.refreshAll, {})

// Expired document download tokens (TRACE-005).
crons.cron('prune file download tokens', '15 4 * * *', internal.files.pruneDownloadTokens, {})

// 02:15 UTC: verify every organization's audit hash chain (TRACE-007).
crons.cron('verify audit chains', '15 2 * * *', internal.audit.verifyAll, {})

// 04:30 UTC: data governance (ENT-005): finish deletion requests past their
// grace period, purge audit rows past retention, delete expired exports.
crons.cron('process data requests', '30 4 * * *', internal.governance.processDueRequests, {})
crons.cron('prune data exports', '45 4 * * *', internal.governance.pruneExports, {})

// 06:00 UTC: equipment and asset servicing due in 3 days or overdue
// (INV-012), one bounded job per company.
crons.cron('equipment maintenance reminders', '0 6 * * *', internal.equipment.maintenanceReminders, {})

// Scheduled report emails (ANLY-007): queue due schedules, each in its own
// time zone; the delivery log is kept 90 days.
crons.interval('report schedules tick', { minutes: 15 }, internal.reportSchedules.tick, {})
crons.cron('prune report deliveries', '55 3 * * *', internal.reportSchedules.prune, {})

// 05:00 UTC: subscription lifecycle (PLAT-108): trials and unpaid manual
// periods go past_due, past_due past grace (BILLING_GRACE_DAYS) suspends.
crons.cron('billing lifecycle', '0 5 * * *', internal.billing.lifecycle.runDaily, {})

// 00:40 UTC: yesterday's per-organization usage for the platform console (PLAT-110).
crons.cron('platform usage rollup', '40 0 * * *', internal.platform.usage.rollupYesterday, {})

// 05:00 UTC: early-warning alerts (AI-001) on yesterday, in each company's
// time zone; a few units per job, idempotent per unit/day/rule.
crons.cron('farm early-warning alerts', '0 5 * * *', internal.farmAlerts.tick, {})

// Monday 06:30 UTC: weekly report (AI-003) per site and company-wide for the
// week that ended on Sunday, delivered in-app and by email.
crons.cron('weekly farm reports', '30 6 * * 1', internal.aiReports.weeklyTick, {})

export default crons
