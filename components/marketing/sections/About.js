import { useT } from '../../../lib/i18n/context'
import { Reveal } from '../../../lib/marketing/motion'
import { Eyebrow } from '../ui'

/**
 * "From fingerling to fork" (Paper Q79-2). The words arrive one by one; the
 * fish swims through its blue bubble (tail wagging), the lime feed pellet
 * drips with a ripple, and a hand-drawn line underlines "and traceable".
 */

function Words({ text, className = '' }) {
  return text.split(' ').map((w, i) => (
    <span key={`${w}-${i}`} className={`inline-block ${className}`}>
      {w}&nbsp;
    </span>
  ))
}

function FishBubble() {
  return (
    <span className="relative mx-[0.08em] inline-flex size-[0.88em] shrink-0 items-center justify-center overflow-hidden rounded-pill bg-[#2F86EA] align-middle" aria-hidden>
      <span className="mka-across absolute inset-0 flex items-center justify-center">
        <span className="inline-flex" style={{ transform: 'scaleX(-1)' }}>
          <svg viewBox="0 0 28 20" className="mk-bob h-[0.36em] w-[0.5em]">
            <path d="M2 10c4-6 10-8 16-6 C19 8 19 12 18 16 C12 18 6 16 2 10z" fill="#FFFFFF" />
            <path className="mk-tail" d="M18 4 L26 0 L24 10 L26 20 L18 16 C19 12 19 8 18 4z" fill="#FFFFFF" />
            <circle cx="9" cy="9" r="1.6" fill="#1C6FE0" />
          </svg>
        </span>
      </span>
      <span className="mka-bubble absolute bottom-[22%] left-[30%] size-[0.07em] rounded-pill border border-white/70" />
      <span className="mka-bubble absolute bottom-[18%] left-[42%] size-[0.05em] rounded-pill border border-white/60" style={{ animationDelay: '1.1s' }} />
    </span>
  )
}

function FeedDrop() {
  return (
    <span className="relative mx-[0.08em] inline-flex size-[0.88em] shrink-0 items-center justify-center rounded-pill bg-lime align-middle" aria-hidden>
      <span className="mka-ripple absolute inset-0 rounded-pill border-2 border-lime" />
      <svg viewBox="0 0 18 22" className="mk-drip h-[0.42em] w-[0.35em]">
        <path d="M9 1C9 1 2 9 2 14a7 7 0 0014 0C16 9 9 1 9 1z" fill="#0B0D10" />
        <path d="M6 14a3 3 0 0 0 3 3" fill="none" stroke="#D7F75B" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
      </svg>
    </span>
  )
}

export default function About() {
  const t = useT()
  return (
    <section id="about" className="mx-auto flex scroll-mt-24 w-full max-w-[1416px] flex-col items-center gap-[26px] px-5 pb-[56px] pt-[72px] sm:pt-[90px]">
      <Reveal>
        <Eyebrow>{t('marketing.about.eyebrow')}</Eyebrow>
      </Reveal>
      <Reveal as="h2" className="flex max-w-[960px] flex-col items-center gap-1 text-center font-tight font-normal text-[32px] leading-[118%] tracking-[-0.045em] text-ink sm:text-[42px] lg:text-[52px] lg:leading-[110%]">
        <span className="mk-stagger flex flex-wrap items-center justify-center">
          <Words text={t('marketing.about.line1a')} />
          <span className="inline-flex">
            <FishBubble />
            &nbsp;
          </span>
          <Words text={t('marketing.about.line1b')} />
        </span>
        <span className="mk-stagger flex flex-wrap items-center justify-center">
          <Words text={t('marketing.about.line2a')} />
          <span className="inline-flex">
            <FeedDrop />
            &nbsp;
          </span>
          <span className="relative inline-block font-serif text-[1.19em] italic tracking-[-0.01em] text-[#6B7280]">
            {t('marketing.about.line2b')}
            <svg viewBox="0 0 300 14" preserveAspectRatio="none" className="absolute -bottom-[0.12em] left-0 h-[0.22em] w-full" aria-hidden>
              <path
                className="mk-draw"
                style={{ '--mk-len': 320, '--mk-delay': '0.9s' }}
                d="M3 9 C 60 3, 120 12, 180 7 S 270 4, 297 8"
                fill="none"
                stroke="#2F86EA"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
          </span>
        </span>
      </Reveal>
      <style jsx global>{`
        @keyframes mka-across {
          0% { transform: translateX(-120%); }
          45%, 55% { transform: translateX(0); }
          100% { transform: translateX(120%); }
        }
        .mka-across { animation: mka-across 5.5s cubic-bezier(0.45, 0, 0.55, 1) infinite; }
        @keyframes mka-ripple {
          0% { transform: scale(1); opacity: 0.7; }
          80%, 100% { transform: scale(1.7); opacity: 0; }
        }
        .mka-ripple { animation: mka-ripple 2.8s ease-out infinite; }
        @keyframes mka-bubble {
          0% { transform: translateY(0); opacity: 0; }
          20% { opacity: 1; }
          100% { transform: translateY(-0.6em); opacity: 0; }
        }
        .mka-bubble { animation: mka-bubble 2.4s ease-in infinite; }
        @media (prefers-reduced-motion: reduce) {
          .mka-across, .mka-ripple, .mka-bubble { animation: none !important; }
          .mka-ripple, .mka-bubble { opacity: 0; }
        }
      `}</style>
    </section>
  )
}
