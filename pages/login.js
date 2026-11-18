import { useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useAuth } from '../contexts/AuthContext'
import { safeNextPath } from '../lib/safeRedirect'
import { Button, Field, Input } from '../components/ui'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { signInWithEmail, user } = useAuth()
  const router = useRouter()

  if (user) {
    router.push(safeNextPath(router.query.next))
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

    router.push(safeNextPath(router.query.next))
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-foam px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <p className="font-display text-4xl font-medium text-chart-ink mb-2">PBA Farm</p>
          <h1 className="text-xl font-semibold text-chart-ink">Sign in</h1>
          <p className="mt-1 text-sm text-muted">Cage operations, sampling, and feed — one ledger.</p>
        </div>

        <div className="bg-surface border border-foam-deep rounded-xl px-6 py-8 shadow-sm">
          {error && (
            <div role="alert" className="mb-4 bg-signal/10 text-signal border border-signal/20 p-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <form className="space-y-5" onSubmit={handleEmailLogin}>
            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>

            <Field label="Password" htmlFor="password">
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>

            <Button type="submit" disabled={loading} size="lg" className="w-full">
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted">
            No account?{' '}
            <Link href="/signup" className="font-medium text-lake hover:underline">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
