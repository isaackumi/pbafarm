import Link from 'next/link'
import { useRouter } from 'next/router'
import { House, ClipboardList, LayoutGrid, Package, Menu } from 'lucide-react'
import { usePermissions } from '../hooks/usePermission'

const TABS = [
  { href: '/dashboard', label: 'Home', icon: House, permission: 'reports.view' },
  { href: '/daily-entry', label: 'Daily entry', icon: ClipboardList, permission: 'production.daily.record' },
  { href: '/cages', label: 'Cages', icon: LayoutGrid, permission: 'production.view' },
  { href: '/feed-issue', label: 'Feed', icon: Package, permission: 'inventory.issue' },
]

/** Phone-only bottom bar: the four places field staff go most, plus the full menu. */
export default function MobileTabBar({ onOpenMenu }) {
  const router = useRouter()
  // Only the places this member may use (PERM-003); the menu button stays.
  const { can } = usePermissions()
  const tabs = TABS.filter((t) => can(t.permission))
  const isActive = (href) =>
    router.pathname === href || router.pathname.startsWith(`${href}/`)

  return (
    <nav
      aria-label="Quick navigation"
      className="print:hidden lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-foam-deep bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul
        className="grid"
        style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}
      >
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = isActive(href)
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-16 flex-col items-center justify-center gap-1 text-xs transition-colors focus:outline-none focus-visible:bg-foam ${
                  active ? 'text-chart-ink font-medium' : 'text-muted'
                }`}
              >
                <span
                  className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${
                    active ? 'bg-foam-deep' : ''
                  }`}
                >
                  <Icon size={18} aria-hidden />
                </span>
                {label}
              </Link>
            </li>
          )
        })}
        <li>
          <button
            type="button"
            onClick={onOpenMenu}
            className="flex h-16 w-full flex-col items-center justify-center gap-1 text-xs text-muted focus:outline-none focus-visible:bg-foam"
          >
            <span className="flex h-7 w-12 items-center justify-center">
              <Menu size={18} aria-hidden />
            </span>
            More
          </button>
        </li>
      </ul>
    </nav>
  )
}
