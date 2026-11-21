import Link from 'next/link'
import { useRouter } from 'next/router'
import { usePermissions } from '../hooks/usePermission'
import { routePermission } from '../lib/routePermissions'
import { useT } from '../lib/i18n/context'

/**
 * Settings sub-navigation (Paper 22 Roles 57B-0 / 31 Account ACU-0).
 * Items without a page yet (Access policies) have no href and stay hidden.
 * `contextual` items (Messaging 57, Anowa AI 58) only show while they are
 * the current page, as in the artboards.
 */
export const SETTINGS_NAV = [
  { key: 'company', href: '/company-settings' },
  { key: 'sites', href: '/farm-locations' },
  { key: 'members', href: '/users' },
  { key: 'roles', href: '/users?view=roles' },
  { key: 'policies', href: null },
  { key: 'audit', href: '/audit-logs' },
  { key: 'automations', href: '/automations' },
  { key: 'api-keys', href: '/api-keys' },
  { key: 'messaging', href: '/messaging-settings', contextual: true },
  { key: 'ai', href: '/ai-settings', contextual: true },
  { key: 'billing', href: '/billing' },
]

/** Which item a path belongs to when the page doesn't say. */
const PATH_KEY = {
  '/company-settings': 'company',
  '/farm-locations': 'sites',
  '/organization-structure': 'sites',
  '/users': 'members',
  '/teams': 'members',
  '/workforce': 'members',
  '/audit-logs': 'audit',
  '/automations': 'automations',
  '/api-keys': 'api-keys',
  '/webhooks': 'api-keys',
  '/inbound-webhooks': 'api-keys',
  '/api-docs': 'api-keys',
  '/messaging-settings': 'messaging',
  '/outbox': 'messaging',
  '/bot-templates': 'messaging',
  '/ai-settings': 'ai',
  '/billing': 'billing',
}

/**
 * `active` is an item key; by default it follows the page path. Pass
 * `active={null}` for pages outside the list (31 Account).
 */
export default function SettingsNav({ active, className = '' }) {
  const router = useRouter()
  const t = useT()
  const { can } = usePermissions()
  const current = active !== undefined ? active : PATH_KEY[router.pathname]
  const items = SETTINGS_NAV.filter(
    (item) =>
      item.href && can(routePermission(item.href)) && (!item.contextual || item.key === current),
  )

  return (
    <nav aria-label={t('settingsUi.nav.label')} className={`flex w-full shrink-0 flex-col gap-[2px] md:w-[200px] ${className}`}>
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
            {t(`settingsUi.nav.${item.key}`)}
          </Link>
        )
      })}
    </nav>
  )
}
