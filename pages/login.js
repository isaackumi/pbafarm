import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useAuth } from '../contexts/AuthContext'
import { safeNextPath } from '../lib/safeRedirect'
import {
  AUTH_ERROR_CODES,
  SIGN_OUT_CODES,
  authErrorText,
} from '../convex/lib/authErrors'
import { Button, Field, Input } from '../components/ui'

/** Passwordless sign-in with a code sent to a registered phone (SEC-006). */
function PhoneSignIn({ onSignedIn }) {
  const { sendPhoneCode, verifyPhoneCode } = useAuth()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState('phone')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const send = async (e) => {
    e?.preventDefault()
    setBusy(true)
    setError('')
    const { error: sendError } = await sendPhoneCode(phone)
    setBusy(false)
    if (sendError) {
      setError('Could not reach the server. Check your connection and try again.')
      return
    }
    setStep('code')
    setCooldown(30)
  }

  const verify = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { signedIn } = await verifyPhoneCode(phone, code)
    setBusy(false)
    if (!signedIn) {
      setError('That code is not valid or has expired. Check it, or ask for a new one.')
      return
    }
    onSignedIn()
  }

  if (step === 'code') {
    return (
      <form className="space-y-5" onSubmit={verify}>
        <p className="text-sm text-muted">
          If {phone} is registered for phone sign-in, a 6-digit code is on its way. It expires in
          10 minutes.
        </p>
        {error && (
          <div role="alert" className="bg-signal/10 text-signal border border-signal/20 p-3 rounded-lg text-sm">
            {error}
          </div>
        )}
        <Field label="Code" htmlFor="otp">
          <Input
            id="otp"
            name="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="tracking-[0.4em] text-center text-lg"
          />
        </Field>
        <Button type="submit" disabled={busy || code.length !== 6} size="lg" className="w-full">
          {busy ? 'Checking…' : 'Sign in'}
        </Button>
        <div className="flex justify-between text-sm">
          <button
            type="button"
            className="text-lake hover:underline"
            onClick={() => {
              setStep('phone')
              setCode('')
              setError('')
            }}
          >
            Change number
          </button>
          <button
            type="button"
            className="text-lake hover:underline disabled:text-muted disabled:no-underline"
            disabled={cooldown > 0 || busy}
            onClick={send}
          >
            {cooldown > 0 ? `Send again in ${cooldown}s` : 'Send a new code'}
          </button>
        </div>
      </form>
    )
  }

  return (
    <form className="space-y-5" onSubmit={send}>
      {error && (
        <div role="alert" className="bg-signal/10 text-signal border border-signal/20 p-3 rounded-lg text-sm">
          {error}
        </div>
      )}
      <Field
        label="Mobile number"
        htmlFor="phone"
        hint="The number your farm admin registered for you, for example 024 412 3456."
      >
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </Field>
      <Button type="submit" disabled={busy || phone.trim().length < 6} size="lg" className="w-full">
        {busy ? 'Sending…' : 'Send code'}
      </Button>
    </form>
  )
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [method, setMethod] = useState('email')
  const { signInWithEmail, user } = useAuth()
  const router = useRouter()
  const reason =
    typeof router.query.reason === 'string' && AUTH_ERROR_CODES[router.query.reason]
      ? router.query.reason
      : null

  // An account that is about to be signed out (inactive, company not approved)
  // stays here; AuthWrapper ends the session and sets ?reason=.
  if (user && !SIGN_OUT_CODES.includes(user.accessState)) {
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
          {reason && !error && (
            <div
              role="alert"
              className="mb-4 bg-signal/10 text-signal border border-signal/20 p-3 rounded-lg text-sm"
            >
              You have been signed out. {authErrorText(reason)}
            </div>
          )}
          {error && (
            <div role="alert" className="mb-4 bg-signal/10 text-signal border border-signal/20 p-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div role="tablist" aria-label="Sign-in method" className="mb-6 grid grid-cols-2 gap-1 rounded-lg bg-foam p-1">
            {[
              ['email', 'Email'],
              ['phone', 'Phone'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={method === id}
                onClick={() => {
                  setMethod(id)
                  setError('')
                }}
                className={`min-h-10 rounded-md text-sm font-medium transition-colors ${
                  method === id ? 'bg-surface text-chart-ink shadow-sm' : 'text-muted hover:text-chart-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {method === 'phone' ? (
            <PhoneSignIn onSignedIn={() => router.push(safeNextPath(router.query.next))} />
          ) : (
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

            <Field
              label="Password"
              htmlFor="password"
              hint={
                <Link href="/reset-password" className="text-lake hover:underline">
                  Forgot password?
                </Link>
              }
            >
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
          )}

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
