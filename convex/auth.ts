import { Password } from '@convex-dev/auth/providers/Password'
import { ConvexCredentials } from '@convex-dev/auth/providers/ConvexCredentials'
import { convexAuth } from '@convex-dev/auth/server'
import type { DataModel } from './_generated/dataModel'
import { authorizePhoneOtp } from './phoneAuth'

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
