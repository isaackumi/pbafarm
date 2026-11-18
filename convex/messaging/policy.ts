import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { platformChannelFromEnv } from './providers'
import type { MessagingChannel } from './validators'

/**
 * A company's sign-in policy (SEC-006, SEC-007, doc 18 §7–8) with defaults:
 * phone sign-in off, 2FA off, both on SMS, phone sign-in does not count as
 * the second step.
 */
export type SecurityPolicy = {
  allowPhoneLogin: boolean
  phoneLoginChannel: 'sms' | 'whatsapp'
  require2fa: boolean
  twoFactorChannel: 'sms' | 'whatsapp'
  phoneLoginSatisfies2fa: boolean
}

export function securityPolicy(company: Doc<'companies'> | null | undefined): SecurityPolicy {
  const s = company?.settings?.security
  return {
    allowPhoneLogin: s?.allowPhoneLogin === true,
    phoneLoginChannel: s?.phoneLoginChannel ?? 'sms',
    require2fa: s?.require2fa === true,
    twoFactorChannel: s?.twoFactorChannel ?? 'sms',
    phoneLoginSatisfies2fa: s?.phoneLoginSatisfies2fa === true,
  }
}

/**
 * Whether phone sign-in is offered: allowed by the company, and not when 2FA
 * is required unless the company counts the phone code as the second step.
 */
export function phoneLoginOffered(policy: SecurityPolicy): boolean {
  if (!policy.allowPhoneLogin) return false
  if (policy.require2fa && !policy.phoneLoginSatisfies2fa) return false
  return true
}

/** Channels the sign-in policy depends on. */
export function channelsInUse(policy: SecurityPolicy): Set<MessagingChannel> {
  const used = new Set<MessagingChannel>()
  if (policy.require2fa) used.add(policy.twoFactorChannel)
  if (policy.allowPhoneLogin) used.add(policy.phoneLoginChannel)
  return used
}

/**
 * Refuse a change that would leave sign-in codes with no way out (doc 18 §8,
 * recovery). Changing the company's own channel is fine when the platform
 * default would carry the codes; turning off the platform default is fine when
 * the company has its own verified channel.
 */
export async function assertChannelChangeAllowed(
  ctx: QueryCtx | MutationCtx,
  companyId: Id<'companies'>,
  channel: MessagingChannel,
  turningOffPlatformDefault = false,
) {
  const company = await ctx.db.get(companyId)
  const policy = securityPolicy(company)
  if (!channelsInUse(policy).has(channel)) return
  let stillCovered: boolean
  if (turningOffPlatformDefault) {
    const own = await ctx.db
      .query('messagingChannels')
      .withIndex('by_company_and_channel', (q) => q.eq('companyId', companyId).eq('channel', channel))
      .first()
    stillCovered = own?.status === 'verified'
  } else {
    const s = company?.settings?.messaging
    const optedIn =
      channel === 'sms' ? s?.usePlatformDefaultSms !== false : s?.usePlatformDefaultWhatsapp !== false
    stillCovered = optedIn && platformChannelFromEnv(channel) !== null
  }
  if (!stillCovered) {
    throw new Error(
      `Sign-in codes are sent by ${channel === 'sms' ? 'SMS' : 'WhatsApp'}. ` +
        'Turn off two-step verification and phone sign-in for this channel (Messaging → Sign-in security) before changing it.',
    )
  }
}
