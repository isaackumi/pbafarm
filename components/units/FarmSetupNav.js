import Link from 'next/link'
import { useRouter } from 'next/router'
import { usePermissions } from '../../hooks/usePermission'
import { routePermission } from '../../lib/routePermissions'
import { useT } from '../../lib/i18n/context'

const ITEMS = [
  { key: 'units', href: '/cages/settings' },
  { key: 'groups', href: '/units/groups' },
  { key: 'species', href: '/species' },
  { key: 'qr', href: '/cages/qr-codes' },
]

/** P-SETTINGS left sub-nav for farm setup pages (same look as SettingsNav). */
export default function FarmSetupNav({ className = '' }) {
  const t = useT()
  const router = useRouter()
  const { can } = usePermissions()
  const items = ITEMS.filter((item) => can(routePermission(item.href)))
  return (
    <nav aria-label={t('farmSetup.label')} className={`flex w-full shrink-0 flex-col gap-[2px] md:w-[200px] ${className}`}>
      {items.map((item) => {
        const on = router.pathname === item.href
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={on ? 'page' : undefined}
            className={`rounded-pill px-3.5 py-[9px] text-[14px] leading-[18px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
              on ? 'bg-surface-2 font-medium text-text' : 'text-muted hover:text-text'
            }`}
          >
            {t(`farmSetup.${item.key}`)}
          </Link>
        )
      })}
    </nav>
  )
}
