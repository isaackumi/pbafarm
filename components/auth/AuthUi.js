/**
 * Signed-out screens (Paper 15 / 15b / 60 / 61, P-AUTH): split layout with
 * the form on the left and the lake scene on the right (lg and up), plus the
 * form pieces those screens share.
 *
 * Light-only Paper values use the `[html[data-theme=light]_&]:` variant
 * (the root always carries data-theme, see pages/_document.js).
 */
import { useId, useRef, useState } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { ANOWA_CORAL } from '../brand/AnowaLogo'
import LanguageSwitcher from '../LanguageSwitcher'
import { useT } from '../../lib/i18n/context'

/** Optional public status page for the footer's "Status ●". */
const STATUS_URL = process.env.NEXT_PUBLIC_STATUS_URL || ''

/**
 * Paper 15 lockup: the Pulse mark (33.9×20, line #F4F0E8 dark / #0B0D10
 * light, coral dot) and "anowa" in Geist Mono 18/22 medium, 10px apart.
 */
export function Brand({ href = '/' }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2.5 rounded-pill focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-ink"
    >
      <svg
        width="33.9"
        height="20"
        viewBox="0.5 16.25 60.25 35.5"
        aria-hidden
        className="shrink-0 text-[#F4F0E8] [html[data-theme=light]_&]:text-ink"
      >
        <path
          d="M14.5 34 H18 L23 19 L30 49 L36 27 L40 34 H46 L58 22 L58 46 L46 34"
          fill="none"
          stroke="currentColor"
          strokeWidth="5.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="4.5" cy="34" r="4" fill={ANOWA_CORAL} />
      </svg>
      <span className="font-geist text-[18px] font-medium leading-[22px] tracking-[-0.02em] text-text">anowa</span>
    </Link>
  )
}

// [cx, cy, rx, ry, ring var, fill var] — the six cages, Paper 15 order.
const CAGES = [
  [180, 560, 70, 16, '--scene-cage-ring', '--scene-cage-fill'],
  [340, 575, 78, 18, '--scene-cage-ring', '--scene-cage-fill'],
  [510, 560, 70, 16, '--scene-cage-hot-ring', '--scene-cage-hot-fill'],
  [250, 640, 92, 22, '--scene-cage-ring', '--scene-cage-fill'],
  [450, 650, 96, 23, '--scene-cage-ring', '--scene-cage-fill'],
  [640, 640, 88, 21, '--scene-cage-ring', '--scene-cage-lime-fill'],
]
const v = (name) => `var(${name})`

/**
 * Paper 60 (sign up, dark) draws its own night: these literals replace the
 * Paper 15 scene tokens for that scene only. Light 60 matches light 15.
 */
const SIGNUP_DARK = {
  sky: [
    [0, '#0B1220', 1],
    [0.55, '#123A78', 1],
    [0.8, '#1562D6', 0.85],
    [1, '#B9DDF9', 0.6],
  ],
  sun: [
    [0, '#EAF4FD', 1],
    [0.4, '#B9DDF9', 0.55],
    [1, '#B9DDF9', 0],
  ],
  hills: '#14202E',
  water: ['#1A2E45', '#0B0D10'],
  ring: '#2A2E33',
  fills: ['#6AA8F512', '#6AA8F512', '#D7F75B12', '#6AA8F512', '#6AA8F512', '#6AA8F512'],
}

/** Gradient stops; each entry is [offset, colour, opacity]. */
function Stops({ stops }) {
  return stops.map(([offset, color, opacity]) => (
    <stop key={offset} offset={offset} style={{ stopColor: color, stopOpacity: opacity }} />
  ))
}

/**
 * Sky and lake with cage rings (Paper 15 / 60 visual side). The dark and
 * light artboards differ in geometry as well as colour (sun position and
 * size, clouds, cage posts), so each theme gets its own drawing.
 */
