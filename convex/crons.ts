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

export default crons
