import { useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { signInWithEmail, user } = useAuth()
  const router = useRouter()

  if (user) {
    const next =
      typeof router.query.next === 'string' && router.query.next.startsWith('/')
        ? router.query.next
        : '/dashboard'
    router.push(next)
    return null
  }

  const handleEmailLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error: signInError } = await signInWithEmail(email, password)

    if (signInError) {
      const raw = signInError.message || ''
      const friendly =
        raw.includes('InvalidAccountId') || raw.includes('InvalidSecret')
          ? 'No account for that email, or the password is wrong. Check the address carefully — or create an account on Sign up.'
          : raw || 'Sign in failed'
      setError(friendly)
      setLoading(false)
      return
    }

    router.push(
      typeof router.query.next === 'string' && router.query.next.startsWith('/')
        ? router.query.next
        : '/dashboard',
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-foam px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <p className="font-display text-4xl text-lagoon-950 tracking-tight">PBA Farm</p>
          <div className="waterline mx-auto mt-3 mb-4 max-w-[8rem]" />
          <h1 className="text-xl font-semibold text-chart-ink">Sign in</h1>
          <p className="mt-1 text-sm text-muted">Cage operations, sampling, and feed — one ledger.</p>
        </div>

        <div className="bg-surface border border-foam-deep rounded-lg px-6 py-8 shadow-sm">
          {error && (
            <div className="mb-4 bg-signal/10 text-signal border border-signal/20 p-3 rounded-md text-sm">
              {error}
            </div>
          )}

          <form className="space-y-5" onSubmit={handleEmailLogin}>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-chart-ink">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-chart-ink">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className={`w-full flex justify-center py-2.5 px-4 rounded-md text-sm font-semibold text-white ${
                loading ? 'bg-lagoon-700/70' : 'bg-lagoon-800 hover:bg-lagoon-950'
              } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-lagoon-800`}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-muted">
            No account?{' '}
            <Link href="/signup" className="font-medium text-lagoon-800 hover:text-lagoon-950">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
