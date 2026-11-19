import { useEffect, useState } from 'react'
import { useAction, useMutation, useQuery } from 'convex/react'
import QRCode from 'qrcode'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { Button, Field, Input } from './ui'

/** Authenticator-app two-step verification (ENT-003). */

function CodeInput({ id, value, onChange, label = 'Code from your authenticator app' }) {
  return (
    <Field label={label} htmlFor={id}>
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
  return (
    <div className="space-y-4">
      <p className="text-sm text-chart-ink">
        Save these recovery codes somewhere safe. Each works once if you lose your phone. They will not be shown again.
      </p>
      <ul className="grid grid-cols-2 gap-2 rounded-lg bg-foam p-3 font-mono text-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex gap-3">
        <Button type="button" variant="secondary" onClick={() => navigator.clipboard?.writeText(codes.join('\n'))}>
          Copy
        </Button>
        <Button type="button" onClick={onDone}>
          I have saved them
        </Button>
      </div>
    </div>
  )
}

/** Scan a QR code, confirm one code, then show recovery codes. */
export function AuthenticatorEnrol({ onDone }) {
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
    setBusy(true)
    setError('')
    try {
      setSetup(await start({}))
    } catch (err) {
      setError(errorMessage(err, 'Could not start set-up'))
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

  if (codes) return <RecoveryCodes codes={codes} onDone={onDone} />
  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-sm text-signal">{error}</p>}
      {!setup ? (
        <Button type="button" onClick={begin} disabled={busy}>
          {busy ? 'Starting…' : 'Set up an authenticator app'}
        </Button>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          <p className="text-sm text-muted">
            Scan this with Google Authenticator, Microsoft Authenticator, 1Password or similar, then enter the 6-digit code.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- local data: URL */}
          {qr && <img src={qr} alt="Authenticator set-up QR code" width={200} height={200} className="mx-auto" />}
          <p className="break-all text-center font-mono text-xs text-muted">{setup.secret}</p>
          <CodeInput id="totp-enrol-code" value={code} onChange={setCode} />
          <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
            {busy ? 'Checking…' : 'Turn on'}
          </Button>
        </form>
      )}
    </div>
  )
}

/** Verify this sign-in with an app code or a recovery code. */
export function AuthenticatorVerify() {
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
      {error && <p role="alert" className="text-sm text-signal">{error}</p>}
      {useRecovery ? (
        <Field label="Recovery code" htmlFor="totp-recovery">
          <Input id="totp-recovery" required autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
      ) : (
        <CodeInput id="totp-code" value={code} onChange={setCode} />
      )}
      <Button type="submit" size="lg" className="w-full" disabled={busy || (!useRecovery && code.length !== 6)}>
        {busy ? 'Checking…' : 'Verify'}
      </Button>
      <button
        type="button"
        className="w-full text-center text-sm text-lake hover:underline"
        onClick={() => {
          setUseRecovery((v) => !v)
          setCode('')
          setError('')
        }}
      >
        {useRecovery ? 'Use the authenticator app' : 'Use a recovery code'}
      </button>
    </form>
  )
}

/** Account page card: set up, regenerate recovery codes, or remove. */
export function AuthenticatorCard() {
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

  let body
  if (codes) body = <RecoveryCodes codes={codes} onDone={reset} />
  else if (!status.enrolled) {
    body = status.available ? (
      <AuthenticatorEnrol onDone={reset} />
    ) : (
      <p className="text-sm text-muted">Authenticator apps are not available on this deployment yet.</p>
    )
  } else if (mode) {
    body = (
      <form className="space-y-4" onSubmit={run}>
        {error && <p role="alert" className="text-sm text-signal">{error}</p>}
        <CodeInput id="totp-manage-code" value={code} onChange={setCode} />
        <div className="flex gap-3">
          <Button type="button" variant="secondary" onClick={reset}>
            Cancel
          </Button>
          <Button type="submit" variant={mode === 'disable' ? 'danger' : 'primary'} disabled={busy || code.length !== 6}>
            {mode === 'disable' ? 'Remove authenticator app' : 'New recovery codes'}
          </Button>
        </div>
      </form>
    )
  } else {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-chart-ink">
          On. Every new sign-in asks for a code from your app. {status.recoveryCodesLeft} recovery codes left.
        </p>
        <div className="flex gap-3">
          <Button type="button" variant="secondary" onClick={() => setMode('regenerate')}>
            New recovery codes
          </Button>
          <Button type="button" variant="ghost" onClick={() => setMode('disable')}>
            Remove
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-card space-y-4 p-6">
      <div>
        <h2 className="text-base font-semibold text-chart-ink">Authenticator app</h2>
        <p className="text-sm text-muted">Two-step verification with a 6-digit code from an app on your phone.</p>
      </div>
      {body}
    </div>
  )
}
