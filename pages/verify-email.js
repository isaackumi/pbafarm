import { useState } from 'react'
import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { Button, Field, Input } from '../components/ui'
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
    <div className="min-h-screen flex items-center justify-center bg-foam px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <p className="font-display text-4xl font-medium text-chart-ink mb-2">PBA Farm</p>
          <h1 className="text-xl font-semibold text-chart-ink">{t('auth.verifyEmail.title')}</h1>
          {status?.email && <p className="mt-1 text-sm text-muted">{status.email}</p>}
        </div>

        <div className="bg-surface border border-foam-deep rounded-xl px-6 py-8 shadow-sm space-y-5">
          {error && (
            <div role="alert" className="bg-signal/10 text-signal border border-signal/20 p-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {status?.verified ? (
            <>
              <p className="text-sm text-chart-ink">{t('auth.verifyEmail.verified')}</p>
              <Button size="lg" className="w-full" onClick={() => router.push(next)}>
                {t('common.continue')}
              </Button>
            </>
          ) : !sent ? (
            <>
              <p className="text-sm text-muted">{t('auth.verifyEmail.intro')}</p>
              <Button size="lg" className="w-full" disabled={busy || !status} onClick={send}>
                {busy ? t('common.sending') : t('auth.verifyEmail.emailMe')}
              </Button>
            </>
          ) : (
            <form className="space-y-5" onSubmit={submit}>
              <Field label={t('common.code')} htmlFor="code" hint={t('auth.verifyEmail.expires')}>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </Field>
              <Button type="submit" size="lg" className="w-full" disabled={busy}>
                {busy ? t('common.checking') : t('common.verify')}
              </Button>
              <button type="button" className="w-full text-sm text-lake hover:underline" onClick={send} disabled={busy}>
                {t('common.sendNewCode')}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
