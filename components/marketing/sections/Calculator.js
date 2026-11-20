import { useEffect, useId, useRef, useState } from 'react'
import { useLocale, useT } from '../../../lib/i18n/context'
import { Reveal, prefersReducedMotion } from '../../../lib/marketing/motion'
import { fcrSavings, formatAmount, formatTonnes } from '../../../lib/marketing/fcrSavings'
import { Eyebrow, Heading, PillButton } from '../ui'

/**
 * Paper v4 "FCR calculator", made live: drag any slider and the yearly
 * saving tweens to its new value. Native range inputs (keyboard and screen
 * reader friendly) sit invisibly over Paper's track and knob.
 */

function useTween(target, duration = 450) {
  const [value, setValue] = useState(target)
  const fromRef = useRef(target)
  useEffect(() => {
    if (prefersReducedMotion()) {
      fromRef.current = target
      setValue(target)
      return undefined
    }
    const from = fromRef.current
    const start = performance.now()
    let raf
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration)
      const v = from + (target - from) * (1 - (1 - p) ** 3)
      fromRef.current = v
      setValue(v)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return value
}

function Slider({ label, display, value, min, max, step, onChange, valueText }) {
  const id = useId()
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="text-[15px] leading-5 text-[#4B5563]">
          {label}
        </label>
        <span className="whitespace-nowrap font-geist text-[18px] leading-6 text-ink sm:text-[20px]" aria-hidden>
          {display}
        </span>
      </div>
      <div className="relative h-[22px]">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-valuetext={valueText}
          onChange={(e) => onChange(Number(e.target.value))}
          className="peer absolute inset-0 z-10 h-[22px] w-full cursor-pointer opacity-0"
        />
        <div className="pointer-events-none absolute left-0 right-0 top-2 h-1.5 rounded-pill bg-[#DDE1E6]" aria-hidden>
          <div className="h-1.5 rounded-pill bg-ink" style={{ width: `${pct}%` }} />
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 size-[22px] rounded-pill border-2 border-ink bg-white shadow-[0_2px_6px_#0B0D1026] transition-transform peer-hover:scale-110 peer-active:scale-110 peer-focus-visible:ring-4 peer-focus-visible:ring-sky/40"
          style={{ left: `calc(${pct}% - ${(pct / 100) * 22}px)` }}
        />
      </div>
    </div>
  )
}

export default function Calculator() {
  const t = useT()
  const { locale } = useLocale()
  const [cages, setCages] = useState(24)
  const [tonnes, setTonnes] = useState(4)
  const [price, setPrice] = useState(9.8)
  const [fcr, setFcr] = useState(1.6)
  const [improvement, setImprovement] = useState(0.1)

  const r = fcrSavings({ cages, tonnesPerCage: tonnes, improvement, pricePerKg: price })
  const shown = useTween(r.amount)
  const fmtPrice = price.toFixed(2)
  const target = Math.max(0, fcr - improvement).toFixed(2).replace(/0$/, '')
  const fcrText = fcr.toFixed(2).replace(/0$/, '')
  const impText = improvement.toFixed(2).replace(/0$/, '')

  return (
    <section id="calculator" className="mx-auto w-full max-w-[1416px]">
      <div className="flex flex-col items-center gap-[44px] px-5 py-10 sm:px-10 xl:px-[120px]">
        <Reveal className="flex max-w-[900px] flex-col items-center gap-4 text-center">
          <Eyebrow>{t('marketing.calculator.eyebrow')}</Eyebrow>
          <Heading lead={t('marketing.calculator.titleLead')} accent={t('marketing.calculator.titleAccent')} />
        </Reveal>

        <Reveal variant="scale" className="flex w-full max-w-[1176px] flex-col gap-[18px] lg:flex-row">
          <div className="flex grow basis-0 flex-col justify-center gap-[30px] rounded-[24px] bg-mist p-6 sm:p-9">
            <Slider
              label={t('marketing.calculator.cages')}
              display={cages}
              valueText={String(cages)}
              value={cages}
              min={1}
              max={200}
              step={1}
              onChange={setCages}
            />
            <Slider
              label={t('marketing.calculator.tonnes')}
              display={`${formatTonnes(tonnes, locale)} t`}
              valueText={`${formatTonnes(tonnes, locale)} t`}
              value={tonnes}
              min={0.5}
              max={20}
              step={0.5}
              onChange={setTonnes}
            />
            <Slider
              label={t('marketing.calculator.price')}
              display={`GH₵ ${fmtPrice} / kg`}
              valueText={`GH₵ ${fmtPrice} / kg`}
              value={price}
              min={2}
              max={30}
              step={0.1}
              onChange={(v) => setPrice(Math.round(v * 10) / 10)}
            />
            <Slider
              label={t('marketing.calculator.fcr')}
              display={`${fcrText} → ${target}`}
              valueText={`${fcrText} → ${target}`}
              value={fcr}
              min={1}
              max={2.5}
              step={0.05}
              onChange={(v) => setFcr(Math.round(v * 100) / 100)}
            />
            <Slider
              label={t('marketing.calculator.improvement')}
              display={impText}
              valueText={impText}
              value={improvement}
              min={0.05}
              max={0.5}
              step={0.05}
              onChange={(v) => setImprovement(Math.min(Math.round(v * 100) / 100, Math.round((fcr - 0.5) * 100) / 100))}
            />
          </div>

          <div className="flex w-full shrink-0 flex-col justify-between gap-6 rounded-[24px] bg-lime p-6 sm:p-9 lg:w-[440px]">
            <div className="flex flex-col gap-2.5">
              <p className="font-mono-dm text-xs uppercase leading-4 tracking-[0.08em] text-ink">{t('marketing.calculator.resultLabel')}</p>
              <p className="font-tight text-[48px] leading-none tracking-[-0.05em] text-ink tabular-nums sm:text-[64px]" aria-live="polite">
                GH₵ {formatAmount(shown, locale)}
              </p>
              <p className="font-serif text-[28px] italic leading-[110%] text-ink">{t('marketing.calculator.perYear')}</p>
            </div>
            <div className="flex flex-col gap-4">
              <p className="font-geist text-[13px] leading-5 text-[#3F4A12]">
                {t('marketing.calculator.formula1', {
                  improvement: impText,
                  fish: formatTonnes(r.fishTonnes, locale),
                  feed: formatTonnes(r.feedTonnes, locale),
                })}
                <br />
                {t('marketing.calculator.formula2', {
                  feed: formatTonnes(r.feedTonnes, locale),
                  price: fmtPrice,
                  amount: formatAmount(r.amount, locale),
                })}
              </p>
              <PillButton href="/signup" variant="ink" className="justify-between">
                {t('marketing.calculator.cta')}
              </PillButton>
              <p className="text-xs leading-[17px] text-[#3F4A12]">{t('marketing.calculator.note')}</p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
