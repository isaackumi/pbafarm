import Link from 'next/link'
import { useT } from '../../../lib/i18n/context'
import { Reveal } from '../../../lib/marketing/motion'
import { Eyebrow, Heading, MK_FOCUS, PillButton, Section } from '../ui'

/**
 * Pricing (Paper landing v4 "Pricing", PX8-2): three plans on mist/ink cards.
 * Cards rise in one after another; the featured Farm card carries a slow lime
 * sheen. Starter and Farm start a trial; Enterprise writes to sales.
 */

const PLANS = [
  { key: 'starter', features: ['f1', 'f2', 'f3'], featured: false, href: '/signup' },
  { key: 'farm', features: ['f1', 'f2', 'f3', 'f4'], featured: true, href: '/signup' },
  { key: 'enterprise', features: ['f1', 'f2', 'f3'], featured: false, href: 'mailto:hello@getanowa.com' },
]

function Check({ featured }) {
  return (
    <span
      className={`flex size-[18px] shrink-0 items-center justify-center rounded-pill ${featured ? 'bg-lime' : 'bg-white'}`}
      aria-hidden
    >
      <svg width="10" height="10" viewBox="0 0 24 24">
        <path d="M5 12l5 5L20 7" fill="none" stroke="#0B0D10" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

function Plan({ plan, t, index }) {
  const { key, features, featured, href } = plan
  const base = `marketing.pricing.plans.${key}`
  const price = t(`${base}.price`)
  const per = t(`${base}.per`)
  return (
    <Reveal
      delay={index * 120}
      className={`mk-lift relative flex grow basis-0 flex-col gap-[22px] overflow-hidden rounded-[24px] p-[30px] ${
        featured ? 'bg-ink shadow-[0_30px_60px_-30px_rgba(11,13,16,0.55)]' : 'bg-mist'
      }`}
    >
      {featured && (
        <span
          aria-hidden
          className="mk-pricing-sheen pointer-events-none absolute -inset-1/2 opacity-60"
          style={{
            background:
              'conic-gradient(from 0deg at 50% 50%, transparent 0deg, rgb(215 247 91 / 0.18) 40deg, transparent 90deg, transparent 360deg)',
          }}
        />
      )}
      <div className="relative flex items-center justify-between">
        <p className={`font-mono-dm text-xs uppercase leading-4 tracking-[0.08em] ${featured ? 'text-white' : 'text-ink'}`}>
          {t(`${base}.name`)}
        </p>
        {featured && (
          <span className="mk-pulse rounded-pill bg-lime px-2.5 py-1 font-sans text-[11px] font-semibold leading-[14px] text-ink">
            {t('marketing.pricing.popular')}
          </span>
        )}
      </div>
      <div className="relative flex flex-wrap items-baseline gap-1.5">
        <p className={`font-tight text-[44px] leading-[56px] tracking-[-0.045em] sm:text-[52px] sm:leading-[64px] ${featured ? 'text-white' : 'text-ink'}`}>
          {price}
        </p>
        {per && <p className="text-[14px] leading-[18px] text-[#9CA3AF]">{per}</p>}
      </div>
      <p className={`relative text-[14px] leading-[18px] ${featured ? 'text-[#9CA3AF]' : 'text-[#6B7280]'}`}>{t(`${base}.blurb`)}</p>
      <ul className="relative flex flex-col gap-3 pb-2.5 pt-1.5">
        {features.map((f) => (
          <li key={f} className="flex items-center gap-2.5">
            <Check featured={featured} />
            <span className={`text-[14px] leading-[18px] ${featured ? 'text-white' : 'text-ink'}`}>{t(`${base}.${f}`)}</span>
          </li>
        ))}
      </ul>
      <div className="relative mt-auto flex">
        {featured ? (
          <PillButton href={href}>{t(`${base}.cta`)}</PillButton>
        ) : (
          <Link
            href={href}
            className={`mk-press rounded-pill border border-[#D1D5DB] px-[22px] py-3 font-mono-dm text-xs uppercase leading-4 tracking-[0.08em] text-ink transition-colors hover:bg-white ${MK_FOCUS}`}
          >
            {t(`${base}.cta`)}
          </Link>
        )}
      </div>
    </Reveal>
  )
}

export default function Pricing() {
  const t = useT()
  return (
    <Section id="pricing" inner="flex flex-col items-center gap-11 py-20 lg:py-[110px]">
      <style jsx global>{`
        @keyframes mk-pricing-spin {
          to {
            transform: rotate(360deg);
          }
        }
        .mk-pricing-sheen {
          animation: mk-pricing-spin 14s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .mk-pricing-sheen {
            animation: none;
          }
        }
      `}</style>
      <Reveal className="flex max-w-[700px] flex-col items-center gap-4 text-center">
        <Eyebrow>{t('marketing.pricing.eyebrow')}</Eyebrow>
        <Heading lead={t('marketing.pricing.title')} accent={t('marketing.pricing.titleAccent')} />
      </Reveal>
      <div className="flex w-full max-w-[1176px] flex-col gap-[18px] lg:flex-row">
        {PLANS.map((plan, i) => (
          <Plan key={plan.key} plan={plan} t={t} index={i} />
        ))}
      </div>
    </Section>
  )
}
