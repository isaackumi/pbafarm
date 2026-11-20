import { useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useAuth } from '../contexts/AuthContext'
import { safeNextPath } from '../lib/safeRedirect'
import { useHumanCheck } from '../components/HumanCheck'
import { useT } from '../lib/i18n/context'
import {
  AuthAlert,
  AuthCheckbox,
  AuthField,
  AuthHeading,
  AuthInput,
  AuthLayout,
  AuthSubmit,
  PasswordInput,
  StrengthBar,
} from '../components/auth/AuthUi'

/** Slightly under the server's sign-up grant (HUMAN_GRANT_TTL_MS, 5 minutes). */
const KEEP_TICKET_MS = 4.5 * 60 * 1000

export default function SignUp() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { signUpWithEmail, user } = useAuth()
  const human = useHumanCheck('signup')
  const [keptTicket, setKeptTicket] = useState(null)
  const router = useRouter()
  const t = useT()

  if (user) {
    router.push(safeNextPath(router.query.next, '/register-company'))
    return null
  }

  const handleSignUp = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    if (password !== confirmPassword) {
      setError(t('authUi.signup.mismatch'))
      setLoading(false)
      return
    }

    if (password.length < 6) {
      setError(t('authUi.signup.tooShort'))
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
      setError(err?.data?.message || err.message || t('authUi.humanFailed'))
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
      setError(signUpError.message || t('authUi.signup.failed'))
      setLoading(false)
      return
    }

    // A new account has no company yet: register one, or ask to join an invite.
    router.push(safeNextPath(router.query.next, '/register-company'))
  }

  return (
    <AuthLayout title={t('authUi.signup.title')} scene="signup" gap="gap-[18px]">
      <AuthHeading title={t('authUi.signup.title')} subtitle={t('authUi.signup.subtitle')} />

      {error && <AuthAlert>{error}</AuthAlert>}

      {/* Paper 60: one 18px rhythm from the heading to "Already have an account?" */}
      <form className="flex flex-col gap-[18px]" onSubmit={handleSignUp}>
        <AuthField label={t('authUi.signup.fullName')} htmlFor="fullName">
          <AuthInput
            id="fullName"
            name="name"
            type="text"
            autoComplete="name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </AuthField>

        <AuthField label={t('authUi.login.workEmail')} htmlFor="email">
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

        <AuthField label={t('auth.login.password')} htmlFor="password">
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </AuthField>
        <StrengthBar password={password} />

        <AuthField label={t('authUi.signup.confirm')} htmlFor="confirmPassword">
          <PasswordInput
            id="confirmPassword"
            name="confirmPassword"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </AuthField>

        {human.widget}

        {/* Dark: muted sentence, Terms and Privacy policy in the text colour; light: all text colour. */}
        <AuthCheckbox
          id="agree"
          required
          checked={agreed}
          onChange={setAgreed}
          labelClassName="text-muted [html[data-theme=light]_&]:text-text"
        >
          {t('authUi.signup.agreeBefore')}{' '}
          <Link href="/terms" target="_blank" className="text-text hover:underline underline-offset-2">
            {t('authUi.signup.agreeTerms')}
          </Link>{' '}
          {t('authUi.signup.agreeAnd')}{' '}
          <Link href="/privacy" target="_blank" className="text-text hover:underline underline-offset-2">
            {t('authUi.signup.agreePrivacy')}
          </Link>
        </AuthCheckbox>

        <AuthSubmit disabled={loading || !agreed || (!human.ready && !keptTicket)}>
          {loading ? t('authUi.signup.creating') : t('authUi.signup.create')}
        </AuthSubmit>

        <p className="text-[13px] leading-4 text-muted [html[data-theme=light]_&]:text-text">
          {t('authUi.signup.haveAccount')}{' '}
          <Link
            href="/login"
            className="rounded-sm font-medium text-text hover:underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-ink"
          >
            {t('auth.login.signIn')} →
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}
