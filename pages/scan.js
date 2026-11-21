import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { ScanFrame, useQrCamera } from '../components/QrScanner'
import { Field, Input } from '../components/ui'
import { useToast } from '../components/Toast'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { api } from '../convex/_generated/api'
import { useReferenceList } from '../hooks/useReferenceList'
import { usePermission } from '../hooks/usePermission'
import { useOnline } from '../hooks/useOutbox'
import { useActiveOrganization } from '../lib/useActiveOrganization'
import { findCageByCode, parseCageScan, scanHref, shortCodeFor } from '../lib/qrTarget'
import { formatNumber, formatQuantity, getActiveLocale, getActiveZone, localToday } from '../lib/format'
import { useT } from '../lib/i18n/context'

export default function ScanPage() {
  const t = useT()
  return (
    <ProtectedRoute>
      <Layout title={t('scan.title')} hideTitle phoneBare>
        <Scan />
      </Layout>
    </ProtectedRoute>
  )
}

const idOf = (c) => String(c?.id || c?._id || '')
/** A missing figure (no reading yet, offline with nothing saved). */
const NONE = '\u2013'
const known = (n) => n != null && Number.isFinite(Number(n))
const isLink = (text) => /^https?:|^\//.test(String(text).trim())

/**
 * Paper 54 Mobile, Scan & QR (H44-0 dark, MDZ-0 light). Scan a cage label and
 * stay here: the cage card shows its batch, fish, weight, whether it was fed
 * today and its DO, with Log feed, Water and Mortality one tap away for that
 * cage. Labels that name a screen (/daily-entry?cage=…) still go straight
 * there. The cage in view is `?c=<short code>`, so the phone camera's own
 * scan of a label lands here too, and offline it resolves from the saved
 * cage list (MOBILE-003).
 */
