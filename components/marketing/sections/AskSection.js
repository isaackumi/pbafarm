import { useEffect, useRef, useState } from 'react'
import { useT } from '../../../lib/i18n/context'
import { Reveal, prefersReducedMotion, useCountUp, useInView } from '../../../lib/marketing/motion'
import { Eyebrow, Heading } from '../ui'

/**
 * Paper v4 "Ask Anowa" (dark panel). Scrolled into view, the chat plays out:
 * the question slides in, Anowa types, the answer arrives sentence by
 * sentence, the risk callout fades in, then the "Answers use" counts run up.
 */

const DONE = 6
const STEPS = [
  [1, 0], // question
  [2, 450], // typing dots
  [3, 1650], // sentence one
  [4, 2150], // sentence two
  [5, 2650], // risk callout + save
  [6, 3150], // sources count up
]

function useChatPhase(active) {
  const [phase, setPhase] = useState(0)
  useEffect(() => {
    if (!active) return undefined
    if (prefersReducedMotion()) {
      setPhase(DONE)
      return undefined
    }
    const timers = STEPS.map(([p, ms]) => setTimeout(() => setPhase(p), ms))
    return () => timers.forEach(clearTimeout)
  }, [active])
  return phase
}

function Shown({ on, className = '', from = 'translate-y-2', children, as: Tag = 'div' }) {
  return (
    <Tag
      className={`transition-all duration-500 ease-[cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none ${on ? 'translate-x-0 translate-y-0 opacity-100' : `${from} opacity-0`} ${className}`}
    >
      {children}
    </Tag>
  )
}

function Count({ value, active }) {
  const n = useCountUp(value, active)
  return <>{n.toLocaleString('en')}</>
}

