import Link from 'next/link'
import { useT } from '../lib/i18n/context'

/**
 * Workspace tabs for one unit (Paper 03 underline tabs: 14/18 labels 28px
 * apart, 12px under the label). Phones keep a 44px target.
 */
export default function UnitTabs({ unitId, active, unitType = 'cage' }) {
  const t = useT()
  const tabs = [
    { id: 'overview', label: t('unitTabs.overview'), href: `/cages/${unitId}` },
    {
      id: 'water',
      label: unitType === 'pond' ? t('unitTabs.waterPond') : t('unitTabs.water'),
      href: `/units/${unitId}/water`,
    },
    {
      id: 'maintenance',
      label: unitType === 'cage' ? t('unitTabs.netsEquipment') : t('unitTabs.equipment'),
      href: `/units/${unitId}/maintenance`,
    },
  ]
  return (
    <nav aria-label={t('unitTabs.label')} className="flex gap-7 overflow-x-auto border-b border-line">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={active === tab.id ? 'page' : undefined}
          className={`-mb-px inline-flex min-h-11 items-center whitespace-nowrap border-b-2 pb-3 pt-2 text-[14px] sm:min-h-0 sm:pt-0 leading-[18px] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
            active === tab.id
              ? 'border-button font-medium text-text'
              : 'border-transparent text-muted hover:text-text'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
