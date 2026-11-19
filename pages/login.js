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
import { useT } from '../lib/i18n/context'
import {
  AUTH_LINK,
  AuthAlert,
  AuthDivider,
  AuthField,
  AuthHeading,
  AuthInput,
  AuthLayout,
  AuthSubmit,
  MethodTabs,
  OtpInput,
  PasswordInput,
} from '../components/auth/AuthUi'
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

/** Passwordless sign-in with a code sent to a registered phone (SEC-006, Paper 15b). */
function PhoneSignIn({ phone, setPhone, step, setStep, onSignedIn, onUseEmail }) {
  const { sendPhoneCode, verifyPhoneCode } = useAuth()
  const t = useT()
  const [code, setCode] = useState('')
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
      <form className="flex flex-col gap-[22px]" onSubmit={verify}>
        {error && <AuthAlert>{error}</AuthAlert>}
        <OtpInput id="otp" label={t('common.code')} value={code} onChange={setCode} autoFocus />
        <div className="flex items-center justify-between gap-3 text-sm leading-[18px]">
          <button type="button" className={AUTH_LINK} disabled={cooldown > 0 || busy} onClick={send}>
            {cooldown > 0 ? t('common.sendAgainIn', { seconds: cooldown }) : t('common.sendNewCode')}
          </button>
          <button
            type="button"
            className={AUTH_LINK}
            onClick={() => {
              setStep('phone')
              setCode('')
              setError('')
            }}
          >
            {t('common.changeNumber')}
          </button>
        </div>
        <AuthSubmit disabled={busy || code.length !== 6}>
          {busy ? t('common.checking') : t('authUi.login.verifyAndSignIn')}
        </AuthSubmit>
        <div className="flex flex-col gap-1 rounded-input border border-line bg-surface px-4 py-3.5">
          <p className="text-sm font-semibold leading-[18px] text-text">{t('authUi.login.sharedPhoneTitle')}</p>
          <p className="text-sm leading-5 text-muted">{t('authUi.login.sharedPhoneBody')}</p>
        </div>
        <button type="button" onClick={onUseEmail} className={`self-start text-sm leading-[18px] text-muted hover:text-text ${AUTH_LINK.replace('text-cyan ', '')}`}>
          ← {t('authUi.login.useEmail')}
        </button>
      </form>
    )
  }

  return (
    <form className="flex flex-col gap-[22px]" onSubmit={send}>
      {error && <AuthAlert>{error}</AuthAlert>}
      <AuthField label={t('common.mobileNumber')} htmlFor="phone" hint={t('auth.login.phoneHint')}>
        <AuthInput
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </AuthField>
      <AuthSubmit disabled={busy || phone.trim().length < 6}>
        {busy ? t('common.sending') : t('common.sendCode')}
      </AuthSubmit>
    </form>
  )
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [method, setMethod] = useState('email')
  const [phone, setPhone] = useState('')
  const [phoneStep, setPhoneStep] = useState('phone')
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

  const codeStep = method === 'phone' && phoneStep === 'code'
  const tabs = [
    { id: 'email', label: t('auth.login.tabEmail') },
    { id: 'phone', label: t('authUi.login.tabPhoneCode') },
    ...(SSO_NAME ? [{ id: 'sso', label: t('authUi.login.tabSso') }] : []),
  ]

  return (
    <AuthLayout title={t('auth.login.title')}>
      <AuthHeading
        title={codeStep ? t('authUi.login.codeTitle') : t('authUi.login.title')}
        subtitle={codeStep ? t('auth.login.codeOnItsWay', { phone }) : t('authUi.login.subtitle')}
      />

      {reason && !error && (
        <AuthAlert>
          {t('auth.login.signedOut')} {authErrorText(reason)}
        </AuthAlert>
      )}
      {error && <AuthAlert>{error}</AuthAlert>}

      {!codeStep && (
        <MethodTabs
          label={t('auth.login.method')}
          tabs={tabs}
          value={method}
          onChange={(id) => {
            setMethod(id)
            setError('')
          }}
        />
      )}

      {method === 'phone' ? (
        <PhoneSignIn
          phone={phone}
          setPhone={setPhone}
          step={phoneStep}
          setStep={setPhoneStep}
          onSignedIn={() => router.push(safeNextPath(router.query.next))}
          onUseEmail={() => {
            setMethod('email')
            setPhoneStep('phone')
          }}
        />
      ) : method === 'sso' && SSO_NAME ? (
        <div className="flex flex-col gap-[22px]">
          <p className="text-sm leading-5 text-muted">{t('authUi.login.ssoHint', { name: SSO_NAME })}</p>
          <AuthSubmit type="button" onClick={() => signIn('oidc', { redirectTo: safeNextPath(router.query.next) })}>
            {t('auth.login.sso', { name: SSO_NAME })}
          </AuthSubmit>
        </div>
      ) : (
        <form className="flex flex-col gap-[22px]" onSubmit={handleEmailLogin}>
          <AuthField label={t('auth.login.email')} htmlFor="email">
            <AuthInput
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </AuthField>

          <AuthField
            label={t('auth.login.password')}
            htmlFor="password"
            aside={
              <Link href="/reset-password" className={`text-sm leading-[18px] ${AUTH_LINK}`}>
                {t('auth.login.forgot')}
              </Link>
            }
          >
            <PasswordInput
              id="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </AuthField>

          {needsHuman && human.widget}

          <AuthSubmit disabled={loading || (needsHuman && !human.ready)}>
            {loading ? t('auth.login.signingIn') : t('auth.login.signIn')}
          </AuthSubmit>

          {SSO_NAME && (
            <>
              <AuthDivider label={t('authUi.or')} />
              <button
                type="button"
                onClick={() => setMethod('sso')}
                className="w-full rounded-pill border border-line-strong py-[13px] text-sm font-medium leading-[18px] text-text hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
              >
                {t('auth.login.sso', { name: SSO_NAME })}
              </button>
            </>
          )}
        </form>
      )}

      {!codeStep && (
        <p className="text-sm leading-[18px] text-muted">
          {t('authUi.login.newHere')}{' '}
          <Link href="/signup" className={AUTH_LINK}>
            {t('authUi.login.createWorkspace')} →
          </Link>
        </p>
      )}
    </AuthLayout>
  )
}
