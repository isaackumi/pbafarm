import { useCallback, useEffect, useRef, useState } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useT } from '../../../lib/i18n/context'
import { CountUp, Reveal, prefersReducedMotion, useInView, useScrollProgress } from '../../../lib/marketing/motion'
import { Brand, MK_FOCUS, MarketingPage } from '../ui'
import Footer from '../sections/Footer'
import privacy from './content/privacy'
import terms from './content/terms'
import cookies from './content/cookies'
import security from './content/security'

/**
 * The legal pages (Paper "Legal · Privacy / Terms / Cookies / Security
 * (1440)", page "Anowa · Marketing site"): one template, four content
 * modules (./content/*) that hold only structure; every word comes from
 * locales under marketing.legal.<page> and marketing.legal.common.
 */
const PAGES = { privacy, terms, cookies, security }
const TABS = ['privacy', 'terms', 'cookies', 'security']
const C = `marketing.legal.common` // key prefix, not a key

const P = 'font-sans text-base leading-[165%] text-[#374151]'

export default function LegalPage({ page }) {
  const t = useT()
  const content = PAGES[page] || privacy
  const key = PAGES[page] ? page : 'privacy'
  const base = `marketing.legal.${key}`
  const toc = [
    ...content.sections.map((s) => ({ id: s.id, label: t(`${base}.sections.${s.id}.toc`) })),
    { id: 'contact', label: t(`${C}.contactToc`) },
  ]
  return (
    <MarketingPage>
      <Head>
        <title>{`${t(`${base}.metaTitle`)} · Anowa`}</title>
        <meta name="description" content={t(`${base}.subtitle`)} />
        <meta property="og:title" content={`${t(`${base}.metaTitle`)} · Anowa`} />
        <meta property="og:description" content={t(`${base}.subtitle`)} />
      </Head>
      <style jsx global>{`
        @keyframes mk-legal-pop {
          0% { transform: scale(0.6); }
          60% { transform: scale(1.12); }
          100% { transform: scale(1); }
        }
        .is-in .mk-legal-pop { animation: mk-legal-pop 0.7s cubic-bezier(0.2, 0.7, 0.2, 1) both; animation-delay: var(--mk-pop-delay, 0s); }
        .mk-legal-line { transform: scaleY(0); transform-origin: top; transition: transform 1.4s cubic-bezier(0.6, 0, 0.2, 1) 0.15s; }
        .is-in .mk-legal-line { transform: scaleY(1); }
        .mk-legal-dot { transform: scale(0); transition: transform 0.5s cubic-bezier(0.2, 0.7, 0.2, 1.4); transition-delay: var(--mk-dot-delay, 0s); }
        .is-in .mk-legal-dot { transform: scale(1); }
        @media (prefers-reduced-motion: reduce) {
          .is-in .mk-legal-pop { animation: none; }
          .mk-legal-line, .mk-legal-dot { transform: none !important; transition: none !important; }
        }
        @media print {
          .mk-noprint { display: none !important; }
          .mk-print-plain { background: none !important; color: #000 !important; padding: 0 !important; }
          .mk-print-plain * { color: #000 !important; }
          .mk-reveal, .mk-reveal * { opacity: 1 !important; transform: none !important; filter: none !important; }
          .mk-legal-line, .mk-legal-dot { transform: none !important; }
        }
      `}</style>
      <LegalHeader page={key} base={base} />
      <main id="main">
        <ShortVersion base={base} />
        <div className="mx-auto w-full max-w-[1416px]">
          <div className="flex items-start gap-24 px-5 pb-[100px] pt-12 sm:px-10 xl:px-[120px]">
            <Contents items={toc} />
            <article className="flex min-w-0 max-w-[760px] grow basis-0 flex-col gap-14">
              {content.sections.map((s, i) => (
                <ArticleSection
                  key={s.id}
                  id={s.id}
                  number={content.sections.slice(0, i + 1).filter((x) => !x.untitled).length}
                  base={base}
                  section={s}
                />
              ))}
              <ContactCard base={base} email={content.email} />
            </article>
          </div>
        </div>
      </main>
      <div className="mk-noprint">
        <Footer />
      </div>
    </MarketingPage>
  )
}

/* ─── Header (sky, tabs, title) ─────────────────────────────────────── */

