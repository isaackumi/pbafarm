import { useState } from 'react'
import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import {
  AUTH_LINK,
  AuthAlert,
  AuthHeading,
  AuthLayout,
  AuthSubmit,
  OtpInput,
} from '../components/auth/AuthUi'
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
  const next = safeNextPath(router.query.next, '/dashboard')

  const send = async () => {
    setBusy(true)
    setError('')
    try {
      await requestCode({})
      setSent(true)
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

  return (
    <AuthLayout title={t('auth.verifyEmail.title')}>
      <AuthHeading title={t('auth.verifyEmail.title')} subtitle={status?.email || undefined} />

      {error && <AuthAlert>{error}</AuthAlert>}

      {status?.verified ? (
        <>
          <AuthAlert tone="good">{t('auth.verifyEmail.verified')}</AuthAlert>
          <AuthSubmit type="button" onClick={() => router.push(next)}>
            {t('common.continue')}
          </AuthSubmit>
        </>
      ) : !sent ? (
        <>
          <p className="text-sm leading-5 text-muted">{t('auth.verifyEmail.intro')}</p>
          <AuthSubmit type="button" disabled={busy || !status} onClick={send}>
            {busy ? t('common.sending') : t('auth.verifyEmail.emailMe')}
          </AuthSubmit>
        </>
      ) : (
        <form className="flex flex-col gap-[22px]" onSubmit={submit}>
          <OtpInput id="code" label={t('common.code')} value={code} onChange={setCode} autoFocus />
          <p className="text-xs leading-4 text-muted">{t('auth.verifyEmail.expires')}</p>
          <AuthSubmit disabled={busy || code.length !== 6}>
            {busy ? t('common.checking') : t('common.verify')}
          </AuthSubmit>
          <button type="button" className={`self-start text-[13px] leading-4 ${AUTH_LINK}`} onClick={send} disabled={busy}>
            {t('common.sendNewCode')}
          </button>
        </form>
      )}
    </AuthLayout>
  )
}
