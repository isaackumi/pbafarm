import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { useAction } from 'convex/react'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { Button, Field, Input, Select } from '../components/ui'
import { useT } from '../lib/i18n/context'
import LanguageSwitcher from '../components/LanguageSwitcher'

const CHANNEL_KEY = { sms: 'auth.verify.channelSms', whatsapp: 'auth.verify.channelWhatsapp' }
const RESEND_SECONDS = 30

/**
 * Two-step verification for this sign-in (SEC-007). AuthWrapper sends any
 * session whose company requires 2FA here until it is verified. Accounts
 * without a phone enrol one first: the code goes to the new number.
 */
export default function VerifyPage() {
  const { user, signOut } = useAuth()
  const t = useT()
  const channelLabel = (c) => (CHANNEL_KEY[c] ? t(CHANNEL_KEY[c]) : c)
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
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
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
            {enrolling ? t('auth.verify.titleEnrol') : t('auth.verify.titleConfirm')}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {enrolling
              ? t('auth.verify.introEnrol')
              : t('auth.verify.introConfirm', { phone: user.maskedPhone })}
          </p>
        </div>

        <div className="bg-surface border border-foam-deep rounded-xl px-6 py-8 shadow-sm space-y-5">
          {error && (
            <div role="alert" className="bg-signal/10 text-signal border border-signal/20 p-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {channels.length === 0 ? (
            <p className="text-sm text-chart-ink">{t('auth.verify.noChannel')}</p>
          ) : !sentTo ? (
            <form className="space-y-5" onSubmit={send}>
              {enrolling && (
                <Field label={t('common.mobileNumber')} htmlFor="enrol-phone" hint={t('auth.verify.phoneHint')}>
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
                <Field label={t('auth.verify.sendBy')} htmlFor="mfa-channel">
                  <Select id="mfa-channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
                    {channels.map((c) => (
                      <option key={c} value={c}>
                        {channelLabel(c)}
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
                {busy ? t('common.sending') : t('common.sendCode')}
              </Button>
            </form>
          ) : (
            <form className="space-y-5" onSubmit={verify}>
              <p className="text-sm text-muted">
                {t('auth.verify.codeSent', { channel: channelLabel(channel), to: sentTo })}
              </p>
              <Field label={t('common.code')} htmlFor="mfa-code">
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
                {busy ? t('common.checking') : t('common.verify')}
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
                  {enrolling ? t('common.changeNumber') : t('auth.verify.chooseAnother')}
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
          )}

          <button
            type="button"
            className="w-full text-center text-sm text-muted hover:text-chart-ink"
            onClick={async () => {
              await signOut({ force: true })
              router.replace('/login')
            }}
          >
            {t('common.signOut')}
          </button>
        </div>
        <div className="mt-4 flex justify-center">
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  )
}
