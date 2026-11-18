import Link from 'next/link'

/** Workspace tabs for one unit: overview, water, maintenance. */
export default function UnitTabs({ unitId, active, unitType = 'cage' }) {
  const tabs = [
    { id: 'overview', label: 'Overview', href: `/cages/${unitId}` },
    { id: 'water', label: unitType === 'pond' ? 'Water and treatments' : 'Water quality', href: `/units/${unitId}/water` },
    { id: 'maintenance', label: unitType === 'cage' ? 'Nets and equipment' : 'Equipment', href: `/units/${unitId}/maintenance` },
  ]
  return (
    <nav aria-label="Unit sections" className="flex gap-1 overflow-x-auto border-b border-foam-deep">
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          aria-current={active === t.id ? 'page' : undefined}
          className={`whitespace-nowrap px-3 min-h-11 inline-flex items-center text-sm font-medium border-b-2 -mb-px ${
            active === t.id
              ? 'border-chart-ink text-chart-ink'
              : 'border-transparent text-muted hover:text-chart-ink'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
