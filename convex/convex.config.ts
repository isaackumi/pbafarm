import { defineApp } from 'convex/server'
import rateLimiter from '@convex-dev/rate-limiter/convex.config'

// Components (D-017): application rate limits live in the rate limiter's own
// tables, see convex/lib/rateLimits.ts.
const app = defineApp()
app.use(rateLimiter)

export default app
