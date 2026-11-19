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
      className="print:hidden lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
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
                className="group flex h-16 items-center justify-center px-1 focus:outline-none"
              >
                <span
                  className={`flex min-w-[56px] max-w-full flex-col items-center justify-center gap-[2px] rounded-pill px-3 py-1.5 text-[11px] leading-[14px] transition-colors group-focus-visible:ring-2 group-focus-visible:ring-cyan ${
                    active ? 'bg-button font-medium text-button-text' : 'text-muted'
                  }`}
                >
                  <Icon size={20} aria-hidden />
                  <span className="max-w-full truncate">{label}</span>
                </span>
              </Link>
            </li>
          )
        })}
        <li>
          <button
            type="button"
            onClick={onOpenMenu}
            className="group flex h-16 w-full items-center justify-center px-1 focus:outline-none"
          >
            <span className="flex min-w-[56px] flex-col items-center justify-center gap-[2px] rounded-pill px-3 py-1.5 text-[11px] leading-[14px] text-muted group-focus-visible:ring-2 group-focus-visible:ring-cyan">
              <Menu size={20} aria-hidden />
              {t('nav.more')}
            </span>
          </button>
        </li>
      </ul>
    </nav>
  )
}
