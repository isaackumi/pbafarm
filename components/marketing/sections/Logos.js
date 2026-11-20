import { useT } from '../../../lib/i18n/context'

/** Customer logo row (Paper Q93-2) as a seamless marquee with faded edges. */
const LOGOS = [
  ['◐', 'PBA Farm'],
  ['◎', 'Kpong Fingerlings'],
  ['✳', 'Lake Harvest'],
  ['◆', 'Golden Tilapia'],
  ['❖', 'Raanan Feeds'],
  ['◒', 'Akosombo Co-op'],
  ['✦', 'Tema Cold Chain'],
]

function Row({ hidden = false }) {
  return (
    <ul className="flex shrink-0 items-center gap-16 pr-16" aria-hidden={hidden || undefined}>
      {LOGOS.map(([glyph, name]) => (
        <li key={name} className="flex items-center gap-2 text-[#9CA3AF] transition-colors hover:text-ink">
          <span className="text-[20px] leading-6" aria-hidden>
            {glyph}
          </span>
          <span className="whitespace-nowrap text-[17px] font-semibold leading-[22px] tracking-tight">{name}</span>
        </li>
      ))}
    </ul>
  )
}

export default function Logos() {
  const t = useT()
  return (
    <section aria-label={t('marketing.logos.label')} className="mx-auto w-full max-w-[1416px] overflow-hidden py-[34px]">
      <div className="[mask-image:linear-gradient(90deg,transparent,#000_10%,#000_90%,transparent)]">
        <div className="mk-marquee flex" style={{ '--mk-dur': '42s' }}>
          <Row />
          <Row hidden />
        </div>
      </div>
    </section>
  )
}
