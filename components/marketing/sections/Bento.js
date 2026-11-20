import { useT } from '../../../lib/i18n/context'
import { CountUp, Reveal } from '../../../lib/marketing/motion'

/**
 * Proof bento (Paper Q32-2): farms on Anowa, entries on time, readings
 * logged, feed saved. Cards arrive one after another, numbers count up, and
 * each card lifts on hover.
 */

const CLOUDS = [
  [-40, 161, 154, 49, 9, 'F2'], [-5, 140, 105, 63, 9, 'F2'], [65, 154, 126, 56, 9, 'F2'], [-82, 175, 140, 35, 9, 'F2'],
  [121, 175, 112, 35, 9, 'F2'], [200, 126, 121, 38, 7, 'CC'], [228, 110, 82, 50, 7, 'CC'], [282, 121, 99, 44, 7, 'CC'],
  [167, 138, 110, 28, 7, 'CC'], [326, 138, 88, 28, 7, 'CC'],
]

const AVATARS = [
  ['KA', '#2F86EA'],
  ['AO', '#D86AA6'],
  ['EB', '#15803D'],
  ['YM', '#F59E0B'],
]

const NUMBER = 'font-tight text-[48px] leading-[110%] tracking-[-0.045em] text-ink sm:text-[56px]'
const fmtInt = (n) => Math.round(n).toLocaleString('en')

export default function Bento() {
  const t = useT()
  return (
    <section id="results" className="mx-auto w-full max-w-[1416px] scroll-mt-24 px-5 pb-[100px] pt-[72px] sm:px-10 xl:px-[120px]">
      <Reveal className="mk-stagger flex flex-col gap-[18px] lg:flex-row">
        {/* Blue farm card */}
        <div className="lg:w-[380px] lg:shrink-0">
          <div
            className="mk-lift relative h-[420px] overflow-clip rounded-[24px]"
            style={{ backgroundImage: 'linear-gradient(in oklab 180deg, #2F86EA 0%, #8CC6F6 100%)' }}
          >
            <div className="mk-drift absolute inset-0" style={{ '--mk-drift': '22px', '--mk-dur': '18s' }} aria-hidden>
              {CLOUDS.map(([l, tp, w, h, b, a], i) => (
                <span key={i} className="absolute rounded-pill" style={{ left: l, top: tp, width: w, height: h, filter: `blur(${b}px)`, backgroundColor: `#FFFFFF${a}` }} />
              ))}
            </div>
            <svg viewBox="0 0 364 220" preserveAspectRatio="xMidYMax slice" className="absolute inset-x-2 top-[200px] h-[220px] w-[calc(100%-16px)]" aria-hidden>
              <rect y="120" width="364" height="100" fill="#185AB3" />
              <ellipse className="mkb-bob" cx="110" cy="160" rx="70" ry="15" fill="#0C357066" stroke="#CFE6FF99" strokeWidth="1.6" />
              <ellipse className="mkb-bob" style={{ animationDelay: '1.2s' }} cx="270" cy="180" rx="80" ry="17" fill="#0C357066" stroke="#CFE6FF99" strokeWidth="1.6" />
              <line x1="40" y1="135" x2="90" y2="135" stroke="#FFFFFF4D" strokeWidth="2" />
              <line x1="220" y1="140" x2="300" y2="140" stroke="#FFFFFF4D" strokeWidth="2" />
            </svg>
            <div className="absolute left-6 top-[22px] flex items-center gap-2">
              <svg width="22" height="15" viewBox="0 0 28 20" aria-hidden className="mk-bob shrink-0">
                <path d="M2 10c4-6 10-8 16-6l8-4-2 10 2 10-8-4C12 18 6 16 2 10z" fill="#FFFFFF" />
                <circle cx="9" cy="9" r="1.6" fill="#1C6FE0" />
              </svg>
              <span className="text-[16px] font-bold leading-[20px] tracking-tight text-white">PBA FARM</span>
            </div>
            <div className="absolute right-6 top-[18px] flex size-10 items-center justify-center rounded-[12px] bg-white" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 24 24">
                <path className="mkb-bars" d="M6 20V10M12 20V4M18 20v-6" fill="none" stroke="#0B0D10" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            </div>
            <div className="absolute inset-x-5 top-[250px] flex flex-col gap-2 rounded-[18px] bg-white p-[22px]">
              <CountUp value={4200} format={(n) => `${fmtInt(n)}+`} className="font-tight text-[56px] leading-[100%] tracking-[-0.045em] text-ink" />
              <p className="text-[14px] leading-[145%] text-[#374151]">{t('marketing.bento.farmsBody')}</p>
            </div>
          </div>
        </div>

        {/* Entries on time */}
        <div className="lg:w-[380px] lg:shrink-0">
          <div className="mk-lift flex h-full min-h-[420px] flex-col rounded-[24px] bg-mist p-[26px]">
            <p className="text-[14px] leading-[18px] text-[#374151]">{t('marketing.bento.onTimeLabel')}</p>
            <CountUp value={98} format={(n) => `${Math.round(n)}%`} className={`${NUMBER} pt-[10px]`} />
            <div className="mt-auto flex flex-col gap-[14px] pt-8">
              <div className="flex pl-2">
                {AVATARS.map(([i, c]) => (
                  <span
                    key={i}
                    className="-ml-2 flex size-[34px] shrink-0 items-center justify-center rounded-pill border-2 border-mist text-[11px] font-semibold leading-[14px] text-white"
                    style={{ backgroundColor: c }}
                    aria-hidden
                  >
                    {i}
                  </span>
                ))}
              </div>
              <blockquote className="text-[16px] leading-[150%] text-ink">{t('marketing.bento.quote')}</blockquote>
              <p className="text-sm leading-4 text-[#6B7280]">{t('marketing.bento.quoteBy')}</p>
            </div>
          </div>
        </div>

        {/* Readings and feed saved */}
        <div className="flex grow basis-0 flex-col gap-[18px]">
          <div className="mk-lift flex min-h-[270px] flex-col rounded-[24px] bg-lime p-[26px]">
            <p className="text-[14px] leading-[18px] text-ink">{t('marketing.bento.readingsLabel')}</p>
            <CountUp value={1.2} decimals={1} format={(n) => `${n.toFixed(1)}M`} className={`${NUMBER} pt-[10px]`} />
            <p className="mt-auto pt-6 text-base leading-[150%] text-ink">{t('marketing.bento.readingsBody')}</p>
          </div>
          <div className="mk-lift flex min-h-[132px] items-center justify-between gap-4 rounded-[24px] bg-ink px-[28px] py-6">
            <p className="text-base leading-[18px] text-white">{t('marketing.bento.feedSaved')}</p>
            <CountUp value={11} format={(n) => `−${Math.round(n)}%`} className="font-tight text-[44px] leading-[64px] tracking-[-0.045em] text-white sm:text-[52px]" />
          </div>
        </div>
      </Reveal>
      <style jsx global>{`
        @keyframes mkb-bob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(3px); }
        }
        .mkb-bob { animation: mkb-bob 4.4s ease-in-out infinite; transform-box: fill-box; }
        @media (prefers-reduced-motion: reduce) {
          .mkb-bob { animation: none !important; }
        }
      `}</style>
    </section>
  )
}
