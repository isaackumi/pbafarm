import { v } from 'convex/values'
import { query } from './_generated/server'
import { oidcConfigFromEnv, socialAvailability } from './lib/sso'
import { platformDefaultAvailable } from './messaging/providers'

/**
 * Which optional sign-in methods this deployment offers (Paper 15 / 15b),
 * read from the Convex environment so the sign-in page hides a button whose
 * provider is not configured. Public: it reveals only on/off flags, never a
 * client id, secret or provider name.
 */
export const available = query({
  args: {},
  returns: v.object({
    google: v.boolean(),
    microsoft: v.boolean(),
    sso: v.boolean(),
    /** The platform can send sign-in codes on WhatsApp ("Send via WhatsApp instead"). */
    whatsapp: v.boolean(),
  }),
  handler: async () => {
    const social = socialAvailability()
    return {
      google: social.google,
      microsoft: social.microsoft,
      sso: oidcConfigFromEnv() !== null,
      whatsapp: platformDefaultAvailable('whatsapp').available,
    }
  },
})
