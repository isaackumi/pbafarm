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

// 01:30 UTC, after the day's entries: compare cage counts with the stock
// ledger and tell admins about any drift (PROD-005).
crons.cron('stock ledger reconciliation', '30 1 * * *', internal.reconciliation.run, {})

// Outbox replay keys older than 30 days (MOBILE-002).
crons.cron('prune idempotency keys', '30 3 * * *', internal.idempotency.prune, {})

// Public API idempotency keys are kept 30 days (INT-004).
crons.cron('prune api idempotency keys', '30 3 * * *', internal.publicApi.pruneIdempotencyKeys, {})

// Webhook delivery log is kept 30 days (INT-005).
crons.cron('prune webhook deliveries', '45 3 * * *', internal.webhooks.pruneDeliveries, {})

// 03:00 UTC: yesterday's weather and a short forecast for sites with
// coordinates (INT-006). Open-Meteo, no key.
crons.cron('fetch site weather', '0 3 * * *', internal.weather.refreshAll, {})

export default crons
