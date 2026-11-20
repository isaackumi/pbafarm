/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import { DEFAULT_AI_POLICY, cleanDailyCap, resolveAiPolicy } from './lib/aiPolicyShared'
import { buildDraftCatalog } from './automation/catalog'

const modules = import.meta.glob('./**/*.ts')

async function setup(opts: { ai?: boolean; aiPolicy?: Record<string, unknown> } = {}) {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert('companies', {
      name: 'Lake Farm',
      code: 'LAKE',
      status: 'approved',
      createdAt: Date.now(),
      settings: { aiAssistantEnabled: opts.ai ?? true, ...(opts.aiPolicy ? { aiPolicy: opts.aiPolicy } : {}) },
    })
    const now = Date.now()
    const adminId = await ctx.db.insert('users', { email: 'owner@x.com', role: 'admin', companyId })
    // Field staff: no ai.use, automation.manage or org.settings.manage.
    const staffId = await ctx.db.insert('users', { email: 'staff@x.com', role: 'user', companyId })
    await ctx.db.insert('memberships', { userId: adminId, companyId, roleKey: 'owner', allLocations: true, status: 'active', updatedAt: now })
    await ctx.db.insert('memberships', { userId: staffId, companyId, roleKey: 'field_staff', allLocations: true, status: 'active', updatedAt: now })
    return { companyId, adminId, staffId }
  })
  return {
    t,
    ids,
    admin: t.withIdentity({ subject: `${ids.adminId}|s` }),
    staff: t.withIdentity({ subject: `${ids.staffId}|s` }),
  }
}

const validDraft = {
  name: 'Low oxygen alert',
  trigger: { kind: 'event' as const, eventType: 'daily.recorded' },
  match: 'all' as const,
  conditions: [{ field: 'payload.dissolvedOxygen', op: 'lt' as const, value: 4 }],
  actions: [
    {
      kind: 'notify' as const,
      channels: ['in_app' as const, 'sms' as const],
      recipients: { roles: ['admin' as const] },
      title: 'Low DO in {{payload.cageName}}',
      message: 'Dissolved oxygen is {{payload.dissolvedOxygen}} mg/L',
      level: 'warning' as const,
    },
  ],
}

