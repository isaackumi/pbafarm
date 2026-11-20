import { v, type Infer } from 'convex/values'
import { DEFAULT_SETTINGS } from '../lib/farmRules'
import { CHECKS } from './checks'
import { MAX_CONDITIONS } from './conditions'
import { EVENT_TYPES } from './templates'
import { automationRecipients, conditionOp, notifyChannel } from './validators'

/**
 * What an automation can be built from, for Anowa's drafts (AI-AUTO-001).
 * Derived from the code that runs rules (event catalog, CHECKS, farm rule
 * defaults, the rule validators), so there is no second list to keep in sync.
 */

export const MAX_ACTIONS = 5

/** Literal values of a union validator of literals. */
function literals(union: { members: readonly { value?: unknown }[] }): string[] {
  return union.members.map((m) => String(m.value))
}

const recipientRoles = (() => {
  const roles = automationRecipients.fields.roles as unknown as {
    element: { members: readonly { value?: unknown }[] }
  }
  return literals(roles.element)
})()

export const draftCatalogValidator = v.object({
  timezone: v.string(),
  eventTypes: v.array(v.object({ type: v.string(), label: v.string(), fields: v.array(v.string()) })),
  checks: v.array(
    v.object({
      key: v.string(),
      label: v.string(),
      description: v.string(),
      fields: v.array(v.string()),
      params: v.array(v.object({ key: v.string(), label: v.string(), default: v.optional(v.number()) })),
    }),
  ),
  farmRuleKeys: v.array(v.string()),
  conditionOps: v.array(v.string()),
  channels: v.array(v.string()),
  recipientRoles: v.array(v.string()),
  maxConditions: v.number(),
  maxActions: v.number(),
})

export type DraftCatalog = Infer<typeof draftCatalogValidator>

export function buildDraftCatalog(timezone: string): DraftCatalog {
  return {
    timezone,
    eventTypes: EVENT_TYPES.map((e) => ({ type: e.type, label: e.label, fields: [...e.fields] })),
    checks: Object.entries(CHECKS).map(([key, c]) => ({
      key,
      label: c.label,
      description: c.description,
      fields: [...c.fields],
      params: (c.params ?? []).map((p) => ({ ...p })),
    })),
    farmRuleKeys: Object.keys(DEFAULT_SETTINGS.farmRules),
    conditionOps: literals(conditionOp),
    channels: literals(notifyChannel),
    recipientRoles,
    maxConditions: MAX_CONDITIONS,
    maxActions: MAX_ACTIONS,
  }
}
