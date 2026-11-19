import Head from 'next/head'
import { Check } from 'lucide-react'
import { useT } from '../../lib/i18n/context'
import { Brand } from '../auth/AuthUi'
import LanguageSwitcher from '../LanguageSwitcher'

/** Paper 16 step marker: done = solid check, current = gradient ring, upcoming = outline. */
function StepMarker({ state, n }) {
  if (state === 'done') {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-button text-button-text">
        <Check size={14} strokeWidth={2.5} aria-hidden />
      </span>
    )
  }
  if (state === 'current') {
    return (
      <span className="flex h-7 w-7 shrink-0 rounded-full p-[1.5px]" style={{ backgroundImage: 'var(--gradient-brand)' }}>
        <span className="flex h-full w-full items-center justify-center rounded-full bg-surface text-xs font-semibold text-text">
          {n}
        </span>
      </span>
    )
  }
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-strong text-xs text-faint">
      {n}
    </span>
  )
}

/**
 * Paper 16 onboarding frame: a 340px step rail on the left, the step content
 * on the right and an optional footer bar (Back · Skip · Continue).
 * `steps` is [{ id, label, hint?, state: 'done' | 'current' | 'upcoming' }].
 */
export default function OnboardingLayout({ title, subtitle, pageTitle, steps, children, footer, aside }) {
  const t = useT()
  const currentIndex = Math.max(
    0,
    steps.findIndex((s) => s.state === 'current'),
  )
  const doneCount = steps.filter((s) => s.state === 'done').length
  const progress = Math.round(((doneCount + 0.5) / steps.length) * 100)

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text lg:flex-row">
      <Head>
        <title>{`${pageTitle || title} · Anowa`}</title>
      </Head>
      <aside className="flex shrink-0 flex-col gap-8 border-b border-line bg-surface px-6 py-6 sm:px-7 lg:w-[340px] lg:border-b-0 lg:border-r lg:py-9">
        <div className="flex items-center justify-between">
          <Brand />
          <LanguageSwitcher className="lg:hidden" />
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-[13px] uppercase leading-4 tracking-[0.08em] text-cyan">{t('onboarding.eyebrow')}</p>
          <p className="text-sm leading-5 text-muted">
            {t('onboarding.stepOf', { n: currentIndex + 1, total: steps.length })}
          </p>
          <div
            className="mt-1.5 h-1 overflow-hidden rounded-pill bg-surface-2"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            aria-label={t('onboarding.eyebrow')}
          >
            <div className="h-full rounded-pill" style={{ width: `${progress}%`, backgroundImage: 'var(--gradient-bar)' }} />
          </div>
        </div>
        <ol className="hidden flex-col gap-5 lg:flex">
          {steps.map((s, i) => (
            <li key={s.id} className="flex items-start gap-3.5" aria-current={s.state === 'current' ? 'step' : undefined}>
              <StepMarker state={s.state} n={i + 1} />
              <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
                <span
                  className={`text-[15px] leading-5 ${
                    s.state === 'upcoming' ? 'text-muted' : s.state === 'current' ? 'font-semibold text-text' : 'text-text'
                  }`}
                >
                  {s.label}
                  <span className="sr-only"> · {t(`onboarding.state.${s.state}`)}</span>
                </span>
                {s.hint && <span className="truncate text-[13px] leading-4 text-faint">{s.hint}</span>}
              </div>
            </li>
          ))}
        </ol>
        {aside && <div className="mt-auto hidden text-sm leading-5 text-muted lg:block">{aside}</div>}
      </aside>

      <main className="flex min-w-0 grow flex-col px-6 pb-8 pt-10 sm:px-12 lg:px-20 lg:pt-14">
        <div className="hidden justify-end lg:flex">
          <LanguageSwitcher />
        </div>
        <div className="flex w-full max-w-[720px] grow flex-col gap-7">
          <div className="flex flex-col gap-2.5">
            <h1 className="text-[28px] font-semibold leading-9 tracking-[-0.03em] text-text sm:text-[34px] sm:leading-[42px]">
              {title}
            </h1>
            {subtitle && <p className="text-base leading-[22px] text-muted">{subtitle}</p>}
          </div>
          {children}
        </div>
        {footer && (
          <div className="mt-10 flex w-full max-w-[720px] flex-wrap items-center gap-3 border-t border-line pt-6">{footer}</div>
        )}
      </main>
    </div>
  )
}

/** Paper 16 input: bg-bg, 14px radius, 13/16 padding. */
export const ONBOARDING_INPUT =
  'w-full rounded-input border border-line-strong bg-bg px-4 py-[13px] text-[15px] leading-5 text-text placeholder:text-faint focus:border-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan/40 disabled:opacity-60'

export function OnboardingField({ label, htmlFor, hint, required, children, className = '' }) {
  const t = useT()
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <label htmlFor={htmlFor} className="text-sm leading-[18px] text-muted">
        {label}
        {required ? <span className="sr-only"> ({t('onboarding.required')})</span> : null}
      </label>
      {children}
      {hint && <p className="text-xs leading-4 text-faint">{hint}</p>}
    </div>
  )
}
