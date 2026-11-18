import { v } from 'convex/values'

/** Delivery channels a company can configure (INT-001, doc 18 §2). */
export const messagingChannel = v.union(
  v.literal('sms'),
  v.literal('whatsapp'),
  v.literal('email'),
)

/** Provider adapters in convex/messaging/providers (doc 18 §3). */
export const messagingProvider = v.union(
  v.literal('hubtel'),
  v.literal('africastalking'),
  v.literal('twilio'),
  v.literal('whatsapp_cloud'),
  v.literal('twilio_whatsapp'),
  v.literal('resend'),
)

export type MessagingChannel = 'sms' | 'whatsapp' | 'email'
export type MessagingProvider =
  | 'hubtel'
  | 'africastalking'
  | 'twilio'
  | 'whatsapp_cloud'
  | 'twilio_whatsapp'
  | 'resend'
