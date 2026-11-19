/** Shared bits of the hatchery workspace (Phase 5). */
import Link from 'next/link'
import { useRouter } from 'next/router'
import { Pill as UiPill } from '../ui'
import { useT } from '../../lib/i18n/context'

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
  { href: '/hatchery', key: 'board' },
  { href: '/hatchery/broodstock', key: 'broodstock' },
  { href: '/hatchery/spawning', key: 'spawning' },
  { href: '/hatchery/larval', key: 'larval' },
  { href: '/hatchery/live-feed', key: 'liveFeed' },
]

const FALLBACK = {
  status: STATUS_LABEL,
  sex: SEX_LABEL,
  origin: ORIGIN_LABEL,
  method: METHOD_LABEL,
  liveFeed: LIVE_FEED_LABEL,
  unit: LIVE_FEED_UNIT,
  stage: { larvae: 'Larvae', fingerlings: 'Fingerlings' },
}

/** Translated label for a hatchery enum value (status, sex, origin, method, liveFeed, unit, stage). */
export const label = (t, group, value) => t.or(`hatcheryPage.${group}.${value}`, FALLBACK[group]?.[value] || value || '—')

/** Paper 13 section tabs (underline links); scrolls sideways on phones. */
export function HatcheryNav() {
  const t = useT()
  const { pathname } = useRouter()
  return (
    <nav aria-label={t('hatcheryPage.nav')} className="overflow-x-auto border-b border-line">
      <ul className="flex min-w-max gap-[28px]">
        {TABS.map((tab) => {
          const active = tab.href === '/hatchery' ? pathname === tab.href : pathname.startsWith(tab.href)
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`-mb-px inline-flex border-b-2 pb-3 text-[14px] leading-[18px] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
                  active ? 'border-text font-medium text-text' : 'border-transparent text-muted hover:text-text'
                }`}
              >
                {t(`hatcheryPage.tab.${tab.key}`)}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

const PILL_TONE = { good: 'green', warn: 'red', accent: 'cyan', default: 'neutral' }

/** Status pill on the shared Paper Pill. */
export function Pill({ children, tone = 'default' }) {
  return <UiPill tone={PILL_TONE[tone] || 'neutral'}>{children}</UiPill>
}

export const statusTone = (s) =>
  s === 'ready' || s === 'hatched' ? 'good' : s === 'dead' || s === 'failed' ? 'warn' : s === 'conditioning' || s === 'incubating' ? 'accent' : 'default'

/** Paper card shell and title used across the hatchery pages. */
export const CARD = 'rounded-card border border-line bg-surface shadow-[var(--shadow-card)]'

export function PaperCard({ title, meta, action, children, className = '', padded = true }) {
  return (
    <section className={`${CARD} ${padded ? 'px-[22px] py-6 sm:px-[26px]' : ''} ${className}`}>
      {(title || meta != null || action) && (
        <div className={`flex flex-wrap items-center justify-between gap-3 pb-3 ${padded ? '' : 'px-[22px] pt-6 sm:px-[26px]'}`}>
          {title && <h2 className="text-[15px] font-semibold leading-[18px] text-text">{title}</h2>}
          <div className="flex items-center gap-3">
            {meta != null && <span className="text-[13px] leading-4 text-muted">{meta}</span>}
            {action}
          </div>
        </div>
      )}
      {children}
    </section>
  )
}
