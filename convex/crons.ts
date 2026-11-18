import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

// 16:00 UTC is 4pm in Accra: late enough that the day's feeding is done,
// early enough to fix gaps before dark. (crons.cron, not crons.daily: the
// Convex guidelines allow only cron/interval.)
crons.cron(
  'daily entry and low stock reminders',
  '0 16 * * *',
  internal.reminders.dailyDigest,
  {},
)

// 01:30 UTC, after the day's entries: compare cage counts with the stock
// ledger and tell admins about any drift (PROD-005).
crons.cron('stock ledger reconciliation', '30 1 * * *', internal.reconciliation.run, {})

// Outbox replay keys older than 30 days (MOBILE-002).
crons.cron('prune idempotency keys', '30 3 * * *', internal.idempotency.prune, {})

// Domain-event outbox (convex/events.ts): webhooks and automation consume
// events within a minute of the change.
crons.interval('dispatch domain events', { minutes: 1 }, internal.events.dispatchPending, {})

// Public API idempotency keys are kept 30 days (INT-004).
crons.cron('prune api idempotency keys', '30 3 * * *', internal.publicApi.pruneIdempotencyKeys, {})

export default crons