export function LakeScene({ scene = 'login' }) {
  const id = useId().replace(/:/g, '')
  const signup = scene === 'signup'
  const ripple = (
    <path d="M500 506h120M470 520h180M520 534h80" fill="none" strokeWidth="2" style={{ stroke: v('--scene-ripple') }} />
  )
  const hills = 'M0 470 C120 430 220 450 320 432 S520 420 620 440 S760 430 788 446 V500 H0Z'
  const svgClass = 'absolute inset-0 h-full w-full'
  return (
    <>
      {/* Dark: Paper 15 (50X-0) or 60 (GXI-0) */}
      <svg
        viewBox="0 0 788 868"
        preserveAspectRatio="xMidYMid slice"
        className={`${svgClass} [html[data-theme=light]_&]:hidden`}
        aria-hidden
      >
        <defs>
          <linearGradient id={`${id}dsky`} x1="0" y1="0" x2="0" y2="1">
            <Stops
              stops={
                signup
                  ? SIGNUP_DARK.sky
                  : [
                      [0, v('--scene-sky-1')],
                      [0.5, v('--scene-sky-2')],
                      [0.8, v('--scene-sky-3')],
                      [1, v('--scene-sky-4')],
                    ]
              }
            />
          </linearGradient>
          <linearGradient id={`${id}dwater`} x1="0" y1="0" x2="0" y2="1">
            <Stops
              stops={
                signup
                  ? [
                      [0, SIGNUP_DARK.water[0]],
                      [1, SIGNUP_DARK.water[1]],
                    ]
                  : [
                      [0, v('--scene-water-top')],
                      [1, v('--scene-water-bottom')],
                    ]
              }
            />
          </linearGradient>
          <radialGradient id={`${id}dsun`} cx="0.5" cy="0.5" r="0.5">
            <Stops
              stops={
                signup
                  ? SIGNUP_DARK.sun
                  : [
                      [0, v('--scene-sun')],
                      [0.35, v('--scene-sun-halo')],
                      [1, v('--scene-sun-edge')],
                    ]
              }
            />
          </radialGradient>
        </defs>
        <rect width="788" height="500" fill={`url(#${id}dsky)`} />
        <circle cx="560" cy="470" r="140" fill={`url(#${id}dsun)`} />
        <path d={hills} style={{ fill: signup ? SIGNUP_DARK.hills : v('--scene-hills') }} />
        <rect y="496" width="788" height="372" fill={`url(#${id}dwater)`} />
        {ripple}
        {CAGES.map(([cx, cy, rx, ry, ring, fill], i) => (
          <g key={`${cx}-${cy}`}>
            <ellipse
              cx={cx}
              cy={cy}
              rx={rx}
              ry={ry}
              fill="none"
              strokeWidth="3"
              style={{ stroke: signup ? SIGNUP_DARK.ring : v(ring) }}
            />
            <ellipse cx={cx} cy={cy} rx={rx - 8} ry={ry - 3} style={{ fill: signup ? SIGNUP_DARK.fills[i] : v(fill) }} />
            <path
              d={`M${cx - rx} ${cy}v10M${cx + rx} ${cy}v10`}
              fill="none"
              strokeWidth="2"
              style={{ stroke: signup ? SIGNUP_DARK.ring : v('--scene-cage-post') }}
            />
          </g>
        ))}
      </svg>
      {/* Light: L · 15 (7YE-0) and 60 Light (KLV-0) draw the same day scene */}
      <svg
        viewBox="0 0 788 868"
        preserveAspectRatio="xMidYMid slice"
        className={`${svgClass} hidden [html[data-theme=light]_&]:block`}
        aria-hidden
      >
        <defs>
          <linearGradient id={`${id}lsky`} x1="0" y1="0" x2="0" y2="1">
            <Stops
              stops={[
                [0, v('--scene-sky-1')],
                [0.5, v('--scene-sky-2')],
                [1, v('--scene-sky-4')],
              ]}
            />
          </linearGradient>
          <linearGradient id={`${id}lwater`} x1="0" y1="0" x2="0" y2="1">
            <Stops
              stops={[
                [0, v('--scene-water-top')],
                [1, v('--scene-water-bottom')],
              ]}
            />
          </linearGradient>
          <radialGradient id={`${id}lsun`} cx="0.5" cy="0.5" r="0.5">
            <Stops
              stops={[
                [0, v('--scene-sun')],
                [0.45, v('--scene-sun-halo')],
                [1, v('--scene-sun-edge')],
              ]}
            />
          </radialGradient>
        </defs>
        <rect width="788" height="500" fill={`url(#${id}lsky)`} />
        <circle cx="560" cy="440" r="150" fill={`url(#${id}lsun)`} />
        <ellipse cx="200" cy="220" rx="140" ry="26" style={{ fill: v('--scene-cloud') }} />
        {/* #FFFFFF80: the cloud token is white at 0.6, so 5/6 of it is 0.5 */}
        <ellipse cx="620" cy="160" rx="110" ry="20" style={{ fill: v('--scene-cloud'), fillOpacity: 5 / 6 }} />
        <path d={hills} style={{ fill: v('--scene-hills') }} />
        <rect y="496" width="788" height="372" fill={`url(#${id}lwater)`} />
        {ripple}
        {CAGES.map(([cx, cy, rx, ry, ring, fill]) => (
          <g key={`${cx}-${cy}`}>
            <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" strokeWidth="3" style={{ stroke: v(ring) }} />
            <ellipse cx={cx} cy={cy} rx={rx - 8} ry={ry - 3} style={{ fill: v(fill) }} />
          </g>
        ))}
      </svg>
    </>
  )
}

