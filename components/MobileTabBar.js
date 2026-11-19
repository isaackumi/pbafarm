import Link from 'next/link'
import { useRouter } from 'next/router'
import { Menu } from 'lucide-react'
import { usePermissions } from '../hooks/usePermission'
import { useTerm } from '../hooks/useTerm'
import { useT } from '../lib/i18n/context'
import { navKey } from '../lib/i18n'
import { resolveShortcuts } from '../lib/navigation'
import { useSettings } from '../contexts/SettingsContext'

/**
 * Phone-only bottom bar: the member's shortcuts (chosen in Global settings,
 * UX-004; field-staff defaults otherwise), plus the full menu.
 */
export default function MobileTabBar({ onOpenMenu }) {
  const router = useRouter()
  // Only the places this member may use (PERM-003); the menu button stays.
  const { can } = usePermissions()
  const { settings } = useSettings()
  const t = useT()
  const term = useTerm()
  const tabs = resolveShortcuts(settings?.mobileShortcuts, can)
  const isActive = (href) =>
    router.pathname === href || router.pathname.startsWith(`${href}/`)

  return (
    <nav
      aria-label={t('nav.quickNavigation')}
      className="print:hidden lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-foam-deep bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul
        className="grid"
        style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}
      >
        {tabs.map(({ path, title, shortLabelKey, icon: Icon }) => {
          const active = isActive(path)
          const label = term.text(t.or(shortLabelKey || navKey(path), title))
          return (
            <li key={path}>
              <Link
                href={path}
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
                <span className="max-w-full truncate px-1">{label}</span>
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
            {t('nav.more')}
          </button>
        </li>
      </ul>
    </nav>
  )
}
