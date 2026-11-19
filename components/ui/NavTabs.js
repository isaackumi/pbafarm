import Link from 'next/link'
import { useRouter } from 'next/router'
import { usePermissions } from '../../hooks/usePermission'
import { routePermission } from '../../lib/routePermissions'

/**
 * Route tabs under a page title (Paper 09 Feed, 10 Finance, 11 Reports,
 * 19 Cost accounting, 51 Inventory): 14px labels 28px apart on a hairline,
 * the active one underlined in the button colour. Each tab is a link; tabs
 * the member can't open (lib/routePermissions) are hidden.
 *
 * tabs: [{ href, label, permission? }]. `active` overrides the href match.
 */
export function NavTabs({ tabs = [], label, active, className = '' }) {
  const router = useRouter()
  const { can } = usePermissions()
  const shown = tabs.filter((tab) => can(tab.permission ?? routePermission(tab.href)))
  if (shown.length < 2) return null
  const path = router?.pathname
  const current = active ?? shown.find((tab) => tab.href === path)?.href
  return (
    <nav aria-label={label} className={`overflow-x-auto border-b border-line ${className}`}>
      <ul className="flex min-w-max gap-[28px]">
        {shown.map((tab) => {
          const on = tab.href === current
          return (
            <li key={tab.href} className="flex">
              <Link
                href={tab.href}
                aria-current={on ? 'page' : undefined}
                className={`-mb-px whitespace-nowrap rounded-sm border-b-2 pb-3 text-[14px] leading-[18px] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
                  on ? 'border-button font-medium text-text' : 'border-transparent text-muted hover:text-text'
                }`}
              >
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export default NavTabs
