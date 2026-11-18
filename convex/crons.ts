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
crons.cron('prune domain events', '30 3 * * *', internal.automation.engine.pruneEvents, {})

export default crons
