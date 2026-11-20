import { useT } from '../../../lib/i18n/context'

/** Live activity ticker (Paper Q7P-2): ink pill, lime "Live" badge, events scrolling past. */
const EVENTS = [
  ['#4ADE80', 'PBA Farm', 'feedLogged'],
  ['#FBBF24', 'Kpong Fingerlings', 'samplingDue'],
  ['#9FE3E6', 'Lake Harvest', 'lotTraced'],
  ['#F87171', 'Akosombo Co-op', 'lowOxygen'],
  ['#4ADE80', 'Golden Tilapia', 'harvest'],
  ['#E8A6C8', 'Raanan Feeds', 'delivered'],
]

function Events({ t, hidden = false }) {
  return (
    <ul className="flex shrink-0 items-center gap-[28px] pr-[28px]" aria-hidden={hidden || undefined}>
      {EVENTS.map(([color, farm, key]) => (
        <li key={key} className="flex items-center gap-[10px] whitespace-pre text-sm leading-4">
          <span className="size-[7px] shrink-0 rounded-pill" style={{ backgroundColor: color }} />
          <span className="font-medium text-white">{farm}</span>
          <span className="text-[#8B9097]">{t(`marketing.ticker.events.${key}`)}</span>
          <span className="pl-[18px] text-[#2A2E33]" aria-hidden>
            /
          </span>
        </li>
      ))}
    </ul>
  )
}

export default function Ticker() {
  const t = useT()
  return (
    <section aria-label={t('marketing.ticker.label')} className="mx-auto w-full max-w-[1416px]">
      <div className="relative flex h-[64px] items-center gap-4 overflow-hidden rounded-pill bg-ink pl-3 sm:gap-6 sm:pl-6">
        <div className="relative z-10 flex shrink-0 items-center gap-2 rounded-pill bg-lime px-[14px] py-[7px]">
          <span className="mk-pulse size-[6px] shrink-0 rounded-pill bg-ink" />
          <span className="font-mono-dm text-[11px] uppercase leading-[14px] tracking-[0.08em] text-ink">
            {t('marketing.ticker.live', { count: 320 })}
          </span>
        </div>
        <div className="min-w-0 grow overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_6%,#000_80%,transparent)]">
          <div className="mk-marquee flex" style={{ '--mk-dur': '48s' }}>
            <Events t={t} />
            <Events t={t} hidden />
          </div>
        </div>
      </div>
    </section>
  )
}
