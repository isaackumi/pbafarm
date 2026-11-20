import { useState } from 'react'
import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useAuth } from '../../contexts/AuthContext'
import { errorMessage } from '../../lib/errorMessage'
import { useHumanCheck } from '../../components/HumanCheck'
import { useT, useLocale } from '../../lib/i18n/context'
import {
  AuthAlert,
  AuthGhost,
  AuthLayout,
  AuthStateCard,
  AuthSubmit,
  DarkEmphasis,
} from '../../components/auth/AuthUi'
import { LoadingState } from '../../components/ui'
import { Clock, Link2Off, MailCheck } from 'lucide-react'

const ROLE_KEYS = ['owner', 'admin', 'manager', 'field_staff', 'viewer']
const DAY_MS = 24 * 60 * 60 * 1000

/** Two letters for the company tile (Paper 61 "PF" for PBA Farm Ltd). */
function initials(name) {
  const words = (name || '?').trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)
  return letters.toUpperCase()
}

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

  // Paper 61 company tile: 52px, 14px radius, 3px surface border, lime
  // (#A8C93A on light), initials 16/20 bold in the page colour (white on light).
  const companyTile = info ? (
    <span
      className="flex size-[52px] shrink-0 items-center justify-center rounded-[14px] border-[3px] border-surface bg-lime text-[16px] font-bold leading-5 text-bg [html[data-theme=light]_&]:bg-[#A8C93A] [html[data-theme=light]_&]:text-white"
      aria-hidden
    >
      {initials(info.companyName)}
    </span>
  ) : null

  const expiresLabel = (at) => {
    const days = Math.ceil((at - Date.now()) / DAY_MS)
    if (days <= 0) return t('authUi.invite.expiresToday')
    if (days === 1) return t('authUi.invite.expiresTomorrow')
    return t('authUi.invite.expiresIn', { count: days })
  }

  // Paper 61 rows: 13/16, muted label, text value, 10px padding, line rules.
  const details = info ? (
    <dl className="flex flex-col border-t border-line text-[13px] leading-4">
      <div className="flex items-center justify-between gap-4 border-b border-line py-2.5">
        <dt className="text-muted">{t('authUi.invite.email')}</dt>
        <dd className="truncate text-text">{info.email}</dd>
      </div>
      {typeof info.expiresAt === 'number' && (
        <div className="flex items-center justify-between gap-4 border-b border-line py-2.5">
          <dt className="text-muted">{t('authUi.invite.expires')}</dt>
          <dd className="text-text">
            <time
              dateTime={new Date(info.expiresAt).toISOString()}
              title={new Date(info.expiresAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}
            >
              {expiresLabel(info.expiresAt)}
            </time>
          </dd>
        </div>
      )}
    </dl>
  ) : null

  const invited = (children) => (
    <AuthStateCard
      media={companyTile}
      title={t('authUi.invite.title', { company: info.companyName })}
      body={
        <>
          {t('authUi.invite.joinAsBefore')} <DarkEmphasis>{roleLabel(info.roleKey)}</DarkEmphasis>.
        </>
      }
    >
      {details}
      {children}
    </AuthStateCard>
  )

  // Paper 61 actions: Decline (outlined, hugs its label) then Accept (lime, fills the row), 10px apart.
  const actions = (primary, secondary) => <div className="flex gap-2.5">{secondary}{primary}</div>

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
        <AuthSubmit type="button" size="sm" onClick={openOrg}>
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
        {actions(
          <AuthSubmit type="button" size="sm" onClick={() => router.push(`/login?next=${next}`)}>
            {t('auth.login.signIn')}
          </AuthSubmit>,
          <AuthGhost href={`/signup?next=${next}`} hug>
            {t('authUi.signup.create')}
          </AuthGhost>,
        )}
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
        <AuthSubmit type="button" size="sm" onClick={() => router.push(`/verify-email?next=${encodeURIComponent(here)}`)}>
          {t('authUi.invite.verifyEmail')}
        </AuthSubmit>
      </>,
    )
  } else {
    body = invited(
      <>
        {human.widget}
        {actions(
          <AuthSubmit type="button" size="sm" disabled={busy || !human.ready} onClick={onAccept}>
            {busy ? t('authUi.invite.joining') : t('authUi.invite.accept')}
          </AuthSubmit>,
          <AuthGhost disabled={busy} onClick={onDecline} hug>
            {t('authUi.invite.decline')}
          </AuthGhost>,
        )}
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
