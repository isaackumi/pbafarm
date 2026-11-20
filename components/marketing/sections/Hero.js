import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useT } from '../../../lib/i18n/context'
import { Reveal, useScrollProgress } from '../../../lib/marketing/motion'
import { Brand, GhostButton, MK_FOCUS, PillButton } from '../ui'

/**
 * Hero (Paper landing v4, node Q9P-2): sky to lake, the headline, and nine
 * floating product cards over the water. The scene is drawn at Paper's
 * 1416×1000 and scaled from the bottom centre, so the lake and cards keep
 * their geometry at every width; the headline is laid out normally above it.
 */

const NAV = [
  { key: 'product', href: '#product' },
  { key: 'ask', href: '#ask' },
  { key: 'pricing', href: '#pricing' },
  { key: 'customers', href: '#customers' },
  { key: 'resources', href: '#faq' },
]

/* Cloud blobs: [left, top, width, height, blur, alpha] in Paper coordinates. */
const CLOUD_CLUSTERS = [
  {
    drift: '36px',
    dur: '26s',
    blobs: [
      [-80, 632, 308, 98, 19, 'F2'], [-10, 590, 210, 126, 19, 'F2'], [130, 618, 252, 112, 19, 'F2'],
      [-164, 660, 280, 70, 19, 'F2'], [242, 660, 224, 70, 19, 'F2'], [260, 710, 220, 70, 14, 'F2'],
      [310, 680, 150, 90, 14, 'F2'], [410, 700, 180, 80, 14, 'F2'], [200, 730, 200, 50, 14, 'F2'], [490, 730, 160, 50, 14, 'F2'],
    ],
  },
  {
    drift: '-44px',
    dur: '31s',
    blobs: [
      [900, 679, 286, 91, 18, 'F2'], [965, 640, 195, 117, 18, 'F2'], [1095, 666, 234, 104, 18, 'F2'],
      [822, 705, 260, 65, 18, 'F2'], [1199, 705, 208, 65, 18, 'F2'], [1150, 733, 242, 77, 15, 'F2'],
      [1205, 700, 165, 99, 15, 'F2'], [1315, 722, 198, 88, 15, 'F2'], [1084, 755, 220, 55, 15, 'F2'], [1403, 755, 176, 55, 15, 'F2'],
    ],
  },
  {
    drift: '24px',
    dur: '22s',
    blobs: [[560, 767, 198, 63, 12, 'CC'], [605, 740, 135, 81, 12, 'CC'], [695, 758, 162, 72, 12, 'CC'], [506, 785, 180, 45, 12, 'CC'], [767, 785, 144, 45, 12, 'CC']],
  },
  {
    drift: '-60px',
    dur: '38s',
    blobs: [[1250, 168, 132, 42, 8, '99'], [1280, 150, 90, 54, 8, '99'], [1340, 162, 108, 48, 8, '99'], [1214, 180, 120, 30, 8, '99'], [1388, 180, 96, 30, 8, '99']],
  },
  {
    drift: '70px',
    dur: '34s',
    blobs: [[40, 135, 110, 35, 7, '88'], [65, 120, 75, 45, 7, '88'], [115, 130, 90, 40, 7, '88'], [10, 145, 100, 25, 7, '88'], [155, 145, 80, 25, 7, '88']],
  },
]

const SHADOW = '[box-shadow:#0B2A5A40_0px_24px_50px,#0B2A5A26_0px_2px_6px]'

function Fish({ width = 56, height = 40, eye = '#1C6FE0', fill = '#FFFFFF' }) {
  return (
    <svg width={width} height={height} viewBox="0 0 28 20" aria-hidden className="shrink-0">
      <path d="M2 10c4-6 10-8 16-6l8-4-2 10 2 10-8-4C12 18 6 16 2 10z" fill={fill} />
      <circle cx="9" cy="9" r="1.6" fill={eye} />
    </svg>
  )
}

function Dot({ color }) {
  return <span className="size-[6px] shrink-0 rounded-pill" style={{ backgroundColor: color }} />
}

function Row({ color, label, value }) {
  return (
    <div className="flex items-center justify-between gap-[6px]">
      <div className="flex items-center gap-[5px]">
        <Dot color={color} />
        <span className="text-[9px] leading-[120%] text-[#374151]">{label}</span>
      </div>
      <span className="text-[9px] font-semibold leading-[120%] text-ink">{value}</span>
    </div>
  )
}

/**
 * A card in the scene: positioned like Paper, rises in from the lake on load
 * (staggered), then floats with its Paper rotation.
 */
