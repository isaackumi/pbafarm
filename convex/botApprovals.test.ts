/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import agentTest from '@convex-dev/agent/test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { hmacSha256HexBytes } from './bot/verify'
import { quietHoursDelay } from './bot/approvals'

/**
 * BOT-007: approvals via chat buttons. Scripted fakes for WhatsApp and
 * Telegram (every outbound call is recorded, nothing reaches a provider).
 */
const modules = import.meta.glob('./**/*.ts')

const ENV = {
  WHATSAPP_APP_SECRET: 'app-secret',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  WHATSAPP_BOT_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BOT_ACCESS_TOKEN: 'wa-token',
  TELEGRAM_BOT_TOKEN: 'tg-token',
  TELEGRAM_WEBHOOK_SECRET: 'tg-secret',
}

const AMA_PHONE = '+233200000001'
const ESI_PHONE = '+233200000002'
const YAW_PHONE = '+233200000003'
const VIEWER_PHONE = '+233200000004'
const KOFI_CHAT = '77'

type Sent = { url: string; body: Record<string, any> }
let sent: Sent[] = []

beforeEach(() => {
  for (const [k, val] of Object.entries(ENV)) vi.stubEnv(k, val)
  sent = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      sent.push({ url, body })
      if (url.includes('graph.facebook.com')) {
        return new Response(JSON.stringify({ messages: [{ id: `wamid.out${sent.length}` }] }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }), { status: 200 })
    }),
  )
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

async function setup(opts: { sod?: boolean } = {}) {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  agentTest.register(t)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const companyA = await ctx.db.insert('companies', {
      name: 'Lake', code: 'LAKE', status: 'approved', createdAt: now,
      settings: {
        aiAssistantEnabled: false,
        stockingRules: {
          requireApprovalForStocking: true,
          requireApprovalForTopup: true,
          enforceCageCapacity: false,
          requireDifferentApprover: opts.sod ?? true,
        },
      },
    })
    const companyB = await ctx.db.insert('companies', { name: 'River', code: 'RIVER', status: 'approved', createdAt: now })
    const north = await ctx.db.insert('farmLocations', { companyId: companyA, name: 'North', active: true, updatedAt: now })
    const siteB = await ctx.db.insert('farmLocations', { companyId: companyB, name: 'B', active: true, updatedAt: now })
    const member = async (
      name: string, companyId: Id<'companies'>, roleKey: string, phone?: string,
    ) => {
      const id = await ctx.db.insert('users', {
        name, email: `${name}@x.com`, role: roleKey === 'admin' ? 'admin' : 'user', companyId,
        ...(phone ? { phone, phoneVerificationTime: now } : {}),
      })
      await ctx.db.insert('memberships', { userId: id, companyId, roleKey, allLocations: true, status: 'active', updatedAt: now })
      return id
    }
    const ama = await member('Ama', companyA, 'admin', AMA_PHONE)
    const kofi = await member('Kofi', companyA, 'admin')
    const esi = await member('Esi', companyA, 'admin', ESI_PHONE)
    const viewer = await member('Vic', companyA, 'viewer', VIEWER_PHONE)
    const yaw = await member('Yaw', companyB, 'admin', YAW_PHONE)
    const bind = (userId: Id<'users'>, companyId: Id<'companies'>, provider: 'whatsapp' | 'telegram', address: string) =>
      ctx.db.insert('channelBindings', { provider, address, userId, companyId, verifiedAt: now, lastInboundAt: now })
    const amaChat = await bind(ama, companyA, 'whatsapp', AMA_PHONE)
    const kofiChat = await bind(kofi, companyA, 'telegram', KOFI_CHAT)
    const esiChat = await bind(esi, companyA, 'whatsapp', ESI_PHONE)
    const viewerChat = await bind(viewer, companyA, 'whatsapp', VIEWER_PHONE)
    const yawChat = await bind(yaw, companyB, 'whatsapp', YAW_PHONE)
    const cage = (name: string) =>
      ctx.db.insert('cages', { name, status: 'empty', currentCount: 0, capacity: 100000, locationId: north, companyId: companyA, updatedAt: now })
    const n1 = await cage('N1')
    const n2 = await cage('N2')
    void siteB
    return { companyA, companyB, north, ama, kofi, esi, viewer, yaw, amaChat, kofiChat, esiChat, viewerChat, yawChat, n1, n2 }
  })
  const as = (id: Id<'users'>) => t.withIdentity({ subject: `${id}|s` })
  return { t, as, ...ids }
}
type S = Awaited<ReturnType<typeof setup>>

