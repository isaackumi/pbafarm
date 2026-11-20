/**
 * Post-sign-in farm chooser (ORG-002). Members of more than one approved
 * organization pick the farm to work in; everyone else passes straight
 * through to `next`. Shown once per sign-in (lib/activeOrganization).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useAuth } from '../contexts/AuthContext'
import { Check } from 'lucide-react'
import { useT } from '../lib/i18n/context'
import { safeNextPath } from '../lib/safeRedirect'
import { markOrgChosen, shouldShowChooser } from '../lib/activeOrganization'
import { useActiveOrganization } from '../lib/useActiveOrganization'
import { AuthAlert, AuthHeading, AuthLayout, AuthSubmit } from '../components/auth/AuthUi'
import { OrgAvatar } from '../components/OrgAvatar'

function OrgCard({ org, selected, lastUsed, disabled, onSelect, onKeyDown, cardRef, t }) {
  return (
    <button
      ref={cardRef}
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      tabIndex={selected ? 0 : -1}
      onClick={() => onSelect(org.companyId)}
      onKeyDown={onKeyDown}
      className={`choose-org__card flex w-full items-center gap-3.5 rounded-[16px] border-[1.5px] px-[18px] py-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:cursor-not-allowed disabled:border-dashed disabled:opacity-70 ${
        selected ? 'border-cyan bg-surface' : 'border-line bg-surface hover:border-line-strong'
      }`}
    >
      <OrgAvatar name={org.name} logoUrl={org.logoUrl} size={40} highlight={selected} className="rounded-[10px]" />
      <span className="flex min-w-0 grow basis-0 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="choose-org__name truncate text-[16px] font-semibold leading-5 text-text">{org.name}</span>
          {lastUsed && (
            <span className="choose-org__badge shrink-0 rounded-pill border border-[var(--pill-cyan-border)] px-2 py-0.5 text-[11px] font-medium leading-[14px] text-[var(--pill-cyan-text)]">
              {t('chooseOrg.lastUsed')}
            </span>
          )}
        </span>
        <span className={`choose-org__role truncate text-[13px] leading-4 ${org.companyStatus !== 'approved' ? 'text-warn' : 'text-muted'}`}>
          {org.companyStatus !== 'approved' ? t(`farmSwitcher.status.${org.companyStatus}`) : org.roleName || org.roleKey}
        </span>
      </span>
      <span
        className={`flex size-[22px] shrink-0 items-center justify-center rounded-full ${
          selected ? 'bg-cyan text-bg' : disabled ? '' : 'border-[1.5px] border-line-strong'
        }`}
        aria-hidden
      >
        {selected && <Check size={12} strokeWidth={3} />}
      </span>
    </button>
  )
}

export default function ChooseOrganizationPage() {
  const t = useT()
  const router = useRouter()
  const { orgs, active, switching, switchTo } = useActiveOrganization()
  const { user, signOut } = useAuth()
  const next = safeNextPath(router.query.next)
  const show = orgs !== undefined && shouldShowChooser(orgs)
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const cardRefs = useRef({})

  const usable = useMemo(() => (orgs || []).filter((o) => o.companyStatus === 'approved'), [orgs])

  // Single-farm members (or none): nothing to choose, carry on.
  useEffect(() => {
    if (!router.isReady || orgs === undefined || show) return
    markOrgChosen(window.sessionStorage)
    router.replace(next)
  }, [router, orgs, show, next])

  // Pre-select and focus the farm used last (the active one).
  useEffect(() => {
    if (!show || selected) return
    const initial = (active && active.companyStatus === 'approved' ? active : usable[0])?.companyId
    if (!initial) return
    setSelected(initial)
    requestAnimationFrame(() => cardRefs.current[initial]?.focus())
  }, [show, selected, active, usable])

  if (!show) return null
  const selectedOrg = orgs.find((o) => o.companyId === selected)

  // Radio-group arrow keys move (and select) between usable farms.
  const onCardKey = (e) => {
    const keys = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }
    if (!(e.key in keys) || usable.length === 0) return
    e.preventDefault()
    const i = usable.findIndex((o) => o.companyId === selected)
    const target = usable[(i + keys[e.key] + usable.length) % usable.length].companyId
    setSelected(target)
    cardRefs.current[target]?.focus()
  }

  const onContinue = async (e) => {
    e.preventDefault()
    if (!selected || busy) return
    setError('')
    setBusy(true)
    markOrgChosen(window.sessionStorage)
    if (active && selected === active.companyId) {
      router.replace(next)
      return
    }
    // Reloads into `next` so every cached query starts in the chosen farm.
    const ok = await switchTo(selected, { to: next })
    if (!ok) {
      setBusy(false)
      setError(t('chooseOrg.error'))
    }
  }

  return (
    <AuthLayout title={t('chooseOrg.title')}>
      <AuthHeading
        title={t('chooseOrg.title')}
        subtitle={t('chooseOrg.subtitle', { name: user?.name || user?.email || '', count: orgs.length })}
      />
      {error && <AuthAlert>{error}</AuthAlert>}
      <form className="flex flex-col gap-[22px]" onSubmit={onContinue}>
        <div role="radiogroup" aria-label={t('chooseOrg.listLabel')} className="choose-org__list flex flex-col gap-2.5">
          {orgs.map((org) => (
            <OrgCard
              key={org.companyId}
              org={org}
              t={t}
              selected={selected === org.companyId}
              lastUsed={org.isActive}
              disabled={org.companyStatus !== 'approved' || busy}
              onSelect={setSelected}
              onKeyDown={onCardKey}
              cardRef={(el) => {
                cardRefs.current[org.companyId] = el
              }}
            />
          ))}
        </div>
        <AuthSubmit disabled={!selected || busy}>
          {busy || switching
            ? t('chooseOrg.continuing')
            : t('chooseOrg.continueTo', { name: selectedOrg?.name || '' })}
        </AuthSubmit>
        <p className="text-[13px] leading-4 text-muted">
          {t('chooseOrg.newFarm')}{' '}
          <Link href="/register-company" className="font-medium text-cyan hover:underline">
            {t('farmSwitcher.registerAnother')}
          </Link>
          {'  ·  '}
          {t('chooseOrg.notYou')}{' '}
          <button type="button" onClick={() => signOut()} className="font-medium text-text hover:underline">
            {t('chooseOrg.signOut')}
          </button>
        </p>
      </form>
    </AuthLayout>
  )
}
