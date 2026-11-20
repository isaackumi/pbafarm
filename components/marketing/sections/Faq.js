import { useId, useState } from 'react'
import { useT } from '../../../lib/i18n/context'
import { Reveal } from '../../../lib/marketing/motion'
import { Eyebrow, MK_FOCUS, PillButton, Section } from '../ui'

/**
 * FAQ (Paper landing v4 "FAQ", PW6-2): heading and WhatsApp CTA on the left,
 * an accordion on the right. One answer open at a time (the first, as in
 * Paper); height animates with a 0fr → 1fr grid row and the "+" turns into
 * a "×" on a lime chip.
 */

const QUESTIONS = ['offline', 'spreadsheets', 'ponds', 'financials', 'ai']

function Item({ id, t, open, onToggle }) {
  const uid = useId()
  const buttonId = `${uid}-q`
  const panelId = `${uid}-a`
  return (
    <div className="border-t border-[#E5E7EB]">
      <h3>
        <button
          type="button"
          id={buttonId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className={`flex w-full items-center justify-between gap-6 py-6 text-left ${MK_FOCUS}`}
        >
          <span className="text-[17px] font-medium leading-6 tracking-[-0.01em] text-ink sm:text-[19px]">
            {t(`marketing.faq.items.${id}.q`)}
          </span>
          <span
            aria-hidden
            className={`flex size-8 shrink-0 items-center justify-center rounded-pill transition-colors duration-300 ${
              open ? 'bg-lime' : 'bg-[#F3F4F6]'
            }`}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              className={`transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)] ${open ? 'rotate-45' : ''}`}
            >
              <path d="M7 1v12M1 7h12" stroke="#0B0D10" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </span>
        </button>
      </h3>
      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        className={`grid transition-[grid-template-rows,opacity] duration-500 ease-[cubic-bezier(0.2,0.7,0.2,1)] ${
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <p className="max-w-[560px] pb-6 text-base leading-[160%] text-[#6B7280]">{t(`marketing.faq.items.${id}.a`)}</p>
        </div>
      </div>
    </div>
  )
}

export default function Faq() {
  const t = useT()
  const [open, setOpen] = useState(QUESTIONS[0])
  return (
    <Section id="faq" inner="flex flex-col gap-12 pb-20 pt-10 lg:flex-row lg:gap-20 lg:pb-[110px]">
      <Reveal className="flex w-full shrink-0 flex-col gap-4 lg:w-[380px]">
        <Eyebrow>{t('marketing.faq.eyebrow')}</Eyebrow>
        <h2 className="font-tight text-[38px] font-normal leading-[108%] tracking-[-0.045em] text-ink sm:text-[48px]">
          {t('marketing.faq.title')}
          <br />
          <span className="font-serif text-[1.17em] italic text-[#6B7280]">{t('marketing.faq.titleAccent')}</span>
        </h2>
        <p className="text-base leading-[160%] text-[#6B7280]">{t('marketing.faq.body')}</p>
        <div className="self-start pt-2">
          <PillButton href="mailto:hello@getanowa.com">{t('marketing.faq.cta')}</PillButton>
        </div>
      </Reveal>
      <Reveal delay={120} className="flex grow basis-0 flex-col border-b border-[#E5E7EB]">
        {QUESTIONS.map((id) => (
          <Item key={id} id={id} t={t} open={open === id} onToggle={() => setOpen(open === id ? null : id)} />
        ))}
      </Reveal>
    </Section>
  )
}
