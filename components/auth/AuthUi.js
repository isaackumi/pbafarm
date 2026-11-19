/**
 * Signed-out screens (Paper 15 / 15b / 60 / 61, P-AUTH): split layout with
 * the form on the left and the lake scene on the right (lg and up), plus the
 * form pieces those screens share.
 */
import { useId, useRef, useState } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { Lock } from 'lucide-react'
import { AnowaLockup } from '../brand/AnowaLogo'
import LanguageSwitcher from '../LanguageSwitcher'
import { useT } from '../../lib/i18n/context'

export function Brand({ href = '/' }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2.5 rounded-pill focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
    >
      <AnowaLockup height={20} />
    </Link>
  )
}

/** Lake at dawn with cage rings (Paper 15 visual side); colours come from the theme's scene tokens. */
export function LakeScene() {
  const id = useId().replace(/:/g, '')
  const stop = (v, extra = {}) => ({ stopColor: `var(${v})`, ...extra })
  const cages = [
    [180, 560, 70, 16, '--cyan'],
    [340, 575, 78, 18, '--cyan'],
    [510, 560, 70, 16, '--alert'],
    [250, 640, 92, 22, '--cyan'],
    [450, 650, 96, 23, '--cyan'],
    [640, 640, 88, 21, '--cyan'],
  ]
  return (
    <svg
      viewBox="0 0 788 868"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
      aria-hidden
    >
      <defs>
        <linearGradient id={`${id}sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={stop('--scene-sky-top')} />
          <stop offset="0.55" style={stop('--scene-sky-mid')} />
          <stop offset="0.72" style={stop('--pink-fill', { stopOpacity: 0.55 })} />
        </linearGradient>
        <linearGradient id={`${id}water`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={stop('--scene-water-top')} />
          <stop offset="1" style={stop('--scene-water-bottom')} />
        </linearGradient>
        <radialGradient id={`${id}sun`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" style={stop('--scene-sun')} />
          <stop offset="0.4" style={stop('--pink-fill', { stopOpacity: 0.6 })} />
          <stop offset="1" style={stop('--pink-fill', { stopOpacity: 0 })} />
        </radialGradient>
      </defs>
      <rect width="788" height="500" fill={`url(#${id}sky)`} />
      <circle cx="560" cy="470" r="140" fill={`url(#${id}sun)`} />
      <path
        d="M0 470 C120 430 220 450 320 432 S520 420 620 440 S760 430 788 446 V500 H0Z"
        style={{ fill: 'var(--scene-hills)' }}
      />
      <rect y="496" width="788" height="372" fill={`url(#${id}water)`} />
      <path
        d="M500 506h120M470 520h180M520 534h80"
        fill="none"
        strokeWidth="2"
        style={{ stroke: 'var(--pink)', strokeOpacity: 0.35 }}
      />
      {cages.map(([cx, cy, rx, ry, tone]) => (
        <g key={`${cx}-${cy}`}>
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" strokeWidth="3" style={{ stroke: 'var(--line-strong)' }} />
          <ellipse cx={cx} cy={cy} rx={rx - 8} ry={ry - 3} style={{ fill: `var(${tone})`, fillOpacity: 0.06 }} />
          <path
            d={`M${cx - rx} ${cy}v10M${cx + rx} ${cy}v10`}
            fill="none"
            strokeWidth="2"
            style={{ stroke: 'var(--line-strong)' }}
          />
        </g>
      ))}
    </svg>
  )
}

/**
 * Split auth frame. `eyebrow`/`headline` caption the scene (defaults to the
 * sign-in copy). The scene hides below lg so phones get the form only.
 */
export function AuthLayout({ title, eyebrow, headline, children, footer }) {
  const t = useT()
  return (
    <div className="flex min-h-screen bg-bg text-text">
      {title && (
        <Head>
          <title>{`${title} · Anowa`}</title>
        </Head>
      )}
      <div className="flex w-full shrink-0 flex-col justify-between gap-10 px-6 py-8 sm:px-12 lg:w-[620px] lg:px-24 lg:py-11">
        <header className="mx-auto flex w-full max-w-[428px] items-center justify-between">
          <Brand />
          <LanguageSwitcher />
        </header>
        <main className="mx-auto flex w-full max-w-[428px] flex-col gap-[22px]">{children}</main>
        <footer className="mx-auto flex w-full max-w-[428px] flex-wrap items-center justify-between gap-2 text-xs leading-4 text-faint">
          <span className="inline-flex items-center gap-1.5">
            <Lock size={12} aria-hidden />
            {t('authUi.footerSecure')}
          </span>
          {footer}
        </footer>
      </div>
      <aside
        className="relative m-4 hidden min-w-0 grow overflow-hidden rounded-[28px] border border-line lg:block"
        style={{ backgroundColor: 'var(--scene-bg)' }}
        aria-hidden
      >
        <LakeScene />
        <div className="absolute left-12 top-12 flex max-w-[560px] flex-col gap-3.5 pr-12">
          <p className="text-[13px] uppercase leading-4 tracking-[0.08em] text-cyan">
            {eyebrow || t('authUi.panel.loginEyebrow')}
          </p>
          <p className="text-[40px] font-semibold leading-[110%] tracking-[-0.03em] text-text">
            {headline || t('authUi.panel.loginHeadline')}
          </p>
        </div>
      </aside>
    </div>
  )
}

export function AuthHeading({ title, subtitle }) {
  return (
    <div className="flex flex-col gap-2.5">
      <h1 className="text-[32px] font-semibold leading-10 tracking-[-0.03em] text-text sm:text-4xl sm:leading-[44px]">
        {title}
      </h1>
      {subtitle && <p className="text-[15px] leading-[18px] text-muted">{subtitle}</p>}
    </div>
  )
}

/** Inline message: `tone` alert (default), good or info. */
export function AuthAlert({ tone = 'alert', children }) {
  const tones = {
    alert: 'border-[color:var(--alert-tint-border)] bg-[color:var(--alert-tint-bg)] text-text',
    good: 'border-[color:var(--pill-green-border)] bg-surface text-text',
    info: 'border-line-strong bg-surface text-muted',
  }
  const dot = { alert: 'bg-dot-alert', good: 'bg-dot-good', info: 'bg-cyan' }
  return (
    <div
      role={tone === 'alert' ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 rounded-input border px-4 py-3 text-sm leading-5 ${tones[tone] || tones.alert}`}
    >
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot[tone] || dot.alert}`} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export const AUTH_INPUT =
  'w-full rounded-input border border-line-strong bg-surface px-[18px] py-3.5 text-[15px] leading-[18px] text-text placeholder:text-faint focus:border-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan/30 disabled:opacity-60'

/** Label (14px muted) over a control; `aside` sits right of the label (e.g. "Forgot?"). */
export function AuthField({ label, htmlFor, aside, hint, error, children }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={htmlFor} className="text-[13px] leading-4 text-muted">
          {label}
        </label>
        {aside}
      </div>
      {children}
      {error ? (
        <p className="text-xs leading-4 text-alert">{error}</p>
      ) : (
        hint && <p className="text-xs leading-4 text-faint">{hint}</p>
      )}
    </div>
  )
}

export function AuthInput({ className = '', ...props }) {
  return <input className={`${AUTH_INPUT} ${className}`} {...props} />
}

/** Password input with a Show/Hide toggle. */
export function PasswordInput({ className = '', ...props }) {
  const t = useT()
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <input type={shown ? 'text' : 'password'} className={`${AUTH_INPUT} pr-20 ${className}`} {...props} />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-pressed={shown}
        aria-controls={props.id}
        className="absolute inset-y-0 right-1.5 my-1.5 rounded-pill px-3 text-[13px] leading-4 text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
      >
        {shown ? t('authUi.hide') : t('authUi.show')}
      </button>
    </div>
  )
}

/** Full-width primary: gradient ring around the solid light pill (Paper 15 "Sign in"). */
export function AuthSubmit({ children, className = '', type = 'submit', ...props }) {
  return (
    <button
      type={type}
      className={`group block w-full rounded-pill p-[1.5px] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      style={{ backgroundImage: 'var(--gradient-brand)' }}
      {...props}
    >
      <span className="flex items-center justify-center gap-2 rounded-pill bg-button px-6 py-3.5 text-[15px] font-semibold leading-[18px] text-button-text transition-opacity group-hover:opacity-90">
        {children}
      </span>
    </button>
  )
}

/** Full-width outlined pill (secondary action on auth screens). */
export function AuthGhost({ href, children, className = '', type = 'button', ...props }) {
  const cls = `flex w-full items-center justify-center gap-2 rounded-pill border border-line-strong px-5 py-3 text-sm leading-[18px] text-text hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:cursor-not-allowed disabled:opacity-50 ${className}`
  if (href) {
    return (
      <Link href={href} className={cls} {...props}>
        {children}
      </Link>
    )
  }
  return (
    <button type={type} className={cls} {...props}>
      {children}
    </button>
  )
}

export function AuthDivider({ label }) {
  return (
    <div className="flex items-center gap-3.5 text-xs leading-4 text-faint" role="separator">
      <span className="h-px flex-1 bg-line" />
      {label}
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}

/** Cyan text link/button used inline on auth screens. */
export const AUTH_LINK =
  'rounded-sm text-cyan hover:underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:text-muted disabled:no-underline'

/** Pill segmented tabs (Paper 15 Email / Phone code / SSO). Arrow keys move between tabs. */
export function MethodTabs({ label, tabs, value, onChange }) {
  const refs = useRef([])
  const onKeyDown = (e, i) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (i + step + tabs.length) % tabs.length
    onChange(tabs[next].id)
    refs.current[next]?.focus()
  }
  return (
    <div
      role="tablist"
      aria-label={label}
      className="grid gap-1 rounded-pill border border-line bg-surface p-1"
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
    >
      {tabs.map((tab, i) => {
        const active = tab.id === value
        return (
          <button
            key={tab.id}
            ref={(el) => (refs.current[i] = el)}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`rounded-pill py-[9px] text-[13px] leading-4 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
              active ? 'bg-button font-semibold text-button-text' : 'text-muted hover:text-text'
            }`}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Six code boxes over one real input (Paper 15b), so paste, autofill
 * (one-time-code) and screen readers see a single field.
 */
export function OtpInput({ id, value, onChange, length = 6, label, autoFocus = false, disabled = false }) {
  const [focused, setFocused] = useState(false)
  const digits = value.split('')
  const active = Math.min(value.length, length - 1)
  return (
    <div className="relative">
      <input
        id={id}
        name={id}
        aria-label={label}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern={`[0-9]{${length}}`}
        maxLength={length}
        required
        autoFocus={autoFocus}
        disabled={disabled}
        value={value}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, length))}
        className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0"
      />
      <div className="grid gap-2 sm:gap-2.5" style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }} aria-hidden>
        {Array.from({ length }).map((_, i) => (
          <div
            key={i}
            className={`flex h-[60px] items-center justify-center rounded-input bg-surface text-2xl font-semibold leading-[30px] text-text ${
              focused && i === active ? 'border-[1.5px] border-cyan' : 'border border-line-strong'
            }`}
          >
            {digits[i] || ''}
          </div>
        ))}
      </div>
    </div>
  )
}

/** 0–4 from length and character variety; a hint only, the server sets the rules. */
export function passwordScore(pw) {
  if (!pw) return 0
  let score = 0
  if (pw.length >= 8) score += 1
  if (pw.length >= 12) score += 1
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score += 1
  return Math.max(1, score)
}

/** Four-segment strength bar with a text label (Paper 60 / 61 reset). */
export function StrengthBar({ password }) {
  const t = useT()
  if (!password) return null
  const score = passwordScore(password)
  const labels = ['', 'weak', 'fair', 'good', 'strong']
  const fill = score >= 3 ? 'var(--dot-good)' : score === 2 ? 'var(--warn)' : 'var(--alert)'
  const tone = score >= 3 ? 'text-[color:var(--pill-green-text)]' : score === 2 ? 'text-warn' : 'text-alert'
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-4 gap-1.5" aria-hidden>
        {[1, 2, 3, 4].map((n) => (
          <span
            key={n}
            className="h-1 rounded-pill bg-line-strong"
            style={n <= score ? { background: fill } : undefined}
          />
        ))}
      </div>
      <p className={`text-xs leading-4 ${tone}`}>{t(`authUi.strength.${labels[score]}`)}</p>
    </div>
  )
}

/** 52px gradient ring with an icon (Paper 61 state cards). */
export function IconRing({ children }) {
  return (
    <span
      className="inline-flex h-[52px] w-[52px] shrink-0 rounded-full p-[1.5px]"
      style={{ backgroundImage: 'var(--gradient-brand)' }}
      aria-hidden
    >
      <span className="flex h-full w-full items-center justify-center rounded-full bg-surface text-text [&>svg]:h-[22px] [&>svg]:w-[22px]">
        {children}
      </span>
    </span>
  )
}

/** Paper 61 state card: eyebrow, icon ring, title, body, then actions. */
export function AuthStateCard({ eyebrow, icon, title, body, children }) {
  return (
    <section className="flex flex-col gap-5 rounded-card border border-line bg-surface px-7 py-8">
      {eyebrow && <p className="text-[11px] uppercase leading-[14px] tracking-[0.08em] text-faint">{eyebrow}</p>}
      {icon && <IconRing>{icon}</IconRing>}
      {(title || body) && (
        <div className="flex flex-col gap-2">
          {title && <h1 className="text-[22px] font-semibold leading-7 tracking-tight text-text">{title}</h1>}
          {body && <div className="text-sm leading-5 text-muted">{body}</div>}
        </div>
      )}
      {children}
    </section>
  )
}