const SCENE_CARD =
  'absolute flex rounded-[18px] border [background-color:var(--scene-card-bg)] [border-color:var(--scene-card-border)] [box-shadow:var(--scene-card-shadow)]'

/**
 * Floating cards over the scene (Paper 15 / 60). The light artboards place
 * the top-right card and the testimonial outside the frame, so light shows
 * only the left card.
 */
function SceneCards({ scene }) {
  const t = useT()
  const k = scene === 'signup' ? 'signup' : 'login'
  return (
    <>
      <div className={`${SCENE_CARD} right-10 top-[210px] w-[300px] flex-col gap-2.5 px-5 py-[18px] [html[data-theme=light]_&]:hidden`}>
        <p className="flex items-center gap-2 text-xs leading-4 [color:var(--scene-card-ok)]">
          <span className="size-[7px] shrink-0 rounded-pill bg-dot-good" />
          {t(`authUi.panel.${k}.cardTopLabel`)}
        </p>
        <p className="text-[14px] font-semibold leading-[18px] text-text">{t(`authUi.panel.${k}.cardTopTitle`)}</p>
        <p className="text-xs leading-4 text-muted">{t(`authUi.panel.${k}.cardTopMeta`)}</p>
      </div>
      <div className={`${SCENE_CARD} left-12 top-[330px] w-[280px] flex-col gap-1.5 px-5 py-[18px]`}>
        <p className="text-xs leading-4 text-muted">{t(`authUi.panel.${k}.cardLeftLabel`)}</p>
        <p className="text-[30px] font-semibold leading-9 tracking-[-0.03em] text-text">
          {t(`authUi.panel.${k}.cardLeftValue`)}
        </p>
        <p className="text-xs leading-4 text-muted">{t(`authUi.panel.${k}.cardLeftMeta`)}</p>
      </div>
      <div
        className={`${SCENE_CARD} inset-x-12 bottom-10 items-center justify-between gap-4 px-[22px] py-[18px] [html[data-theme=light]_&]:hidden`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="size-9 shrink-0 rounded-pill" style={{ backgroundImage: 'var(--gradient-sky)' }} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-[13px] leading-4 text-text">{t('authUi.panel.quote')}</p>
            <p className="text-xs leading-4 text-muted">{t('authUi.panel.quoteBy')}</p>
          </div>
        </div>
        <p className="shrink-0 text-xs leading-4 text-muted">{t('authUi.panel.reach')}</p>
      </div>
    </>
  )
}

/**
 * Split auth frame. `scene` picks the visual side ('login' for Paper 15,
 * 'signup' for Paper 60); `eyebrow`/`headline` override its caption. `gap`
 * is the form column's rhythm (22px on 15, 18px on 60). `footer` replaces
 * the "Privacy · Terms · Status" links on the right of the footer; `cards={false}`
 * drops the floating cards (Paper 70 draws none). The scene hides
 * below lg so phones get the form only.
 */
export function AuthLayout({ title, scene = 'login', eyebrow, headline, gap = 'gap-[22px]', footer, cards = true, children }) {
  const t = useT()
  const k = scene === 'signup' ? 'signup' : 'login'
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
        <main className={`mx-auto flex w-full max-w-[428px] flex-col ${gap}`}>{children}</main>
        <footer className="mx-auto flex w-full max-w-[428px] flex-wrap items-center justify-between gap-2 text-xs leading-4 text-faint">
          <span>{t('authUi.footerSecure')}</span>
          {footer || (
            <span>
              <Link href="/privacy" className="hover:text-text focus:outline-none focus-visible:underline">
                {t('authUi.footerPrivacy')}
              </Link>
              {' · '}
              <Link href="/terms" className="hover:text-text focus:outline-none focus-visible:underline">
                {t('authUi.footerTerms')}
              </Link>
              {' · '}
              {STATUS_URL ? (
                <a href={STATUS_URL} className="hover:text-text focus:outline-none focus-visible:underline">
                  {t('authUi.footerStatus')}
                </a>
              ) : (
                t('authUi.footerStatus')
              )}{' '}
              <span className="text-good" aria-hidden>
                ●
              </span>
            </span>
          )}
        </footer>
      </div>
      <aside
        className="relative m-4 hidden min-w-0 grow overflow-hidden rounded-[28px] border border-line lg:block"
        style={{ backgroundColor: 'var(--scene-bg)' }}
        aria-hidden
      >
        <LakeScene scene={scene} />
        {cards && <SceneCards scene={scene} />}
        <div className="absolute left-12 top-12 flex max-w-[560px] flex-col gap-3.5 pr-12">
          <p className="text-[13px] uppercase leading-4 tracking-[0.08em] [color:var(--scene-eyebrow)]">
            {eyebrow || t(`authUi.panel.${k}.eyebrow`)}
          </p>
          <p className="text-[40px] font-semibold leading-[110%] tracking-[-0.03em] text-text">
            {headline || t(`authUi.panel.${k}.headline`)}
          </p>
        </div>
      </aside>
    </div>
  )
}

