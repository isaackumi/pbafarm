import { Password } from '@convex-dev/auth/providers/Password'
import { Email } from '@convex-dev/auth/providers/Email'
import { convexAuth } from '@convex-dev/auth/server'
import type { DataModel } from './_generated/dataModel'
import { pickEmailAdapter } from './lib/email'
import { randomDigits } from './lib/tokens'
import { ConvexCredentials } from '@convex-dev/auth/providers/ConvexCredentials'
import { authorizePhoneOtp } from './phoneAuth'

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
  async sendVerificationRequest({ identifier, token }) {
    await pickEmailAdapter().send({
      to: identifier,
      subject: 'Reset your PBA Farm password',
      text: `Your password reset code is ${token}. It expires in 15 minutes.\n\nIf you did not ask to reset your password, ignore this email.`,
    })
  },
})

const PasswordProvider = Password<DataModel>({
  profile(params) {
    const email = String(params.email || '')
      .trim()
      .toLowerCase()
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
  providers: [PasswordProvider, PhoneOtpProvider],
})
