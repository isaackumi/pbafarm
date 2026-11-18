import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { useAction } from 'convex/react'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { Button, Field, Input, Select } from '../components/ui'

const CHANNEL_LABEL = { sms: 'Text message (SMS)', whatsapp: 'WhatsApp' }
const RESEND_SECONDS = 30

/**
 * Two-step verification for this sign-in (SEC-007). AuthWrapper sends any
 * session whose company requires 2FA here until it is verified. Accounts
 * without a phone enrol one first: the code goes to the new number.
 */
export default function VerifyPage() {
  const { user, signOut } = useAuth()
  const router = useRouter()
  const startChallenge = useAction(api.mfa.startChallenge)
  const startEnrolment = useAction(api.mfa.startEnrolment)
  const verifyChallenge = useAction(api.mfa.verifyChallenge)

  const channels = useMemo(() => user?.mfaChannels || [], [user?.mfaChannels])
  const [channel, setChannel] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sentTo, setSentTo] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (!channel && channels.length) {
      setChannel(channels.includes(user?.mfaDefaultChannel) ? user.mfaDefaultChannel : channels[0])
    }
  }, [channel, channels, user?.mfaDefaultChannel])

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  // Verified (here or elsewhere): continue into the app.
  useEffect(() => {
    if (user && !user.mfaRequired) router.replace('/dashboard')
  }, [user, router])

  if (!user) return null
  const enrolling = !user.hasPhone

  const send = async (e) => {
    e?.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = enrolling
        ? await startEnrolment({ phone, channel })
        : await startChallenge({ channel })
      if (!result.ok) {
        setError(result.error)
      } else {
        setSentTo(result.sentTo)
        setCooldown(RESEND_SECONDS)
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const verify = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await verifyChallenge({ code })
      if (!result.ok) setError(result.error)
      // On success users.current updates and the effect above moves on.
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-foam px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <p className="font-display text-4xl font-medium text-chart-ink mb-2">PBA Farm</p>
          <h1 className="text-xl font-semibold text-chart-ink">
            {enrolling ? 'Add your phone number' : 'Confirm it is you'}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {enrolling
              ? 'Your company asks for a code at each new sign-in. Add the mobile number the code should go to.'
              : `Your company asks for a code at each new sign-in. We send it to ${user.maskedPhone}.`}
          </p>
        </div>

        <div className="bg-surface border border-foam-deep rounded-xl px-6 py-8 shadow-sm space-y-5">
          {error && (
            <div role="alert" className="bg-signal/10 text-signal border border-signal/20 p-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {channels.length === 0 ? (
            <p className="text-sm text-chart-ink">
              Codes cannot be sent right now because your company&apos;s messaging channel is not working. Ask your admin to check Messaging settings.
            </p>
          ) : !sentTo ? (
            <form className="space-y-5" onSubmit={send}>
              {enrolling && (
                <Field label="Mobile number" htmlFor="enrol-phone" hint="For example 024 412 3456.">
                  <Input
                    id="enrol-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </Field>
              )}
              {channels.length > 1 && (
                <Field label="Send the code by" htmlFor="mfa-channel">
                  <Select id="mfa-channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
                    {channels.map((c) => (
                      <option key={c} value={c}>
                        {CHANNEL_LABEL[c] || c}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={busy || !channel || (enrolling && phone.trim().length < 6)}
              >
                {busy ? 'Sending…' : 'Send code'}
              </Button>
            </form>
          ) : (
            <form className="space-y-5" onSubmit={verify}>
              <p className="text-sm text-muted">
                Code sent by {CHANNEL_LABEL[channel] || channel} to {sentTo}. It expires in 10 minutes.
              </p>
              <Field label="Code" htmlFor="mfa-code">
                <Input
                  id="mfa-code"
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
              <Button type="submit" size="lg" className="w-full" disabled={busy || code.length !== 6}>
                {busy ? 'Checking…' : 'Verify'}
              </Button>
              <div className="flex justify-between text-sm">
                <button
                  type="button"
                  className="text-lake hover:underline"
                  onClick={() => {
                    setSentTo(null)
                    setCode('')
                    setError('')
                  }}
                >
                  {enrolling ? 'Change number' : 'Choose another way'}
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
          )}

          <button
            type="button"
            className="w-full text-center text-sm text-muted hover:text-chart-ink"
            onClick={async () => {
              await signOut({ force: true })
              router.replace('/login')
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