export function AuthHeading({ title, subtitle }) {
  return (
    <div className="flex flex-col gap-2.5">
      <h1 className="text-[32px] font-semibold leading-10 tracking-[-0.03em] text-text sm:text-[36px] sm:leading-[44px]">
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
  const dot = { alert: 'bg-dot-alert', good: 'bg-dot-good', info: 'bg-sky-ink' }
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

const AUTH_INPUT_BASE =
  'w-full rounded-input border border-line-strong text-[15px] leading-[18px] text-text placeholder:text-faint focus:border-sky-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-ink/30 disabled:opacity-60'

/** Paper 15 field: 14px radius, line-strong border, surface, 15/18 text, 14×18 padding. */
export const AUTH_INPUT = `${AUTH_INPUT_BASE} bg-surface px-[18px] py-3.5`

/** Paper 61 field inside a state card: page background, 13×16 padding. */
export const AUTH_INPUT_CARD = `${AUTH_INPUT_BASE} bg-bg px-4 py-[13px]`

/** Label (13px muted) over a control; `aside` sits right of the label (e.g. "Forgot?"). */
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

/** Password input with a Show/Hide toggle; `card` for the Paper 61 field. */
export function PasswordInput({ className = '', card = false, ...props }) {
  const t = useT()
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <input
        type={shown ? 'text' : 'password'}
        className={`${card ? AUTH_INPUT_CARD : AUTH_INPUT} pr-20 ${className}`}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-pressed={shown}
        aria-controls={props.id}
        className={`absolute inset-y-0 my-1.5 rounded-pill text-[13px] leading-4 text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-ink ${
          card ? 'right-1 px-3' : 'right-1.5 px-3'
        }`}
      >
        {shown ? t('authUi.hide') : t('authUi.show')}
      </button>
    </div>
  )
}

/** Inner padding and type: lg = Paper 15/60 (15/18, 14×24), md = 61 (14/18, 12×20), sm = 61 invite (14/18, 11×18). */
const SUBMIT_SIZE = {
  lg: 'px-6 py-3.5 text-[15px] leading-[18px]',
  md: 'px-5 py-3 text-[14px] leading-[18px]',
  sm: 'px-[18px] py-[11px] text-[14px] leading-[18px]',
}

/**
 * Primary pill: lime fill with a 1.5px lime ring and ink text (Paper 15, 60,
 * 61). Light adds the lime glow (#4F6B0066 0 8 20 -10). `lightSolid` is the
 * light 61 "Save & sign in": sky-gradient ring around the dark pill, white text.
 */
export function AuthSubmit({ children, className = '', type = 'submit', size = 'lg', lightSolid = false, ...props }) {
  const ring = lightSolid
    ? 'bg-lime [html[data-theme=light]_&]:bg-[image:var(--gradient-sky)]'
    : 'bg-lime [html[data-theme=light]_&]:shadow-[0_8px_20px_-10px_#4F6B0066]'
  const inner = lightSolid
    ? 'bg-lime text-ink [html[data-theme=light]_&]:bg-button [html[data-theme=light]_&]:text-button-text'
    : 'bg-lime text-ink'
  return (
    <button
      type={type}
      className={`group block w-full rounded-pill p-[1.5px] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-ink focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50 ${ring} ${className}`}
      {...props}
    >
      <span
        className={`flex items-center justify-center gap-2 rounded-pill font-semibold transition-opacity group-hover:opacity-90 ${inner} ${SUBMIT_SIZE[size] || SUBMIT_SIZE.lg}`}
      >
        {children}
      </span>
    </button>
  )
}

/**
 * Solid light pill (Paper 61 "Open Gmail"): #E4E6E8 dark / #0E1012 light,
 * 14/18 semibold, 13×20. Disabled is the drawn 61 "Verify": surface-2 fill, faint text.
 */
export function AuthSolid({ href, children, className = '', type = 'button', ...props }) {
  const cls = `flex w-full items-center justify-center gap-2 rounded-pill bg-button px-5 py-[13px] text-[14px] font-semibold leading-[18px] text-button-text hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-ink focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-faint disabled:hover:opacity-100 ${className}`
  if (href) {
    return (
      <a href={href} className={cls} {...props}>
        {children}
      </a>
    )
  }
  return (
    <button type={type} className={cls} {...props}>
      {children}
    </button>
  )
}

/** Outlined pill (Paper 61 "Resend in 0:42" 12×20; `hug` is "Decline", 12×18 and as wide as its label): line-strong border, 14/18 text. */
export function AuthGhost({ href, children, className = '', type = 'button', hug = false, ...props }) {
  const cls = `flex items-center justify-center gap-2 rounded-pill border border-line-strong py-3 ${hug ? 'shrink-0 px-[18px]' : 'w-full px-5'} text-[14px] leading-[18px] text-text hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-ink disabled:cursor-not-allowed disabled:opacity-50 ${className}`
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

/** Sky text link/button used inline on auth screens (#6AA8F5 dark, #1562D6 light). */
export const AUTH_LINK =
  'rounded-sm text-sky-ink hover:underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-ink disabled:text-muted disabled:no-underline'

/**
 * Paper 15 / 60 checkbox: 18px, 6px radius; checked is the light pill fill
 * (#E4E6E8 / #0E1012) with a 12px check in the pill text colour.
 */
export function AuthCheckbox({ id, checked, onChange, children, labelClassName = 'text-muted', ...props }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2.5">
      <span className="relative flex size-[18px] shrink-0">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 m-0 cursor-pointer opacity-0"
          {...props}
        />
        <span
          className="flex size-[18px] items-center justify-center rounded-[6px] border border-line-strong bg-surface text-button-text peer-checked:border-transparent peer-checked:bg-button peer-focus-visible:ring-2 peer-focus-visible:ring-sky-ink [&>svg]:invisible peer-checked:[&>svg]:visible"
          aria-hidden
        >
          <svg width="12" height="12" viewBox="0 0 24 24">
            <path d="M5 12l5 5L20 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </span>
      <span className={`text-[13px] leading-4 ${labelClassName}`}>{children}</span>
    </label>
  )
}

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
      className="grid rounded-pill border border-line bg-surface p-1"
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
            className={`rounded-pill py-[9px] text-[13px] leading-4 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-ink ${
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
 * Six code boxes over one real input, so paste, autofill (one-time-code)
 * and screen readers see a single field. Default is Paper 15b (60px boxes,
 * surface, 24/30 digits, 10px apart); `card` is Paper 61 (52px boxes on the
 * page background, 22/28 digits, 8px apart, a 2×22 caret in the active box,
 * #3D86E6 on light).
 */
export function OtpInput({ id, value, onChange, length = 6, label, autoFocus = false, disabled = false, card = false }) {
  const [focused, setFocused] = useState(false)
  const digits = value.split('')
  const active = Math.min(value.length, length - 1)
  const activeBorder = card
    ? 'border-[1.5px] border-sky-ink [html[data-theme=light]_&]:border-[#3D86E6]'
    : 'border-[1.5px] border-sky-ink'
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
      <div
        className={`grid ${card ? 'gap-2' : 'gap-2 sm:gap-2.5'}`}
        style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}
        aria-hidden
      >
        {Array.from({ length }).map((_, i) => {
          const isActive = focused && i === active
          return (
            <div
              key={i}
              className={`flex items-center justify-center rounded-input font-semibold text-text ${
                card ? 'h-[52px] bg-bg text-[22px] leading-7' : 'h-[60px] bg-surface text-2xl leading-[30px]'
              } ${isActive ? activeBorder : 'border border-line-strong'}`}
            >
              {digits[i] ||
                (card && isActive ? (
                  <span className="h-[22px] w-[2px] shrink-0 bg-sky-ink [html[data-theme=light]_&]:bg-[#3D86E6]" />
                ) : (
                  ''
                ))}
            </div>
          )
        })}
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

/**
 * Four 4px segments 6px apart, then "Label · hint" in 12/16 muted (Paper 60
 * "Strong", 61 "Fair"). Dark tints the label (#86EFAC strong, warn fair);
 * light leaves it muted and uses #16A34A / #D97706 bars.
 */
export function StrengthBar({ password, className = '' }) {
  const t = useT()
  if (!password) return null
  const score = passwordScore(password)
  const labels = ['', 'weak', 'fair', 'good', 'strong']
  const bar =
    score >= 3
      ? 'bg-good [html[data-theme=light]_&]:bg-[#16A34A]'
      : score === 2
        ? 'bg-warn [html[data-theme=light]_&]:bg-[#D97706]'
        : 'bg-alert'
  const tone =
    score >= 3
      ? 'text-[color:var(--pill-green-text)] [html[data-theme=light]_&]:text-muted'
      : score === 2
        ? 'text-warn [html[data-theme=light]_&]:text-muted'
        : 'text-alert'
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="grid grid-cols-4 gap-1.5" aria-hidden>
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={`h-1 rounded-pill ${n <= score ? bar : 'bg-line-strong'}`} />
        ))}
      </div>
      <p className="text-xs leading-4 text-muted">
        <span className={tone}>{t(`authUi.strength.${labels[score]}`)}</span>
        {' · '}
        {t(score === 4 ? 'authUi.strength.hintStrong' : 'authUi.strength.hintMore')}
      </p>
    </div>
  )
}

/** Paper 61 state-card icons: 22px, 2px strokes in the text colour. */
export const StateIcon = {
  mail: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M4 7l8 6 8-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  phone: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="7" y="2" width="10" height="20" rx="2.5" />
      <path d="M11 18h2" strokeLinecap="round" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="11" width="16" height="10" rx="2.5" />
      <path d="M8 11V8a4 4 0 018 0v3" strokeLinecap="round" />
    </svg>
  ),
}

/** 52px ring: 1.5px sky gradient around the surface, icon 22px (Paper 61). */
export function IconRing({ children }) {
  return (
    <span
      className="inline-flex h-[52px] w-[52px] shrink-0 rounded-full p-[1.5px]"
      style={{ backgroundImage: 'var(--gradient-sky)' }}
      aria-hidden
    >
      <span className="flex h-full w-full items-center justify-center rounded-full bg-surface text-text [&>svg]:h-[22px] [&>svg]:w-[22px]">
        {children}
      </span>
    </span>
  )
}

/**
 * Paper 61 state card: 20px radius, surface, line border, 32×28 padding,
 * 20px gap (light adds the card shadow); eyebrow, icon or `media`, title
 * 22/28 -0.02em, body 14/20 muted, then actions.
 */
export function AuthStateCard({ eyebrow, icon, media, title, body, children }) {
  return (
    <section className="flex flex-col gap-5 rounded-card border border-line bg-surface px-7 py-8 [box-shadow:var(--shadow-card)]">
      {eyebrow && <p className="text-[11px] uppercase leading-[14px] tracking-[0.08em] text-faint">{eyebrow}</p>}
      {icon && <IconRing>{icon}</IconRing>}
      {media}
      {(title || body) && (
        <div className="flex flex-col gap-2">
          {title && <h1 className="text-[22px] font-semibold leading-7 tracking-[-0.02em] text-text">{title}</h1>}
          {body && <div className="text-[14px] leading-5 text-muted">{body}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

/**
 * Text that Paper 61 highlights in the dark theme only (the email, phone,
 * role): text colour on dark, muted like its sentence on light.
 */
export function DarkEmphasis({ children, className = '' }) {
  return <span className={`text-text [html[data-theme=light]_&]:text-muted ${className}`}>{children}</span>
}

/** Seconds as m:ss ("0:42"), the Paper 15b / 61 resend countdown. */
export function clock(seconds) {
  const s = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
