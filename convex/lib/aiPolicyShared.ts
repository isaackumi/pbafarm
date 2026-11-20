import { v, type Infer } from 'convex/values'

/**
 * Organization AI policy (Anowa): what the assistant may do beyond answering
 * questions, set by an admin with org.settings.manage. Who may use Anowa at
 * all stays a role permission (`ai.use`) and the company switch
 * (`settings.aiAssistantEnabled`).
 *
 * Validators and pure helpers only (schema.ts imports this file); the
 * Convex-side daily cap lives in ./aiPolicy.
 */
export const MIN_DAILY_QUESTIONS = 1
export const MAX_DAILY_QUESTIONS = 500

/** Stored on companies.settings.aiPolicy; every field optional (defaults below). */
export const aiPolicyValidator = v.object({
  /** Anowa may turn a request into an automation draft. Default true. */
  allowAutomationDrafts: v.optional(v.boolean()),
  /** Automations created from a draft start paused. Default true. */
  draftsStartPaused: v.optional(v.boolean()),
  /** Assistant requests per member per 24 hours; absent = no daily cap. */
  dailyQuestionsPerMember: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
  updatedBy: v.optional(v.id('users')),
})

/** The policy with defaults filled in, as clients see it. */
export const resolvedAiPolicyValidator = v.object({
  allowAutomationDrafts: v.boolean(),
  draftsStartPaused: v.boolean(),
  dailyQuestionsPerMember: v.union(v.number(), v.null()),
})

export type StoredAiPolicy = Infer<typeof aiPolicyValidator>
export type AiPolicy = Infer<typeof resolvedAiPolicyValidator>

export const DEFAULT_AI_POLICY: AiPolicy = {
  allowAutomationDrafts: true,
  draftsStartPaused: true,
  dailyQuestionsPerMember: null,
}

/** A valid daily cap, or null for none. */
export function cleanDailyCap(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const n = Math.floor(value)
  if (n < MIN_DAILY_QUESTIONS || n > MAX_DAILY_QUESTIONS) return null
  return n
}

export function resolveAiPolicy(stored: StoredAiPolicy | undefined | null): AiPolicy {
  return {
    allowAutomationDrafts: stored?.allowAutomationDrafts ?? DEFAULT_AI_POLICY.allowAutomationDrafts,
    draftsStartPaused: stored?.draftsStartPaused ?? DEFAULT_AI_POLICY.draftsStartPaused,
    dailyQuestionsPerMember: cleanDailyCap(stored?.dailyQuestionsPerMember),
  }
}

/** Structural, so schema.ts can import this file without a type cycle. */
export function aiPolicyOf(company: { settings?: { aiPolicy?: StoredAiPolicy } } | null | undefined): AiPolicy {
  return resolveAiPolicy(company?.settings?.aiPolicy)
}

