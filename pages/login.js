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
import { useT } from '../lib/i18n/context'
import LanguageSwitcher from '../components/LanguageSwitcher'
import { useAuthActions } from '@convex-dev/auth/react'
import { useHumanCheck } from '../components/HumanCheck'

/** `{ code, message, details }` of a ConvexError thrown by sign-in, if any. */
function errorData(err) {
  let data = err?.data
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      data = null
    }
  }
  return data && typeof data === 'object' ? data : null
}

/** Enterprise SSO (ENT-003): shown when the deployment has an OIDC provider. */
const SSO_NAME = process.env.NEXT_PUBLIC_AUTH_OIDC_NAME || ''

/** Passwordless sign-in with a code sent to a registered phone (SEC-006). */
function PhoneSignIn({ onSignedIn }) {
  const { sendPhoneCode, verifyPhoneCode } = useAuth()
  const t = useT()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState('phone')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const send = async (e) => {
    e?.preventDefault()
    setBusy(true)
    setError('')
    const { error: sendError } = await sendPhoneCode(phone)
    setBusy(false)
    if (sendError) {
      setError(t('auth.login.serverUnreachable'))
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
      setError(t('auth.login.codeInvalid'))
      return
    }
    onSignedIn()
  }

  if (step === 'code') {
    return (
      <form className="space-y-5" onSubmit={verify}>
        <p className="text-sm text-muted">{t('auth.login.codeOnItsWay', { phone })}</p>
        {error && (
          <div role="alert" className="bg-signal/10 text-signal border border-signal/20 p-3 rounded-lg text-sm">
            {error}
          </div>
        )}
        <Field label={t('common.code')} htmlFor="otp">
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
          {busy ? t('common.checking') : t('auth.login.signIn')}
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
            {t('common.changeNumber')}
          </button>
          <button
            type="button"
            className="text-lake hover:underline disabled:text-muted disabled:no-underline"
            disabled={cooldown > 0 || busy}
            onClick={send}
          >
            {cooldown > 0 ? t('common.sendAgainIn', { seconds: cooldown }) : t('common.sendNewCode')}
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
        label={t('common.mobileNumber')}
        htmlFor="phone"
        hint={t('auth.login.phoneHint')}
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
        {busy ? t('common.sending') : t('common.sendCode')}
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
  // CF-003: after repeated failures the server asks for the human check.
  const [needsHuman, setNeedsHuman] = useState(false)
  const human = useHumanCheck('signin')
  const { signInWithEmail, user } = useAuth()
  const { signIn } = useAuthActions()
  const t = useT()
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

    let humanTicket = null
    if (needsHuman) {
      try {
        humanTicket = await human.getTicket()
      } catch (err) {
        setError(errorData(err)?.message || err.message || t('auth.login.failed'))
        setLoading(false)
        return
      }
    }

    const { error: signInError } = await signInWithEmail(email, password, humanTicket)

    if (signInError) {
      const data = errorData(signInError)
      const raw = signInError.message || ''
      let friendly
      if (data?.details?.reason === 'HUMAN_CHECK_REQUIRED') {
        setNeedsHuman(true)
        friendly = t('auth.login.humanCheck')
      } else if (data?.message) {
        friendly = data.message
      } else {
        friendly =
          raw.includes('InvalidAccountId') || raw.includes('InvalidSecret')
            ? t('auth.login.wrongCredentials')
            : raw || t('auth.login.failed')
      }
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
          <h1 className="text-xl font-semibold text-chart-ink">{t('auth.login.title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('auth.login.tagline')}</p>
        </div>

        <div className="bg-surface border border-foam-deep rounded-xl px-6 py-8 shadow-sm">
          {reason && !error && (
            <div
              role="alert"
              className="mb-4 bg-signal/10 text-signal border border-signal/20 p-3 rounded-lg text-sm"
            >
              {t('auth.login.signedOut')} {authErrorText(reason)}
            </div>
          )}
          {error && (
            <div role="alert" className="mb-4 bg-signal/10 text-signal border border-signal/20 p-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div role="tablist" aria-label={t('auth.login.method')} className="mb-6 grid grid-cols-2 gap-1 rounded-lg bg-foam p-1">
            {[
              ['email', t('auth.login.tabEmail')],
              ['phone', t('auth.login.tabPhone')],
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
            <Field label={t('auth.login.email')} htmlFor="email">
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
              label={t('auth.login.password')}
              htmlFor="password"
              hint={
                <Link href="/reset-password" className="text-lake hover:underline">
                  {t('auth.login.forgot')}
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

            {needsHuman && human.widget}

            <Button type="submit" disabled={loading || (needsHuman && !human.ready)} size="lg" className="w-full">
              {loading ? t('auth.login.signingIn') : t('auth.login.signIn')}
            </Button>
          </form>
          )}

          {SSO_NAME && (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="mt-4 w-full"
              onClick={() => signIn('oidc', { redirectTo: safeNextPath(router.query.next) })}
            >
              {t('auth.login.sso', { name: SSO_NAME })}
            </Button>
          )}

          <p className="mt-6 text-center text-sm text-muted">
            {t('auth.login.noAccount')}{' '}
            <Link href="/signup" className="font-medium text-lake hover:underline">
              {t('auth.login.createOne')}
            </Link>
          </p>
        </div>
        <div className="mt-4 flex justify-center">
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  )
}
