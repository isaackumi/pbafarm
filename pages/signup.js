import { useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useAuth } from '../contexts/AuthContext'
import { Button, Field, Input } from '../components/ui'
import { safeNextPath } from '../lib/safeRedirect'
import { useHumanCheck } from '../components/HumanCheck'

/** Slightly under the server's sign-up grant (HUMAN_GRANT_TTL_MS, 5 minutes). */
const KEEP_TICKET_MS = 4.5 * 60 * 1000

export default function SignUp() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { signUpWithEmail, user } = useAuth()
  const human = useHumanCheck('signup')
  const [keptTicket, setKeptTicket] = useState(null)
  const router = useRouter()

  if (user) {
    router.push(safeNextPath(router.query.next, '/register-company'))
    return null
  }

  const handleSignUp = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      setLoading(false)
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long')
      setLoading(false)
      return
    }

    // A ticket used by a sign-up that then failed stays valid for the same
    // email for a few minutes (CF-003): resend it unless the widget has a new token.
    const kept = keptTicket
    let humanTicket = null
    try {
      humanTicket =
        kept && kept.email === email.trim().toLowerCase() && Date.now() - kept.at < KEEP_TICKET_MS && !human.hasToken
          ? kept.ticket
          : await human.getTicket()
    } catch (err) {
      setError(err?.data?.message || err.message || 'Human check failed')
      setLoading(false)
      return
    }

    const { error: signUpError } = await signUpWithEmail(email, password, fullName, humanTicket)

    if (signUpError) {
      const reason = signUpError?.data?.details?.reason
      if (humanTicket && reason !== 'HUMAN_CHECK_REQUIRED') {
        if (!kept || kept.ticket !== humanTicket) {
          setKeptTicket({ ticket: humanTicket, email: email.trim().toLowerCase(), at: Date.now() })
        }
      } else {
        setKeptTicket(null)
      }
      setError(signUpError.message || 'Sign up failed')
      setLoading(false)
      return
    }

    // A new account has no company yet: register one, or ask to join an invite.
    router.push(safeNextPath(router.query.next, '/register-company'))
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-foam px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <p className="font-display text-4xl font-medium text-chart-ink mb-2">PBA Farm</p>
          <h1 className="text-xl font-semibold text-chart-ink">Create account</h1>
          <p className="mt-1 text-sm text-muted">
            Start with email and password. Next, register your farm or accept your
            company&apos;s invite.
          </p>
        </div>

        <div className="bg-surface border border-foam-deep rounded-xl px-6 py-8 shadow-sm">
          {error && (
            <div role="alert" className="mb-4 bg-signal/10 text-signal border border-signal/20 p-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <form className="space-y-5" onSubmit={handleSignUp}>
            <Field label="Full name" htmlFor="fullName">
              <Input
                id="fullName"
                name="name"
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </Field>

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
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>

            <Field label="Confirm password" htmlFor="confirmPassword">
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </Field>

            {human.widget}

            <Button type="submit" disabled={loading || (!human.ready && !keptTicket)} size="lg" className="w-full">
              {loading ? 'Creating account…' : 'Create account'}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted">
            Already have an account?{' '}
            <Link href="/login" className="font-medium text-lake hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