function SceneCard({ left, top, rot = 0, delay, dur, hide = '', className = '', children }) {
  return (
    <div className={`absolute ${hide}`} style={{ left, top }}>
      <Reveal delay={delay} variant="up">
        <div
          className={`mk-float origin-top-left ${className}`}
          style={{ '--mk-rot': `${rot}deg`, '--mk-dur': dur, '--mk-delay': `${(delay / 1000).toFixed(2)}s` }}
        >
          {children}
        </div>
      </Reveal>
    </div>
  )
}

function Cards({ t }) {
  const card = `flex flex-col gap-[6px] overflow-clip rounded-[14px] p-3 ${SHADOW}`
  return (
    <div className="mk-parallax-fast absolute inset-0">
      <SceneCard left={56} top={644} rot={-14} delay={700} dur="7.2s" hide="hidden lg:block" className={`${card} h-[120px] w-[74px] bg-white`}>
        <span className="text-[8px] font-medium leading-[120%] text-[#6B7280]">{t('marketing.hero.cards.feedDay')}</span>
        <span className="text-[11px] font-medium leading-[120%] text-ink">1,840 kg</span>
        <div className="mt-auto flex h-[44px] shrink-0 items-end gap-[3px]">
          {[20, 28, 24, 36, 30, 44, 34].map((h, i) => (
            <span key={i} className="grow basis-0 rounded-[3px]" style={{ height: h, backgroundColor: i === 5 ? '#1C6FE0' : '#CFE0F7' }} />
          ))}
        </div>
      </SceneCard>

      <SceneCard left={150} top={588} rot={-10} delay={600} dur="6.4s" hide="hidden sm:block" className={`${card} h-[150px] w-[108px] bg-white`}>
        <span className="text-[9px] font-medium leading-[120%] text-[#6B7280]">{t('marketing.hero.cards.cages')}</span>
        <span className="text-sm font-medium leading-[120%] text-ink">{t('marketing.hero.cards.cagesActive')}</span>
        <Row color="#F87171" label="C-07" value="3.1" />
        <Row color="#22C55E" label="B-12" value="5.8" />
        <Row color="#22C55E" label="A-01" value="6.2" />
        <Row color="#22C55E" label="A-03" value="5.1" />
      </SceneCard>

      <SceneCard left={282} top={550} rot={-6} delay={500} dur="7.8s" hide="hidden sm:block" className={`${card} h-[180px] w-[138px] bg-white`}>
        <div className="flex grow basis-0 items-center justify-center rounded-[10px]" style={{ backgroundImage: 'linear-gradient(in oklab 160deg, #9FE3E6 0%, #2F86EA 100%)' }}>
          <span className="mk-bob inline-flex">
            <Fish />
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[9px] leading-[120%] text-[#6B7280]">{t('marketing.hero.cards.harvest')}</span>
          <span className="text-[9px] font-semibold leading-[120%] text-[#15803D]">{t('marketing.hero.cards.gradeA')}</span>
        </div>
        <span className="text-xs font-medium leading-[120%] text-ink">{t('marketing.hero.cards.harvestValue')}</span>
      </SceneCard>

      <SceneCard left={442} top={532} rot={-3} delay={400} dur="6.8s" className={`${card} h-[150px] w-[178px] bg-white`}>
        <span className="text-[9px] font-medium leading-[120%] text-[#6B7280]">{t('marketing.hero.cards.biomass')}</span>
        <div className="flex items-baseline gap-1">
          <span className="text-[22px] font-semibold leading-[120%] text-ink">412.6</span>
          <span className="text-[10px] font-medium leading-[120%] text-[#15803D]">t +4.2%</span>
        </div>
        <svg width="150" height="60" viewBox="0 0 150 60" aria-hidden className="shrink-0">
          <defs>
            <linearGradient id="mk-hero-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#4FA3F2" stopOpacity="0.5" />
              <stop offset="1" stopColor="#4FA3F2" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M0 50 L20 46 L40 44 L60 38 L80 34 L100 26 L120 20 L150 10 L150 60 L0 60Z" fill="url(#mk-hero-area)" />
          <path className="mk-draw" style={{ '--mk-len': 170, '--mk-delay': '0.9s' }} d="M0 50 L20 46 L40 44 L60 38 L80 34 L100 26 L120 20 L150 10" fill="none" stroke="#1C6FE0" strokeWidth="2" />
        </svg>
      </SceneCard>

      <SceneCard left={642} top={522} rot={0} delay={300} dur="7.4s" className={`${card} h-[158px] w-[166px] bg-ink`}>
        <div className="flex items-center gap-[6px]">
          <span className="size-4 shrink-0 rounded-pill" style={{ backgroundImage: 'linear-gradient(in oklab 120deg, #E8A6C8 0%, #9FE3E6 100%)' }} />
          <span className="text-[10px] font-semibold leading-[120%] text-white">Anowa</span>
        </div>
        <span className="text-[11px] leading-[120%] text-[#E5E7EB]">{t('marketing.hero.cards.anowaMessage')}</span>
        <span className="mt-auto self-start rounded-pill bg-lime px-[10px] py-1 text-[9px] font-semibold leading-3 text-ink">{t('marketing.hero.cards.createTask')}</span>
      </SceneCard>

      <SceneCard
        left={830}
        top={532}
        rot={3}
        delay={400}
        dur="6.2s"
        className={`${card} h-[150px] w-[160px] items-center border border-[#FFFFFF55] bg-[linear-gradient(160deg,#5AA9F0_0%,#1C6FE0_100%)]`}
      >
        <span className="mt-[18px] flex size-[28px] shrink-0 items-center justify-center self-center rounded-pill bg-white text-lg leading-[22px] text-[#1C6FE0]">+</span>
        <span className="text-center text-base leading-[18px] tracking-tight text-white">{t('marketing.hero.cards.dailyEntry')}</span>
        <span className="text-center text-[9px] leading-3 text-white/80">{t('marketing.hero.cards.offline')}</span>
      </SceneCard>

      <SceneCard left={1012} top={550} rot={6} delay={500} dur="7s" className={`${card} h-[178px] w-[120px] bg-white`}>
        <span className="text-[9px] font-medium leading-[120%] text-[#6B7280]">{t('marketing.hero.cards.survival')}</span>
        <span className="text-[20px] font-semibold leading-[120%] text-ink">95.1%</span>
        <Row color="#1C6FE0" label={t('marketing.hero.cards.stocked')} value="10,000" />
        <Row color="#F59E0B" label={t('marketing.hero.cards.mortality')} value="490" />
        <Row color="#22C55E" label={t('marketing.hero.cards.harvested')} value="9,510" />
      </SceneCard>

      <SceneCard left={1154} top={588} rot={10} delay={600} dur="6.6s" hide="hidden sm:block" className={`${card} h-[150px] w-[100px] bg-white`}>
        <span className="text-[9px] font-medium leading-[120%] text-[#6B7280]">FCR</span>
        <span className="text-[20px] font-semibold leading-[120%] text-ink">1.38</span>
        <span className="text-[9px] font-medium leading-[120%] text-[#15803D]">{t('marketing.hero.cards.target')}</span>
        <div className="mt-auto flex h-[6px] shrink-0 rounded-pill bg-[#E5E7EB]">
          <span className="w-[72%] rounded-pill bg-[#1C6FE0]" />
        </div>
      </SceneCard>

      <SceneCard left={1280} top={644} rot={14} delay={700} dur="7.6s" hide="hidden lg:block" className={`${card} h-[120px] w-[78px] bg-white`}>
        <span className="text-[8px] font-semibold leading-[120%] text-[#DC2626]">{t('marketing.hero.cards.alert')}</span>
        <span className="text-xs font-medium leading-[120%] text-ink">DO 3.1</span>
        <span className="text-[8px] leading-[120%] text-[#6B7280]">{t('marketing.hero.cards.alertWhere')}</span>
      </SceneCard>
    </div>
  )
}

function Lake() {
  const rings = [
    [160, 70, 70, 15.4, 56, 11.2, '0s'],
    [330, 96, 90, 19.8, 72, 14.4, '0.8s'],
    [1090, 80, 80, 17.6, 64, 12.8, '1.6s'],
    [1260, 104, 96, 21.1, 77, 15.4, '0.4s'],
    [470, 138, 56, 12.3, 45, 9, '1.2s'],
    [950, 134, 60, 13.2, 48, 9.6, '2s'],
  ]
  const glints = [
    [240, 20, 330, '0s'], [1000, 24, 1070, '1.4s'], [1180, 40, 1230, '2.6s'], [80, 30, 120, '0.7s'], [520, 90, 570, '3.1s'], [860, 96, 920, '1.9s'],
  ]
  return (
    <>
      <div className="absolute left-0 top-[822px] h-[178px] w-[1416px]" style={{ backgroundImage: 'linear-gradient(in oklab 180deg, #2C7BD8 0%, #185AB3 40%, #0F3F86 100%)' }} />
      <svg width="1416" height="160" viewBox="0 0 1416 160" aria-hidden className="absolute left-0 top-[822px]">
        {glints.map(([x1, y, x2, d], i) => (
          <line key={i} className="mkh-glint" style={{ animationDelay: d }} x1={x1} y1={y} x2={x2} y2={y} stroke="#FFFFFF" strokeOpacity="0.3" strokeWidth="2" strokeLinecap="round" />
        ))}
        {rings.map(([cx, cy, rx, ry, rx2, ry2, d], i) => (
          <g key={i} className="mkh-bob" style={{ animationDelay: d }}>
            <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#0C357059" stroke="#CFE6FF8C" strokeWidth="1.6" />
            <ellipse cx={cx} cy={cy - 2} rx={rx2} ry={ry2} fill="none" stroke="#FFFFFF40" />
          </g>
        ))}
      </svg>
      <div className="absolute left-[-40px] top-[796px] h-12 w-[1496px] rounded-pill bg-[#E6F3FD] opacity-75 [filter:blur(14px)]" />
    </>
  )
}

function Clouds() {
  return (
    <div className="mk-parallax-slow absolute inset-0">
      {CLOUD_CLUSTERS.map((c, i) => (
        <div key={i} className="mk-drift absolute inset-0" style={{ '--mk-drift': c.drift, '--mk-dur': c.dur }}>
          {c.blobs.map(([l, tp, w, h, b, a], j) => (
            <span
              key={j}
              className="absolute rounded-pill"
              style={{ left: l, top: tp, width: w, height: h, filter: `blur(${b}px)`, backgroundColor: `#FFFFFF${a}` }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function Nav({ t }) {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open])

  const link = `rounded-pill px-4 py-[9px] font-mono-dm text-[11px] uppercase leading-[14px] tracking-[0.08em] transition-colors ${MK_FOCUS}`
  return (
    <>
      <nav
        aria-label={t('marketing.nav.label')}
        className={`fixed inset-x-2 top-2 z-50 mx-auto flex max-w-[1416px] items-center justify-between rounded-[28px] px-4 py-3 transition-all duration-500 sm:inset-x-3 sm:top-3 sm:px-7 sm:py-[22px] ${
          scrolled ? 'bg-[#0B2A5A]/70 py-2.5 shadow-[0_10px_30px_#0B2A5A33] backdrop-blur-xl sm:py-3' : 'bg-transparent'
        }`}
      >
        <Brand />
        <div className="hidden rounded-pill border border-[#FFFFFF38] bg-[#FFFFFF1F] p-[5px] shadow-[0_10px_30px_#0B2A5A26] backdrop-blur-md lg:flex lg:gap-1">
          {NAV.map((n, i) => (
            <a key={n.key} href={n.href} className={`${link} ${i === 0 ? 'bg-white text-ink' : 'text-white hover:bg-white/15'}`}>
              {t(`marketing.nav.${n.key}`)}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-[22px]">
          <Link href="/login" className={`hidden rounded-sm font-mono-dm text-xs uppercase leading-4 tracking-[0.08em] text-white hover:opacity-80 sm:inline ${MK_FOCUS}`}>
            {t('marketing.nav.signIn')}
          </Link>
          <Link href="/signup" className={`mk-press hidden rounded-pill bg-lime px-5 py-[10px] font-mono-dm text-xs uppercase leading-4 tracking-[0.08em] text-ink sm:inline-flex ${MK_FOCUS}`}>
            {t('marketing.nav.startFree')}
          </Link>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={t('marketing.nav.menu')}
            aria-expanded={open}
            className={`flex size-10 items-center justify-center rounded-pill border border-white/30 bg-white/15 text-white lg:hidden ${MK_FOCUS}`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </nav>

      {open && (
        <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true" aria-label={t('marketing.nav.label')}>
          <button type="button" aria-label={t('marketing.nav.close')} onClick={() => setOpen(false)} className="absolute inset-0 bg-ink/40 backdrop-blur-sm" />
          <div className="mkh-sheet absolute inset-x-2 top-2 flex flex-col gap-2 rounded-[28px] bg-white p-5 shadow-[0_30px_60px_#0B2A5A40]">
            <div className="flex items-center justify-between pb-2">
              <Brand tone="ink" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('marketing.nav.close')}
                className={`flex size-10 items-center justify-center rounded-pill bg-mist text-ink ${MK_FOCUS}`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            {NAV.map((n) => (
              <a
                key={n.key}
                href={n.href}
                onClick={() => setOpen(false)}
                className={`rounded-[16px] px-4 py-3 font-tight text-[22px] tracking-[-0.03em] text-ink hover:bg-mist ${MK_FOCUS}`}
              >
                {t(`marketing.nav.${n.key}`)}
              </a>
            ))}
            <div className="flex flex-wrap gap-2 pt-3">
              <PillButton href="/signup">{t('marketing.nav.startFree')}</PillButton>
              <GhostButton href="/login" tone="dark">
                {t('marketing.nav.signIn')}
              </GhostButton>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default function Hero() {
  const t = useT()
  const ref = useRef(null)
  useScrollProgress(ref)
  return (
    <>
      <Nav t={t} />
      <header
        ref={ref}
        className="relative mx-auto h-[800px] w-full max-w-[1416px] overflow-clip rounded-[28px] sm:h-[880px] lg:h-[960px] xl:h-[1000px]"
        style={{ backgroundImage: 'linear-gradient(in oklab 180deg, #1562D6 0%, #2F86EA 38%, #6FB6F4 66%, #B9DDF9 100%)' }}
      >
        {/* The scene at Paper scale, anchored to the bottom so the lake always meets the frame. */}
        <div
          aria-hidden
          className="absolute bottom-0 left-1/2 h-[1000px] w-[1416px] origin-bottom -translate-x-1/2 scale-[0.52] sm:scale-[0.72] lg:scale-[0.9] xl:scale-100"
        >
          <div className="absolute left-[358px] top-[120px] h-[360px] w-[700px] rounded-pill bg-white opacity-[0.14] [filter:blur(90px)]" />
          <Clouds />
          <Lake />
          <Cards t={t} />
        </div>

        <div className="relative flex flex-col items-center gap-[22px] px-5 pt-[104px] text-center sm:pt-[110px]">
          <Reveal delay={80}>
            <div className="flex items-center gap-2 rounded-pill border border-[#FFFFFF40] bg-[#FFFFFF26] py-[6px] pl-[6px] pr-[14px] backdrop-blur-sm">
              <span className="mk-pulse rounded-pill bg-lime px-[10px] py-[3px] font-mono-dm text-[10px] uppercase leading-3 tracking-[0.08em] text-ink">
                {t('marketing.hero.badgeNew')}
              </span>
              <span className="text-left text-[13px] leading-4 text-white sm:text-sm">{t('marketing.hero.badge')}</span>
            </div>
          </Reveal>
          <h1 className="flex flex-col items-center font-tight font-normal tracking-[-0.045em] text-[42px] leading-[104%] sm:text-[60px] lg:text-[72px] lg:leading-[102%]">
            <Reveal as="span" delay={200} className="text-white">
              {t('marketing.hero.titleLine1')}
            </Reveal>
            <Reveal as="span" delay={360} className="text-[#FFFFFFCC]">
              {t('marketing.hero.titleLine2')}{' '}
              <span className="font-serif text-[1.14em] italic tracking-[-0.01em]">{t('marketing.hero.titleAccent')}</span>
            </Reveal>
          </h1>
          <Reveal delay={520}>
            <p className="max-w-[600px] text-[15px] leading-[155%] text-[#FFFFFFE0] sm:text-[16px]">{t('marketing.hero.body')}</p>
          </Reveal>
          <Reveal delay={660} className="flex flex-wrap items-center justify-center gap-3 pt-[6px]">
            <GhostButton href="#tour">{t('marketing.hero.watchDemo')}</GhostButton>
            <PillButton href="/signup" className="text-[14px]">
              {t('marketing.hero.startTrial')}
            </PillButton>
          </Reveal>
        </div>

        <Reveal delay={900} variant="fade" className="absolute inset-x-0 bottom-[44px] flex flex-col items-center gap-[6px] sm:bottom-[52px]">
          <p className="text-sm leading-4 text-white">{t('marketing.hero.rating')}</p>
          <p className="text-[14px] leading-[18px] tracking-[4px] text-lime" aria-hidden>
            ★★★★★
          </p>
        </Reveal>

        <style jsx global>{`
          @keyframes mkh-bob {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(3px); }
          }
          .mkh-bob { animation: mkh-bob 4.6s ease-in-out infinite; transform-box: fill-box; }
          @keyframes mkh-glint {
            0%, 100% { opacity: 0.25; transform: translateX(0); }
            50% { opacity: 1; transform: translateX(14px); }
          }
          .mkh-glint { animation: mkh-glint 5s ease-in-out infinite; transform-box: fill-box; }
          @keyframes mkh-sheet {
            from { opacity: 0; transform: translateY(-12px) scale(0.98); }
            to { opacity: 1; transform: none; }
          }
          .mkh-sheet { animation: mkh-sheet 0.28s cubic-bezier(0.2, 0.7, 0.2, 1); }
          @media (prefers-reduced-motion: reduce) {
            .mkh-bob, .mkh-glint, .mkh-sheet { animation: none !important; }
          }
        `}</style>
      </header>
    </>
  )
}
