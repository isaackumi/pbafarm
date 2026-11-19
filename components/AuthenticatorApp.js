import { useEffect, useState } from 'react'
import { useAction, useMutation, useQuery } from 'convex/react'
import QRCode from 'qrcode'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { useT } from '../lib/i18n/context'
import { Button, Field, GhostButton, GradientButton, Input, Pill } from './ui'
import { SettingsRow, InlineError } from './settings'

/** Authenticator-app two-step verification (ENT-003). */

function CodeInput({ id, value, onChange, label }) {
  const t = useT()
  return (
    <Field label={label || t('settingsUi.totp.codeLabel')} htmlFor={id}>
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        className="tracking-[0.4em] text-center text-lg"
      />
    </Field>
  )
}

/** Recovery codes, shown once. */
export function RecoveryCodes({ codes, onDone }) {
  const t = useT()
  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-[18px] text-text">{t('settingsUi.totp.codesIntro')}</p>
      <ul className="grid grid-cols-2 gap-2 rounded-input border border-line bg-surface-2 p-3 font-data text-[13px] text-text">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3">
        <GhostButton onClick={() => navigator.clipboard?.writeText(codes.join('\n'))}>{t('settingsUi.totp.copy')}</GhostButton>
        <GradientButton size="sm" variant="solid" onClick={onDone}>
          {t('settingsUi.totp.saved')}
        </GradientButton>
      </div>
    </div>
  )
}

/** Scan a QR code, confirm one code, then show recovery codes. */
export function AuthenticatorEnrol({ onDone, autoStart = false }) {
  const t = useT()
  const start = useAction(api.mfaTotp.startEnrolment)
  const confirm = useMutation(api.mfaTotp.confirmEnrolment)
  const [setup, setSetup] = useState(null)
  const [qr, setQr] = useState('')
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!setup) return
    QRCode.toDataURL(setup.uri, { margin: 1, width: 200 }).then(setQr, () => setQr(''))
  }, [setup])

  const begin = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      setSetup(await start({}))
    } catch (err) {
      setError(errorMessage(err, t('settingsUi.totp.startFailed')))
    } finally {
      setBusy(false)
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await confirm({ code })
      if (r.ok) setCodes(r.recoveryCodes)
      else setError(r.error)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (autoStart) begin()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start once on mount
  }, [])

  if (codes) return <RecoveryCodes codes={codes} onDone={onDone} />
  return (
    <div className="space-y-4">
      <InlineError>{error}</InlineError>
      {!setup ? (
        <Button type="button" onClick={begin} disabled={busy}>
          {busy ? t('settingsUi.totp.starting') : t('settingsUi.totp.setUp')}
        </Button>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          <p className="text-[13px] leading-[18px] text-muted">{t('settingsUi.totp.scan')}</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- local data: URL */}
          {qr && <img src={qr} alt={t('settingsUi.totp.qrAlt')} width={200} height={200} className="mx-auto rounded-input" />}
          <p className="break-all text-center font-data text-xs text-muted">{setup.secret}</p>
          <CodeInput id="totp-enrol-code" value={code} onChange={setCode} />
          <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
            {busy ? t('common.checking') : t('settingsUi.totp.turnOn')}
          </Button>
        </form>
      )}
    </div>
  )
}

/** Verify this sign-in with an app code or a recovery code. */
export function AuthenticatorVerify() {
  const t = useT()
  const verify = useMutation(api.mfaTotp.verify)
  const redeem = useMutation(api.mfaTotp.redeemRecoveryCode)
  const [useRecovery, setUseRecovery] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = useRecovery ? await redeem({ code }) : await verify({ code })
      if (!r.ok) setError(r.error)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <InlineError>{error}</InlineError>
      {useRecovery ? (
        <Field label={t('settingsUi.totp.recoveryCode')} htmlFor="totp-recovery">
          <Input id="totp-recovery" required autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
      ) : (
        <CodeInput id="totp-code" value={code} onChange={setCode} />
      )}
      <Button type="submit" size="lg" className="w-full" disabled={busy || (!useRecovery && code.length !== 6)}>
        {busy ? t('common.checking') : t('settingsUi.totp.verify')}
      </Button>
      <button
        type="button"
        className="w-full rounded text-center text-sm text-pearl-cyan hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
        onClick={() => {
          setUseRecovery((v) => !v)
          setCode('')
          setError('')
        }}
      >
        {useRecovery ? t('settingsUi.totp.useApp') : t('settingsUi.totp.useRecovery')}
      </button>
    </form>
  )
}

/** Paper 31 "Sign-in methods" row: status pill, then set up, new codes or remove inline. */
export function AuthenticatorRow() {
  const t = useT()
  const status = useQuery(api.mfaTotp.status, {})
  const regenerate = useMutation(api.mfaTotp.regenerateRecoveryCodes)
  const disable = useMutation(api.mfaTotp.disable)
  const [mode, setMode] = useState(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!status) return null
  const reset = () => {
    setMode(null)
    setCode('')
    setCodes(null)
    setError('')
  }

  const run = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = mode === 'regenerate' ? await regenerate({ code }) : await disable({ code })
      if (!r.ok) setError(r.error)
      else if (r.recoveryCodes) setCodes(r.recoveryCodes)
      else reset()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const helper = status.enrolled
    ? t('settingsUi.totp.helperOn', { count: status.recoveryCodesLeft })
    : status.available
      ? t('settingsUi.totp.helperOff')
      : t('settingsUi.totp.unavailable')

  let body = null
  if (codes) body = <RecoveryCodes codes={codes} onDone={reset} />
  else if (!status.enrolled && mode === 'enrol') body = <AuthenticatorEnrol onDone={reset} autoStart />
  else if (status.enrolled && mode) {
    body = (
      <form className="space-y-4" onSubmit={run}>
        <InlineError>{error}</InlineError>
        <CodeInput id="totp-manage-code" value={code} onChange={setCode} />
        <div className="flex flex-wrap justify-end gap-3">
          <GhostButton onClick={reset}>{t('common.cancel')}</GhostButton>
          {mode === 'disable' ? (
            <GhostButton type="submit" tone="danger" disabled={busy || code.length !== 6}>
              {t('settingsUi.totp.remove')}
            </GhostButton>
          ) : (
            <GradientButton type="submit" size="sm" variant="solid" disabled={busy || code.length !== 6}>
              {t('settingsUi.totp.newCodes')}
            </GradientButton>
          )}
        </div>
      </form>
    )
  }

  return (
    <>
      <SettingsRow label={t('settingsUi.totp.title')} helper={helper}>
        {status.enrolled ? (
          <>
            {!mode && !codes && (
              <>
                <GhostButton size="sm" onClick={() => setMode('regenerate')}>
                  {t('settingsUi.totp.newCodes')}
                </GhostButton>
                <GhostButton size="sm" tone="danger" onClick={() => setMode('disable')}>
                  {t('settingsUi.totp.removeShort')}
                </GhostButton>
              </>
            )}
            <Pill tone="green">{t('settingsUi.on')}</Pill>
          </>
        ) : status.available && mode !== 'enrol' && !codes ? (
          <GhostButton onClick={() => setMode('enrol')}>{t('settingsUi.totp.setUpShort')}</GhostButton>
        ) : (
          <Pill tone="neutral">{t('settingsUi.off')}</Pill>
        )}
      </SettingsRow>
      {body && <div className="pb-3">{body}</div>}
    </>
  )
}
