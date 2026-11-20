/**
 * Post-sign-in farm chooser (ORG-002). Members of more than one approved
 * organization pick the farm to work in; everyone else passes straight
 * through to `next`. Shown once per sign-in (lib/activeOrganization).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useAuth } from '../contexts/AuthContext'
import { useT } from '../lib/i18n/context'
import { safeNextPath } from '../lib/safeRedirect'
import { markOrgChosen, shouldShowChooser } from '../lib/activeOrganization'
import { useActiveOrganization } from '../lib/useActiveOrganization'
import { AuthAlert, AuthLayout } from '../components/auth/AuthUi'
import { OrgAvatar } from '../components/OrgAvatar'

/** Paper 70 check: 12px ink tick on the 22px sky disc. */
function Tick() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden>
      <path d="M5 12l5 5L20 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * One farm row (Paper 70 "Farm — selected" / "Farm" / "Farm — pending").
 * Selected: surface fill, 1.5px sky border, sky gradient avatar, sky check.
 * Others: #0E1012 fill (dark), 1.5px line border, empty radio ring.
 * Pending: dashed border, 70% opacity, muted initials, warn status, no radio.
 */
function OrgCard({ org, selected, lastUsed, pending, disabled, onSelect, onKeyDown, cardRef, t }) {
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
      className={`choose-org__card flex w-full items-center gap-3.5 rounded-[16px] border-[1.5px] px-[18px] py-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-ink disabled:cursor-not-allowed ${
        selected
          ? 'border-solid border-sky-ink bg-surface'
          : pending
            ? 'border-dashed border-line bg-surface opacity-70 dark:bg-[#0E1012]'
            : 'border-solid border-line bg-surface hover:border-line-strong dark:bg-[#0E1012]'
      }`}
    >
      <OrgAvatar name={org.name} logoUrl={org.logoUrl} size={40} highlight={selected} muted={pending} />
      <span className="flex min-w-0 grow basis-0 flex-col gap-[3px]">
        <span className="flex min-w-0 items-center gap-2">
          <span className="choose-org__name truncate text-[16px] font-semibold leading-5 text-text">{org.name}</span>
          {lastUsed && (
            <span className="choose-org__badge shrink-0 rounded-pill border border-[color:var(--pill-pink-border)] px-2 py-0.5 text-[11px] font-medium leading-[14px] text-[color:var(--pill-pink-text)]">
              {t('chooseOrg.lastUsed')}
            </span>
          )}
        </span>
        <span className={`choose-org__role truncate text-[13px] leading-4 ${pending ? 'text-warn' : 'text-muted'}`}>
          {pending
            ? org.companyStatus === 'pending'
              ? t('chooseOrg.pending')
              : t(`farmSwitcher.status.${org.companyStatus}`)
            : org.roleName || org.roleKey}
        </span>
      </span>
      {pending ? (
        <span className="w-[22px] shrink-0" aria-hidden />
      ) : (
        <span
          className={`flex size-[22px] shrink-0 items-center justify-center rounded-pill ${
            selected ? 'bg-sky-ink text-ink' : 'border-[1.5px] border-line-strong'
          }`}
          aria-hidden
        >
          {selected && <Tick />}
        </span>
      )}
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

  // Paper 70 sets the signed-in name in body text inside the muted subtitle.
  const NAME = '\u0000'
  const [beforeName, afterName = ''] = t('chooseOrg.subtitle', { name: NAME, count: orgs.length }).split(NAME)
  const who = user?.name || user?.email || ''

  return (
    <AuthLayout
      title={t('chooseOrg.title')}
      eyebrow={t('chooseOrg.panelEyebrow')}
      headline={t('chooseOrg.panelHeadline')}
      scene="signup"
      cards={false}
    >
      {/* Paper 70: one 18px-gap column for heading, list, button and links. */}
      <form className="flex flex-col gap-[18px]" onSubmit={onContinue}>
        <div className="flex flex-col gap-2.5">
          <h1 className="text-[32px] font-semibold leading-10 tracking-[-0.03em] text-text sm:text-4xl sm:leading-[44px]">
            {t('chooseOrg.title')}
          </h1>
          <p className="text-[15px] leading-[22px] text-muted">
            {beforeName}
            <span className="text-text">{who}</span>
            {afterName}
          </p>
        </div>
        {error && <AuthAlert>{error}</AuthAlert>}
        <div
          role="radiogroup"
          aria-label={t('chooseOrg.listLabel')}
          className="choose-org__list flex flex-col gap-2.5 pt-1.5"
        >
          {orgs.map((org) => (
            <OrgCard
              key={org.companyId}
              org={org}
              t={t}
              selected={selected === org.companyId}
              lastUsed={org.isActive}
              pending={org.companyStatus !== 'approved'}
              disabled={org.companyStatus !== 'approved' || busy}
              onSelect={setSelected}
              onKeyDown={onCardKey}
              cardRef={(el) => {
                cardRefs.current[org.companyId] = el
              }}
            />
          ))}
        </div>
        {/* Paper 70 "Continue": 1.5px lime ring around a lime pill, 14px/24px padding, 15/18 ink semibold. */}
        <button
          type="submit"
          disabled={!selected || busy}
          className="group flex w-full rounded-pill bg-lime p-[1.5px] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-ink focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="flex grow basis-0 items-center justify-center rounded-pill bg-lime px-6 py-3.5 text-[15px] font-semibold leading-[18px] text-ink transition-opacity group-hover:opacity-90">
            {busy || switching
              ? t('chooseOrg.continuing')
              : t('chooseOrg.continueTo', { name: selectedOrg?.name || '' })}
          </span>
        </button>
        <p className="whitespace-pre-wrap text-[13px] leading-4 text-muted">
          {t('chooseOrg.newFarm')}{' '}
          <Link href="/register-company" className="font-medium text-sky-ink hover:underline">
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
