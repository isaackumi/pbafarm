import Link from 'next/link'
import { useRef } from 'react'
import { useT } from '../../../lib/i18n/context'
import { useInView, useScrollProgress } from '../../../lib/marketing/motion'
import { Brand, MK_FOCUS } from '../ui'

/**
 * Footer (Paper landing v4 "Footer", PTZ-2), shared by the landing, legal
 * pages and anything else on the marketing site. The giant "anowa" wordmark
 * rises out of the bottom edge as the footer scrolls into view.
 */

const COLUMNS = [
  {
    key: 'product',
    links: [
      ['dailyEntry', '/#product'],
      ['growth', '/#product'],
      ['anowa', '/#ask'],
      ['automations', '/#product'],
      ['traceability', '/#product'],
    ],
  },
  {
    key: 'solutions',
    links: [
      ['cages', '/#product'],
      ['ponds', '/#product'],
      ['hatcheries', '/#product'],
      ['coops', '/#pricing'],
    ],
  },
  {
    key: 'company',
    links: [
      ['about', '/#about'],
      ['customers', '/#customers'],
      ['careers', 'mailto:hello@getanowa.com'],
      ['contact', 'mailto:hello@getanowa.com'],
    ],
  },
  {
    key: 'resources',
    links: [
      ['help', '/#faq'],
      ['api', '/api-docs'],
      ['status', null],
      ['security', '/security'],
    ],
  },
]

const LEGAL = [
  ['privacy', '/privacy'],
  ['terms', '/terms'],
  ['cookies', '/cookies'],
]

const LINK = `rounded-sm text-[14px] leading-[18px] text-[#6B7280] transition-colors hover:text-ink ${MK_FOCUS}`

export default function Footer() {
  const t = useT()
  const ref = useRef(null)
  const markRef = useRef(null)
  useScrollProgress(ref)
  const shown = useInView(markRef, { threshold: 0.05 })
  return (
    <footer ref={ref} className="relative mx-auto w-full max-w-[1416px] overflow-hidden">
      <div className="relative z-10 flex flex-col gap-12 px-5 pb-10 pt-16 sm:px-10 lg:flex-row lg:justify-between">
        <div className="flex w-full max-w-[320px] flex-col gap-3.5">
          <Brand tone="ink" />
          <p className="text-[14px] leading-[155%] text-[#6B7280]">{t('marketing.footer.tagline')}</p>
          <p className="flex flex-wrap items-center gap-x-1.5 pt-5 text-xs leading-4 text-[#9CA3AF]">
            <span>© 2026 Anowa</span>
            {LEGAL.map(([key, href]) => (
              <span key={key} className="flex items-center gap-1.5">
                <span aria-hidden>·</span>
                <Link href={href} className={`rounded-sm hover:text-ink ${MK_FOCUS}`}>
                  {t(`marketing.footer.legal.${key}`)}
                </Link>
              </span>
            ))}
          </p>
        </div>
        <nav aria-label={t('marketing.footer.navLabel')} className="grid grid-cols-2 gap-x-10 gap-y-10 sm:grid-cols-4 lg:flex lg:gap-[72px]">
          {COLUMNS.map((col) => (
            <div key={col.key} className="flex flex-col gap-3">
              <p className="font-mono-dm text-[11px] uppercase leading-[14px] tracking-[0.08em] text-ink">
                {t(`marketing.footer.columns.${col.key}.title`)}
              </p>
              <ul className="flex flex-col gap-3">
                {col.links.map(([key, href]) => (
                  <li key={key}>
                    {href ? (
                      <Link href={href} className={LINK}>
                        {t(`marketing.footer.columns.${col.key}.${key}`)}
                      </Link>
                    ) : (
                      <span className="text-[14px] leading-[18px] text-[#6B7280]">{t(`marketing.footer.columns.${col.key}.${key}`)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div
        ref={markRef}
        aria-hidden
        className="pointer-events-none relative -mt-6 flex select-none justify-center overflow-hidden lg:-mt-16"
      >
        <span
          className="block whitespace-nowrap font-geist text-[34vw] font-medium leading-[90%] tracking-[-0.04em] text-[#EEF2F6] transition-[transform,opacity] duration-[1200ms] ease-[cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none lg:text-[300px]"
          style={{
            transform: shown
              ? 'translate3d(0, calc((1 - var(--mk-p, 1)) * 60px), 0)'
              : 'translate3d(0, 45%, 0)',
            opacity: shown ? 1 : 0,
          }}
        >
          anowa
        </span>
      </div>
    </footer>
  )
}
