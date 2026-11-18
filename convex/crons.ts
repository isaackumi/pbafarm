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

// Outbox replay keys older than 30 days (MOBILE-002).
crons.cron('prune idempotency keys', '30 3 * * *', internal.idempotency.prune, {})

export default crons
