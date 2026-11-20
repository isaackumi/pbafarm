import { useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useAuthActions } from '@convex-dev/auth/react'
import { useHumanCheck } from '../components/HumanCheck'
import { useT } from '../lib/i18n/context'
import {
  AUTH_INPUT_CARD,
  AUTH_LINK,
  AuthAlert,
  AuthField,
  AuthHeading,
  AuthInput,
  AuthLayout,
  AuthStateCard,
  AuthSubmit,
  PasswordInput,
  StateIcon,
  StrengthBar,
} from '../components/auth/AuthUi'

/**
 * Password reset by emailed code (SEC-005). Step 1 sends an 8-digit code;
 * step 2 sets the new password and signs in.
 */
export default function ResetPassword() {
  const { signIn } = useAuthActions()
  const router = useRouter()
  const [step, setStep] = useState('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const human = useHumanCheck('password_reset')
  const t = useT()

  const sendCode = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const form = new FormData()
      form.set('email', email.trim().toLowerCase())
      form.set('flow', 'reset')
      const humanTicket = await human.getTicket()
      if (humanTicket) form.set('humanTicket', humanTicket)
      await signIn('password', form)
      setStep('code')
    } catch (err) {
      const raw = err?.data?.message || err?.message || ''
      setError(
        raw.includes('InvalidAccountId')
          ? t('authUi.reset.noAccount')
          : /human/i.test(raw)
            ? raw
            : t('authUi.reset.couldNotSend'),
      )
    } finally {
      setBusy(false)
    }
  }

  const setNewPassword = async (e) => {
    e.preventDefault()
    setError('')
    if (password.length < 6) {
      setError(t('authUi.signup.tooShort'))
      return
    }
    if (password !== confirm) {
      setError(t('authUi.signup.mismatch'))
      return
    }
    setBusy(true)
    try {
      const form = new FormData()
      form.set('email', email.trim().toLowerCase())
      form.set('code', code.trim())
      form.set('newPassword', password)
      form.set('flow', 'reset-verification')
      await signIn('password', form)
      router.push('/dashboard')
    } catch {
      setError(t('authUi.reset.wrongCode'))
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={t('authUi.reset.title')}>
      {step === 'email' && <AuthHeading title={t('authUi.reset.title')} subtitle={t('authUi.reset.emailIntro')} />}

      {error && <AuthAlert>{error}</AuthAlert>}

      {step === 'email' ? (
        <form className="flex flex-col gap-[22px]" onSubmit={sendCode}>
          <AuthField label={t('authUi.login.workEmail')} htmlFor="email">
            <AuthInput
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </AuthField>
          {human.widget}
          <AuthSubmit disabled={busy || !human.ready}>
            {busy ? t('common.sending') : t('common.sendCode')}
          </AuthSubmit>
        </form>
      ) : (
        // Paper 61 "/reset-password" card. The emailed code field and the
        // confirmation are this flow's own (the card draws a link-based reset).
        <AuthStateCard icon={StateIcon.lock} title={t('authUi.reset.newTitle')} body={t('authUi.reset.sessionsNote')}>
          <form className="flex flex-col gap-5" onSubmit={setNewPassword}>
            <AuthField label={t('common.code')} htmlFor="code" hint={t('authUi.reset.codeIntro', { email })}>
              <input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                className={`${AUTH_INPUT_CARD} font-mono tracking-[0.2em]`}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </AuthField>
            <AuthField label={t('authUi.reset.newPassword')} htmlFor="password">
              <PasswordInput
                id="password"
                card
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <StrengthBar password={password} className="pt-0.5" />
            </AuthField>
            <AuthField label={t('authUi.reset.confirm')} htmlFor="confirm">
              <PasswordInput
                id="confirm"
                card
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </AuthField>
            <AuthSubmit size="md" lightSolid disabled={busy}>
              {busy ? t('common.saving') : t('authUi.reset.saveSignIn')}
            </AuthSubmit>
            <button
              type="button"
              className={`self-start text-[13px] leading-4 ${AUTH_LINK}`}
              onClick={() => {
                setStep('email')
                setCode('')
                setError('')
              }}
            >
              {t('common.sendNewCode')}
            </button>
          </form>
        </AuthStateCard>
      )}

      <p className="text-[13px] leading-4 text-muted">
        {t('authUi.reset.remembered')}{' '}
        <Link href="/login" className={AUTH_LINK}>
          {t('auth.login.signIn')} →
        </Link>
      </p>
    </AuthLayout>
  )
}