describe('AI policy helpers', () => {
  test('defaults and daily cap bounds', () => {
    expect(resolveAiPolicy(undefined)).toEqual(DEFAULT_AI_POLICY)
    expect(resolveAiPolicy({ allowAutomationDrafts: false })).toEqual({ ...DEFAULT_AI_POLICY, allowAutomationDrafts: false })
    expect(cleanDailyCap(20)).toBe(20)
    expect(cleanDailyCap(20.7)).toBe(20)
    expect(cleanDailyCap(0)).toBeNull()
    expect(cleanDailyCap(501)).toBeNull()
    expect(cleanDailyCap('20')).toBeNull()
  })

  test('the draft catalog comes from the rule code', () => {
    const c = buildDraftCatalog('Africa/Accra')
    expect(c.eventTypes.map((e) => e.type)).toContain('daily.recorded')
    expect(c.checks.map((x) => x.key)).toContain('missed_daily_entry')
    expect(c.conditionOps).toEqual(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_set', 'not_set'])
    expect(c.channels).toEqual(['in_app', 'sms', 'whatsapp', 'email'])
    expect(c.recipientRoles).toEqual(['user', 'admin'])
    expect(c.farmRuleKeys).toContain('dailyMortalityAlertPct')
  })
})

describe('companies.updateAiPolicy', () => {
  test('an admin updates the policy; it is audit logged and shown in status', async () => {
    const { t, admin, ids } = await setup()
    const before = await admin.query(api.companies.aiAssistantStatus, {})
    expect(before.policy).toEqual(DEFAULT_AI_POLICY)
    expect(before.canDraftAutomations).toBe(true)
    expect(before.canSaveAutomations).toBe(true)

    const next = await admin.mutation(api.companies.updateAiPolicy, {
      draftsStartPaused: false,
      dailyQuestionsPerMember: 25,
    })
    expect(next).toEqual({ allowAutomationDrafts: true, draftsStartPaused: false, dailyQuestionsPerMember: 25 })
    expect((await admin.query(api.companies.aiAssistantStatus, {})).policy).toEqual(next)

    const cleared = await admin.mutation(api.companies.updateAiPolicy, { dailyQuestionsPerMember: null })
    expect(cleared.dailyQuestionsPerMember).toBeNull()

    const audits = await t.run(async (ctx) =>
      (await ctx.db.query('auditLogs').collect()).filter((a) => a.recordId === ids.companyId),
    )
    expect(audits.length).toBeGreaterThanOrEqual(2)
  })

  test('turning drafts off removes canDraftAutomations', async () => {
    const { admin } = await setup()
    await admin.mutation(api.companies.updateAiPolicy, { allowAutomationDrafts: false })
    const s = await admin.query(api.companies.aiAssistantStatus, {})
    expect(s.canDraftAutomations).toBe(false)
    expect(s.canSaveAutomations).toBe(true)
  })

  test('drafts need the company assistant switch', async () => {
    const { admin } = await setup({ ai: false })
    expect((await admin.query(api.companies.aiAssistantStatus, {})).canDraftAutomations).toBe(false)
  })

  test('a field member cannot change the policy and cannot draft or save', async () => {
    const { staff } = await setup()
    await expect(staff.mutation(api.companies.updateAiPolicy, { allowAutomationDrafts: false })).rejects.toThrow()
    const s = await staff.query(api.companies.aiAssistantStatus, {})
    expect(s.canDraftAutomations).toBe(false)
    expect(s.canSaveAutomations).toBe(false)
  })

  test('the daily cap is checked', async () => {
    const { admin } = await setup()
    await expect(admin.mutation(api.companies.updateAiPolicy, { dailyQuestionsPerMember: 0 })).rejects.toThrow(
      /1 to 500/,
    )
    await expect(admin.mutation(api.companies.updateAiPolicy, { dailyQuestionsPerMember: 9999 })).rejects.toThrow(
      /1 to 500/,
    )
  })

  test('the daily cap refuses assistant calls past the limit', async () => {
    const { admin } = await setup({ aiPolicy: { dailyQuestionsPerMember: 2 } })
    // Each finished call gives its concurrency lease back (AI protections, D-023).
    for (let i = 0; i < 2; i++) {
      const gate = await admin.mutation(api.llmQuota.consumeServerKeyQuota, {})
      await admin.mutation(api.aiGuard.releaseLease, { leaseId: gate.leaseId })
    }
    await expect(admin.mutation(api.llmQuota.consumeServerKeyQuota, {})).rejects.toThrow(/today's 2 Anowa questions/)
  })

  test('publishing company settings keeps the AI policy', async () => {
    const { t, admin, ids } = await setup({ aiPolicy: { allowAutomationDrafts: false } })
    await admin.mutation(api.companies.publishSettings, {})
    const company = await t.run((ctx) => ctx.db.get(ids.companyId))
    expect(company?.settings?.aiPolicy?.allowAutomationDrafts).toBe(false)
  })
})

describe('automation.rules.checkDraft and draftCatalog', () => {
  test('a valid draft has no problems', async () => {
    const { admin } = await setup()
    expect(await admin.query(api.automation.rules.checkDraft, validDraft)).toEqual({ ok: true, problems: [] })
    const catalog = await admin.query(api.automation.rules.draftCatalog, {})
    expect(catalog.eventTypes.length).toBeGreaterThan(0)
  })

  test('invalid drafts report what to fix and nothing is written', async () => {
    const { t, admin } = await setup()
    const noActions = await admin.query(api.automation.rules.checkDraft, { ...validDraft, actions: [] })
    expect(noActions.ok).toBe(false)
    expect(noActions.problems).toEqual(['Add at least one action'])

    const badEvent = await admin.query(api.automation.rules.checkDraft, {
      ...validDraft,
      trigger: { kind: 'event', eventType: 'cage.exploded' },
    })
    expect(badEvent.problems[0]).toMatch(/Unknown event/)

    const badTime = await admin.query(api.automation.rules.checkDraft, {
      ...validDraft,
      trigger: { kind: 'schedule', localTime: '25:99', check: 'missed_daily_entry' },
    })
    expect(badTime.problems).toEqual(['Time must be HH:MM'])

    const rules = await t.run((ctx) => ctx.db.query('automationRules').collect())
    expect(rules).toEqual([])
  })

  test('drafts never name people', async () => {
    const { admin, ids } = await setup()
    const r = await admin.query(api.automation.rules.checkDraft, {
      ...validDraft,
      actions: [{ ...validDraft.actions[0], recipients: { userIds: [ids.adminId] } }],
    })
    expect(r.problems).toContain('Choose recipients by role or everyone, not by name')
  })

  test('drafts cannot link outside the app', async () => {
    const { admin } = await setup()
    const r = await admin.query(api.automation.rules.checkDraft, {
      ...validDraft,
      actions: [{ ...validDraft.actions[0], link: '//evil.example/login' }],
    })
    expect(r.problems).toContain('Links must be app paths starting with a single /')
  })

  test('members without ai.use cannot use the draft endpoints', async () => {
    const { staff } = await setup()
    await expect(staff.query(api.automation.rules.checkDraft, validDraft)).rejects.toThrow()
    await expect(staff.query(api.automation.rules.draftCatalog, {})).rejects.toThrow()
  })
})
