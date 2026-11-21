import { Password } from '@convex-dev/auth/providers/Password'
import { Email } from '@convex-dev/auth/providers/Email'
import { convexAuth } from '@convex-dev/auth/server'
import type { DataModel } from './_generated/dataModel'
import type { GenericActionCtx } from 'convex/server'
import { pickEmailAdapter } from './lib/email'
import { emailContext, passwordResetEmail } from './lib/emailTemplates'
import { randomDigits } from './lib/tokens'
import { ConvexCredentials } from '@convex-dev/auth/providers/ConvexCredentials'
import { authorizePhoneOtp } from './phoneAuth'
import { internal } from './_generated/api'
import { oidcProviderFromEnv, socialProvidersFromEnv } from './lib/sso'
import { canonicalEmail } from './authGuard'

/**
 * Password reset by emailed code (SEC-005): signIn('password', { email, flow: 'reset' })
 * sends it; signIn('password', { email, code, newPassword, flow: 'reset-verification' })
 * sets the new password and signs in.
 */
const PasswordReset = Email({
  id: 'password-reset',
  maxAge: 15 * 60,
  async generateVerificationToken() {
    return randomDigits(8)
  },
  async sendVerificationRequest({ identifier, token }, ctx?: unknown) {
    // Convex Auth passes the action ctx as a second argument (not in its types).
    const actionCtx = ctx as Partial<GenericActionCtx<DataModel>> | undefined
    const locale = actionCtx?.runQuery
      ? await actionCtx.runQuery(internal.emails.recipientLocale, { email: identifier }).catch(() => null)
      : null
    const mail = passwordResetEmail(emailContext(locale), { email: identifier, code: token, minutes: 15 })
    await pickEmailAdapter().send({ to: identifier, subject: mail.subject, text: mail.text, html: mail.html })
  },
})

const BasePasswordProvider = Password<DataModel>({
  profile(params) {
    const email = canonicalEmail(params.email)
    return {
      email,
      name: (params.name as string) || undefined,
      role: 'user',
    }
  },
  validatePasswordRequirements(password: string) {
    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters long')
    }
  },
  reset: PasswordReset,
})

/**
 * Human check (CF-003) before the two public password flows that create an
 * account or send an email: the browser passes `humanTicket` from
 * humanVerification.verify; a no-op when TURNSTILE_SECRET_KEY is unset. A
 * sign-up ticket stays usable for the same email for a few minutes, so a
 * sign-up that fails validation can be retried without a new check.
 *
 * Sign-in (CF-003 hardening, convex/authGuard.ts): failures are counted per
 * email and rate limited; after three in a row the next attempt needs a
 * `signin` ticket.
 *
 * Wraps the provider's authorize because `profile` is synchronous.
 */
type CredentialsOptions = {
  authorize: (params: Record<string, unknown>, ctx: { runMutation: (...args: never[]) => unknown }) => Promise<unknown>
}
const passwordOptions = (BasePasswordProvider as unknown as { options: CredentialsOptions }).options
export const PasswordProvider = {
  ...BasePasswordProvider,
  options: {
    ...passwordOptions,
    authorize: async (params: Record<string, unknown>, ctx: Parameters<CredentialsOptions['authorize']>[1]) => {
      const actionCtx = ctx as unknown as GenericActionCtx<DataModel>
      const ticket = typeof params.humanTicket === 'string' ? params.humanTicket : undefined
      const email = canonicalEmail(params.email)
      if (params.flow === 'signIn') {
        await actionCtx.runMutation(internal.authGuard.beforePasswordSignIn, { email, humanTicket: ticket })
        let result: unknown
        try {
          result = await passwordOptions.authorize(params, ctx)
        } catch (err) {
          await actionCtx.runMutation(internal.authGuard.recordPasswordSignIn, { email, ok: false })
          throw err
        }
        await actionCtx.runMutation(internal.authGuard.recordPasswordSignIn, { email, ok: true })
        return result
      }
      const purpose = params.flow === 'signUp' ? 'signup' : params.flow === 'reset' ? 'password_reset' : null
      if (purpose) {
        await actionCtx.runMutation(internal.humanVerification.consumeTicket, { ticket, purpose, email })
      }
      const result = await passwordOptions.authorize(params, ctx)
      if (params.flow === 'reset-verification') {
        await actionCtx.runMutation(internal.bot.bindings.revokeAfterPasswordReset, { email })
      }
      return result
    },
  },
} as typeof BasePasswordProvider

/**
 * Passwordless phone sign-in (SEC-006, doc 18 §7). A credentials provider
 * rather than the library's Phone provider: that one creates a user and
 * account before sending a code, which would create users for unknown
 * numbers or reveal which numbers exist. This one only signs in an existing
 * user whose phone matches; see convex/phoneAuth.ts.
 */
const PhoneOtpProvider = ConvexCredentials<DataModel>({
  id: 'phone-otp',
  authorize: (params, ctx) => authorizePhoneOtp(params, ctx),
})

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [PasswordProvider, PhoneOtpProvider, ...oidcProviderFromEnv(), ...socialProvidersFromEnv()],
})
