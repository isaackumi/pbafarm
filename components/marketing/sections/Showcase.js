import { useRef } from 'react'
import Image from 'next/image'
import { useT } from '../../../lib/i18n/context'
import { Reveal, useScrollProgress } from '../../../lib/marketing/motion'
import { Eyebrow } from '../ui'

/**
 * "See what's below the waterline" (Paper Q4X-2): the sky meets the lake at
 * a wave, and under it the product shot rises through light rays, swimming
 * fish and bubbles, with live chips floating around it.
 */

/* Light rays: [left %, width px, rotation deg, alpha hex]. */
const RAYS = [
  [11.3, 90, 18, '50'],
  [26.8, 60, 14, '38'],
  [39.5, 140, 10, '34'],
  [60.7, 80, -8, '38'],
  [73.4, 120, -14, '44'],
  [88.3, 70, -18, '34'],
]

/* Fish: [left %, top px, width, opacity, travel px, faces right, duration]. */
const FISH = [
  [4.2, 540, 46, 0.9, 90, true, '11s'],
  [9.9, 580, 28, 0.8, 70, true, '8s'],
  [88.3, 560, 54, 0.85, -110, false, '12s'],
  [93.9, 610, 30, 0.8, -70, false, '9s'],
]

/* Bubbles: [left %, top px, size px, delay s, duration s]. */
const BUBBLES = [
  [8.5, 360, 10, 0, 5], [9.9, 420, 6, 1.4, 4.2], [91.1, 300, 12, 0.6, 5.6], [92.5, 360, 7, 2.2, 4.4],
  [90.4, 400, 5, 3, 3.8], [6.4, 700, 8, 1, 5], [94.6, 720, 9, 2.6, 4.8], [5.2, 560, 5, 3.4, 4],
  [96, 600, 6, 0.3, 4.6], [12, 780, 7, 1.8, 5.4],
]

function Fish({ width }) {
  return (
    <svg width={width} height={Math.round(width * 0.714)} viewBox="0 0 28 20" aria-hidden>
      <path d="M2 10c4-6 10-8 16-6 C19 8 19 12 18 16 C12 18 6 16 2 10z" fill="#0B2E40" />
      <path className="mk-tail" d="M18 4 L26 0 L24 10 L26 20 L18 16 C19 12 19 8 18 4z" fill="#0B2E40" />
      <circle cx="9" cy="9" r="1.6" fill="#1E6F8A" />
    </svg>
  )
}

const CHIP = 'flex items-center gap-[10px] rounded-[16px] px-[14px] py-[10px] [box-shadow:#01080F66_0px_20px_40px]'

function Chip({ style, rot = 0, dur, className = '', children }) {
  return (
    <div className="absolute hidden lg:block" style={style}>
      <Reveal variant="scale" delay={300}>
        <div className={`mk-float origin-top-left ${CHIP} ${className}`} style={{ '--mk-rot': `${rot}deg`, '--mk-dur': dur }}>
          {children}
        </div>
      </Reveal>
    </div>
  )
}