function Scan() {
  const router = useRouter()
  const t = useT()
  const { showToast } = useToast()
  const { locationArgs, activeLocation } = useLocation()
  const { active: activeOrg } = useActiveOrganization()
  const { list: cages, ready: cagesLoaded } = useReferenceList('cages', api.cages.getActive, locationArgs)
  const videoRef = useRef(null)

  const labelCode = router.isReady && typeof router.query.c === 'string' ? router.query.c : null
  const cage = labelCode && cagesLoaded ? findCageByCode(labelCode, cages) : null

  const show = (found) => {
    router.replace({ pathname: '/scan', query: { c: shortCodeFor(found, cages) } }, undefined, { shallow: true })
  }

  // A declaration, so the camera hook below can be handed it.
  function onResult(text) {
    // Without a cage list (offline, first run) only full label links can be read.
    const known = cages.length ? cages : null
    const hit = parseCageScan(text, known)
    if (!hit || (!known && !isLink(text))) {
      showToast(t('scan.noMatch'), 'error')
      camera.resume()
      return
    }
    const one = hit.cageIds.length === 1 && !hit.target && known ? cages.find((c) => idOf(c) === hit.cageIds[0]) : null
    if (one) show(one)
    else router.push(scanHref(hit, 'daily'))
  }

  const camera = useQrCamera({ active: true, videoRef, onResult })
  const { markDone } = camera

  // A cage in view: stop reading codes until the person asks for another.
  useEffect(() => {
    if (cage) markDone()
  }, [cage, markDone])

  // A label code that matches nothing on this farm.
  const handledCode = useRef(null)
  useEffect(() => {
    if (!labelCode || !cagesLoaded || cage || handledCode.current === labelCode) return
    handledCode.current = labelCode
    showToast(t('scan.unknownCode', { code: labelCode }), 'error')
    router.replace('/scan', undefined, { shallow: true })
  }, [labelCode, cagesLoaded, cage, router, showToast, t])

  const scanAnother = () => {
    handledCode.current = null
    router.replace('/scan', undefined, { shallow: true })
    camera.resume()
  }

  const back = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back()
    else router.push('/dashboard')
  }

  const site = activeLocation?.name || activeOrg?.name || ''
  const iconBtn =
    'inline-flex size-11 shrink-0 items-center justify-center rounded-pill border border-line-strong text-text hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'

  return (
    // Paper sets proportional figures here (the app body uses tabular ones).
    <div className="mx-auto w-full max-w-[420px] [font-variant-numeric:normal] lg:max-w-[390px]">
      {/* Paper 54 header: 44px round back and torch, 17/22 title over the site. */}
      <div className="flex items-center justify-between px-4 pb-3 pt-[max(4px,env(safe-area-inset-top))]">
        <button type="button" onClick={back} aria-label={t('scan.back')} className={iconBtn}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <div className="flex min-w-0 flex-col items-center gap-[2px] px-2 text-center">
          <h1 className="text-[17px] font-semibold leading-[22px] text-text">{t('scan.title')}</h1>
          {site && <p className="truncate text-xs leading-4 text-muted">{site}</p>}
        </div>
        {camera.torch ? (
          <button
            type="button"
            onClick={camera.toggleTorch}
            aria-pressed={camera.torch.on}
            aria-label={camera.torch.on ? t('scan.torchOff') : t('scan.torchOn')}
            className={`${iconBtn} ${camera.torch.on ? 'bg-surface-2' : ''}`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill={camera.torch.on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
              <path d="M9 2h6l-1 7h4l-8 13 1-9H7z" />
            </svg>
          </button>
        ) : (
          // No torch on this camera: keep the title centred, no dead control.
          <span className="size-11 shrink-0" aria-hidden />
        )}
      </div>

      <div className="flex flex-col gap-4 px-4">
        <Viewfinder videoRef={videoRef} camera={camera} cage={cage} onScanAnother={scanAnother} />
        {cage ? (
          <CageCard cage={cage} />
        ) : (
          <TypedCode onSubmit={onResult} />
        )}
      </div>
    </div>
  )
}

/** The 300px navy viewfinder with the camera feed, corner frame and status pill. */
function Viewfinder({ videoRef, camera, cage, onScanAnother }) {
  const t = useT()
  const { status, reason } = camera
  const live = status === 'scanning'
  const pill = cage
    ? { dot: 'bg-[#4ADE80] [html[data-theme=light]_&]:bg-[#16A34A]', text: t('scan.recognised', { name: cage.name }) }
    : status === 'fallback'
      ? null
      : { dot: 'bg-[#8B9097]', text: live ? t('scan.pointAt') : t('scan.starting') }

  return (
    <div className="relative flex h-[300px] shrink-0 items-center justify-center overflow-hidden rounded-[24px] bg-[radial-gradient(circle_farthest-corner_at_50%_40%_in_oklab,#15305A_0%,#0C1728_55%,#07090C_100%)] [html[data-theme=light]_&]:bg-[radial-gradient(circle_farthest-corner_at_50%_40%_in_oklab,#183457_0%,#0D1A2B_55%,#070A0F_100%)]">
      <video
        ref={videoRef}
        playsInline
        muted
        className={`absolute inset-0 h-full w-full object-cover ${live ? '' : 'hidden'}`}
      />
      {status === 'fallback' ? (
        <p className="px-6 text-center text-[14px] leading-5 text-[#8B9097]">{t(`scan.reason.${reason}`)}</p>
      ) : (
        <ScanFrame className="flex size-[190px] shrink-0 items-center justify-center">
          {!live && <LabelGlyph />}
        </ScanFrame>
      )}
      {pill && (
        <div className="absolute bottom-4 left-0 flex w-full justify-center" role="status" aria-live="polite">
          <span className="flex items-center gap-2 rounded-pill bg-[#0A0B0CCC] px-[14px] py-2 text-[13px] leading-4 text-[#F2F3F4]">
            <span className={`size-2 shrink-0 rounded-pill ${pill.dot}`} aria-hidden />
            {pill.text}
          </span>
        </div>
      )}
      {cage && (
        <button
          type="button"
          onClick={onScanAnother}
          aria-label={t('scan.scanAnother')}
          className="absolute inset-0 rounded-[24px] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan"
        />
      )}
    </div>
  )
}

/** Paper 54's label tile: what to point at before the camera feed is up. */
function LabelGlyph() {
  return (
    <span
      className="relative flex size-[118px] shrink-0 items-center justify-center rounded-[12px] bg-[#F2F3F4] opacity-[0.92] [html[data-theme=light]_&]:bg-white"
      aria-hidden
    >
      <svg width="92" height="92" viewBox="0 0 29 29">
        <path
          d="M0 0h7v7H0zM1 1v5h5V1zM2 2h3v3H2zM22 0h7v7h-7zM23 1v5h5V1zM24 2h3v3h-3zM0 22h7v7H0zM1 23v5h5v-5zM2 24h3v3H2zM9 0h2v2H9zM12 1h3v2h-3zM16 0h2v3h-2zM9 4h3v2H9zM14 5h4v2h-4zM19 2h2v4h-2zM9 9h2v2H9zM13 9h3v3h-3zM18 9h2v2h-2zM22 9h2v3h-2zM26 9h3v2h-3zM0 9h3v2H0zM4 10h3v3H4zM1 13h2v3H1zM9 13h2v4H9zM12 14h3v2h-3zM17 13h4v2h-4zM23 13h2v2h-2zM26 13h3v4h-3zM5 16h3v2H5zM13 18h2v3h-2zM16 17h3v2h-3zM20 17h4v2h-4zM9 19h3v2H9zM9 23h2v3H9zM12 22h3v2h-3zM17 21h2v4h-2zM21 21h3v3h-3zM25 20h2v2h-2zM13 26h3v3h-3zM20 26h4v3h-4zM26 24h3v2h-3zM9 27h3v2H9zM26 27h3v2h-3z"
          fill="#0A0B0C"
        />
      </svg>
    </span>
  )
}

const CARD =
  'flex flex-col gap-4 rounded-[24px] border border-line bg-surface p-5 shadow-[var(--shadow-card)]'

/** Typing the code: for a torn label, no camera, or a browser that cannot scan. */
function TypedCode({ onSubmit }) {
  const t = useT()
  const [typed, setTyped] = useState('')
  const submit = (e) => {
    e.preventDefault()
    const value = typed.trim()
    if (!value) return
    setTyped('')
    onSubmit(value)
  }
  return (
    <form onSubmit={submit} className={CARD}>
      <Field label={t('scan.typeLabel')} htmlFor="scan-typed">
        <Input
          id="scan-typed"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          placeholder={t('scan.typePlaceholder')}
        />
      </Field>
      <button
        type="submit"
        disabled={!typed.trim()}
        className="flex min-h-[48px] w-full items-center justify-center rounded-[16px] bg-button text-[15px] font-medium text-button-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t('scan.openCage')}
      </button>
    </form>
  )
}

function clockTime(ms) {
  try {
    return new Intl.DateTimeFormat(getActiveLocale(), {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: getActiveZone() || undefined,
    }).format(new Date(ms))
  } catch {
    return new Date(ms).toTimeString().slice(0, 5)
  }
}

/**
 * The scanned cage (Paper 54 card): batch, fish, average weight, today's
 * feeding and the latest DO, from api.scan.cageCard. Offline it shows what
 * the saved cage list knows and says so.
 */
function CageCard({ cage }) {
  const t = useT()
  const { user } = useAuth()
  const online = useOnline()
  const canLog = usePermission('production.daily.record')
  const id = idOf(cage)
  const [today] = useState(localToday)
  const card = useQuery(api.scan.cageCard, user && id ? { id, today } : 'skip')
  const live = card || null

  const batch = live?.batchNumber
  const fish = live?.fish ?? cage.current_count
  const abw = live?.abwG ?? cage.current_weight
  const dox = live?.dissolvedOxygen || null

  let chip = null
  if (live?.logged && live.logged.feedKg > 0) {
    chip = { tone: 'good', text: t('scan.card.fedToday', { time: clockTime(live.logged.at) }) }
  } else if (live?.logged) {
    chip = { tone: 'neutral', text: t('scan.card.loggedToday', { time: clockTime(live.logged.at) }) }
  } else if (live) {
    chip = { tone: 'neutral', text: t('scan.card.notFed') }
  } else if (card === undefined && !online) {
    chip = { tone: 'neutral', text: t('scan.card.offline') }
  }
  const chipTone =
    chip?.tone === 'good'
      ? 'border-[var(--pill-green-border)] text-[var(--pill-green-text)] [html[data-theme=light]_&]:border-[#A7DDB8]'
      : 'border-line-strong text-muted'

  const doText = dox ? formatNumber(dox.value, { decimals: 1 }) : NONE
  const stat = 'flex min-w-0 flex-1 basis-0 flex-col gap-[2px]'
  const label = 'text-xs leading-4 text-muted'
  const value = 'truncate text-[16px] font-semibold leading-5'

  const actions = [
    {
      key: 'feed',
      href: `/daily-entry?cage=${encodeURIComponent(id)}`,
      label: t('scan.card.logFeed'),
      primary: true,
      icon: <path d="M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10" strokeLinecap="round" />,
    },
    {
      key: 'water',
      href: `/water-entry?unit=${encodeURIComponent(id)}`,
      label: t('scan.card.water'),
      iconClass: 'stroke-cyan',
      icon: <path d="M12 3s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11z" strokeLinejoin="round" />,
    },
    {
      key: 'mortality',
      href: `/daily-entry?cage=${encodeURIComponent(id)}&focus=mortality`,
      label: t('scan.card.mortality'),
      iconClass: 'stroke-alert',
      icon: <path d="M12 5v14M5 12h14" transform="rotate(45 12 12)" strokeLinecap="round" />,
    },
  ]

  return (
    <section aria-labelledby="scan-cage-name" className={CARD}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="truncate text-xs uppercase leading-4 tracking-[0.06em] text-faint">
            {batch ? `${t('scan.card.cage')} · ${batch}` : t('scan.card.cage')}
          </p>
          <h2 id="scan-cage-name" className="truncate text-[28px] font-semibold leading-8 tracking-[-0.02em] text-text">
            {cage.name}
          </h2>
        </div>
        {chip && (
          <span className={`shrink-0 rounded-pill border px-3 py-1 text-xs leading-4 ${chipTone}`}>{chip.text}</span>
        )}
      </div>

      <dl className="flex">
        <div className={stat}>
          <dt className={label}>{t('scan.card.fish')}</dt>
          <dd className={`${value} text-text`}>{known(fish) ? formatNumber(fish) : NONE}</dd>
        </div>
        <div className={`${stat} border-l border-line pl-[14px]`}>
          <dt className={label}>{t('scan.card.avgWt')}</dt>
          <dd className={`${value} text-text`}>
            {known(abw) ? formatQuantity(abw, 'smallMass', { decimals: 0 }) : NONE}
          </dd>
        </div>
        <div className={`${stat} border-l border-line pl-[14px]`}>
          <dt className={label}>{t('scan.card.do')}</dt>
          <dd
            className={`${value} ${dox?.low ? 'text-warn' : 'text-text'}`}
            aria-label={
              dox
                ? dox.low && dox.min != null
                  ? t('scan.card.doLow', { value: doText, min: formatNumber(dox.min, { decimals: 1 }) })
                  : t('scan.card.doUnit', { value: doText })
                : t('scan.card.noReading')
            }
          >
            {doText}
          </dd>
        </div>
      </dl>

      {canLog && (
        <nav aria-label={t('scan.card.actions')} className="flex gap-2">
          {actions.map((a) => (
            <Link
              key={a.key}
              href={a.href}
              className={`flex min-h-[44px] flex-1 basis-0 flex-col items-center gap-[6px] rounded-[16px] py-3 text-[13px] leading-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
                a.primary
                  ? 'bg-pink-fill font-medium text-[#0A0B0C] [html[data-theme=light]_&]:font-semibold [html[data-theme=light]_&]:text-[#0B0D10]'
                  : 'border border-line-strong bg-surface-2 font-medium text-text [html[data-theme=light]_&]:border-line [html[data-theme=light]_&]:bg-surface'
              }`}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth="2"
                className={`shrink-0 ${a.primary ? 'stroke-current' : a.iconClass}`}
                aria-hidden
              >
                {a.icon}
              </svg>
              {a.label}
            </Link>
          ))}
        </nav>
      )}
    </section>
  )
}
