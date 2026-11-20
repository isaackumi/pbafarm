import Head from 'next/head'
import Link from 'next/link'
import { useT } from '../../lib/i18n/context'
import { Reveal } from '../../lib/marketing/motion'
import { Brand, MK_FOCUS, PillButton } from './ui'

/**
 * 404 "This cage is empty" (Paper artboard QMW-2, page "Anowa · Marketing
 * site"). Sky above the waterline holds "4 [empty cage] 4"; below it a
 * fading reflection ripples, a lime fish swims off with rising bubbles, and
 * the copy points back to the surface. The illustration is sized in em from
 * one clamp() font size, so the whole group scales with the viewport while
 * the copy stays regular responsive text. Public, no queries, no app Layout.
 */

// Numeral height / font size in Paper: line-height 290px for 340px type.
const FS = 'clamp(118px, 23.6vw, 340px)'

function Numeral({ children }) {
  return (
    <span className="block font-tight font-light leading-[0.853em] tracking-[-0.06em] text-white" style={{ fontSize: '1em' }}>
      {children}
    </span>
  )
}

/** The zero: an empty net pen with two lime floats (Paper "Zero as an empty cage"). */
function CageZero({ reflection = false }) {
  return (
    <svg viewBox="0 0 240 290" className="block h-[0.853em] w-[0.706em] shrink-0" aria-hidden>
      {!reflection && (
        <>
          <defs>
            <clipPath id="mk404-inside">
              <ellipse cx="120" cy="145" rx="96" ry="121" />
            </clipPath>
          </defs>
          <g clipPath="url(#mk404-inside)" stroke="#FFFFFF" strokeOpacity="0.32" strokeWidth="1.6" className="mk404-net">
            <path d="M0 40L240 280M0 80L240 320M0 0L240 240M0 -40L240 200M0 -80L240 160M0 120L200 320M40 -40L240 160" />
            <path d="M240 40L0 280M240 80L0 320M240 0L0 240M240 -40L0 200M240 -80L0 160M240 120L40 320M200 -40L0 160" />
          </g>
        </>
      )}
      <ellipse cx="120" cy="145" rx="107" ry="132" fill="none" stroke="#FFFFFF" strokeWidth="22" />
      {!reflection && (
        <>
          <circle cx="13" cy="149" r="9" fill="#D7F75B" className="mk404-float" />
          <circle cx="227" cy="149" r="9" fill="#D7F75B" className="mk404-float" style={{ animationDelay: '-1.4s' }} />
        </>
      )}
    </svg>
  )
}

function Fish() {
  return (
    <div className="mk404-swim pointer-events-none absolute left-[38%] top-[clamp(70px,10dvh,110px)] w-[clamp(190px,26vw,380px)]" aria-hidden>
      <svg viewBox="0 0 380 120" className="block w-full">
        <circle cx="18" cy="44" r="3" fill="none" stroke="#FFFFFF" strokeOpacity="0.3" strokeWidth="1.5" className="mk-bubble" style={{ '--mk-dur': '3.4s', '--mk-delay': '0s', '--mk-rise': '-90px' }} />
        <circle cx="52" cy="66" r="6" fill="none" stroke="#FFFFFF" strokeOpacity="0.4" strokeWidth="1.5" className="mk-bubble" style={{ '--mk-dur': '4.2s', '--mk-delay': '-1.2s', '--mk-rise': '-120px' }} />
        <circle cx="90" cy="48" r="4" fill="none" stroke="#FFFFFF" strokeOpacity="0.45" strokeWidth="1.5" className="mk-bubble" style={{ '--mk-dur': '3.8s', '--mk-delay': '-2.4s', '--mk-rise': '-100px' }} />
        <circle cx="124" cy="62" r="5" fill="none" stroke="#FFFFFF" strokeOpacity="0.55" strokeWidth="1.5" className="mk-bubble" style={{ '--mk-dur': '3s', '--mk-delay': '-0.6s', '--mk-rise': '-80px' }} />
        <path d="M160 60 L 198 36 L 190 60 L 198 84 Z" fill="#D7F75B" className="mk404-tail" />
        <path d="M196 60 Q 218 50 240 46 Q 300 22 348 60 Q 300 98 240 74 Q 218 70 196 60 Z" fill="#D7F75B" />
        <circle cx="326" cy="55" r="4" fill="#0B0D10" />
      </svg>
    </div>
  )
}