export default function Showcase() {
  const t = useT()
  const ref = useRef(null)
  useScrollProgress(ref)
  return (
    <section
      id="tour"
      ref={ref}
      className="relative mx-auto w-full max-w-[1416px] scroll-mt-24 overflow-clip rounded-[28px]"
      style={{ backgroundImage: 'linear-gradient(in oklab 180deg, #2E8FA8 0%, #0E4A63 33%, #072638 66%, #041019 100%)' }}
    >
      {/* Sky and the waterline */}
      <div className="relative px-5 pb-6 pt-14 text-center" style={{ backgroundImage: 'linear-gradient(in oklab 180deg, #B9DDF9 0%, #DCEFFB 100%)' }}>
        <Reveal className="flex flex-col items-center gap-[14px]">
          <Eyebrow>{t('marketing.showcase.eyebrow')}</Eyebrow>
          <h2 className="font-tight text-[34px] font-normal leading-[105%] tracking-[-0.045em] text-ink sm:text-[44px] lg:text-[52px]">
            {t('marketing.showcase.titleLead')}{' '}
            <span className="font-serif text-[1.19em] italic tracking-[-0.01em] text-[#0E6B86]">{t('marketing.showcase.titleAccent')}</span>
          </h2>
        </Reveal>
      </div>
      <div className="relative h-[70px] bg-[#DCEFFB]" aria-hidden>
        <svg viewBox="0 0 1416 70" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <path d="M0 34 C 160 6, 320 62, 470 34 S 790 6, 945 34 S 1260 62, 1416 30 L1416 70 L0 70Z" fill="#2E8FA8" />
          <path d="M0 40 C 160 12, 320 68, 470 40 S 790 12, 945 40 S 1260 68, 1416 36" fill="none" stroke="#FFFFFFB3" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>

      {/* Light, fish and bubbles */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-[200px] bottom-0">
        <div className="mk-parallax-drift absolute inset-0">
          {RAYS.map(([left, w, rot, a], i) => (
            <span
              key={i}
              className="mk-sway absolute top-[60px] h-[820px] [filter:blur(14px)]"
              style={{
                left: `${left}%`,
                width: w,
                '--mk-rot': `${rot}deg`,
                '--mk-o': 1,
                '--mk-dur': `${8 + i * 1.3}s`,
                backgroundImage: `linear-gradient(in oklab 180deg, #BFF4F5${a} 0%, #BFF4F500 100%)`,
              }}
            />
          ))}
        </div>
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0 hidden sm:block">
        {FISH.map(([left, top, w, o, dist, right, dur], i) => (
          <div key={i} className="absolute" style={{ left: `${left}%`, top, opacity: o }}>
            <div className="mk-swim" style={{ '--mk-dist': `${dist}px`, '--mk-flip': right ? -1 : 1, '--mk-dur': dur }}>
              <Fish width={w} />
            </div>
          </div>
        ))}
        {BUBBLES.map(([left, top, s, d, dur], i) => (
          <span
            key={i}
            className="mk-bubble absolute rounded-pill border border-[#CFF7F880] bg-[#CFF7F814]"
            style={{ left: `${left}%`, top, width: s, height: s, '--mk-delay': `${d}s`, '--mk-dur': `${dur}s`, '--mk-rise': '-180px' }}
          />
        ))}
      </div>

      {/* The product, rising from the deep */}
      <div className="relative z-10 px-3 pb-10 pt-8 sm:px-8 sm:pt-10 lg:pb-[64px]">
        <div className="mk-parallax-slow mx-auto w-full max-w-[1200px]">
        <Reveal variant="scale">
          <div
            className="rounded-[18px] p-[6px] [box-shadow:#01080F99_0px_60px_120px] sm:rounded-[28px] sm:p-[10px]"
            style={{ backgroundImage: 'linear-gradient(in oklab 180deg, #2A2E33 0%, #0A0B0C 100%)' }}
          >
            <div className="overflow-hidden rounded-[12px] bg-[#0A0B0C] sm:rounded-[20px]">
              <Image
                src="/marketing/home-screenshot.jpg"
                width={1180}
                height={827}
                alt={t('marketing.showcase.shotAlt')}
                sizes="(min-width: 1280px) 1180px, 100vw"
                className="h-auto w-full"
              />
            </div>
          </div>
        </Reveal>
        </div>
      </div>

      {/* Live chips */}
      <Chip style={{ left: '2%', top: 690 }} dur="6.4s" className="bg-[#FFFFFFE6]">
        <span className="mk-pulse size-2 shrink-0 rounded-pill bg-[#22C55E]" />
        <span className="flex flex-col gap-[2px]">
          <span className="text-[14px] font-semibold leading-[125%] text-ink">DO 6.2 mg/L</span>
          <span className="text-[10px] leading-[125%] text-[#6B7280]">{t('marketing.showcase.chips.doWhere')}</span>
        </span>
      </Chip>
      <Chip style={{ left: '79.8%', top: 236 }} rot={2} dur="7.2s" className="border border-[#7FE0E333] bg-[#06121CF0]">
        <span className="size-[22px] shrink-0 rounded-pill" style={{ backgroundImage: 'linear-gradient(in oklab 120deg, #E8A6C8 0%, #9FE3E6 100%)' }} />
        <span className="flex w-[200px] shrink-0 flex-col gap-[3px]">
          <span className="text-[11px] font-semibold leading-[125%] text-white">Anowa</span>
          <span className="text-xs leading-[125%] text-[#C9D3DA]">{t('marketing.showcase.chips.anowa')}</span>
        </span>
      </Chip>
      <Chip style={{ left: '3.1%', top: 1000 }} rot={-3} dur="6.8s" className="bg-[#FFFFFFE6]">
        <span className="flex size-[28px] shrink-0 items-center justify-center rounded-[10px] bg-lime text-[14px] font-bold leading-[18px] text-ink">
          <span className="mks-spin inline-block">↻</span>
        </span>
        <span className="flex flex-col gap-[2px]">
          <span className="text-sm font-semibold leading-[125%] text-ink">{t('marketing.showcase.chips.queued')}</span>
          <span className="text-[10px] leading-[125%] text-[#6B7280]">{t('marketing.showcase.chips.queuedNote')}</span>
        </span>
      </Chip>
      <Chip style={{ left: '82.6%', top: 1080 }} rot={3} dur="7.6s" className="bg-[#FFFFFFE6]">
        <span className="flex flex-col gap-[2px]">
          <span className="text-[10px] leading-[125%] text-[#6B7280]">Lot #A01-0412</span>
          <span className="text-sm font-semibold leading-[125%] text-ink">{t('marketing.showcase.chips.traced')}</span>
        </span>
        <svg width="34" height="34" viewBox="0 0 7 7" aria-hidden className="shrink-0">
          <path d="M0 0h3v3H0zM4 0h3v3H4zM0 4h3v3H0zM4 4h1v1H4zM6 6h1v1H6zM5 5h1v1H5z" fill="#0B0D10" />
        </svg>
      </Chip>

      <style jsx global>{`
        @keyframes mks-spin { to { transform: rotate(360deg); } }
        .mks-spin { animation: mks-spin 2.4s linear infinite; }
        @media (prefers-reduced-motion: reduce) {
          .mks-spin { animation: none !important; }
        }
      `}</style>
    </section>
  )
}
