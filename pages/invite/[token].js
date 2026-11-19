import { useState } from 'react'
import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useAuth } from '../../contexts/AuthContext'
import { errorMessage } from '../../lib/errorMessage'
import { useHumanCheck } from '../../components/HumanCheck'
import { useT, useLocale } from '../../lib/i18n/context'
import { AuthAlert, AuthGhost, AuthLayout, AuthStateCard, AuthSubmit } from '../../components/auth/AuthUi'
import { LoadingState } from '../../components/ui'
import { Clock, Link2Off, MailCheck } from 'lucide-react'

const ROLE_KEYS = ['owner', 'admin', 'manager', 'field_staff', 'viewer']

/** Accept an organization invite from its emailed link (ORG-003). */
export default function AcceptInvite() {
  const router = useRouter()
  const token = typeof router.query.token === 'string' ? router.query.token : ''
  const { user } = useAuth()
  const info = useQuery(api.memberships.inviteInfo, token ? { token } : 'skip')
  const verification = useQuery(api.emailVerification.status, user ? {} : 'skip')
  const accept = useMutation(api.memberships.acceptInvite)
  const decline = useMutation(api.memberships.declineInvite)
  const switchActive = useMutation(api.memberships.switchActive)
  const human = useHumanCheck('invite_accept')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)
  const here = `/invite/${token}`
  const t = useT()
  const { locale } = useLocale()
  const roleLabel = (k) => (ROLE_KEYS.includes(k) ? t(`authUi.invite.roles.${k}`) : k)

  const onAccept = async () => {
    setBusy(true)
    setError('')
    try {
      const humanTicket = await human.getTicket()
      const r = await accept(humanTicket ? { token, humanTicket } : { token })
      setDone(r)
    } catch (err) {
      setError(errorMessage(err, t('authUi.invite.acceptFailed')))
    } finally {
      setBusy(false)
    }
  }

  const onDecline = async () => {
    setBusy(true)
    try {
      await decline({ token })
      router.push('/dashboard')
    } catch (err) {
      setError(errorMessage(err, t('authUi.invite.declineFailed')))
      setBusy(false)
    }
  }

  const openOrg = async () => {
    if (!done) return
    if (!done.activated) await switchActive({ companyId: done.companyId })
    router.push('/dashboard')
  }

  const companyTile = info ? (
    <span
      className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[14px] border-[3px] border-surface bg-pink-fill text-[15px] font-bold leading-5 text-bg"
      aria-hidden
    >
      {(info.companyName || '?').trim().charAt(0).toUpperCase()}
    </span>
  ) : null

  const details = info ? (
    <dl className="flex flex-col border-t border-line text-[13px] leading-4">
      <div className="flex items-center justify-between gap-4 border-b border-line py-2.5">
        <dt className="text-muted">{t('authUi.invite.email')}</dt>
        <dd className="truncate text-text">{info.email}</dd>
      </div>
      <div className="flex items-center justify-between gap-4 border-b border-line py-2.5">
        <dt className="text-muted">{t('authUi.invite.role')}</dt>
        <dd className="text-text">{roleLabel(info.roleKey)}</dd>
      </div>
      {typeof info.expiresAt === 'number' && (
        <div className="flex items-center justify-between gap-4 border-b border-line py-2.5">
          <dt className="text-muted">{t('authUi.invite.expires')}</dt>
          <dd className="text-text">
            {new Date(info.expiresAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}
          </dd>
        </div>
      )}
    </dl>
  ) : null

  const invited = (children) => (
    <AuthStateCard
      eyebrow={t('authUi.invite.eyebrow')}
      title={
        <span className="flex items-center gap-4">
          {companyTile}
          <span>{t('authUi.invite.title', { company: info.companyName })}</span>
        </span>
      }
      body={t('authUi.invite.joinAs', { role: roleLabel(info.roleKey) })}
    >
      {details}
      {children}
    </AuthStateCard>
  )

  let body
  if (!token || info === undefined) {
    body = <LoadingState label={t('authUi.invite.loading')} />
  } else if (info === null) {
    body = (
      <AuthStateCard icon={<Link2Off />} title={t('authUi.invite.invalidTitle')} body={t('authUi.invite.invalid')}>
        <AuthGhost href="/login">{t('auth.login.signIn')}</AuthGhost>
      </AuthStateCard>
    )
  } else if (done) {
    body = (
      <AuthStateCard
        icon={<MailCheck />}
        title={t('authUi.invite.joinedTitle')}
        body={t('authUi.invite.joined', { company: info.companyName })}
      >
        <AuthSubmit type="button" onClick={openOrg}>
          {t('authUi.invite.open', { company: info.companyName })}
        </AuthSubmit>
      </AuthStateCard>
    )
  } else if (info.state === 'expired') {
    body = (
      <AuthStateCard
        icon={<Clock />}
        title={t('authUi.invite.expiredTitle')}
        body={t('authUi.invite.expired', { company: info.companyName })}
      >
        <AuthGhost href="/login">{t('auth.login.signIn')}</AuthGhost>
      </AuthStateCard>
    )
  } else if (info.state !== 'pending') {
    body = (
      <AuthStateCard icon={<Link2Off />} title={t('authUi.invite.usedTitle')} body={t('authUi.invite.used')}>
        <AuthGhost href="/login">{t('auth.login.signIn')}</AuthGhost>
      </AuthStateCard>
    )
  } else if (!user) {
    const next = encodeURIComponent(here)
    body = invited(
      <>
        <p className="text-sm leading-5 text-muted">
          {t('authUi.invite.signInAs')} <span className="font-medium text-text">{info.email}</span>.{' '}
          {t('authUi.invite.newHere')}
        </p>
        <div className="flex flex-col gap-2.5 sm:flex-row-reverse">
          <AuthSubmit type="button" onClick={() => router.push(`/login?next=${next}`)}>
            {t('auth.login.signIn')}
          </AuthSubmit>
          <AuthGhost href={`/signup?next=${next}`}>{t('authUi.signup.create')}</AuthGhost>
        </div>
      </>,
    )
  } else if ((user.email || '').toLowerCase() !== info.email) {
    body = invited(
      <AuthAlert tone="info">{t('authUi.invite.wrongAccount', { email: info.email, current: user.email })}</AuthAlert>,
    )
  } else if (verification && !verification.verified) {
    body = invited(
      <>
        <p className="text-sm leading-5 text-muted">{t('authUi.invite.verifyFirst')}</p>
        <AuthSubmit type="button" onClick={() => router.push(`/verify-email?next=${encodeURIComponent(here)}`)}>
          {t('authUi.invite.verifyEmail')}
        </AuthSubmit>
      </>,
    )
  } else {
    body = invited(
      <>
        {human.widget}
        <div className="flex flex-col gap-2.5 sm:flex-row-reverse">
          <AuthSubmit type="button" disabled={busy || !human.ready} onClick={onAccept}>
            {busy ? t('authUi.invite.joining') : t('authUi.invite.accept')}
          </AuthSubmit>
          <AuthGhost disabled={busy} onClick={onDecline}>
            {t('authUi.invite.decline')}
          </AuthGhost>
        </div>
      </>,
    )
  }

  return (
    <AuthLayout
      title={info ? t('authUi.invite.title', { company: info.companyName }) : t('authUi.invite.pageTitle')}
      eyebrow={t('authUi.panel.inviteEyebrow')}
      headline={t('authUi.panel.inviteHeadline')}
    >
      {error && <AuthAlert>{error}</AuthAlert>}
      {body}
    </AuthLayout>
  )
}
