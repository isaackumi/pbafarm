/**
 * Active farm indicator + switcher at the top of the sidebar (ORG-002).
 *
 * Shows the active organization's logo or initials, its name and the
 * member's role there. Members of several organizations get a chevron and a
 * menu to switch (which reloads the app); single-farm members see the name
 * only. On the collapsed rail only the 32px avatar is shown.
 *
 * Markup is kept in small pieces with `farm-switcher__*` classNames so the
 * Paper restyle can target them.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { useT } from '../lib/i18n/context'
import { useActiveOrganization } from '../lib/useActiveOrganization'
import { OrgAvatar } from './OrgAvatar'

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
      className={`farm-switcher__option flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-text hover:bg-surface-2 focus:bg-surface-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${checked ? 'bg-surface-2' : ''}`}
    >
      <OrgAvatar name={org.name} logoUrl={org.logoUrl} size={28} highlight={checked} />
      <span className="flex min-w-0 grow basis-0 flex-col">
        <span className="farm-switcher__option-name truncate text-[14px] font-medium leading-[18px]">{org.name}</span>
        <span className={`farm-switcher__option-role truncate text-[12px] leading-4 ${statusLabel ? 'text-warn' : 'text-muted'}`}>
          {switching ? t('farmSwitcher.switching') : statusLabel || org.roleName || org.roleKey}
        </span>
      </span>
      <span className="flex w-4 shrink-0 justify-center">
        {checked && <Check size={16} strokeWidth={2.5} className="text-cyan" aria-hidden />}
      </span>
    </button>
  )
}

export default function FarmSwitcher({ collapsed = false }) {
  const t = useT()
  const { orgs, active, isMulti, switching, switchTo } = useActiveOrganization()
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
        : { top: r.bottom + 8, left: r.left - 4, width: Math.max(r.width + 8, 280) },
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
        className={`farm-switcher farm-switcher--loading rounded-[8px] bg-surface-2 ${collapsed ? 'mx-auto size-8' : 'h-11'}`}
        aria-hidden
      />
    )
  }
  if (!active) return null

  const roleLine = active.roleName || active.roleKey
  const label = t('farmSwitcher.current', { name: active.name, role: roleLine })

  const body = (
    <>
      <OrgAvatar name={active.name} logoUrl={active.logoUrl} size={collapsed ? 32 : 28} highlight />
      {!collapsed && (
        <span className="farm-switcher__text flex min-w-0 grow basis-0 flex-col text-left">
          <span className="farm-switcher__name truncate text-[14px] font-medium leading-[18px] text-text">
            {active.name}
          </span>
          <span className="farm-switcher__role truncate text-[12px] leading-4 text-muted">{roleLine}</span>
        </span>
      )}
      {!collapsed && isMulti && (
        <ChevronsUpDown size={14} strokeWidth={2} className="farm-switcher__chevron shrink-0 text-muted" aria-hidden />
      )}
    </>
  )

  const frame = `farm-switcher flex items-center gap-2.5 rounded-[10px] ${collapsed ? 'justify-center' : 'px-1.5 py-1.5'}`

  if (!isMulti) {
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
          open ? 'bg-surface-2 ring-1 ring-line-strong' : ''
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
          className="farm-switcher__menu z-50 flex max-h-[70vh] flex-col gap-0.5 overflow-y-auto rounded-[14px] border border-line-strong bg-surface p-1.5 shadow-[0_24px_48px_rgba(0,0,0,0.45),0_2px_6px_rgba(0,0,0,0.3)]"
        >
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
          <div className="my-1 border-t border-line" role="none" />
          <Link
            href="/register-company"
            role="menuitem"
            onClick={() => close(false)}
            className="farm-switcher__register flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] font-medium leading-4 text-cyan hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
          >
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] border border-dashed border-line-strong" aria-hidden>
              <Plus size={14} strokeWidth={2} />
            </span>
            {t('farmSwitcher.registerAnother')}
          </Link>
        </div>
      )}
    </div>
  )
}
