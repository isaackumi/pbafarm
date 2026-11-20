import { defineApp } from 'convex/server'
import rateLimiter from '@convex-dev/rate-limiter/convex.config'
import agent from '@convex-dev/agent/convex.config'
import workflow from '@convex-dev/workflow/convex.config'

// Components (D-017): application rate limits live in the rate limiter's own
// tables, see convex/lib/rateLimits.ts. The farm bot's conversation threads
// live in the agent component (doc 23). Durable pipelines (voice notes,
// BOT-005) run on the workflow component.
const app = defineApp()
app.use(rateLimiter)
app.use(agent)
app.use(workflow)

export default app
