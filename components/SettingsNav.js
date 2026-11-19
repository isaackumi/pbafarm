import Link from 'next/link'
import { useRouter } from 'next/router'
import { usePermissions } from '../hooks/usePermission'
import { routePermission } from '../lib/routePermissions'

/**
 * Settings sub-navigation (Paper 22 Roles 57B-0 / 31 Account ACU-0).
 * Items without a page yet (Access policies, Billing) are listed with no
 * href and hidden until their routes exist.
 */
export const SETTINGS_NAV = [
  { key: 'company', label: 'Company', href: '/company-settings' },
  { key: 'sites', label: 'Farm sites', href: '/farm-locations' },
  { key: 'members', label: 'Members', href: '/users' },
  { key: 'roles', label: 'Roles & permissions', href: '/users#roles' },
  { key: 'policies', label: 'Access policies', href: null },
  { key: 'audit', label: 'Audit log', href: '/audit-logs' },
  { key: 'automations', label: 'Automations', href: '/automations' },
  { key: 'api-keys', label: 'API keys', href: '/api-keys' },
  { key: 'billing', label: 'Billing', href: null },
]

/**
 * `active` is an item key; by default the item whose path matches the page
 * is active. Pass `active={null}` for pages outside the list (31 Account).
 */
export default function SettingsNav({ active, className = '' }) {
  const router = useRouter()
  const { can } = usePermissions()
  const items = SETTINGS_NAV.filter((item) => item.href && can(routePermission(item.href.split('#')[0])))
  const current =
    active !== undefined
      ? active
      : items.find((item) => !item.href.includes('#') && router.pathname === item.href)?.key

  return (
    <nav aria-label="Settings" className={`flex w-full shrink-0 flex-col gap-[2px] md:w-[200px] ${className}`}>
      {items.map((item) => {
        const on = item.key === current
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={on ? 'page' : undefined}
            className={`rounded-pill px-3.5 py-[9px] text-[14px] leading-[18px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
              on ? 'bg-surface-2 font-medium text-text' : 'text-muted hover:text-text'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
