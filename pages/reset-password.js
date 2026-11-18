import { useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useAuthActions } from '@convex-dev/auth/react'
import { Button, Field, Input } from '../components/ui'
import { useHumanCheck } from '../components/HumanCheck'

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
          ? 'No account uses that email.'
          : /human/i.test(raw)
            ? raw
            : 'Could not send the code. Try again in a minute.',
      )
    } finally {
      setBusy(false)
    }
  }

  const setNewPassword = async (e) => {
    e.preventDefault()
    setError('')
    if (password.length < 6) {
      setError('Password must be at least 6 characters long')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
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
      setError('That code is wrong or has expired. Ask for a new one.')
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-foam px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <p className="font-display text-4xl font-medium text-chart-ink mb-2">PBA Farm</p>
          <h1 className="text-xl font-semibold text-chart-ink">Reset your password</h1>
          <p className="mt-1 text-sm text-muted">
            {step === 'email'
              ? 'We will email you a code.'
              : `Enter the code sent to ${email} and choose a new password.`}
          </p>
        </div>

        <div className="bg-surface border border-foam-deep rounded-xl px-6 py-8 shadow-sm">
          {error && (
            <div role="alert" className="mb-4 bg-signal/10 text-signal border border-signal/20 p-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {step === 'email' ? (
            <form className="space-y-5" onSubmit={sendCode}>
              <Field label="Email" htmlFor="email">
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              {human.widget}
              <Button type="submit" disabled={busy || !human.ready} size="lg" className="w-full">
                {busy ? 'Sending…' : 'Send code'}
              </Button>
            </form>
          ) : (
            <form className="space-y-5" onSubmit={setNewPassword}>
              <Field label="Code" htmlFor="code">
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </Field>
              <Field label="New password" htmlFor="password">
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Field label="Confirm new password" htmlFor="confirm">
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </Field>
              <Button type="submit" disabled={busy} size="lg" className="w-full">
                {busy ? 'Saving…' : 'Set new password'}
              </Button>
              <button
                type="button"
                className="w-full text-sm text-lake hover:underline"
                onClick={() => {
                  setStep('email')
                  setCode('')
                  setError('')
                }}
              >
                Send a new code
              </button>
            </form>
          )}

          <p className="mt-6 text-center text-sm text-muted">
            Remembered it?{' '}
            <Link href="/login" className="font-medium text-lake hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
