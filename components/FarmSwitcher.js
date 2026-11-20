/**
 * Active farm indicator + switcher at the top of the sidebar (ORG-002),
 * Paper shell 7Z-0 "Tenant" row and 69 "Farm switcher — open".
 *
 * The row shows the farm's 24px tile, its name and the active site (the
 * member's role when there is no site). Members of several farms, or of a
 * farm with several sites, get the chevron and the menu: "Switch farm"
 * (reloads the app) and, not in the artboard, the farm's sites. On the
 * collapsed rail only the 32px avatar is shown.
 *
 * Markup is kept in small pieces with `farm-switcher__*` classNames so the
 * Paper restyle can target them.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { MapPin } from 'lucide-react'
import { useT } from '../lib/i18n/context'
import { useActiveOrganization } from '../lib/useActiveOrganization'
import { useLocation } from '../contexts/LocationContext'
import { OrgAvatar } from './OrgAvatar'

/** Paper 69 icons: up/down chevrons, check and plus (exact paths). */
function UpDown({ className = '' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden className={`shrink-0 ${className}`}>
      <path d="M7 9l5-5 5 5M7 15l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
function Tick() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden className="shrink-0 text-sky-ink">
      <path d="M5 12l5 5L20 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

// Paper 69 menu (dark literals; the light theme has no artboard, so it uses
// the surface tokens).
const MENU_BOX =
  'bg-[#14161A] shadow-[0_24px_48px_#0000008C,0_2px_6px_#00000066] [[data-theme=light]_&]:bg-surface [[data-theme=light]_&]:shadow-[var(--shadow-md)]'
const ROW_ON = 'bg-[#1B1E22] [[data-theme=light]_&]:bg-surface-2'
const ROW =
  'flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-text hover:bg-surface-2 focus:bg-surface-2 focus:outline-none disabled:cursor-not-allowed'

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

function OrgOption({ org, checked, disabled, switching, onSelect, statusLabel, t }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={() => onSelect(org)}
      className={`farm-switcher__option ${ROW} ${statusLabel ? 'opacity-60' : 'disabled:opacity-60'} ${checked ? ROW_ON : ''}`}
    >
      <OrgAvatar
        name={org.name}
        logoUrl={org.logoUrl}
        size={28}
        highlight={checked}
        muted={Boolean(statusLabel)}
        className={statusLabel ? 'border-dashed' : ''}
      />
      <span className="flex min-w-0 grow basis-0 flex-col gap-px">
        <span className="farm-switcher__option-name truncate text-[14px] font-medium leading-[18px]">{org.name}</span>
        <span className={`farm-switcher__option-role truncate text-[12px] leading-4 ${statusLabel ? 'text-warn' : 'text-muted'}`}>
          {switching ? t('farmSwitcher.switching') : statusLabel || org.roleName || org.roleKey}
        </span>
      </span>
      <span className="flex w-4 shrink-0 justify-center">{checked && <Tick />}</span>
    </button>
  )
}

/** A site of the active farm (in the app, not in Paper 69). */
function SiteOption({ site, checked, disabled, onSelect }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onSelect(site)}
      className={`farm-switcher__site ${ROW} disabled:opacity-60 ${checked ? ROW_ON : ''}`}
    >
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] border border-line-strong bg-surface-2 text-muted" aria-hidden>
        <MapPin size={14} strokeWidth={2} />
      </span>
      <span className="grow basis-0 truncate text-[14px] font-medium leading-[18px]">{site.name}</span>
      <span className="flex w-4 shrink-0 justify-center">{checked && <Tick />}</span>
    </button>
  )
}

