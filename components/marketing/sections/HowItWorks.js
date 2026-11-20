import { useEffect, useRef, useState } from 'react'
import { useT } from '../../../lib/i18n/context'
import { Reveal, prefersReducedMotion, useInView } from '../../../lib/marketing/motion'
import { Eyebrow, Heading, PillButton } from '../ui'

/**
 * Paper v4 "How it works" (ink panel, five steps). In view, the dashed line
 * draws left to right and a lime highlight walks the cycle 01 to 05, then
 * settles on 02 (Feed), as in Paper.
 */

const STEPS = ['stock', 'feed', 'sample', 'harvest', 'sell']
const REST = 1

function useWalk(active) {
  const [i, setI] = useState(REST)
  const [walking, setWalking] = useState(false)
  useEffect(() => {
    if (!active || prefersReducedMotion()) return undefined
    setWalking(true)
    const timers = STEPS.map((_, k) => setTimeout(() => setI(k), 500 + k * 520))
    timers.push(
      setTimeout(() => {
        setI(REST)
        setWalking(false)
      }, 500 + STEPS.length * 520 + 300),
    )
    return () => timers.forEach(clearTimeout)
  }, [active])
  return { i, walking }
}

export default function HowItWorks() {
  const t = useT()
  const ref = useRef(null)
  const inView = useInView(ref, { threshold: 0.3 })
  const { i: active } = useWalk(inView)

  return (
    <section id="how" className="mx-auto w-full max-w-[1416px]">
      <div className="flex flex-col gap-12 rounded-[28px] bg-ink px-5 pb-16 pt-16 sm:px-10 lg:gap-14 lg:pb-[70px] lg:pt-20 xl:px-[120px]">
        <Reveal className="flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-end">
          <div className="flex max-w-[860px] flex-col gap-4">
            <Eyebrow tone="lime">{t('marketing.how.eyebrow')}</Eyebrow>
            <Heading tone="white" lead={t('marketing.how.titleLead')} accent={t('marketing.how.titleAccent')} />
          </div>
          <PillButton href="/signup">{t('marketing.how.cta')}</PillButton>
        </Reveal>

        <div ref={ref} className="relative">
          <div
            aria-hidden
            className={`absolute left-10 right-10 top-[27px] hidden origin-left border-t-2 border-dashed border-[#3A3F46] transition-transform duration-[1600ms] motion-reduce:transition-none ease-[cubic-bezier(0.6,0,0.2,1)] lg:block ${inView ? 'scale-x-100' : 'scale-x-0'}`}
          />
          <ol className="relative grid grid-cols-1 gap-8 sm:grid-cols-2 lg:flex lg:justify-between lg:gap-0">
            {STEPS.map((k, idx) => {
              const on = idx === active
              return (
                <li
                  key={k}
                  className={`flex flex-col gap-4 transition-all duration-700 motion-reduce:transition-none lg:w-[200px] ${inView ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0'}`}
                  style={{ transitionDelay: `${200 + idx * 120}ms` }}
                >
                  <span
                    className={`flex size-14 shrink-0 items-center justify-center rounded-pill border font-mono-dm text-[14px] uppercase leading-[18px] tracking-[0.08em] transition-all duration-500 ${on ? 'scale-105 border-lime bg-lime text-ink shadow-[0_0_0_8px_#D7F75B1F]' : 'border-[#2A2E33] bg-[#16191D] text-white'}`}
                    aria-hidden
                  >
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <h3 className="text-[22px] font-medium leading-7 tracking-[-0.02em] text-white">{t(`marketing.how.steps.${k}.title`)}</h3>
                  <p className="text-[14px] leading-[155%] text-[#9CA3AF]">{t(`marketing.how.steps.${k}.body`)}</p>
                </li>
              )
            })}
          </ol>
        </div>
      </div>
    </section>
  )
}
