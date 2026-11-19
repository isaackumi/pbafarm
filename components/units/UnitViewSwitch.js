import Link from 'next/link'
import { useRouter } from 'next/router'
import { useT } from '../../lib/i18n/context'

const VIEWS = [
  { href: '/units', key: 'board' },
  { href: '/cages', key: 'table' },
  { href: '/units/map', key: 'map' },
  { href: '/units/groups', key: 'groups' },
]

/**
 * Board / Table / Site map / Groups switcher (Paper 02 Cages, 49 Farm map):
 * a pill track with the current view filled in the button colour.
 */
export default function UnitViewSwitch({ className = '' }) {
  const t = useT()
  const { pathname } = useRouter() || {}
  return (
    <nav aria-label={t('unitsUi.views')} className={`inline-flex gap-[2px] rounded-pill border border-line bg-surface p-[3px] ${className}`}>
      {VIEWS.map((v) => {
        const active = pathname === v.href
        return (
          <Link
            key={v.href}
            href={v.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-pill px-4 py-[7px] text-[13px] leading-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
              active ? 'bg-button font-medium text-button-text' : 'text-muted hover:text-text'
            }`}
          >
            {t(`unitsUi.view.${v.key}`)}
          </Link>
        )
      })}
    </nav>
  )
}

/** Outlined filter pill around a native select (Paper 02 "All rows ▾"). */
export function FilterSelect({ label, value, onChange, children, className = '' }) {
  return (
    <label className={`relative inline-flex items-center rounded-pill border border-line-strong focus-within:ring-2 focus-within:ring-cyan ${className}`}>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer appearance-none bg-transparent py-2 pl-[14px] pr-8 text-[13px] leading-4 text-text focus:outline-none"
      >
        {children}
      </select>
      <span aria-hidden className="pointer-events-none absolute right-[14px] text-[10px] text-muted">▾</span>
    </label>
  )
}