export default function NotFound() {
  const t = useT()
  return (
    <>
      <Head>
        <title>{t('marketing.notFound.metaTitle')}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <style jsx global>{`
        @keyframes mk404-breathe {
          0%, 100% { transform: translateX(-50%) scale(1); opacity: 1; }
          50% { transform: translateX(-50%) scale(1.06); opacity: 0.8; }
        }
        .mk404-glow { animation: mk404-breathe 7s ease-in-out infinite; }
        @keyframes mk404-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }
        .mk404-float { transform-box: fill-box; animation: mk404-float 2.6s ease-in-out infinite; }
        @keyframes mk404-ripple {
          0%, 100% { transform: scaleY(-1) skewX(0deg) scaleX(1); }
          33% { transform: scaleY(-1.03) skewX(1.4deg) scaleX(1.004); }
          66% { transform: scaleY(-0.98) skewX(-1.2deg) scaleX(0.997); }
        }
        .mk404-reflection { transform: scaleY(-1); transform-origin: center; animation: mk404-ripple 6s ease-in-out infinite; }
        @keyframes mk404-swim {
          0% { transform: translate(-22vw, 6px); opacity: 0; }
          10% { opacity: 1; }
          30% { transform: translate(-6vw, -6px); }
          55% { transform: translate(14vw, 4px); }
          82% { transform: translate(40vw, -4px); opacity: 1; }
          100% { transform: translate(62vw, 0); opacity: 0; }
        }
        .mk404-swim { animation: mk404-swim 16s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite; }
        @keyframes mk404-tail {
          0%, 100% { transform: rotate(-9deg); }
          50% { transform: rotate(9deg); }
        }
        .mk404-tail { transform-box: fill-box; transform-origin: right center; animation: mk404-tail 0.55s ease-in-out infinite; }
        @keyframes mk404-shimmer {
          0% { background-position: 0% 0; }
          100% { background-position: 200% 0; }
        }
        .mk404-waterline { background-size: 200% 100%; animation: mk404-shimmer 6s linear infinite; }
        @media (prefers-reduced-motion: reduce) {
          .mk404-glow, .mk404-float, .mk404-reflection, .mk404-swim, .mk404-tail, .mk404-waterline { animation: none !important; }
          .mk404-reflection { transform: scaleY(-1); }
          .mk404-glow { transform: translateX(-50%); }
        }
      `}</style>
      <div className="relative flex min-h-dvh flex-col overflow-hidden bg-[#06121C] font-sans antialiased">
        {/* Sky */}
        <div
          className="relative shrink-0"
          style={{
            height: `max(46dvh, calc(${FS} * 0.853 + 150px))`,
            backgroundImage: 'linear-gradient(180deg, #2F86EA 0%, #8CC6F6 100%)',
          }}
        >
          <span aria-hidden className="mk-drift absolute left-[6%] top-[34%] h-[70px] w-[clamp(140px,18vw,260px)] rounded-pill bg-[#FFFFFFCC] blur-[14px]" style={{ '--mk-drift': '60px', '--mk-dur': '34s' }} />
          <span aria-hidden className="mk-drift absolute left-[75%] top-[25%] h-[80px] w-[clamp(150px,21vw,300px)] rounded-pill bg-[#FFFFFFB3] blur-[16px]" style={{ '--mk-drift': '-50px', '--mk-dur': '40s' }} />

          <header className="relative z-10 flex items-center justify-between px-5 py-5 sm:px-10 sm:py-6">
            <Brand tone="white" />
            <nav className="flex items-center gap-4 sm:gap-[22px]">
              <Link href="/login" className={`rounded-sm font-mono-dm text-xs uppercase leading-4 tracking-[0.08em] text-white ${MK_FOCUS}`}>
                {t('marketing.notFound.signIn')}
              </Link>
              <Link
                href="/signup"
                className={`mk-press rounded-pill bg-lime px-5 py-2.5 font-mono-dm text-xs uppercase leading-4 tracking-[0.08em] text-ink ${MK_FOCUS}`}
              >
                {t('marketing.notFound.startFree')}
              </Link>
            </nav>
          </header>

          {/* 4 [cage] 4, standing on the waterline */}
          <div className="absolute inset-x-0 bottom-0 flex justify-center" style={{ fontSize: FS }}>
            <div className="relative flex items-end gap-[0.118em]">
              <span
                aria-hidden
                className="mk404-glow pointer-events-none absolute bottom-[-0.056em] left-1/2 size-[1.294em] rounded-pill"
                style={{ backgroundImage: 'radial-gradient(circle closest-side, #FFFFFF59 0%, #FFFFFF1A 55%, #FFFFFF00 100%)' }}
              />
              <h1 className="sr-only">{t('marketing.notFound.srTitle')}</h1>
              <div className="relative flex items-end gap-[0.118em]" aria-hidden>
                <Numeral>4</Numeral>
                <CageZero />
                <Numeral>4</Numeral>
              </div>
            </div>
          </div>
        </div>

        {/* Water */}
        <div
          className="relative flex grow flex-col"
          style={{ backgroundImage: 'linear-gradient(180deg, #2B6FB8 0%, #0B3A7A 44%, #06121C 100%)' }}
        >
          <span
            aria-hidden
            className="mk404-waterline absolute inset-x-0 -top-[3px] h-2"
            style={{ backgroundImage: 'linear-gradient(90deg, #FFFFFF00, #FFFFFF99 15%, #FFFFFFCC 25%, #FFFFFF99 35%, #FFFFFF00 50%, #FFFFFF99 65%, #FFFFFFCC 75%, #FFFFFF99 85%, #FFFFFF00)' }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 flex justify-center overflow-hidden opacity-[0.22] blur-[2px]"
            style={{
              fontSize: FS,
              height: '0.56em',
              maskImage: 'linear-gradient(180deg, #000 0%, #0000 100%)',
              WebkitMaskImage: 'linear-gradient(180deg, #000 0%, #0000 100%)',
            }}
          >
            <div className="mk404-reflection flex h-[0.853em] items-end gap-[0.118em]">
              <Numeral>4</Numeral>
              <CageZero reflection />
              <Numeral>4</Numeral>
            </div>
          </div>
          <Fish />

          <div className="relative z-10 flex grow flex-col items-center justify-end gap-[18px] px-5 pb-10 pt-[clamp(150px,24dvh,230px)] text-center">
            <Reveal variant="up">
              <p className="font-tight text-[32px] leading-[110%] tracking-[-0.045em] text-white sm:text-[44px]">
                {t('marketing.notFound.title')}{' '}
                <span className="font-serif text-[1.18em] italic tracking-[-0.01em] text-[#BFD8F6]">{t('marketing.notFound.titleAccent')}</span>
              </p>
            </Reveal>
            <Reveal delay={120}>
              <p className="max-w-[520px] text-base leading-[155%] text-[#BFD8F6]">{t('marketing.notFound.body')}</p>
            </Reveal>
            <Reveal delay={220} className="flex flex-wrap items-center justify-center gap-3 pt-1.5">
              <PillButton href="/">{t('marketing.notFound.home')}</PillButton>
              <Link
                href="/assistant"
                className={`mk-press rounded-pill border border-white/25 bg-white/[0.08] px-[22px] py-3 font-mono-dm text-xs uppercase leading-4 tracking-[0.08em] text-white transition-colors hover:bg-white/15 ${MK_FOCUS}`}
              >
                {t('marketing.notFound.ask')}
              </Link>
            </Reveal>
            <Reveal delay={320} as="nav" aria-label={t('marketing.notFound.linksLabel')} className="flex flex-wrap items-center justify-center gap-x-7 gap-y-2 pt-12">
              <span className="font-mono-dm text-[11px] uppercase leading-[14px] tracking-[0.08em] text-[#5C7BA8]">{t('marketing.notFound.code')}</span>
              <Link href="/#pricing" className={`rounded-sm text-xs leading-[14px] text-[#8FA9CF] hover:text-white ${MK_FOCUS}`}>
                {t('marketing.notFound.links.pricing')}
              </Link>
              <Link href="/#product" className={`rounded-sm text-xs leading-[14px] text-[#8FA9CF] hover:text-white ${MK_FOCUS}`}>
                {t('marketing.notFound.links.whatsapp')}
              </Link>
              <Link href="/#faq" className={`rounded-sm text-xs leading-[14px] text-[#8FA9CF] hover:text-white ${MK_FOCUS}`}>
                {t('marketing.notFound.links.help')}
              </Link>
              <span className="text-xs leading-[14px] text-[#8FA9CF]">{t('marketing.notFound.links.status')}</span>
            </Reveal>
          </div>
        </div>
      </div>
    </>
  )
}
