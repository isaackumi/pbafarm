import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useT } from '../../../lib/i18n/context'
import { Reveal, prefersReducedMotion, useInView, useScrollProgress } from '../../../lib/marketing/motion'
import { Eyebrow, Heading, MK_FOCUS } from '../ui'

/**
 * Paper v4 "WhatsApp bot": a phone in a sky stage. In view, the chat plays
 * out WhatsApp-style (bubbles pop from their corner), the logbook photo
 * "uploads" with a shimmer, and the phone drifts with the scroll.
 */

const BEATS = [250, 1050, 1850, 2650, 3450] // message 1..4, photo done
const ALL = BEATS.length

function useBeats(active) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!active) return undefined
    if (prefersReducedMotion()) {
      setN(ALL)
      return undefined
    }
    const timers = BEATS.map((ms, i) => setTimeout(() => setN(i + 1), ms))
    return () => timers.forEach(clearTimeout)
  }, [active])
  return n
}

function Bubble({ on, out, className = '', children }) {
  return (
    <div
      className={`transition-all duration-[450ms] motion-reduce:transition-none ease-[cubic-bezier(0.34,1.56,0.64,1)] ${out ? 'origin-bottom-right self-end' : 'origin-bottom-left self-start'} ${on ? 'scale-100 opacity-100' : 'scale-50 opacity-0'} ${className}`}
    >
      {children}
    </div>
  )
}

function Phone({ beat }) {
  return (
    <div className="flex h-[540px] w-[300px] shrink-0 flex-col rounded-[44px] bg-ink p-2.5 shadow-[0_30px_60px_#0B3A7A55]">
      <div className="flex grow flex-col overflow-clip rounded-[36px] bg-[#EFE7DE]">
        <div className="flex items-center gap-2.5 bg-[#0B5C4F] px-4 pb-3 pt-[22px]">
          <span className="flex size-8 items-center justify-center rounded-pill bg-ink">
            <svg width="18" height="11" viewBox="0.5 16.25 60.25 35.5">
              <path d="M14.5 34 H18 L23 19 L30 49 L36 27 L40 34 H46 L58 22 L58 46 L46 34" fill="none" stroke="#F4F0E8" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="4.5" cy="34" r="4" fill="#F2A07B" />
            </svg>
          </span>
          <span className="flex flex-col gap-px">
            <span className="text-[14px] font-semibold leading-[18px] text-white">Anowa</span>
            <span className="text-[11px] leading-[14px] text-[#CDE7E1]">farm bot · Kpong site</span>
          </span>
        </div>
        <div className="flex grow flex-col gap-2 px-3 py-[14px]">
          <Bubble on={beat >= 1} out className="max-w-[200px] rounded-[10px] rounded-br-[2px] bg-[#D9FDD3] px-2.5 py-2 text-[13px] leading-[18px] text-[#111B21]">
            A3 fed 42 kg, 3 dead. B2 fed 38 kg, 0 dead
          </Bubble>
          <Bubble on={beat >= 2} className="flex max-w-[230px] flex-col gap-1.5 rounded-[10px] rounded-bl-[2px] bg-white px-2.5 py-2">
            <span className="text-[13px] leading-[18px] text-[#111B21]">Got it, 2 entries for today:</span>
            <span className="font-geist text-xs leading-[17px] text-[#111B21]">
              A3 · 42 kg · 3 dead
              <br />
              B2 · 38 kg · 0 dead
            </span>
            <span className="flex gap-1.5 pt-0.5">
              <span className="rounded-pill bg-[#0B5C4F] px-2.5 py-1 text-xs leading-4 text-white">Confirm</span>
              <span className="rounded-pill border border-[#CBD5D1] px-2.5 py-1 text-xs leading-4 text-[#0B5C4F]">Edit</span>
            </span>
          </Bubble>
          <Bubble on={beat >= 3} out className="flex h-[110px] w-[150px] rounded-[10px] bg-[#D9FDD3] p-1">
            <span
              className={`flex grow items-end rounded-[7px] p-1.5 ${beat >= 5 ? '' : 'mk-shimmer'}`}
              style={{
                backgroundImage:
                  beat >= 5
                    ? 'repeating-linear-gradient(180deg, #F7F3E8 0px, #F7F3E8 13px, #C9D6E8 13px, #C9D6E8 14px)'
                    : 'linear-gradient(100deg, #E8E2D4 30%, #FFFFFF 50%, #E8E2D4 70%)',
              }}
            >
              <span className="text-[11px] leading-[14px] text-[#4B5563]">logbook.jpg</span>
            </span>
          </Bubble>
          <Bubble on={beat >= 4} className="max-w-[230px] rounded-[10px] rounded-bl-[2px] bg-white px-2.5 py-2 text-[13px] leading-[18px] text-[#111B21]">
            I read 6 rows from the photo. Check them in the app before they’re saved.
          </Bubble>
        </div>
      </div>
    </div>
  )
}

