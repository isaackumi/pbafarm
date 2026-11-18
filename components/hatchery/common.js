/** Shared bits of the hatchery workspace (Phase 5). */
import Link from 'next/link'
import { useRouter } from 'next/router'

export const fmt = (v, dp = 0) =>
  v == null || v === '' ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: dp })

export const today = () => new Date().toISOString().slice(0, 10)

/** Number from an input, or undefined when blank (blank is not 0). */
export const num = (v) => (v === '' || v == null ? undefined : Number(v))

export const STATUS_LABEL = {
  conditioning: 'Conditioning',
  ready: 'Ready',
  spent: 'Spent',
  resting: 'Resting',
  retired: 'Retired',
  dead: 'Dead',
}

export const SEX_LABEL = { female: 'Female', male: 'Male', mixed: 'Mixed', unknown: 'Unknown' }

export const ORIGIN_LABEL = {
  wild: 'Wild',
  farm: 'Own farm',
  purchased: 'Purchased',
  hatchery: 'Own hatchery',
  other: 'Other',
}

export const METHOD_LABEL = { natural: 'Natural', induced: 'Induced (hormone)', stripped: 'Stripped' }

export const LIVE_FEED_LABEL = {
  artemia: 'Artemia',
  rotifer: 'Rotifers',
  microalgae: 'Microalgae',
  copepod: 'Copepods',
  other: 'Other',
}

export const LIVE_FEED_UNIT = { million: 'million', L: 'L', g: 'g' }

const TABS = [
  { href: '/hatchery', label: 'Overview' },
  { href: '/hatchery/broodstock', label: 'Broodstock' },
  { href: '/hatchery/spawning', label: 'New spawning' },
  { href: '/hatchery/larval', label: 'Larvae & fingerlings' },
  { href: '/hatchery/live-feed', label: 'Live feed' },
]

/** Section links; scrolls sideways on phones. */
export function HatcheryNav() {
  const { pathname } = useRouter()
  return (
    <nav aria-label="Hatchery" className="-mx-4 px-4 sm:mx-0 sm:px-0 mb-6 overflow-x-auto">
      <ul className="flex gap-1 min-w-max border-b border-foam-deep">
        {TABS.map((t) => {
          const active = t.href === '/hatchery' ? pathname === t.href : pathname.startsWith(t.href)
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex items-center px-3 min-h-11 text-sm border-b-2 -mb-px transition-colors ${
                  active ? 'border-lake text-chart-ink font-medium' : 'border-transparent text-muted hover:text-chart-ink'
                }`}
              >
                {t.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** Small status pill. */
export function Pill({ children, tone = 'default' }) {
  const cls =
    tone === 'good'
      ? 'bg-kelp/10 text-kelp'
      : tone === 'warn'
        ? 'bg-signal/10 text-signal'
        : tone === 'accent'
          ? 'bg-lake/10 text-lake'
          : 'bg-foam text-muted'
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>
}

export const statusTone = (s) =>
  s === 'ready' || s === 'hatched' ? 'good' : s === 'dead' || s === 'failed' ? 'warn' : s === 'conditioning' || s === 'incubating' ? 'accent' : 'default'
