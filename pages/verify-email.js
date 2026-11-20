import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import {
  AuthAlert,
  AuthGhost,
  AuthHeading,
  AuthLayout,
  AuthSolid,
  AuthStateCard,
  AuthSubmit,
  DarkEmphasis,
  OtpInput,
  StateIcon,
  clock,
} from '../components/auth/AuthUi'

const RESEND_SECONDS = 30
/** Paper 61 "Open Gmail": offered when the address is a Gmail one. */
const isGmail = (email) => /@(gmail|googlemail)\.com$/i.test(email || '')
import { safeNextPath } from '../lib/safeRedirect'
import { errorMessage } from '../lib/errorMessage'
import { useT } from '../lib/i18n/context'

/** Confirm the signed-in account's email with a 6-digit code (SEC-005). */
export default function VerifyEmail() {
  const router = useRouter()
  const t = useT()
  const status = useQuery(api.emailVerification.status)
  const requestCode = useMutation(api.emailVerification.requestCode)
  const verify = useMutation(api.emailVerification.verify)
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const next = safeNextPath(router.query.next, '/dashboard')

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const send = async () => {
    setBusy(true)
    setError('')
    try {
      await requestCode({})
      setSent(true)
      setCooldown(RESEND_SECONDS)
    } catch (err) {
      setError(errorMessage(err, t('auth.verifyEmail.couldNotSend')))
    } finally {
      setBusy(false)
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await verify({ code })
      if (r.verified) router.push(next)
      else setError(t('auth.verifyEmail.wrongCode'))
    } catch (err) {
      setError(errorMessage(err, t('auth.verifyEmail.couldNotVerify')))
    } finally {
      setBusy(false)
    }
  }

  const email = status?.email || ''
  return (
    <AuthLayout title={t('auth.verifyEmail.title')}>
      {error && <AuthAlert>{error}</AuthAlert>}

      {status?.verified ? (
        <>
          <AuthHeading title={t('auth.verifyEmail.title')} subtitle={email || undefined} />
          <AuthAlert tone="good">{t('auth.verifyEmail.verified')}</AuthAlert>
          <AuthSubmit type="button" onClick={() => router.push(next)}>
            {t('common.continue')}
          </AuthSubmit>
        </>
      ) : !sent ? (
        <AuthStateCard
          icon={StateIcon.mail}
          title={t('auth.verifyEmail.title')}
          body={
            <>
              {email && (
                <>
                  <DarkEmphasis>{email}</DarkEmphasis>
                  <br />
                </>
              )}
              {t('auth.verifyEmail.intro')}
            </>
          }
        >
          <div className="pt-1">
            <AuthSolid disabled={busy || !status} onClick={send}>
              {busy ? t('common.sending') : t('auth.verifyEmail.emailMe')}
            </AuthSolid>
          </div>
        </AuthStateCard>
      ) : (
        // Paper 61 "/verify-email" card; this flow confirms with a 6-digit code.
        <AuthStateCard
          icon={StateIcon.mail}
          title={t('authUi.verifyEmail.sentTitle')}
          body={
            <>
              {t('authUi.verifyEmail.sentBefore')} <DarkEmphasis>{email}</DarkEmphasis>. {t('authUi.verifyEmail.sentAfter')}
            </>
          }
        >
          <form className="flex flex-col gap-5" onSubmit={submit}>
            <OtpInput id="code" card label={t('common.code')} value={code} onChange={setCode} autoFocus />
            <div className="flex flex-col gap-2.5 pt-1">
              <AuthSolid type="submit" disabled={busy || code.length !== 6}>
                {busy ? t('common.checking') : t('common.verify')}
              </AuthSolid>
              {isGmail(email) && (
                <AuthGhost href="https://mail.google.com/" target="_blank" rel="noopener noreferrer">
                  {t('authUi.verifyEmail.openGmail')}
                </AuthGhost>
              )}
              {/* Drawn at full strength while counting down (Paper 61 "Resend in 0:42"). */}
              <AuthGhost
                onClick={cooldown > 0 ? undefined : send}
                aria-disabled={cooldown > 0}
                disabled={busy}
                className="aria-disabled:cursor-default aria-disabled:hover:bg-transparent"
              >
                {cooldown > 0
                  ? t('authUi.verifyEmail.resendIn', { time: clock(cooldown) })
                  : t('authUi.verifyEmail.resend')}
              </AuthGhost>
            </div>
          </form>
        </AuthStateCard>
      )}
    </AuthLayout>
  )
}
