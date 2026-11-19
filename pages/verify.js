import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { useAction } from 'convex/react'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { useT } from '../lib/i18n/context'
import {
  AUTH_INPUT,
  AUTH_LINK,
  AuthAlert,
  AuthField,
  AuthHeading,
  AuthInput,
  AuthLayout,
  AuthSubmit,
  OtpInput,
} from '../components/auth/AuthUi'
import { AuthenticatorEnrol, AuthenticatorVerify } from '../components/AuthenticatorApp'

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
  const [method, setMethod] = useState(null)

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
  const smsPossible = channels.length > 0
  // No phone channel (e.g. a super_admin outside a 2FA company): the
  // authenticator app is the only way, so open it straight away.
  const mode = method ?? (user.mfaTotp || !smsPossible ? 'app' : 'sms')
  const switchTo = (m) => {
    setMethod(m)
    setError('')
    setCode('')
    setSentTo(null)
  }

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

  const title = enrolling ? t('auth.verify.titleEnrol') : t('auth.verify.titleConfirm')
  return (
    <AuthLayout title={title}>
      <AuthHeading
        title={title}
        subtitle={enrolling ? t('auth.verify.introEnrol') : t('auth.verify.introConfirm', { phone: user.maskedPhone })}
      />

      {error && <AuthAlert>{error}</AuthAlert>}

      {mode === 'app' ? (
        user.mfaTotp ? (
          <AuthenticatorVerify />
        ) : (
          <AuthenticatorEnrol onDone={() => router.replace('/dashboard')} />
        )
      ) : channels.length === 0 ? (
        <AuthAlert tone="info">{t('auth.verify.noChannel')}</AuthAlert>
      ) : !sentTo ? (
        <form className="flex flex-col gap-[22px]" onSubmit={send}>
          {enrolling && (
            <AuthField label={t('common.mobileNumber')} htmlFor="enrol-phone" hint={t('auth.verify.phoneHint')}>
              <AuthInput
                id="enrol-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </AuthField>
          )}
          {channels.length > 1 && (
            <AuthField label={t('auth.verify.sendBy')} htmlFor="mfa-channel">
              <select
                id="mfa-channel"
                className={`${AUTH_INPUT} [&>option]:bg-surface`}
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
              >
                {channels.map((c) => (
                  <option key={c} value={c}>
                    {channelLabel(c)}
                  </option>
                ))}
              </select>
            </AuthField>
          )}
          <AuthSubmit disabled={busy || !channel || (enrolling && phone.trim().length < 6)}>
            {busy ? t('common.sending') : t('common.sendCode')}
          </AuthSubmit>
        </form>
      ) : (
        <form className="flex flex-col gap-[22px]" onSubmit={verify}>
          <p className="text-sm leading-5 text-muted">
            {t('auth.verify.codeSent', { channel: channelLabel(channel), to: sentTo })}
          </p>
          <OtpInput id="mfa-code" label={t('common.code')} value={code} onChange={setCode} autoFocus />
          <div className="flex items-center justify-between gap-3 text-sm leading-[18px]">
            <button
              type="button"
              className={AUTH_LINK}
              onClick={() => {
                setSentTo(null)
                setCode('')
                setError('')
              }}
            >
              {enrolling ? t('common.changeNumber') : t('auth.verify.chooseAnother')}
            </button>
            <button type="button" className={AUTH_LINK} disabled={cooldown > 0 || busy} onClick={send}>
              {cooldown > 0 ? t('common.sendAgainIn', { seconds: cooldown }) : t('common.sendNewCode')}
            </button>
          </div>
          <AuthSubmit disabled={busy || code.length !== 6}>
            {busy ? t('common.checking') : t('common.verify')}
          </AuthSubmit>
        </form>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm leading-[18px]">
        {mode === 'app' && smsPossible && (
          <button type="button" className={AUTH_LINK} onClick={() => switchTo('sms')}>
            {t('auth.verify.useText')}
          </button>
        )}
        {mode === 'sms' && (user.mfaTotp || enrolling || !smsPossible) && (
          <button type="button" className={AUTH_LINK} onClick={() => switchTo('app')}>
            {user.mfaTotp ? t('auth.verify.useApp') : t('auth.verify.setUpApp')}
          </button>
        )}
        <button
          type="button"
          className="ml-auto rounded text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
          onClick={async () => {
            await signOut({ force: true })
            router.replace('/login')
          }}
        >
          {t('common.signOut')}
        </button>
      </div>
    </AuthLayout>
  )
}