let seq = 0
function waPayload(from: string, message: Record<string, unknown>) {
  seq++
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: 'PNID' },
          contacts: [{ wa_id: from.replace('+', ''), profile: { name: 'x' } }],
          messages: [{ id: `wamid.in${seq}`, from: from.replace('+', ''), timestamp: String(Math.floor(Date.now() / 1000)), ...message }],
        },
      }],
    }],
  }
}
const waButton = (from: string, id: string) =>
  waPayload(from, { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: 'x' } } })
const waText = (from: string, body: string) => waPayload(from, { type: 'text', text: { body } })

async function postWhatsApp(s: S, payload: unknown) {
  const raw = JSON.stringify(payload)
  const sig = await hmacSha256HexBytes(ENV.WHATSAPP_APP_SECRET, new TextEncoder().encode(raw))
  return await s.t.fetch('/channels/whatsapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': `sha256=${sig}` },
    body: raw,
  })
}

function replyText(m: Sent): string {
  const b = m.body
  return b.text?.body ?? b.interactive?.body?.text ?? b.text ?? JSON.stringify(b)
}

/** Post a signed WhatsApp payload, run processing, return the texts sent back. */
async function wa(s: S, payload: unknown): Promise<string[]> {
  const before = sent.length
  const res = await postWhatsApp(s, payload)
  expect(res.status).toBe(200)
  await s.t.finishAllScheduledFunctions(vi.runAllTimers)
  return sent.slice(before).map(replyText)
}

let tgUpdate = 1000
async function tgTap(s: S, data: string): Promise<string[]> {
  const before = sent.length
  tgUpdate++
  const res = await s.t.fetch('/channels/telegram', {
    method: 'POST',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': 'tg-secret' },
    body: JSON.stringify({
      update_id: tgUpdate,
      callback_query: { id: `cb${tgUpdate}`, data, from: { id: 77 }, message: { message_id: 1, chat: { id: 77, type: 'private' } } },
    }),
  })
  expect(res.status).toBe(200)
  await s.t.finishAllScheduledFunctions(vi.runAllTimers)
  return sent.slice(before).filter((m) => m.url.endsWith('/sendMessage')).map(replyText)
}

async function requestStocking(s: S, cageId: Id<'cages'> = s.n1) {
  const id = await s.as(s.esi).mutation(api.stocking.createStocking, {
    cageId, stockingDate: '2026-11-18', fishCount: 5000, initialAbw: 10, initialBiomass: 50,
  })
  await s.t.finishAllScheduledFunctions(vi.runAllTimers)
  return id as Id<'stockingHistory'>
}

const prompts = (s: S) => s.t.run(async (ctx) => await ctx.db.query('botApprovalPrompts').collect())
const promptFor = async (s: S, bindingId: Id<'channelBindings'>) =>
  (await prompts(s)).find((p) => p.bindingId === bindingId)!
const stocking = (s: S, id: Id<'stockingHistory'>) => s.t.run(async (ctx) => (await ctx.db.get(id))!)
const audits = (s: S, actionType: string) =>
  s.t.run(async (ctx) => (await ctx.db.query('auditLogs').collect()).filter((a: Doc<'auditLogs'>) => a.actionType === actionType))

