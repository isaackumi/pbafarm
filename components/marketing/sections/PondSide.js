import { useT } from '../../../lib/i18n/context'
import { Reveal } from '../../../lib/marketing/motion'
import { Eyebrow, Heading } from '../ui'

/** Paper v4 "Built for the pond side": five promises in a ruled row; icons bob on hover. */

const S = { fill: 'none', stroke: '#2F86EA', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }

const ICONS = {
  offline: (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0" {...S} />
      <circle cx="12" cy="19" r="1.3" fill="#2F86EA" />
      <path d="M3 3l18 18" {...S} />
    </svg>
  ),
  language: <span className="font-mono-dm text-[11px] leading-[14px] tracking-[0.04em] text-[#2F86EA]">EN·FR</span>,
  money: <span className="text-[15px] font-semibold leading-[18px] text-[#2F86EA]">₵</span>,
  data: (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path d="M4 18h3V13H4zM10.5 18h3V9h-3zM17 18h3V5h-3z" {...S} />
    </svg>
  ),
  ownership: (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" {...S} />
      <path d="M9 12l2 2 4-4" {...S} />
    </svg>
  ),
}

const ITEMS = ['offline', 'language', 'money', 'data', 'ownership']

export default function PondSide() {
  const t = useT()
  return (
    <section id="pond-side" className="mx-auto w-full max-w-[1416px]">
      <div className="flex flex-col gap-9 px-5 pb-[30px] pt-[70px] sm:px-10 xl:px-[120px]">
        <Reveal className="flex max-w-[1000px] flex-col gap-4">
          <Eyebrow>{t('marketing.pondSide.eyebrow')}</Eyebrow>
          <Heading size="md" lead={t('marketing.pondSide.titleLead')} accent={t('marketing.pondSide.titleAccent')} />
        </Reveal>
        <Reveal className="mk-stagger grid grid-cols-1 border-t border-[#E5E7EB] sm:grid-cols-2 lg:grid-cols-5">
          {ITEMS.map((k, i) => (
            <div
              key={k}
              className={`group flex flex-col gap-3 pt-7 lg:px-6 ${i === 0 ? 'lg:pl-0' : ''} ${i === ITEMS.length - 1 ? 'lg:pr-0' : ''} sm:pr-6`}
            >
              <span className="flex size-10 items-center justify-center rounded-pill bg-[#E8F2FE] motion-safe:group-hover:[animation:mk-bob_1.6s_ease-in-out_infinite]" aria-hidden>
                {ICONS[k]}
              </span>
              <h3 className="text-[17px] font-medium leading-[22px] tracking-[-0.01em] text-ink">{t(`marketing.pondSide.items.${k}.title`)}</h3>
              <p className="text-[14px] leading-[155%] text-[#6B7280]">{t(`marketing.pondSide.items.${k}.body`)}</p>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  )
}
