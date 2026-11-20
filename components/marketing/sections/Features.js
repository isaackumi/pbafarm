import { useT } from '../../../lib/i18n/context'
import { Reveal } from '../../../lib/marketing/motion'
import { Eyebrow, Heading } from '../ui'

/** Paper v4 "Features": three product cards on mist with sky stages. */

const STAGE = 'linear-gradient(in oklab 180deg, #2F86EA 0%, #B9DDF9 100%)'

function Card({ title, body, children }) {
  return (
    <div>
    <article className="mk-lift flex h-full flex-col gap-[18px] rounded-[24px] bg-mist px-[14px] pb-[26px] pt-[14px] hover:shadow-[0_24px_50px_-24px_#0B2A5A55]">
      <div
        className="flex h-[250px] shrink-0 items-center justify-center overflow-clip rounded-[16px]"
        style={{ backgroundImage: STAGE }}
        aria-hidden
      >
        {children}
      </div>
      <div className="flex flex-col gap-2 px-3">
        <h3 className="font-sans text-[20px] font-medium leading-6 tracking-[-0.02em] text-ink">{title}</h3>
        <p className="font-sans text-[14px] leading-[155%] text-[#6B7280]">{body}</p>
      </div>
    </article>
    </div>
  )
}

function PhoneMock() {
  return (
    <div className="mt-[50px] flex h-[220px] w-[150px] shrink-0 rounded-[26px] bg-ink p-2">
      <div className="flex grow basis-0 flex-col gap-2 rounded-lg bg-white px-3 py-[14px]">
        <div className="text-[9px] leading-[120%] text-[#6B7280]">Cage A-03 · today</div>
        <div className="text-[9px] leading-[120%] text-[#6B7280]">Feed given</div>
        <div className="rounded-sm border border-[#E5E7EB] px-[9px] py-[7px] text-xs font-semibold leading-4 text-ink">62 kg</div>
        <div className="text-[9px] leading-[120%] text-[#6B7280]">Mortality</div>
        <div className="rounded-sm border border-[#E5E7EB] px-[9px] py-[7px] text-xs font-semibold leading-4 text-ink">3</div>
        <div className="mt-auto rounded-pill bg-lime p-[7px] text-center text-[10px] font-semibold leading-3 text-ink">Save · offline</div>
      </div>
    </div>
  )
}

function ChatMock() {
  return (
    <div className="flex w-[270px] shrink-0 flex-col gap-2">
      <div className="self-end rounded-t-[14px] rounded-bl-[14px] rounded-br-[4px] bg-white px-[13px] py-[9px] text-xs leading-4 text-ink">
        Why is B-12 growing slower?
      </div>
      <div className="rounded-t-[14px] rounded-bl-[4px] rounded-br-[14px] bg-ink px-[13px] py-[11px] text-xs leading-normal text-[#E5E7EB]">
        Density hit 31 kg/m³ on Nov 12. Split 4,200 fish into B-14. I’ve prepared the transfer for approval.
      </div>
      <div className="self-start rounded-pill bg-lime px-3 py-[5px] text-[10px] font-semibold leading-3 text-ink">Open transfer →</div>
    </div>
  )
}

const TRACE = [
  ['#D86AA6', 'Hatchery · Kpong'],
  ['#1C6FE0', 'Stocked · A-01'],
  ['#15803D', 'Harvest · 2.4 t'],
  ['#15803D', 'Dispatched · 4 °C'],
]

function TraceMock() {
  return (
    <div className="flex w-[260px] shrink-0 gap-4 rounded-[16px] bg-white p-4 shadow-[0_20px_40px_#0B2A5A33]">
      <div className="flex size-[72px] shrink-0 items-center justify-center rounded-[10px] bg-ink">
        <svg width="52" height="52" viewBox="0 0 7 7" shapeRendering="crispEdges">
          <path d="M0 0h3v3H0zM4 0h3v3H4zM0 4h3v3H0zM4 4h1v1H4zM6 4h1v1H6zM5 5h1v1H5zM4 6h1v1H4zM6 6h1v1H6z" fill="#FFFFFF" />
          <path d="M1 1h1v1H1zM5 1h1v1H5zM1 5h1v1H1z" fill="#0B0D10" />
        </svg>
      </div>
      <div className="flex flex-col gap-[7px]">
        {TRACE.map(([color, label]) => (
          <div key={label} className="flex items-center gap-[10px]">
            <span className="size-[10px] shrink-0 rounded-pill border-2 bg-white" style={{ borderColor: color }} />
            <span className="text-[11px] font-medium leading-[120%] text-ink">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Features() {
  const t = useT()
  return (
    <section id="product" className="mx-auto w-full max-w-[1416px] scroll-mt-6">
      <div className="flex flex-col items-center gap-[44px] px-5 pb-[80px] pt-[40px] sm:px-10 lg:pb-[110px] xl:px-[120px]">
        <Reveal className="flex max-w-[960px] flex-col items-center gap-4 text-center">
          <Eyebrow>{t('marketing.features.eyebrow')}</Eyebrow>
          <Heading lead={t('marketing.features.titleLead')} accent={t('marketing.features.titleAccent')} />
        </Reveal>
        <Reveal className="mk-stagger grid w-full max-w-[1176px] grid-cols-1 gap-[18px] md:grid-cols-3">
          <Card title={t('marketing.features.offline.title')} body={t('marketing.features.offline.body')}>
            <PhoneMock />
          </Card>
          <Card title={t('marketing.features.copilot.title')} body={t('marketing.features.copilot.body')}>
            <ChatMock />
          </Card>
          <Card title={t('marketing.features.trace.title')} body={t('marketing.features.trace.body')}>
            <TraceMock />
          </Card>
        </Reveal>
      </div>
    </section>
  )
}