describe('BOT-007 approval prompts', () => {
  test('approvers with a bound chat get Approve / Reject buttons; the requester and non-approvers do not', async () => {
    const s = await setup()
    const id = await requestStocking(s)
    const rows = await prompts(s)
    expect(rows.map((p) => p.bindingId).sort()).toEqual([s.amaChat, s.kofiChat].sort())
    expect(rows.every((p) => p.status === 'sent' && p.recordId === id)).toBe(true)

    const waMsg = sent.find((m) => m.url.includes('graph.facebook.com') && m.body.to === AMA_PHONE.slice(1))!
    expect(waMsg.body.interactive.type).toBe('button')
    expect(waMsg.body.interactive.body.text).toMatch(/Stocking needs your approval\.\nEsi: Stocking 5,000 fish into N1/)
    const ama = await promptFor(s, s.amaChat)
    expect(waMsg.body.interactive.action.buttons.map((b: any) => b.reply.id)).toEqual([`apr:${ama._id}`, `rej:${ama._id}`])

    const tg = sent.find((m) => m.url.includes('/bottg-token/sendMessage'))!
    const kofi = await promptFor(s, s.kofiChat)
    expect(tg.body.reply_markup.inline_keyboard[0].map((b: any) => b.callback_data)).toEqual([`apr:${kofi._id}`, `rej:${kofi._id}`])
  })

  test('outside the WhatsApp 24 h window the approved template is used', async () => {
    const s = await setup()
    await s.t.run(async (ctx) => ctx.db.patch(s.amaChat, { lastInboundAt: Date.now() - 2 * 24 * 3_600_000 }))
    await requestStocking(s)
    const ama = await promptFor(s, s.amaChat)
    const msg = sent.find((m) => m.url.includes('graph.facebook.com'))!
    expect(msg.body.type).toBe('template')
    expect(msg.body.template.name).toBe('farm_approval_request')
    const payloads = msg.body.template.components.filter((c: any) => c.type === 'button').map((c: any) => c.parameters[0].payload)
    expect(payloads).toEqual([`apr:${ama._id}`, `rej:${ama._id}`])
  })

  test('WhatsApp notifications off skips the chat; quiet hours hold the prompt until they end', async () => {
    const s = await setup()
    await s.t.run(async (ctx) => {
      await ctx.db.insert('notificationPreferences', {
        userId: s.ama, inApp: true, sms: true, whatsapp: false, email: true, updatedAt: Date.now(),
      })
      await ctx.db.insert('notificationPreferences', {
        userId: s.kofi, inApp: true, sms: true, whatsapp: true, email: true, updatedAt: Date.now(),
        quietHours: { start: '00:00', end: '23:59' },
      })
    })
    await s.as(s.esi).mutation(api.stocking.createStocking, {
      cageId: s.n1, stockingDate: '2026-11-18', fishCount: 5000, initialAbw: 10, initialBiomass: 50,
    })
    expect(await promptFor(s, s.amaChat)).toMatchObject({ status: 'skipped', note: 'whatsapp_notifications_off' })
    const kofi = await promptFor(s, s.kofiChat)
    if (quietHoursDelay({ start: '00:00', end: '23:59' }, kofi.createdAt, 'UTC') > 0) {
      expect(kofi.status).toBe('queued')
      expect(kofi.sendAt).toBeGreaterThan(kofi.createdAt)
    }
    expect(quietHoursDelay({ start: '22:00', end: '06:00' }, Date.UTC(2026, 10, 18, 23, 0), 'UTC')).toBe(7 * 3_600_000)
    expect(quietHoursDelay({ start: '22:00', end: '06:00' }, Date.UTC(2026, 10, 18, 12, 0), 'UTC')).toBe(0)
  })
})