function Check() {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-pill bg-[#D7F75B26]" aria-hidden>
      <svg width="12" height="12" viewBox="0 0 16 16">
        <path d="M3 8l3 3 7-7" fill="none" stroke="#D7F75B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

function AnowaAvatar() {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-pill border border-[#2A2E33] bg-[#0A0B0C]" aria-hidden>
      <svg width="18" height="11" viewBox="0.5 16.25 60.25 35.5">
        <path d="M14.5 34 H18 L23 19 L30 49 L36 27 L40 34 H46 L58 22 L58 46 L46 34" fill="none" stroke="#F4F0E8" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="4.5" cy="34" r="4" fill="#F2A07B" />
      </svg>
    </span>
  )
}

function Chip({ active, icon, children }) {
  return (
    <span
      className={`flex items-center gap-[7px] rounded-pill px-3 py-[7px] text-[13px] leading-4 ${active ? 'border border-[#2A2E33] bg-[#181A1D] text-[#F2F3F4]' : 'text-[#8B9097]'}`}
    >
      {icon}
      {children}
    </span>
  )
}

export default function AskSection() {
  const t = useT()
  const chatRef = useRef(null)
  const inView = useInView(chatRef, { threshold: 0.35 })
  const phase = useChatPhase(inView)
  const bold = 'font-semibold'

  return (
    <section id="ask" className="mx-auto w-full max-w-[1416px] scroll-mt-6">
      <div className="relative flex flex-col items-center gap-12 overflow-hidden rounded-[28px] bg-ink px-5 py-16 sm:px-10 lg:flex-row lg:gap-[72px] lg:py-[88px] xl:px-[120px]">
        <Reveal className="flex w-full shrink-0 flex-col gap-5 lg:w-[440px]">
          <Eyebrow tone="lime">{t('marketing.ask.eyebrow')}</Eyebrow>
          <Heading tone="white" lead={t('marketing.ask.titleLead')} accent={t('marketing.ask.titleAccent')} />
          <p className="text-base leading-[155%] text-[#9CA3AF]">{t('marketing.ask.body')}</p>
          <ul className="mk-stagger flex flex-col gap-[14px] pt-2">
            {['site', 'risk', 'language'].map((k) => (
              <li key={k} className="flex items-start gap-3">
                <Check />
                <span className="text-[15px] leading-5 text-[#E5E7EB]">{t(`marketing.ask.points.${k}`)}</span>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal variant="scale" delay={120} className="w-full min-w-0 grow basis-0">
          <div ref={chatRef} className="flex flex-col gap-[18px] rounded-[24px] border border-[#2A2E33] bg-[#111315] p-4 sm:p-[22px]" aria-label={t('marketing.ask.mockLabel')} role="img">
            <div className="flex items-center justify-between" aria-hidden>
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-pill bg-[#2A2E33]" />
                <span className="size-2 rounded-pill bg-[#2A2E33]" />
                <span className="size-2 rounded-pill bg-[#2A2E33]" />
              </div>
              <div className="flex items-center gap-2 rounded-pill border border-[#2A2E33] px-3 py-[5px]">
                <span className="size-1.5 rounded-pill bg-[#4ADE80]" />
                <span className="text-xs leading-4 text-[#8B9097]">{t('marketing.ask.model')}</span>
              </div>
            </div>

            <div className="flex min-h-[230px] flex-col gap-[18px]" aria-hidden>
              <Shown on={phase >= 1} from="translate-x-6" className="flex justify-end">
                <div className="max-w-[380px] rounded-t-[18px] rounded-bl-[18px] rounded-br-[4px] bg-[#181A1D] px-[18px] py-[14px] text-[15px] leading-[22px] text-[#F2F3F4]">
                  {t('marketing.ask.question')}
                </div>
              </Shown>

              <Shown on={phase >= 2} className="flex items-start gap-[14px]">
                <AnowaAvatar />
                <div className="flex grow basis-0 flex-col gap-3 pt-1">
                  {phase < 3 ? (
                    <div className="flex h-[23px] items-center gap-1">
                      {[0, 1, 2].map((i) => (
                        <span key={i} className="ai-typing-dot inline-block size-2 rounded-full bg-[#8B9097]" style={{ animationDelay: `${i * 160}ms` }} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-[15px] leading-[23px] text-[#F2F3F4]">
                      <Shown as="span" on={phase >= 3} className="inline">
                        <span className={bold}>{t('marketing.ask.answer1Bold')}</span>
                        {t('marketing.ask.answer1Rest')}{' '}
                      </Shown>
                      <Shown as="span" on={phase >= 4} className="inline">
                        {t('marketing.ask.answer2Pre')}
                        <span className={bold}>{t('marketing.ask.answer2Bold')}</span>
                        {t('marketing.ask.answer2Post')}
                      </Shown>
                    </p>
                  )}
                  <Shown on={phase >= 5} className="flex items-center gap-[10px] rounded-[12px] border border-[#F8717140] bg-[#F8717114] px-3 py-[10px]">
                    <span className="size-1.5 shrink-0 rounded-pill bg-[#F87171]" />
                    <span className="text-[14px] leading-5 text-[#FCA5A5]">{t('marketing.ask.risk')}</span>
                  </Shown>
                  <Shown on={phase >= 5} className="flex items-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24">
                      <path d="M6 3h12v18l-6-4-6 4z" fill="none" stroke="#8B9097" strokeWidth="1.7" strokeLinejoin="round" />
                    </svg>
                    <span className="text-xs leading-4 text-[#8B9097]">{t('marketing.ask.save')}</span>
                  </Shown>
                </div>
              </Shown>
            </div>

            <div className="flex flex-col gap-[14px] rounded-[20px] border border-[#2A2E33] bg-[#0A0B0C] pb-3 pl-[18px] pr-[14px] pt-4" aria-hidden>
              <div className="text-[15px] leading-5 text-[#5C6168]">
                {t('marketing.ask.placeholder')}
                <span className="mk-caret ml-0.5 inline-block h-4 w-px translate-y-0.5 bg-[#8B9097]" />
              </div>
              <div className="flex items-center gap-1.5">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <Chip
                    active
                    icon={
                      <svg width="14" height="14" viewBox="0 0 24 24">
                        <path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z" fill="none" stroke="#D7F75B" strokeWidth="1.8" strokeLinejoin="round" />
                      </svg>
                    }
                  >
                    {t('marketing.ask.chipSite')}
                  </Chip>
                  <Chip
                    icon={
                      <svg width="14" height="14" viewBox="0 0 24 24">
                        <rect x="4" y="5" width="16" height="15" rx="2" fill="none" stroke="#8B9097" strokeWidth="1.8" />
                        <path d="M4 10h16" stroke="#8B9097" strokeWidth="1.8" />
                      </svg>
                    }
                  >
                    {t('marketing.ask.chipDays')}
                  </Chip>
                  <span className="hidden sm:inline-flex">
                    <Chip
                      icon={
                        <svg width="14" height="14" viewBox="0 0 24 24">
                          <circle cx="11" cy="11" r="6" fill="none" stroke="#8B9097" strokeWidth="1.8" />
                          <path d="M20 20l-4.5-4.5" stroke="#8B9097" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                      }
                    >
                      {t('marketing.ask.chipDeep')}
                    </Chip>
                  </span>
                </div>
                <span className="grow" />
                <span className="mk-pulse flex size-9 shrink-0 items-center justify-center rounded-pill bg-lime">
                  <svg width="15" height="15" viewBox="0 0 16 16">
                    <path d="M8 13V3M4 7l4-4 4 4" fill="none" stroke="#0B0D10" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-x-[18px] gap-y-1 text-xs leading-4">
              <span className="text-[#5C6168]">{t('marketing.ask.answersUse')}</span>
              {[
                [1204, 'daily'],
                [18, 'samplings'],
                [336, 'water'],
              ].map(([n, k]) => (
                <span key={k} className="flex gap-[5px]">
                  <span className="font-geist text-[#F2F3F4]">
                    <Count value={n} active={phase >= DONE} />
                  </span>
                  <span className="text-[#8B9097]">{t(`marketing.ask.sources.${k}`)}</span>
                </span>
              ))}
              <span className="text-[#5C6168]">{t('marketing.ask.roleOnly')}</span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
