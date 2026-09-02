import { Password } from '@convex-dev/auth/providers/Password'
import { convexAuth } from '@convex-dev/auth/server'
import type { DataModel } from './_generated/dataModel'

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

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [PasswordProvider],
})