describe('BOT-007 decisions', () => {
  test('approve happy path: same helper as the web, audited with the chat channel; other chats then see it decided', async () => {
    const s = await setup()
    const id = await requestStocking(s)
    const ama = await promptFor(s, s.amaChat)
    const replies = await wa(s, waButton(AMA_PHONE, `apr:${ama._id}`))
    expect(replies).toEqual(['Approved: Stocking 5,000 fish into N1 (batch N1-20261118).'])
    expect(await stocking(s, id)).toMatchObject({ status: 'approved', approvedBy: s.ama })
    const cage = await s.t.run(async (ctx) => (await ctx.db.get(s.n1))!)
    expect(cage).toMatchObject({ status: 'active', currentCount: 5000 })
    const [audit] = await audits(s, 'approve')
    expect(audit).toMatchObject({ userId: s.ama, channel: 'whatsapp', recordId: id, companyId: s.companyA })
    expect(audit.sourceMessageId).toMatch(/^wamid\.in/)
    expect(await promptFor(s, s.amaChat)).toMatchObject({ status: 'approved', sourceMessageId: audit.sourceMessageId })
    // Kofi's buttons are closed and answer who decided.
    expect((await promptFor(s, s.kofiChat)).status).toBe('closed')
    const kofi = await promptFor(s, s.kofiChat)
    expect(await tgTap(s, `apr:${kofi._id}`)).toEqual(['This request was already approved by Ama.'])
  })

  test('double tap and webhook retry decide once', async () => {
    const s = await setup()
    await requestStocking(s)
    const ama = await promptFor(s, s.amaChat)
    const tap = waButton(AMA_PHONE, `apr:${ama._id}`)
    expect(await wa(s, tap)).toEqual(['Approved: Stocking 5,000 fish into N1 (batch N1-20261118).'])
    // Meta retries the same webhook: stored once, nothing sent.
    expect(await wa(s, tap)).toEqual([])
    // A second tap is a new message: answered, not applied.
    expect(await wa(s, waButton(AMA_PHONE, `apr:${ama._id}`))).toEqual(['You already approved this request.'])
    expect(await audits(s, 'approve')).toHaveLength(1)
  })

  test('reject asks for a reason; the next text is the reason', async () => {
    const s = await setup()
    const id = await requestStocking(s)
    const ama = await promptFor(s, s.amaChat)
    const before = sent.length
    await wa(s, waButton(AMA_PHONE, `rej:${ama._id}`))
    const list = sent[before].body.interactive
    expect(list.type).toBe('list')
    expect(list.body.text).toMatch(/Why are you rejecting it/)
    expect(list.action.sections[0].rows.map((r: any) => r.id)).toContain(`rr:${ama._id}:count`)
    expect((await stocking(s, id)).status).toBe('pending_approval')

    expect(await wa(s, waText(AMA_PHONE, 'Supplier changed the date'))).toEqual(['Rejected: Stocking 5,000 fish into N1 (batch N1-20261118).'])
    const row = await stocking(s, id)
    expect(row).toMatchObject({ status: 'rejected', approvedBy: s.ama })
    expect(row.notes).toMatch(/Rejection reason: Supplier changed the date/)
    const [audit] = await audits(s, 'reject')
    expect(audit).toMatchObject({ channel: 'whatsapp', newValues: { status: 'rejected', reason: 'Supplier changed the date' } })
  })

  test('reject with a reason from the list (Telegram), and CANCEL keeps it pending', async () => {
    const s = await setup()
    const id = await requestStocking(s)
    const kofi = await promptFor(s, s.kofiChat)
    await tgTap(s, `rej:${kofi._id}`)
    expect((await promptFor(s, s.kofiChat)).status).toBe('awaiting_reason')

    // WhatsApp CANCEL path on Ama's chat.
    const ama = await promptFor(s, s.amaChat)
    await wa(s, waButton(AMA_PHONE, `rej:${ama._id}`))
    expect(await wa(s, waText(AMA_PHONE, 'cancel'))).toEqual(['OK, the request is still pending.'])
    expect((await promptFor(s, s.amaChat)).status).toBe('sent')

    expect(await tgTap(s, `rr:${kofi._id}:count`)).toEqual(['Rejected: Stocking 5,000 fish into N1 (batch N1-20261118).'])
    expect((await stocking(s, id)).notes).toMatch(/Rejection reason: Wrong fish count/)
  })

  test('a non-approver and another tenant are refused; nothing changes', async () => {
    const s = await setup()
    const id = await requestStocking(s)
    const ama = await promptFor(s, s.amaChat)
    // A viewer of the same organization, with a prompt (e.g. their role changed after it was sent).
    const viewerPrompt = await s.t.run(async (ctx) => {
      const { _id, _creationTime, ...rest } = ama
      void _id; void _creationTime
      return await ctx.db.insert('botApprovalPrompts', { ...rest, bindingId: s.viewerChat, userId: s.viewer, provider: 'whatsapp' })
    })
    expect(await wa(s, waButton(VIEWER_PHONE, `apr:${viewerPrompt}`))).toEqual(['You cannot approve this request.'])
    // Another organization's admin replays Ama's button id: not their prompt.
    expect(await wa(s, waButton(YAW_PHONE, `apr:${ama._id}`))).toEqual(['This request no longer exists.'])
    expect(await wa(s, waButton(YAW_PHONE, `rr:${ama._id}:count`))).toEqual(['This request no longer exists.'])
    expect((await stocking(s, id)).status).toBe('pending_approval')
    expect(await audits(s, 'approve')).toHaveLength(0)
    expect(await audits(s, 'reject')).toHaveLength(0)
  })

  test('a member whose approve permission was removed is refused at tap time', async () => {
    const s = await setup()
    const id = await requestStocking(s)
    const ama = await promptFor(s, s.amaChat)
    await s.t.run(async (ctx) => {
      const m = (await ctx.db.query('memberships').collect()).find((x) => x.userId === s.ama)!
      await ctx.db.patch(m._id, { roleKey: 'viewer' })
    })
    expect(await wa(s, waButton(AMA_PHONE, `apr:${ama._id}`))).toEqual(['You cannot approve this request.'])
    expect((await stocking(s, id)).status).toBe('pending_approval')
  })

  test('segregation of duties: the requester cannot approve from chat either', async () => {
    const s = await setup({ sod: true })
    const id = await requestStocking(s)
    // The requester is never sent a prompt…
    expect((await prompts(s)).some((p) => p.userId === s.esi)).toBe(false)
    // …and a forged one is refused by the shared approval helper.
    const ama = await promptFor(s, s.amaChat)
    const forged = await s.t.run(async (ctx) => {
      const { _id, _creationTime, ...rest } = ama
      void _id; void _creationTime
      return await ctx.db.insert('botApprovalPrompts', { ...rest, bindingId: s.esiChat, userId: s.esi })
    })
    expect(await wa(s, waButton(ESI_PHONE, `apr:${forged}`))).toEqual([
      'Not done: Someone other than the requester must approve this',
    ])
    expect((await stocking(s, id)).status).toBe('pending_approval')
    expect((await s.t.run(async (ctx) => (await ctx.db.get(forged))!)).note).toMatch(/requester/)
    // Without SoD the same tap works, exactly like the web.
    await s.t.run(async (ctx) => {
      const c = (await ctx.db.get(s.companyA))!
      await ctx.db.patch(s.companyA, {
        settings: { ...c.settings!, stockingRules: { ...c.settings!.stockingRules!, requireDifferentApprover: false } },
      })
    })
    expect(await wa(s, waButton(ESI_PHONE, `apr:${forged}`))).toEqual(['Approved: Stocking 5,000 fish into N1 (batch N1-20261118).'])
  })

  test('stale requests: decided on the web, deleted, or buttons expired', async () => {
    const s = await setup()
    const id = await requestStocking(s)
    const ama = await promptFor(s, s.amaChat)
    await s.as(s.kofi).mutation(api.stocking.rejectStocking, { id, reason: 'no' })
    expect(await wa(s, waButton(AMA_PHONE, `apr:${ama._id}`))).toEqual(['This request was already rejected by Kofi.'])
    expect((await stocking(s, id)).status).toBe('rejected')

    const id2 = await requestStocking(s, s.n2)
    const ama2 = (await prompts(s)).find((p) => p.recordId === id2 && p.bindingId === s.amaChat)!
    await s.t.run(async (ctx) => ctx.db.patch(ama2._id, { expiresAt: Date.now() - 1 }))
    expect(await wa(s, waButton(AMA_PHONE, `apr:${ama2._id}`))).toEqual([
      'These buttons have expired. Open Approvals in the app to decide.',
    ])
    expect((await stocking(s, id2)).status).toBe('pending_approval')

    await s.t.run(async (ctx) => ctx.db.delete(id2))
    expect(await wa(s, waButton(AMA_PHONE, `apr:${ama2._id}`))).toEqual(['This request no longer exists.'])
  })

  test('a fish transfer is approved through the transfer approval', async () => {
    const s = await setup({ sod: false })
    await s.t.run(async (ctx) => {
      await ctx.db.patch(s.n1, { status: 'active', currentCount: 1000, initialCount: 1000, initialAbw: 10, stockingDate: '2026-10-01' })
      await ctx.db.insert('stockingHistory', {
        cageId: s.n1, batchNumber: 'B-1', stockingDate: '2026-10-01', fishCount: 1000, initialAbw: 10,
        initialBiomass: 10, status: 'approved', companyId: s.companyA, locationId: s.north, createdBy: s.esi,
      } as any)
    })
    const transferId = await s.as(s.esi).mutation(api.fishTransfers.createFishTransfer, {
      sourceCageId: s.n1, destinationCageId: s.n2, transferDate: '2026-11-18', quantity: 200, abw: 12,
    } as any)
    await s.t.finishAllScheduledFunctions(vi.runAllTimers)
    const transfer = await s.t.run(async (ctx) => (await ctx.db.get(transferId))!)
    expect(transfer.status).toBe('pending_approval')
    const ama = (await prompts(s)).find((p) => p.kind === 'transfer' && p.bindingId === s.amaChat)!
    expect(await wa(s, waButton(AMA_PHONE, `apr:${ama._id}`))).toEqual(['Approved: Transfer of 200 fish from N1 to N2.'])
    expect((await s.t.run(async (ctx) => (await ctx.db.get(transferId))!)).status).toBe('approved')
    expect((await audits(s, 'approve'))[0]).toMatchObject({ tableName: 'fishTransfers', channel: 'whatsapp' })
  })
})