const CLOUDS = [
  { left: '6%', top: '58%', w: 260, h: 70, blur: 16, o: 0.55, dur: '34s', drift: '60px' },
  { left: '62%', top: '18%', w: 300, h: 80, blur: 18, o: 0.5, dur: '40s', drift: '-70px' },
  { left: '80%', top: '62%', w: 220, h: 64, blur: 14, o: 0.6, dur: '28s', drift: '50px' },
  { left: '34%', top: '76%', w: 340, h: 70, blur: 20, o: 0.35, dur: '46s', drift: '-40px' },
]

function LegalTabs({ page, t, className = '' }) {
  return (
    <nav aria-label={t(`${C}.nav`)} className={className}>
      <ul className="flex w-max gap-1 rounded-pill border border-white/25 bg-white/15 p-1">
        {TABS.map((tab) => {
          const active = tab === page
          return (
            <li key={tab}>
              <Link
                href={`/${tab}`}
                aria-current={active ? 'page' : undefined}
                className={`block rounded-pill px-4 py-[9px] font-mono-dm text-xs uppercase leading-4 tracking-[0.08em] transition-colors ${MK_FOCUS} ${
                  active ? 'bg-white text-ink' : 'text-white hover:bg-white/15'
                }`}
              >
                {t(`${C}.tabs.${tab}`)}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function LegalHeader({ page, base }) {
  const t = useT()
  const ref = useRef(null)
  useScrollProgress(ref)
  return (
    <header
      ref={ref}
      className="mk-print-plain relative mx-auto flex w-full max-w-[1416px] flex-col gap-12 overflow-clip rounded-[22px] px-5 pb-12 pt-5 sm:rounded-[28px] sm:px-7 sm:pb-16 sm:pt-6 lg:gap-[72px]"
      style={{ backgroundImage: 'linear-gradient(in oklab 180deg, #2F86EA 0%, #8CC6F6 100%)' }}
    >
      <div className="mk-noprint pointer-events-none absolute inset-0" aria-hidden>
        <div className="mk-parallax-slow absolute inset-0">
          {CLOUDS.map((c, i) => (
            <div
              key={i}
              className="mk-drift absolute rounded-pill bg-white"
              style={{
                left: c.left,
                top: c.top,
                width: c.w,
                height: c.h,
                opacity: c.o,
                filter: `blur(${c.blur}px)`,
                '--mk-dur': c.dur,
                '--mk-drift': c.drift,
              }}
            />
          ))}
        </div>
      </div>

      <div className="mk-noprint relative flex items-center justify-between gap-4">
        <Brand />
        <LegalTabs page={page} t={t} className="hidden lg:block" />
        <Link
          href="/signup"
          className={`mk-press rounded-pill bg-lime px-5 py-2.5 font-mono-dm text-xs uppercase leading-4 tracking-[0.08em] text-ink ${MK_FOCUS}`}
        >
          {t(`${C}.startFree`)}
        </Link>
      </div>
      <LegalTabs page={page} t={t} className="mk-noprint relative -mt-6 overflow-x-auto lg:hidden" />

      <Reveal className="mk-stagger relative flex max-w-[1000px] flex-col gap-5 xl:px-[92px]">
        <p className="font-mono-dm text-xs uppercase leading-4 tracking-[0.08em] text-white">
          <span aria-hidden>• </span>
          {t(`${base}.eyebrow`)}
        </p>
        <h1 className="font-tight text-[44px] font-normal leading-[104%] tracking-[-0.045em] text-white sm:text-[60px] lg:text-[72px] lg:leading-[102%]">
          {t(`${base}.title`)}{' '}
          <span className="font-serif text-[1.14em] italic tracking-[-0.01em]">{t(`${base}.accent`)}</span>
        </h1>
        <p className="max-w-[620px] font-sans text-base leading-[155%] text-white/90 sm:text-[17px]">{t(`${base}.subtitle`)}</p>
        <ul className="flex flex-wrap gap-2 pt-1">
          {[t(`${C}.updated`), t(`${base}.readTime`), t(`${C}.languages`)].map((chip) => (
            <li key={chip} className="rounded-pill bg-white/15 px-3 py-1.5 font-sans text-[13px] leading-4 text-white">
              {chip}
            </li>
          ))}
        </ul>
      </Reveal>
    </header>
  )
}

/* ─── "The short version in four lines" ─────────────────────────────── */

const CARD_TONES = [
  { card: 'bg-lime', num: 'text-ink', title: 'text-ink', body: 'text-[#3F4A12]' },
  { card: 'bg-mist', num: 'text-ink', title: 'text-ink', body: 'text-[#6B7280]' },
  { card: 'bg-mist', num: 'text-ink', title: 'text-ink', body: 'text-[#6B7280]' },
  { card: 'bg-ink', num: 'text-lime', title: 'text-white', body: 'text-[#9CA3AF]' },
]

function ShortVersion({ base }) {
  const t = useT()
  return (
    <section aria-labelledby="short-version" className="mx-auto w-full max-w-[1416px]">
      <div className="flex flex-col gap-7 px-5 pb-10 pt-14 sm:px-10 sm:pt-[72px] xl:px-[120px]">
        <Reveal className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h2 id="short-version" className="font-tight text-[30px] font-normal leading-[112%] tracking-[-0.04em] text-ink sm:text-[36px]">
            {t(`${C}.shortVersion`)}{' '}
            <span className="font-serif text-[1.17em] italic tracking-[-0.01em] text-[#6B7280]">{t(`${C}.shortAccent`)}</span>
          </h2>
          <p className="font-sans text-sm leading-5 text-[#6B7280]">{t(`${base}.shortNote`)}</p>
        </Reveal>
        <Reveal as="ol" className="mk-stagger grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {['c1', 'c2', 'c3', 'c4'].map((c, i) => {
            const tone = CARD_TONES[i]
            return (
              <li key={c} className={`mk-lift flex flex-col gap-10 rounded-[24px] p-7 ${tone.card}`}>
                <span className={`font-mono-dm text-xs leading-4 tracking-[0.08em] ${tone.num}`}>{`0${i + 1}`}</span>
                <div className="flex flex-col gap-2.5">
                  <h3 className={`font-tight text-[26px] font-normal leading-[112%] tracking-[-0.035em] ${tone.title}`}>
                    {t(`${base}.cards.${c}.title`)}
                  </h3>
                  <p className={`font-sans text-sm leading-[155%] ${tone.body}`}>{t(`${base}.cards.${c}.body`)}</p>
                </div>
              </li>
            )
          })}
        </Reveal>
      </div>
    </section>
  )
}

/* ─── "On this page" rail with scrollspy ────────────────────────────── */

function Contents({ items }) {
  const t = useT()
  const [active, setActive] = useState(items[0]?.id)
  const ids = items.map((i) => i.id).join('|')

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined
    const els = ids
      .split('|')
      .map((id) => document.getElementById(id))
      .filter(Boolean)
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id)
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: 0 },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [ids])

  const go = useCallback((e, id) => {
    const el = document.getElementById(id)
    if (!el) return
    e.preventDefault()
    el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
    window.history.replaceState(null, '', `#${id}`)
    setActive(id)
  }, [])

  return (
    <aside className="mk-noprint sticky top-6 hidden w-60 shrink-0 flex-col gap-1 pt-1.5 lg:flex" aria-label={t(`${C}.onThisPage`)}>
      <p className="pb-3 font-mono-dm text-[11px] uppercase leading-[14px] tracking-[0.08em] text-[#9CA3AF]">{t(`${C}.onThisPage`)}</p>
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const on = item.id === active
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                onClick={(e) => go(e, item.id)}
                aria-current={on ? 'location' : undefined}
                className={`group flex items-center gap-2.5 rounded-sm py-2 ${MK_FOCUS}`}
              >
                <span
                  className={`h-4 w-0.5 shrink-0 transition-colors duration-300 ${on ? 'bg-ink' : 'bg-[#E5E7EB] group-hover:bg-[#9CA3AF]'}`}
                  aria-hidden
                />
                <span
                  className={`font-sans text-sm leading-[18px] transition-colors duration-300 ${
                    on ? 'font-medium text-ink' : 'text-[#6B7280] group-hover:text-ink'
                  }`}
                >
                  {item.label}
                </span>
              </a>
            </li>
          )
        })}
      </ul>
      <div className="pt-5">
        <button
          type="button"
          onClick={() => window.print()}
          className={`mk-press inline-flex items-center gap-2 rounded-pill border border-[#E5E7EB] px-3.5 py-2.5 font-sans text-[13px] leading-4 text-ink hover:bg-mist ${MK_FOCUS}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
            <path d="M12 4v12M7 11l5 5 5-5M5 20h14" fill="none" stroke="#0B0D10" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t(`${C}.downloadPdf`)}
        </button>
      </div>
    </aside>
  )
}

/* ─── Article sections and blocks ───────────────────────────────────── */

function ArticleSection({ id, number, base, section }) {
  const t = useT()
  return (
    <Reveal as="section" id={id} aria-labelledby={section.untitled ? undefined : `${id}-title`} className="flex scroll-mt-6 flex-col gap-4">
      {section.untitled ? (
        <h2 className="sr-only">{t(`${base}.sections.${id}.toc`)}</h2>
      ) : (
        <>
          <p className="font-mono-dm text-xs leading-4 tracking-[0.08em] text-[#9CA3AF]" aria-hidden>
            {String(number).padStart(2, '0')}
          </p>
          <h2 id={`${id}-title`} className="font-tight text-[26px] font-normal leading-[115%] tracking-[-0.035em] text-ink sm:text-[30px]">
            {t(`${base}.sections.${id}.title`)}
          </h2>
        </>
      )}
      {section.blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </Reveal>
  )
}

function Block({ block }) {
  const t = useT()
  switch (block.type) {
    case 'p':
      return <p className={P}>{t(block.key)}</p>
    case 'callout':
      return (
        <div className="flex gap-3.5 rounded-2xl bg-[#E8F2FE] px-5 py-[18px]">
          <svg width="20" height="20" viewBox="0 0 24 24" className="shrink-0" aria-hidden>
            <circle cx="12" cy="12" r="9" fill="none" stroke="#2F86EA" strokeWidth="1.8" />
            <path d="M12 11v6M12 7.5v.5" stroke="#2F86EA" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p className="font-sans text-[15px] leading-[155%] text-[#1E3A5F]">{t(block.key)}</p>
        </div>
      )
    case 'rows':
      return (
        <dl className="flex flex-col border-t border-[#E5E7EB]">
          {block.items.map((id) => (
            <div key={id} className="flex flex-col gap-1 border-b border-[#E5E7EB] py-4 sm:flex-row sm:gap-6">
              <dt className="font-sans text-[15px] font-medium leading-[22px] text-ink sm:w-[200px] sm:shrink-0">{t(`${block.base}.${id}.label`)}</dt>
              <dd className="font-sans text-[15px] leading-[22px] text-[#4B5563]">{t(`${block.base}.${id}.body`)}</dd>
            </div>
          ))}
        </dl>
      )
    case 'table':
      return <Table block={block} />
    case 'timeline':
      return <Timeline block={block} />
    case 'chips':
    case 'roles':
      return (
        <ul className="mk-stagger flex flex-wrap gap-2.5">
          {block.items.map((id, i) => {
            const first = block.type === 'roles' && i === 0
            const last = block.type === 'roles' && i === block.items.length - 1
            return (
              <li
                key={id}
                className={`rounded-pill px-4 py-2.5 font-sans text-sm leading-[18px] transition-colors ${
                  first
                    ? 'bg-ink text-white'
                    : last
                      ? 'border border-dashed border-[#9CA3AF] text-[#6B7280]'
                      : 'border border-[#E5E7EB] text-ink hover:bg-mist'
                }`}
              >
                {t(`${block.base}.${id}`)}
              </li>
            )
          })}
        </ul>
      )
    case 'donts':
      return (
        <ul className="mk-stagger flex flex-col border-t border-[#E5E7EB]">
          {block.items.map((id) => (
            <li key={id} className="flex items-center gap-3.5 border-b border-[#E5E7EB] py-3.5">
              <svg width="16" height="16" viewBox="0 0 24 24" className="shrink-0" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" stroke="#F87171" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
              <span className="font-sans text-[15px] leading-[22px] text-[#374151]">{t(`${block.base}.${id}`)}</span>
            </li>
          ))}
        </ul>
      )
    case 'counter':
      return <Counter block={block} />
    case 'chain':
      return <Chain block={block} />
    default:
      return null
  }
}

const KIND_TONE = {
  essential: 'bg-ink text-white',
  security: 'bg-[#E8F2FE] text-[#1E5FAF]',
  preference: 'bg-mist text-[#374151]',
}

function Table({ block }) {
  const t = useT()
  return (
    <div className="flex flex-col overflow-clip rounded-2xl border border-[#E5E7EB]" role="table" aria-label={t(`${block.base}.title`)}>
      <div className="hidden border-b border-[#E5E7EB] bg-[#F7F8F9] px-[18px] py-3 lg:flex" role="row">
        {block.cols.map((col) => (
          <span
            key={col.id}
            role="columnheader"
            className={`font-mono-dm text-[11px] uppercase leading-[14px] tracking-[0.08em] text-[#6B7280] ${
              col.grow ? 'grow basis-0 pr-3' : `shrink-0 pr-4 ${col.width}`
            }`}
          >
            {t(`${block.base}.cols.${col.id}`)}
          </span>
        ))}
      </div>
      {block.rows.map((row, i) => (
        <div
          key={row}
          role="row"
          className={`flex flex-col gap-1.5 px-4 py-3.5 transition-colors hover:bg-[#FAFBFC] lg:flex-row lg:items-center lg:gap-0 lg:px-[18px] ${
            i < block.rows.length - 1 ? 'border-b border-[#E5E7EB]' : ''
          }`}
        >
          {block.cols.map((col, ci) => {
            const label = ci > 0 && (
              <span className="mr-2 font-mono-dm text-[10px] uppercase tracking-[0.08em] text-[#9CA3AF] lg:hidden">
                {t(`${block.base}.cols.${col.id}`)}
              </span>
            )
            const cellCls = col.grow ? 'lg:grow lg:basis-0 lg:pr-3' : `lg:shrink-0 lg:pr-4 ${col.width}`
            if (col.kind) {
              const kind = block.kinds[row]
              return (
                <span key={col.id} role="cell" className={`flex items-center ${cellCls}`}>
                  {label}
                  <span className={`inline-block rounded-pill px-2.5 py-[3px] font-sans text-xs leading-4 ${KIND_TONE[kind]}`}>
                    {t(`${block.base}.kinds.${kind}`)}
                  </span>
                </span>
              )
            }
            return (
              <span
                key={col.id}
                role="cell"
                className={`font-sans ${cellCls} ${
                  col.strong
                    ? 'text-[15px] font-medium leading-[22px] text-ink'
                    : col.muted
                      ? 'text-sm leading-5 text-[#6B7280]'
                      : 'text-[15px] leading-[22px] text-[#4B5563]'
                }`}
              >
                {label}
                {t(`${block.base}.rows.${row}.${col.id}`)}
              </span>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function Timeline({ block }) {
  const t = useT()
  const ref = useRef(null)
  const inView = useInView(ref)
  return (
    <ol ref={ref} className={`relative flex flex-col pl-[22px] ${inView ? 'is-in' : ''}`}>
      <span className="absolute bottom-0 left-0 top-0 w-0.5 bg-[#E5E7EB]" aria-hidden />
      <span className="mk-legal-line absolute bottom-0 left-0 top-0 w-0.5 bg-ink" aria-hidden />
      {block.items.map((id, i) => (
        <li key={id} className={`relative flex flex-col gap-1 pt-1 ${i < block.items.length - 1 ? 'pb-[18px]' : ''}`}>
          <span
            className="mk-legal-dot absolute -left-[27px] top-[9px] size-3 rounded-pill border-2 border-white bg-lime ring-1 ring-ink"
            style={{ '--mk-dot-delay': `${0.25 + i * 0.22}s` }}
            aria-hidden
          />
          <span className="font-sans text-[15px] font-medium leading-[22px] text-ink">{t(`${block.base}.${id}.label`)}</span>
          <span className="font-sans text-[15px] leading-[22px] text-[#4B5563]">{t(`${block.base}.${id}.body`)}</span>
        </li>
      ))}
    </ol>
  )
}

function Counter({ block }) {
  const t = useT()
  return (
    <Reveal variant="scale" className="grid grid-cols-1 overflow-clip rounded-[24px] border border-[#E5E7EB] sm:grid-cols-3">
      {block.items.map((item, i) => (
        <div
          key={item.id}
          className={`flex flex-col gap-1.5 px-6 py-[26px] ${i > 0 ? 'border-t border-[#E5E7EB] sm:border-l sm:border-t-0' : ''} ${
            item.highlight ? 'bg-lime' : ''
          }`}
        >
          <span
            className="mk-legal-pop inline-block origin-left font-tight text-[64px] leading-[100%] tracking-[-0.05em] text-ink"
            style={{ '--mk-pop-delay': `${0.15 + i * 0.18}s` }}
          >
            <CountUp value={item.value} />
          </span>
          <span className={`font-sans text-sm leading-5 ${item.highlight ? 'text-[#3F4A12]' : 'text-[#6B7280]'}`}>{t(item.key)}</span>
        </div>
      ))}
    </Reveal>
  )
}

function Chain({ block }) {
  const t = useT()
  return (
    <div className="flex flex-col gap-4">
      <Reveal className="flex flex-col items-stretch rounded-[24px] bg-ink p-5 sm:p-[26px] md:flex-row md:items-center">
        {block.entries.map((e, i) => (
          <div key={e.n} className="contents">
            {i > 0 && (
              <svg className="mx-auto h-6 w-0.5 shrink-0 md:mx-0 md:h-0.5 md:w-9" viewBox="0 0 36 2" preserveAspectRatio="none" aria-hidden>
                <line
                  x1="0"
                  y1="1"
                  x2="36"
                  y2="1"
                  stroke="#D7F75B"
                  strokeWidth="2"
                  className="mk-draw hidden md:block"
                  style={{ '--mk-len': 36, '--mk-delay': `${0.35 + i * 0.3}s` }}
                />
                <rect x="0" y="0" width="36" height="2" fill="#D7F75B" className="md:hidden" />
              </svg>
            )}
            <Reveal
              variant="left"
              delay={i * 260}
              className="flex grow basis-0 flex-col gap-2 rounded-[14px] border border-[#2A2E33] bg-[#111315] p-4"
            >
              <span className="font-mono-dm text-[11px] uppercase leading-[14px] tracking-[0.06em] text-[#8B9097]">
                {t(`${block.base}.entry`, { n: e.n })}
              </span>
              <span className="font-sans text-sm leading-[19px] text-[#F2F3F4]">{t(`${block.base}.events.${e.event}`)}</span>
              <span className="font-geist text-[11px] leading-[14px] text-[#5C6168]">
                {t(`${block.base}.prev`)} {e.prev}
              </span>
              <span className="font-geist text-[11px] leading-[14px] text-lime">
                {t(`${block.base}.hash`)} {e.hash}
              </span>
            </Reveal>
          </div>
        ))}
      </Reveal>
      <p className="flex items-center gap-2.5">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-pill bg-[#4ADE8033]" aria-hidden>
          <svg width="12" height="12" viewBox="0 0 16 16">
            <path d="M3 8l3 3 7-7" fill="none" stroke="#15803D" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="font-sans text-sm leading-5 text-[#374151]">{t(`${block.base}.verified`)}</span>
      </p>
    </div>
  )
}

/* ─── Contact card ──────────────────────────────────────────────────── */

function ContactCard({ base, email }) {
  const t = useT()
  return (
    <Reveal
      as="section"
      id="contact"
      aria-labelledby="contact-title"
      className="flex scroll-mt-6 flex-col items-start justify-between gap-6 rounded-[24px] bg-ink p-7 sm:flex-row sm:items-center"
    >
      <div className="flex flex-col gap-2">
        <p className="font-mono-dm text-xs uppercase leading-4 tracking-[0.08em] text-lime">
          <span aria-hidden>• </span>
          {t(`${C}.contactEyebrow`)}
        </p>
        <h2 id="contact-title" className="font-tight text-[26px] font-normal leading-[115%] tracking-[-0.035em] text-white">
          {t(`${base}.contact.title`)}{' '}
          <span className="font-serif text-[30px] italic text-[#9CA3AF]">{t(`${base}.contact.accent`)}</span>
        </h2>
        <a href={`mailto:${email}`} className={`w-fit rounded-sm font-geist text-sm leading-5 text-[#9CA3AF] hover:text-white ${MK_FOCUS}`}>
          {email}
        </a>
      </div>
      <a
        href={`mailto:${email}`}
        className={`mk-press mk-noprint inline-flex shrink-0 items-center gap-3 rounded-pill bg-lime py-1.5 pl-[22px] pr-1.5 font-mono-dm text-[13px] uppercase leading-4 tracking-[0.08em] text-ink ${MK_FOCUS}`}
      >
        {t(`${C}.writeToUs`)}
        <span className="mk-arrow flex size-[30px] items-center justify-center rounded-pill bg-ink" aria-hidden>
          <svg width="14" height="14" viewBox="0 0 24 24">
            <path d="M7 17L17 7M8 7h9v9" fill="none" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </a>
    </Reveal>
  )
}
