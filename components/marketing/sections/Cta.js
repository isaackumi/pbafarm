import { useRef } from 'react'
import { useT } from '../../../lib/i18n/context'
import { Reveal, useScrollProgress } from '../../../lib/marketing/motion'
import { GhostButton, PillButton } from '../ui'

/**
 * Closing call to action (Paper landing v4 "CTA", PV1-2): sky gradient card
 * with two banks of clouds that drift and part with scroll, and a two-voice
 * headline that rises in.
 */

// Paper cloud puffs: [left, top, width, height, blur, alpha] on the 1416×460 card.
const LEFT_BANK = [
  [-60, 336, 264, 84, 16, 'F2'],
  [0, 300, 180, 108, 16, 'F2'],
  [120, 324, 216, 96, 16, 'F2'],
  [-132, 360, 240, 60, 16, 'F2'],
  [216, 360, 192, 60, 16, 'F2'],
]
const RIGHT_BANK = [
  [980, 356, 264, 84, 16, 'F2'],
  [1040, 320, 180, 108, 16, 'F2'],
  [1160, 344, 216, 96, 16, 'F2'],
  [908, 380, 240, 60, 16, 'F2'],
  [1256, 380, 192, 60, 16, 'F2'],
]
const MID_BANK = [
  [420, 397, 198, 63, 12, 'CC'],
  [465, 370, 135, 81, 12, 'CC'],
  [555, 388, 162, 72, 12, 'CC'],
  [366, 415, 180, 45, 12, 'CC'],
  [627, 415, 144, 45, 12, 'CC'],
]

function Bank({ puffs, className, style }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 ${className}`} style={style}>
      {puffs.map(([l, top, w, h, blur, a], i) => (
        <span
          key={i}
          className="absolute rounded-pill"
          style={{
            left: `${(l / 1416) * 100}%`,
            top: `${(top / 460) * 100}%`,
            width: w,
            height: h,
            filter: `blur(${blur}px)`,
            backgroundColor: `#FFFFFF${a}`,
          }}
        />
      ))}
    </div>
  )
}

export default function Cta() {
  const t = useT()
  const ref = useRef(null)
  useScrollProgress(ref)
  return (
    <section className="mx-auto w-full max-w-[1416px]">
      <div
        ref={ref}
        className="relative h-[420px] overflow-hidden rounded-[28px] sm:h-[460px]"
        style={{ backgroundImage: 'linear-gradient(in oklab 180deg, #1562D6 0%, #4FA3F2 70%, #9FD0F7 100%)' }}
      >
        {/* Banks part as the card scrolls through the viewport, and drift on their own. */}
        <Bank puffs={LEFT_BANK} className="mk-drift" style={{ '--mk-drift': '-36px', '--mk-dur': '26s', translate: 'calc((var(--mk-p, 0.5) - 0.5) * -120px) 0' }} />
        <Bank puffs={RIGHT_BANK} className="mk-drift" style={{ '--mk-drift': '36px', '--mk-dur': '30s', translate: 'calc((var(--mk-p, 0.5) - 0.5) * 120px) 0' }} />
        <Bank puffs={MID_BANK} className="mk-drift" style={{ '--mk-drift': '24px', '--mk-dur': '22s' }} />
        <div className="absolute inset-x-0 top-[72px] flex flex-col items-center gap-6 px-5 sm:top-[110px]">
          <Reveal variant="scale">
            <h2 className="text-center font-tight text-[42px] font-normal leading-[105%] tracking-[-0.045em] text-white sm:text-[56px] lg:text-[64px]">
              {t('marketing.cta.title')}
              <br />
              <span className="font-serif text-[1.19em] italic tracking-[-0.01em]">{t('marketing.cta.titleAccent')}</span>
            </h2>
          </Reveal>
          <Reveal delay={160} className="flex flex-wrap items-center justify-center gap-3">
            <GhostButton href="/#product">{t('marketing.cta.demo')}</GhostButton>
            <PillButton href="/signup">{t('marketing.cta.start')}</PillButton>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
