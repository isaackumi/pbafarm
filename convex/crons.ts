import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

// 16:00 UTC is 4pm in Accra: late enough that the day's feeding is done,
// early enough to fix gaps before dark.
crons.daily(
  'daily entry and low stock reminders',
  { hourUTC: 16, minuteUTC: 0 },
  internal.reminders.dailyDigest,
  {},
)

export default crons
