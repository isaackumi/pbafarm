import Link from 'next/link'
import { useRouter } from 'next/router'
import { usePermissions } from '../hooks/usePermission'
import { useTerm } from '../hooks/useTerm'
import { useT } from '../lib/i18n/context'
import { navKey } from '../lib/i18n'
import { activeTabPath, resolveShortcuts } from '../lib/navigation'
import { useSettings } from '../contexts/SettingsContext'

// Paper 54/55 tab icons (20px, 2px strokes), drawn as in the artboards.
const PAPER_ICONS = {
  '/dashboard': <path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z" strokeLinejoin="round" />,
  '/tasks': <path d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1" strokeLinecap="round" />,
  '/scan': (
    <path
      d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M4 12h16"
      strokeLinecap="round"
    />
  ),
  '/cages': (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
    </>
  ),
  more: <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />,
}

function TabIcon({ path, icon: Icon, className }) {
  const drawn = PAPER_ICONS[path]
  if (!drawn && Icon) return <Icon size={20} strokeWidth={2} className={`shrink-0 ${className}`} aria-hidden />
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="2" className={`shrink-0 ${className}`} aria-hidden>
      {drawn}
    </svg>
  )
}

/**
 * Phone-only bottom bar (Paper 54/55 MobileTabBar): Home, Tasks, Scan,
 * Cages and More by default, or the member's own shortcuts (Global
 * settings, UX-004). Paper sizes: 70px slots spread across, the current
 * place a 76px pill (light pill on dark, ink pill on light); inactive icons
 * are #8B9097 in both themes, labels follow muted.
 */
export default function MobileTabBar({ onOpenMenu }) {
  const router = useRouter()
  // Only the places this member may use (PERM-003); the menu button stays.
  const { can } = usePermissions()
  const { settings } = useSettings()
  const t = useT()
  const term = useTerm()
  const tabs = resolveShortcuts(settings?.mobileShortcuts, can)

  const activePath = activeTabPath(tabs, router.pathname)

  // Paper fits five 70px slots; a longer custom bar shares the width.
  const fixed = tabs.length <= 4
  const slot = `flex h-12 flex-col items-center justify-center gap-1 rounded-pill text-[11px] leading-[14px] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
    fixed ? 'shrink-0' : 'min-w-0 flex-1 px-1'
  }`
  const idle = `${slot} ${fixed ? 'w-[70px]' : ''} text-muted`
  const idleIcon = 'stroke-[#8B9097]'

  return (
    <nav
      aria-label={t('nav.quickNavigation')}
      className="print:hidden lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-line bg-surface px-3 pt-[10px] pb-[max(28px,env(safe-area-inset-bottom))]"
    >
      <ul className={`flex items-center ${fixed ? 'justify-between' : 'gap-1'}`}>
        {tabs.map(({ path, title, shortLabelKey, icon }) => {
          const active = path === activePath
          const label = term.text(t.or(shortLabelKey || navKey(path), title))
          return (
            <li key={path} className={fixed ? '' : 'min-w-0 flex-1'}>
              <Link
                href={path}
                aria-current={active ? 'page' : undefined}
                className={
                  active
                    ? `${slot} ${fixed ? 'w-[76px]' : 'w-full'} bg-button font-semibold text-button-text`
                    : `${idle} ${fixed ? '' : 'w-full'}`
                }
              >
                <TabIcon path={path} icon={icon} className={active ? 'stroke-current' : idleIcon} />
                <span className="max-w-full truncate">{label}</span>
              </Link>
            </li>
          )
        })}
        <li className={fixed ? '' : 'min-w-0 flex-1'}>
          <button type="button" onClick={onOpenMenu} className={`${idle} ${fixed ? '' : 'w-full'}`}>
            <TabIcon path="more" className={idleIcon} />
            {t('nav.more')}
          </button>
        </li>
      </ul>
    </nav>
  )
}
