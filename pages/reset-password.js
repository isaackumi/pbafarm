import { useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useAuthActions } from '@convex-dev/auth/react'
import { useHumanCheck } from '../components/HumanCheck'
import { useT } from '../lib/i18n/context'
import {
  AUTH_LINK,
  AuthAlert,
  AuthField,
  AuthHeading,
  AuthInput,
  AuthLayout,
  AuthSubmit,
  PasswordInput,
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
      <AuthHeading
        title={step === 'email' ? t('authUi.reset.title') : t('authUi.reset.newTitle')}
        subtitle={step === 'email' ? t('authUi.reset.emailIntro') : t('authUi.reset.codeIntro', { email })}
      />

      {error && <AuthAlert>{error}</AuthAlert>}

      {step === 'email' ? (
        <form className="flex flex-col gap-[22px]" onSubmit={sendCode}>
          <AuthField label={t('auth.login.email')} htmlFor="email">
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
        <form className="flex flex-col gap-[18px]" onSubmit={setNewPassword}>
          <AuthField label={t('common.code')} htmlFor="code">
            <AuthInput
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              className="font-mono tracking-[0.2em]"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </AuthField>
          <AuthField label={t('authUi.reset.newPassword')} htmlFor="password">
            <PasswordInput
              id="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <StrengthBar password={password} />
          </AuthField>
          <AuthField label={t('authUi.reset.confirm')} htmlFor="confirm">
            <PasswordInput
              id="confirm"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </AuthField>
          <AuthSubmit disabled={busy}>
            {busy ? t('common.saving') : t('authUi.reset.submit')}
          </AuthSubmit>
          <button
            type="button"
            className={`self-start text-sm leading-[18px] ${AUTH_LINK}`}
            onClick={() => {
              setStep('email')
              setCode('')
              setError('')
            }}
          >
            {t('common.sendNewCode')}
          </button>
        </form>
      )}

      <p className="text-sm leading-[18px] text-muted">
        {t('authUi.reset.remembered')}{' '}
        <Link href="/login" className={AUTH_LINK}>
          {t('auth.login.signIn')} →
        </Link>
      </p>
    </AuthLayout>
  )
}
