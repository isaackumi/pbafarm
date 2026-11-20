import { v, type Infer } from 'convex/values'
import { botProvider } from './tables'

const button = v.object({ id: v.string(), title: v.string() })

/** ChatMessage (convex/messaging/providers/whatsappCloud.ts) as a validator. */
export const chatMessage = v.union(
  v.object({ kind: v.literal('text'), text: v.string() }),
  v.object({ kind: v.literal('buttons'), text: v.string(), buttons: v.array(button) }),
  v.object({
    kind: v.literal('list'),
    text: v.string(),
    button: v.string(),
    rows: v.array(v.object({ id: v.string(), title: v.string(), description: v.optional(v.string()) })),
  }),
  v.object({
    kind: v.literal('template'),
    name: v.string(),
    language: v.string(),
    bodyParams: v.array(v.string()),
    quickReplies: v.array(v.string()),
    fallbackText: v.string(),
    fallbackButtons: v.array(button),
  }),
)

export const target = {
  provider: botProvider,
  address: v.string(),
  callbackQueryId: v.optional(v.string()),
  companyId: v.optional(v.id('companies')),
  bindingId: v.optional(v.id('channelBindings')),
  locale: v.union(v.literal('en'), v.literal('fr')),
}

/** What the processing action does next, decided by the `route` mutation. */
export const routePlan = v.union(
  v.object({ type: v.literal('none') }),
  v.object({ type: v.literal('reply'), ...target, messages: v.array(chatMessage) }),
  v.object({
    type: v.literal('commit'),
    ...target,
    bindingId: v.id('channelBindings'),
    pendingId: v.id('pendingBotActions'),
    confirmDuplicate: v.boolean(),
    sourceMessageId: v.string(),
  }),
  v.object({
    type: v.literal('undo'),
    ...target,
    bindingId: v.id('channelBindings'),
    pendingId: v.id('pendingBotActions'),
    sourceMessageId: v.string(),
  }),
  v.object({
    type: v.literal('approval'),
    ...target,
    bindingId: v.id('channelBindings'),
    promptId: v.id('botApprovalPrompts'),
    decision: v.union(v.literal('approve'), v.literal('reject')),
    reason: v.optional(v.string()),
    sourceMessageId: v.string(),
  }),
  v.object({
    type: v.literal('agent'),
    ...target,
    bindingId: v.id('channelBindings'),
    text: v.string(),
    sourceMessageId: v.string(),
    sentAt: v.number(),
  }),
)

export const targetValidator = v.object(target)
export type Target = Infer<typeof targetValidator>
export type RoutePlan = Infer<typeof routePlan>
export type ChatMessageValue = Infer<typeof chatMessage>
