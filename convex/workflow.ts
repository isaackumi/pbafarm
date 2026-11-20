/**
 * Durable workflows (@convex-dev/workflow, research doc §1.3). The first user
 * is the farm bot's voice-note pipeline (bot/voice.ts, BOT-005). Action
 * steps are not retried by default: each step does its own HTTP retries
 * (effectHttp) and the reply step sends chat messages, which must not repeat.
 */
import { WorkflowManager } from '@convex-dev/workflow'
import { components } from './_generated/api'

export const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: { maxParallelism: 10, retryActionsByDefault: false },
})