export default function FarmSwitcher({ collapsed = false }) {
  const t = useT()
  const { orgs, active, isMulti, switching, switchTo } = useActiveOrganization()
  const { locations, activeLocationId, setActiveLocation, loading: sitesLoading } = useLocation()
  const site = locations.find((loc) => (loc.id || loc._id) === activeLocationId)
  const multiSite = locations.length > 1
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)

  const close = useCallback((refocus = true) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }, [])

  // The sidebar scrolls (overflow-y: auto), so the menu is fixed-positioned
  // next to the trigger to escape it, including on the collapsed rail.
  useIsoLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    setPos(
      collapsed
        ? { top: r.top, left: r.right + 8, width: 272 }
        : { top: r.bottom + 8, left: r.left - 4, width: 296 },
    )
  }, [open, collapsed])

  // Focus the checked item (or the first one) when the menu opens.
  useEffect(() => {
    if (!open || !menuRef.current) return
    const items = [...menuRef.current.querySelectorAll('[role="menuitemradio"]:not([disabled])')]
    const checked = items.find((el) => el.getAttribute('aria-checked') === 'true')
    ;(checked || items[0])?.focus()
  }, [open, pos])

  // Outside click and Escape close; resize/scroll close (the position is fixed).
  useEffect(() => {
    if (!open) return undefined
    const onPointer = (e) => {
      if (menuRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return
      close(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close(true)
      }
    }
    const onResize = () => close(false)
    const onScroll = (e) => {
      if (!menuRef.current?.contains(e.target)) close(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('touchstart', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('touchstart', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [open, close])

  if (orgs === undefined) {
    return (
      <div
        className={`farm-switcher farm-switcher--loading rounded-[8px] bg-surface-2 ${collapsed ? 'mx-auto size-8' : 'h-[34px]'}`}
        aria-hidden
      />
    )
  }
  if (!active) return null

  const roleLine = active.roleName || active.roleKey
  const label = t('farmSwitcher.current', { name: active.name, role: roleLine })
  const hasMenu = isMulti || multiSite

  const body = (
    <>
      {collapsed ? (
        <OrgAvatar name={active.name} logoUrl={active.logoUrl} size={32} highlight />
      ) : (
        <OrgAvatar name={active.name} logoUrl={active.logoUrl} size={24} highlight={open} lightText />
      )}
      {!collapsed && (
        <span className="farm-switcher__text flex min-w-0 grow basis-0 flex-col text-left">
          <span className="farm-switcher__name truncate text-[14px] font-medium leading-[18px] text-text">
            {active.name}
          </span>
          <span className="farm-switcher__role truncate text-[12px] leading-4 text-muted">{site?.name || roleLine}</span>
        </span>
      )}
      {!collapsed && hasMenu && <UpDown className="farm-switcher__chevron text-muted" />}
    </>
  )

  // Paper 7Z-0: the closed row is 6px in from the sidebar edge; 69: open it
  // fills (surface-2, 1px #1F3E6E outline, 10px radius) with 6px padding all
  // round. The negative margin keeps the rows below from moving.
  const frame = `farm-switcher flex items-center gap-2.5 rounded-[10px] ${collapsed ? 'justify-center' : '-my-1.5 p-1.5'}`

  if (!hasMenu) {
    return (
      <div className={frame} title={collapsed ? label : undefined} aria-label={label} role="group">
        {body}
      </div>
    )
  }

  const onMenuKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    const items = [...menuRef.current.querySelectorAll('[role="menuitemradio"]:not([disabled]), [role="menuitem"]')]
    if (items.length === 0) return
    e.preventDefault()
    const i = items.indexOf(document.activeElement)
    const next =
      e.key === 'Home' ? 0
        : e.key === 'End' ? items.length - 1
          : e.key === 'ArrowDown' ? (i + 1) % items.length
            : (i - 1 + items.length) % items.length
    items[next].focus()
  }

  const select = async (org) => {
    if (org.isActive) {
      close(true)
      return
    }
    await switchTo(org.companyId)
  }

  const selectSite = (loc) => {
    const id = loc.id || loc._id
    if (id === activeLocationId) {
      close(true)
      return
    }
    setActiveLocation(id)
  }

  const statusLabel = (org) =>
    org.companyStatus === 'approved' ? null : t(`farmSwitcher.status.${org.companyStatus}`)

  return (
    <div className="farm-switcher-root">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={collapsed ? label : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          }
        }}
        className={`${frame} w-full hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
          open ? 'bg-surface-2 ring-1 ring-[#1F3E6E] [[data-theme=light]_&]:ring-line-strong' : ''
        }`}
      >
        {body}
      </button>
      {open && pos && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('farmSwitcher.menuLabel')}
          onKeyDown={onMenuKey}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
          className={`farm-switcher__menu z-50 flex max-h-[70vh] flex-col overflow-y-auto rounded-[14px] border border-line-strong p-1.5 ${MENU_BOX}`}
        >
          {isMulti && (
            <>
              <div className="farm-switcher__menu-title px-2.5 pb-1.5 pt-2.5 text-[11px] font-medium uppercase leading-[14px] tracking-[0.06em] text-faint">
                {t('farmSwitcher.menuLabel')}
              </div>
              {orgs.map((org) => (
                <OrgOption
                  key={org.companyId}
                  org={org}
                  t={t}
                  checked={org.isActive}
                  disabled={org.companyStatus !== 'approved' || (!!switching && switching !== org.companyId)}
                  switching={switching === org.companyId}
                  statusLabel={statusLabel(org)}
                  onSelect={select}
                />
              ))}
            </>
          )}
          {multiSite && (
            <>
              {isMulti && <div className="h-px shrink-0 bg-line" role="none" />}
              <div className="farm-switcher__menu-title px-2.5 pb-1.5 pt-2.5 text-[11px] font-medium uppercase leading-[14px] tracking-[0.06em] text-faint">
                {t('farmSwitcher.sites')}
              </div>
              {locations.map((loc) => (
                <SiteOption
                  key={loc.id || loc._id}
                  site={loc}
                  checked={(loc.id || loc._id) === activeLocationId}
                  disabled={sitesLoading}
                  onSelect={selectSite}
                />
              ))}
            </>
          )}
          {isMulti && (
            <>
              <div className="h-px shrink-0 bg-line" role="none" />
              <Link
                href="/register-company"
                role="menuitem"
                onClick={() => close(false)}
                className="farm-switcher__register flex items-center gap-2.5 rounded-[10px] p-2.5 text-[13px] font-medium leading-4 text-sky-ink hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
              >
                <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] border border-dashed border-line-strong" aria-hidden>
                  <PlusIcon />
                </span>
                {t('farmSwitcher.registerAnother')}
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  )
}
