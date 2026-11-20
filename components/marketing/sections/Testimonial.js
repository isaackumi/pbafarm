import { useRef } from 'react'
import { useT } from '../../../lib/i18n/context'
import { CountUp, Reveal, useInView } from '../../../lib/marketing/motion'
import { Eyebrow } from '../ui'

/**
 * Paper v4 "Testimonial": the quote's words sharpen in one after another
 * (blur to crisp), then the three figures count up.
 */

function Quote({ text }) {
  const ref = useRef(null)
  const inView = useInView(ref, { threshold: 0.4 })
  const words = text.split(' ')
  return (
    <blockquote
      ref={ref}
      className="max-w-[1000px] text-center font-serif text-[34px] italic leading-[112%] tracking-[-0.01em] text-ink sm:text-[44px] lg:text-[54px]"
    >
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {words.map((w, i) => (
          <span
            key={i}
            className={`inline-block transition-all duration-700 ease-out motion-reduce:transition-none ${inView ? 'opacity-100 blur-0' : 'opacity-0 blur-[8px]'}`}
            style={{ transitionDelay: `${i * 45}ms` }}
          >
            {w}
            {i < words.length - 1 ? ' ' : ''}
          </span>
        ))}
      </span>
    </blockquote>
  )
}

const STATS = [
  { key: 'feed', value: 11, prefix: '−', suffix: '%' },
  { key: 'hours', value: 3, suffixKey: 'marketing.testimonial.stats.hoursUnit' },
  { key: 'missed', value: 0 },
]

export default function Testimonial() {
  const t = useT()
  return (
    <section id="customers" className="mx-auto w-full max-w-[1416px] scroll-mt-6">
      <div className="flex flex-col items-center gap-10 px-5 pb-20 pt-24 sm:px-10 lg:pb-[110px] lg:pt-[120px] xl:px-[160px]">
        <Reveal>
          <Eyebrow>{t('marketing.testimonial.eyebrow')}</Eyebrow>
        </Reveal>
        <Quote text={t('marketing.testimonial.quote')} />
        <Reveal delay={200} className="flex items-center gap-[14px]">
          <span
            className="size-[52px] shrink-0 rounded-pill border-[3px] border-white shadow-[0_6px_16px_#C2410C33]"
            style={{ backgroundImage: 'linear-gradient(in oklab 135deg, #F4B183 0%, #C2410C 100%)' }}
            aria-hidden
          />
          <span className="flex flex-col gap-[3px]">
            <span className="text-base font-semibold leading-[18px] text-ink">{t('marketing.testimonial.name')}</span>
            <span className="text-sm leading-4 text-[#6B7280]">{t('marketing.testimonial.role')}</span>
          </span>
        </Reveal>
        <Reveal delay={260} className="mk-stagger grid w-full max-w-[1000px] grid-cols-1 border-t border-[#E5E7EB] pt-6 sm:grid-cols-3">
          {STATS.map((s, i) => (
            <div key={s.key} className={`flex flex-col gap-1.5 px-0 py-3 sm:px-7 sm:py-0 ${i > 0 ? 'sm:border-l sm:border-[#E5E7EB]' : ''}`}>
              <span className="font-tight text-[44px] leading-[54px] tracking-[-0.045em] text-ink">
                {s.prefix}
                <CountUp value={s.value} />
                {s.suffixKey ? t(s.suffixKey) : s.suffix}
              </span>
              <span className="text-sm leading-4 text-[#6B7280]">{t(`marketing.testimonial.stats.${s.key}`)}</span>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  )
}
