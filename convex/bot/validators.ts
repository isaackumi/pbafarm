import { v, type Infer } from 'convex/values'
import { botProvider } from './tables'

const button = v.object({ id: v.string(), title: v.string() })

/** ChatMessage (convex/messaging/providers/whatsappCloud.ts) as a validator. */
export const chatMessage = v.union(
  v.object({ kind: v.literal('text'), text: v.string() }),
  v.object({ kind: v.literal('buttons'), text: v.string(), buttons: v.array(button) }),
  v.object({ kind: v.literal('keyboard'), text: v.string(), html: v.optional(v.boolean()), rows: v.array(v.array(button)) }),
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
  /** A logbook page photo to read into drafts (BOT-006). */
  v.object({
    type: v.literal('logbook'),
    ...target,
    bindingId: v.id('channelBindings'),
    mediaId: v.string(),
    sourceMessageId: v.string(),
    sentAt: v.number(),
  }),
  /** A voice note to transcribe into drafts (BOT-005): the action starts its workflow. */
  v.object({
    type: v.literal('voice'),
    ...target,
    bindingId: v.id('channelBindings'),
    voiceNoteId: v.id('voiceNotes'),
  }),
  /** Save every draft heard in one voice note (BOT-005). */
  v.object({
    type: v.literal('voice_commit'),
    ...target,
    bindingId: v.id('channelBindings'),
    voiceNoteId: v.id('voiceNotes'),
    sourceMessageId: v.string(),
  }),
  /** Undo every saved draft of one voice note. */
  v.object({
    type: v.literal('voice_undo'),
    ...target,
    bindingId: v.id('channelBindings'),
    voiceNoteId: v.id('voiceNotes'),
    sourceMessageId: v.string(),
  }),
  /** Morning round (T1a/T1b): show the card (edit in place, or `fresh` = a new message), then `messages`. */
  v.object({
    type: v.literal('round'),
    ...target,
    bindingId: v.id('channelBindings'),
    roundId: v.id('botRounds'),
    fresh: v.boolean(),
    messages: v.array(chatMessage),
  }),
  /** Save every open draft of a group (round Log all, template). */
  v.object({
    type: v.literal('group_commit'),
    ...target,
    bindingId: v.id('channelBindings'),
    groupId: v.id('botDraftGroups'),
    sourceMessageId: v.string(),
  }),
  /** Undo every saved draft of a group. */
  v.object({
    type: v.literal('group_undo'),
    ...target,
    bindingId: v.id('channelBindings'),
    groupId: v.id('botDraftGroups'),
    sourceMessageId: v.string(),
  }),
  /** Save all drafts read from one logbook page. */
  v.object({
    type: v.literal('logbook_commit'),
    ...target,
    bindingId: v.id('channelBindings'),
    scanId: v.id('logbookScans'),
    sourceMessageId: v.string(),
  }),
)

export const targetValidator = v.object(target)
export type Target = Infer<typeof targetValidator>
export type RoutePlan = Infer<typeof routePlan>
export type ChatMessageValue = Infer<typeof chatMessage>