export default function WhatsAppSection() {
  const t = useT()
  const stageRef = useRef(null)
  const inView = useInView(stageRef, { threshold: 0.4 })
  const beat = useBeats(inView)
  useScrollProgress(stageRef)

  const facts = ['signal', 'photo', 'confirm']
  return (
    <section id="whatsapp" className="mx-auto w-full max-w-[1416px] scroll-mt-6">
      <div className="flex flex-col items-center gap-12 px-5 py-20 sm:px-10 lg:flex-row lg:gap-20 lg:py-[110px] xl:px-[120px]">
        <Reveal variant="left" className="w-full shrink-0 lg:w-[520px]">
          <div
            ref={stageRef}
            className="relative flex h-[520px] items-end justify-center overflow-clip rounded-[28px] sm:h-[600px]"
            style={{ backgroundImage: 'linear-gradient(in oklab 180deg, #2F86EA 0%, #8CC6F6 100%)' }}
            role="img"
            aria-label={t('marketing.whatsapp.mockLabel')}
          >
            <div className="relative top-[70px]" aria-hidden>
              <div className="mk-parallax-slow">
                <Phone beat={beat} />
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal delay={120} className="flex grow basis-0 flex-col gap-5">
          <Eyebrow>{t('marketing.whatsapp.eyebrow')}</Eyebrow>
          <Heading lead={t('marketing.whatsapp.titleLead')} accent={t('marketing.whatsapp.titleAccent')} />
          <p className="text-base leading-[155%] text-[#4B5563]">{t('marketing.whatsapp.body')}</p>
          <div className="mk-stagger grid grid-cols-1 border-t border-[#E5E7EB] pt-[22px] sm:grid-cols-3">
            {facts.map((k, i) => (
              <div
                key={k}
                className={`flex flex-col gap-1.5 py-3 sm:py-0 ${i > 0 ? 'sm:border-l sm:border-[#E5E7EB] sm:pl-5' : ''} ${i < 2 ? 'sm:pr-5' : ''}`}
              >
                <span className="font-tight text-[28px] leading-8 tracking-[-0.03em] text-ink">{t(`marketing.whatsapp.facts.${k}.value`)}</span>
                <span className="text-[14px] leading-5 text-[#6B7280]">{t(`marketing.whatsapp.facts.${k}.label`)}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              href="/signup"
              className={`mk-press inline-flex items-center gap-3 rounded-pill bg-ink py-1.5 pl-[22px] pr-1.5 font-mono-dm text-[13px] uppercase leading-4 tracking-[0.08em] text-white ${MK_FOCUS}`}
            >
              {t('marketing.whatsapp.cta')}
              <span className="mk-arrow flex size-[30px] items-center justify-center rounded-pill bg-lime" aria-hidden>
                <svg width="14" height="14" viewBox="0 0 24 24">
                  <path d="M7 17L17 7M8 7h9v9" fill="none" stroke="#0B0D10" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </Link>
            <span className="text-[13px] leading-4 text-[#6B7280]">{t('marketing.whatsapp.telegram')}</span>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
